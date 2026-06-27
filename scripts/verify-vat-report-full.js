/**
 * Full VAT report (Output + Input + RCM) — Phase 12H verify.
 *
 * GET /reports/tax-summary now ADDITIVELY exposes Input VAT and RCM alongside
 * the unchanged 12B Output-VAT figures. This script proves:
 *   - backward compat: legacy scope/meta/vatTotal unchanged; vatTotal === outputVatTotal
 *   - Input VAT from received recoverable purchases; RCM net-zero; non-recoverable
 *     and consignment and unreceived purchases excluded
 *   - netVatPayable = output + rcmOutput - input - rcmInput (no double-count)
 *   - from/to filters sales AND purchases; the report creates no journals (read-only)
 *
 * WRITE/READ — fixtures under a throwaway company; cleanup deletes the company
 * LAST so FK cascade removes every row. No residue.
 *
 *   cd backend && node scripts/verify-vat-report-full.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Customer, Invoice, PurchaseOrder, Supplier, JournalEntry } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-VATF-${stamp}`;
const CUST = `CUS-VATF-${stamp}`;
const SUP = `SUP-VATF-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token;
async function report(query = "") {
  const r = await fetch(`${base}/reports/tax-summary${query}`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
let invN = 0, poN = 0;
async function mkInvoice({ type = "sale", postingStatus = "posted", status = "paid", subtotal, tax, date = "2026-05-10" }) {
  return Invoice.create({
    id: `INV-VATF-${stamp}-${++invN}`, companyId: CO, customerId: CUST, customerName: "عميل", type,
    subtotal, tax, total: Number(subtotal) + Number(tax), vatRate: 5, date, status, postingStatus,
    paymentMethod: "Cash", branch: "Main",
  });
}
async function mkPO(fields) {
  return PurchaseOrder.create({
    id: `PO-VATF-${stamp}-${++poN}`, companyId: CO, supplierId: SUP, supplierName: "مورد",
    status: "received", date: "2026-05-12", branch: "Main", ...fields,
  });
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" }); // admin → reports.view

  try {
    await Company.create({ id: CO, businessName: "Verify VATF Co", workspace: `verify-vatf-${stamp}` });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد", phone: "+2", category: "general" });

    // Sales: 2 posted (tax 100, 50) + a return (-20) + a draft (ignored).
    await mkInvoice({ subtotal: 2000, tax: 100, date: "2026-05-10" });
    await mkInvoice({ subtotal: 1000, tax: 50, date: "2026-05-11" });
    await mkInvoice({ type: "return", status: "returned", subtotal: -400, tax: -20, date: "2026-05-13" });
    await mkInvoice({ postingStatus: "draft", subtotal: 9000, tax: 450, date: "2026-05-11" });

    console.log("1) backward compatibility (12B unchanged):");
    const r0 = await report();
    check(r0.status === 200, "GET /reports/tax-summary → 200");
    check(r0.json.scope === "output_vat" && r0.json.meta.scope === "output_vat", "legacy scope/meta still output_vat");
    check(r0.json.meta.includesInputVat === false && r0.json.meta.includesRcm === false, "legacy meta flags unchanged (false/false)");
    check(approx(r0.json.totals.vatTotal, 130), "legacy vatTotal = 100 + 50 - 20 = 130 (Output VAT)");
    check(approx(r0.json.totals.outputVatTotal, r0.json.totals.vatTotal), "outputVatTotal === legacy vatTotal");
    check(approx(r0.json.totals.salesTotal, 2730) && approx(r0.json.totals.netSubtotal, 2600), "salesTotal/netSubtotal unchanged (draft excluded)");

    console.log("\n2) recoverable Input VAT from received purchases:");
    await mkPO({ total: 1050, taxBase: 1000, vatRate: 5, inputVatAmount: 50, isRecoverable: true, isRcm: false });
    const r1 = await report();
    check(approx(r1.json.totals.inputVatTotal, 50), "inputVatTotal = 50");
    check(approx(r1.json.totals.purchasesTaxBaseTotal, 1000), "purchasesTaxBaseTotal = 1000");
    check(approx(r1.json.totals.purchaseGrossTotal, 1050), "purchaseGrossTotal = 1050");
    check(approx(r1.json.totals.netVatPayable, 80), "netVatPayable = 130 - 50 = 80");
    check(approx(r1.json.totals.rcmOutputVatTotal, 0), "no RCM yet");

    console.log("\n3) non-recoverable + consignment + unreceived are excluded:");
    await mkPO({ total: 2100, taxBase: 2000, inputVatAmount: 100, isRecoverable: false });          // non-recoverable
    await mkPO({ total: 525, taxBase: 500, inputVatAmount: 25, isRecoverable: true, isConsignment: true }); // consignment
    await mkPO({ total: 1100, taxBase: 1000, inputVatAmount: 100, isRecoverable: true, status: "draft" }); // unreceived
    const r2 = await report();
    check(approx(r2.json.totals.inputVatTotal, 50), "inputVatTotal still 50 (non-recoverable/consignment/draft excluded)");
    check(approx(r2.json.totals.netVatPayable, 80), "netVatPayable still 80");

    console.log("\n4) RCM is net-zero and separate from ordinary input VAT:");
    await mkPO({ total: 1000, taxBase: 1000, vatRate: 5, isRcm: true, rcmVatAmount: 50, rcmRate: 5 });
    const r3 = await report();
    check(approx(r3.json.totals.rcmOutputVatTotal, 50), "rcmOutputVatTotal = 50");
    check(approx(r3.json.totals.rcmInputVatTotal, 50), "rcmInputVatTotal = 50");
    check(approx(r3.json.totals.inputVatTotal, 50), "ordinary inputVatTotal unchanged (RCM not double-counted)");
    check(approx(r3.json.totals.netVatPayable, 80), "netVatPayable still 80 (RCM net effect = 0)");
    check(r3.json.vatFull && r3.json.vatFull.scope === "vat_full" && r3.json.vatFull.includesInputVat === true && r3.json.vatFull.includesRcm === true, "vatFull meta declares the expanded scope");

    console.log("\n5) date filter scopes sales AND purchases:");
    const ranged = await report("?from=2026-05-10&to=2026-05-10");
    check(approx(ranged.json.totals.vatTotal, 100), "from/to keeps only the 05-10 sale (output 100)");
    check(approx(ranged.json.totals.inputVatTotal, 0) && approx(ranged.json.totals.rcmOutputVatTotal, 0), "purchases (dated 05-12) excluded by the window");
    check(approx(ranged.json.totals.netVatPayable, 100), "netVatPayable in window = 100 (no purchases)");

    console.log("\n6) report is read-only (creates no journals):");
    check((await JournalEntry.count({ where: { companyId: CO } })) === 0, "no JournalEntry created by running the report");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("invoices", () => Invoice.destroy({ where: { companyId: CO }, force: true }));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("journal entries", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("customers", () => Customer.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascade remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
