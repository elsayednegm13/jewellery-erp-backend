/**
 * P4.5 verification — non-posted invoices excluded from financial aggregates.
 *
 * Sets up (throwaway customer) one POSTED + one DRAFT + one CANCELLED invoice,
 * then asserts that financial reads count POSTED only, while drafts stay
 * reachable on demand. Fully reverses the posted invoice's effects + fixtures.
 *
 * Run: node scripts/verify-reports-filter.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const {
  sequelize, Invoice, InvoiceItem, Asset, Customer, AssetEvent,
  Payment, CashTransaction, JournalEntry, JournalLine, Account, LoyaltyTransaction,
} = models;

const COMPANY = "CMP-DEMO";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

let base, token;
async function api(method, path, body, key) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Company-ID": COMPANY, "X-Branch-ID": "BR-WH" };
  if (key) headers["Idempotency-Key"] = key;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const listOf = (j) => j.items || j.data?.items || j.data || [];

const ts = Date.now();
const CUST = `CUS-PROBE-${ts}`;
const A1 = `AST-PROBE-${ts}-1`;
const postedInvoiceIds = [];
const draftInvoiceIds = [];

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  console.log("App listening for E2E\n");

  await Customer.create({ id: CUST, companyId: COMPANY, name: "Probe Cust", phone: `1${ts}`.slice(-10), balance: 0, purchases: 0 });
  await Asset.create({ id: A1, companyId: COMPANY, name: "PA1", type: "gold-piece", status: "available", category: "P", grossWeight: 4, netWeight: 4, price: 1000, cost: 600, branch: "المستودع الرئيسي", branchId: "BR-WH", location: "P", barcode: `PB1-${ts}` });
  const accSnap = new Map((await Account.findAll({ where: { companyId: COMPANY } })).map((a) => [a.id, a.balance]));

  try {
    // 1 POSTED (draft → post).
    const dp = await api("POST", "/sales/invoices/drafts", { customerId: CUST, branchId: "BR-WH", paymentMethod: "cash", items: [{ assetId: A1, name: "PA1", price: 1000, cost: 600 }] });
    const postedId = dp.json.id; postedInvoiceIds.push(postedId);
    await api("POST", `/sales/invoices/${postedId}/post`, {}, "RPKEY");
    // 1 DRAFT (left as draft).
    const d2 = await api("POST", "/sales/invoices/drafts", { customerId: CUST, branchId: "BR-WH", paymentMethod: "cash", items: [{ assetId: A1, name: "PA1", price: 500 }] });
    const draftId = d2.json.id; draftInvoiceIds.push(draftId);
    // 1 CANCELLED draft.
    const d3 = await api("POST", "/sales/invoices/drafts", { customerId: CUST, branchId: "BR-WH", paymentMethod: "cash", items: [{ assetId: A1, name: "PA1", price: 300 }] });
    const cancId = d3.json.id; draftInvoiceIds.push(cancId);
    await api("POST", `/sales/invoices/${cancId}/cancel`, { reason: "test" });

    const rawAll = await Invoice.count({ where: { companyId: COMPANY, customerId: CUST }, paranoid: false });
    check(rawAll === 3, "raw DB has all 3 invoices (posted + draft + cancelled) for the customer");

    // ---- generic /invoices list defaults to POSTED only ----
    console.log("generic /invoices list:");
    const def = await api("GET", `/invoices?pageSize=100&filters=${encodeURIComponent(JSON.stringify({ customerId: CUST }))}`);
    const defItems = listOf(def.json);
    check(defItems.length === 1 && defItems[0].id === postedId, "default list returns ONLY the posted invoice");
    check(defItems.every((i) => i.postingStatus === "posted"), "every item in default list is posted");

    const draftList = await api("GET", `/invoices?pageSize=100&postingStatus=draft&filters=${encodeURIComponent(JSON.stringify({ customerId: CUST }))}`);
    const dItems = listOf(draftList.json);
    check(dItems.length === 1 && dItems[0].id === draftId, "?postingStatus=draft returns the draft (reachable on demand)");

    const allList = await api("GET", `/invoices?pageSize=100&includeDrafts=true&filters=${encodeURIComponent(JSON.stringify({ customerId: CUST }))}`);
    check(listOf(allList.json).length === 3, "?includeDrafts=true returns all 3 lifecycle states");

    // ---- customer financial endpoints: posted only ----
    console.log("\ncustomer financial endpoints:");
    const cinv = await api("GET", `/customers/${CUST}/invoices`);
    check(listOf(cinv.json).length === 1, "/customers/:id/invoices returns posted only (1)");
    const stmt = await api("GET", `/customers/${CUST}/statement`);
    const stmtInv = stmt.json.data?.invoices || [];
    check(stmtInv.length === 1 && stmtInv[0].id === postedId, "/customers/:id/statement counts posted only (1 invoice)");
    const postedTax = Number((await Invoice.findByPk(postedId)).tax || 0);
    check(Number(stmt.json.data?.vatDue || 0) === postedTax, "statement vatDue counts posted invoice tax only");

    // ---- customer.purchases reflects posted only ----
    const cust = await Customer.findByPk(CUST);
    const posted = await Invoice.findByPk(postedId);
    check(Number(cust.purchases) === Number(posted.total), `customer.purchases (${cust.purchases}) = posted invoice total only (${posted.total})`);

    // ---- sales aggregate over the list (mirrors reports/dashboard client calc) ----
    const salesTotal = defItems.reduce((s, i) => s + Number(i.total || 0), 0);
    check(salesTotal === Number(posted.total), "client-style sales total over the list = posted total only (drafts excluded)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    for (const invId of [...postedInvoiceIds, ...draftInvoiceIds]) {
      const jes = await JournalEntry.findAll({ where: { companyId: COMPANY, sourceId: invId } });
      for (const je of jes) await JournalLine.destroy({ where: { journalEntryId: je.id } });
      await JournalEntry.destroy({ where: { companyId: COMPANY, sourceId: invId } });
      await CashTransaction.destroy({ where: { companyId: COMPANY, reference: invId } });
      await Payment.destroy({ where: { invoiceId: invId } });
      await InvoiceItem.destroy({ where: { invoiceId: invId } });
      await Invoice.destroy({ where: { id: invId }, force: true });
    }
    await AssetEvent.destroy({ where: { assetId: A1 } });
    await LoyaltyTransaction.destroy({ where: { customerId: CUST } }).catch(() => {});
    for (const [id, bal] of accSnap) await Account.update({ balance: bal }, { where: { id } });
    await Asset.destroy({ where: { id: A1 }, force: true }).catch(() => {});
    await Customer.destroy({ where: { id: CUST }, force: true }).catch(() => {});
    console.log("(reversed posted-invoice effects + restored GL balances + removed fixtures)");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
