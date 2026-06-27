/**
 * Output VAT — Phase 12B verify.
 *
 * Confirms the existing Output-VAT pipeline is correct and that the hardened
 * GET /reports/tax-summary reports OUTPUT VAT only:
 *   - VAT is computed in the BACKEND (salesService.computeTotals: base × rate),
 *     exclusive, not taken from client input, and snapshotted on the invoice.
 *   - postInvoiceEntry credits GL 2200 (VAT Payable) by exactly the tax.
 *   - tax-summary sums salesTotal/vatTotal/netSubtotal over POSTED invoices only;
 *     draft & cancelled are excluded; returns (negative tax) net the total down;
 *     date (from/to) and branchId filters scope the rows.
 *   - purchases, RCM flags, cash transactions, Customer.balance and Supplier.due
 *     do NOT affect the report (it reads Invoice rows only).
 *
 * WRITE/READ — all fixtures live under a throwaway company; cleanup deletes the
 * company LAST so FK cascade removes every created row. No residue.
 *
 *   cd backend && node scripts/verify-vat-output.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const postingService = require("../src/services/posting.service");
const salesService = require("../src/services/sales.service");

const {
  sequelize, Company, Customer, Supplier, Invoice, Account, CashTransaction,
  PurchaseOrder, JournalEntry,
} = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-VAT-${stamp}`;
const CUST = `CUS-VAT-${stamp}`;
const SUP = `SUP-VAT-${stamp}`;
const BR_A = `BR-A-${stamp}`;
const BR_B = `BR-B-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base;
let token;
async function taxSummary(query = "") {
  const r = await fetch(`${base}/reports/tax-summary${query}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO },
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
let invSeq = 0;
async function mkInvoice({ type = "sale", postingStatus = "posted", status = "paid", subtotal, tax, date = "2026-04-10", branchId = BR_A, paymentMethod = "Cash" }) {
  const total = Number(subtotal) + Number(tax);
  const id = `INV-VAT-${stamp}-${++invSeq}`;
  return Invoice.create({
    id, companyId: CO, customerId: CUST, customerName: "عميل ضريبة", type,
    subtotal, tax, total, vatRate: 5, date, status, postingStatus,
    paymentMethod, branch: "Main", branchId,
  });
}
const balOf = async (code) => {
  const a = await Account.findOne({ where: { companyId: CO, code } });
  return a ? Number(a.balance) : 0;
};

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" }); // admin → reports.view

  try {
    await Company.create({ id: CO, businessName: "Verify VAT Co", workspace: `verify-vat-${stamp}` });
    await models.Setting.create({ companyId: CO, key: "vatRate", value: 5 });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل ضريبة", phone: "+100", balance: 777 });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد ضريبة", phone: "+200", category: "general", due: 555 });

    console.log("1) backend computes VAT (exclusive, base × rate, not from client):");
    const t = salesService.computeTotals({ subtotal: 1000, makingCharge: 0, stoneValue: 0, discount: 0, vatRatePercent: 5 });
    check(approx(t.taxBase, 1000), "computeTotals taxBase = 1000");
    check(approx(t.tax, 50), "computeTotals tax = 1000 × 5% = 50 (exclusive)");
    check(approx(t.total, 1050), "computeTotals total = base + tax = 1050");
    check(!("clientTax" in t) && Object.keys(t).join(",") === "subtotal,taxBase,tax,total,vatRate", "computeTotals derives tax itself — no client-supplied tax field honoured");
    const t2 = salesService.computeTotals({ subtotal: 1000, makingCharge: 200, stoneValue: 100, discount: 50, vatRatePercent: 5 });
    check(approx(t2.taxBase, 1250) && approx(t2.tax, 62.5), "taxBase = sub+making+stone-discount = 1250, tax = 62.5");

    console.log("\n2) posting credits GL 2200 (VAT Payable) by exactly the tax:");
    const vatBefore = await balOf("2200");
    const postInv = await mkInvoice({ subtotal: 1000, tax: 50, date: "2026-04-10" });
    const je = await postingService.postInvoiceEntry(postInv.toJSON(), [], "Verify");
    check(Boolean(je) && je.status === "posted", "postInvoiceEntry posted a journal");
    check(approx(await balOf("2200"), vatBefore + 50), "GL 2200 (VAT Payable) increased by 50");
    const acc2200 = await Account.findOne({ where: { companyId: CO, code: "2200" } });
    check(acc2200 && acc2200.nature === "credit" && acc2200.type === "liability", "2200 is a credit/liability account (Output VAT Payable)");

    console.log("\n3) snapshot persisted on the invoice:");
    const reload = await Invoice.findByPk(postInv.id);
    check(Number(reload.tax) === 50, "Invoice.tax snapshot = 50");
    check(Number(reload.vatRate) === 5, "Invoice.vatRate snapshot = 5");
    check(Number(reload.subtotal) === 1000, "Invoice.subtotal (net-of-VAT base) = 1000");

    console.log("\n4) tax-summary math over posted invoices (returns netted):");
    // Already posted: postInv (sub 1000, tax 50). Add another posted sale + a return.
    await mkInvoice({ subtotal: 2000, tax: 100, date: "2026-04-12" });          // sale
    await mkInvoice({ type: "return", status: "returned", subtotal: -400, tax: -20, date: "2026-04-15" }); // return nets down
    const all = await taxSummary();
    check(all.status === 200, "GET /reports/tax-summary → 200");
    check(approx(all.json.totals.vatTotal, 130), "vatTotal = 50 + 100 - 20 = 130 (returns reverse VAT, no double-count)");
    check(approx(all.json.totals.netSubtotal, 2600), "netSubtotal = 1000 + 2000 - 400 = 2600");
    check(approx(all.json.totals.salesTotal, 2730), "salesTotal = 1050 + 2100 - 420 = 2730");
    check(all.json.totals.records === 3, "records counts the 3 posted invoices");

    console.log("\n5) draft & cancelled are excluded:");
    await mkInvoice({ postingStatus: "draft", subtotal: 5000, tax: 250, date: "2026-04-12" });
    await mkInvoice({ postingStatus: "cancelled", status: "cancelled", subtotal: 9000, tax: 450, date: "2026-04-12" });
    const afterDraft = await taxSummary();
    check(approx(afterDraft.json.totals.vatTotal, 130), "draft + cancelled invoices do NOT change vatTotal (still 130)");
    check(afterDraft.json.totals.records === 3, "draft + cancelled excluded from records");

    console.log("\n6) date (from/to) and branch filters scope the rows:");
    const ranged = await taxSummary("?from=2026-04-11&to=2026-04-13");
    check(approx(ranged.json.totals.vatTotal, 100), "from/to window keeps only the 2026-04-12 sale (vat 100)");
    check(ranged.json.filters.dateFilterApplied === true, "filters.dateFilterApplied = true");
    await mkInvoice({ subtotal: 800, tax: 40, date: "2026-04-12", branchId: BR_B }); // other branch
    const branchA = await taxSummary(`?branchId=${BR_A}`);
    check(approx(branchA.json.totals.vatTotal, 130), "branchId=A excludes the branch-B sale (vat stays 130)");
    const branchB = await taxSummary(`?branchId=${BR_B}`);
    check(approx(branchB.json.totals.vatTotal, 40), "branchId=B returns only the branch-B sale (vat 40)");

    console.log("\n7) purchases / RCM / cash / sub-ledger do NOT affect Output VAT:");
    const before = (await taxSummary()).json.totals.vatTotal;
    await PurchaseOrder.create({ id: `PO-VAT-${stamp}`, companyId: CO, supplierId: SUP, supplierName: "مورد ضريبة", status: "received", date: "2026-04-12", total: 5000, branch: "Main", notes: "DRC reverse VAT applied." });
    await CashTransaction.create({ id: `TX-VAT-${stamp}`, companyId: CO, type: "cash_in", account: "cash", amount: 3000, date: "2026-04-12", branch: "Main", status: "posted" });
    await Customer.update({ balance: 99999 }, { where: { id: CUST } });
    await Supplier.update({ due: 88888 }, { where: { id: SUP } });
    const after = (await taxSummary()).json.totals.vatTotal;
    check(approx(after, before), "purchase order + RCM note + cash_in + Customer.balance + Supplier.due leave vatTotal unchanged");

    console.log("\n8) report declares Output-VAT-only scope:");
    const meta = await taxSummary();
    check(meta.json.scope === "output_vat" && meta.json.meta.scope === "output_vat", "response declares scope = output_vat");
    check(meta.json.meta.includesInputVat === false && meta.json.meta.includesRcm === false, "meta: includesInputVat=false, includesRcm=false");
    check(meta.json.postedOnly === true && meta.json.returnsNetted === "via_negative_invoice_totals", "postedOnly + returnsNetted flags intact");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("journal entries (+lines cascade)", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("invoices", () => Invoice.destroy({ where: { companyId: CO }, force: true }));
    await safe("settings", () => models.Setting.destroy({ where: { companyId: CO } }));
    await safe("customers", () => Customer.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascade remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
