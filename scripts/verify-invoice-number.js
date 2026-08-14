/**
 * P4.6 verification — final invoice numbering (HTTP E2E).
 *
 * Asserts: immediate POS checkout gets invoiceNumber == id (sequential);
 * a draft has invoiceNumber NULL; posting a draft assigns a final sequential
 * invoiceNumber WITHOUT changing the id (so InvoiceItems stay linked);
 * numbers are unique within the company; idempotent re-post keeps the number;
 * search by invoiceNumber works. Throwaway fixtures, GL snapshot/restore, full
 * reversal.
 *
 * Run: node scripts/verify-invoice-number.js
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
const A2 = `AST-PROBE-${ts}-2`;
const cleanupInvoices = [];

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  console.log("App listening for E2E\n");

  await Customer.create({ id: CUST, companyId: COMPANY, name: "Num Probe", phone: `9${ts}`.slice(-10), balance: 0, purchases: 0 });
  for (const id of [A1, A2]) {
    await Asset.create({ id, companyId: COMPANY, name: id, type: "gold-piece", status: "available", category: "P", grossWeight: 3, netWeight: 3, price: 1000, cost: 700, branch: "المستودع الرئيسي", branchId: "BR-WH", location: "P", barcode: `NB-${id}` });
  }
  const accSnap = new Map((await Account.findAll({ where: { companyId: COMPANY } })).map((a) => [a.id, a.balance]));

  try {
    // ── A) immediate POS checkout ──
    console.log("immediate POS checkout:");
    const co = await api("POST", "/pos/checkout", {
      customerId: CUST, branchId: "BR-WH", paymentMethod: "cash",
      items: [{ assetId: A1, name: A1, price: 1000, cost: 700, totalWeight: 3, quantity: 1 }],
    }, "CO-KEY");
    check(co.status === 201, "POS checkout → 201");
    const coId = co.json.id; cleanupInvoices.push(coId);
    check(!!co.json.invoiceNumber, "checkout invoice has an invoiceNumber");
    check(co.json.invoiceNumber === coId, "checkout invoiceNumber == id");
    check(/^INV-.*-\d{6}$/.test(co.json.invoiceNumber), "checkout invoiceNumber is the padded INV-*-NNNNNN sequence");

    // ── B) draft → invoiceNumber NULL ──
    console.log("\ndraft:");
    const d = await api("POST", "/sales/invoices/drafts", { customerId: CUST, branchId: "BR-WH", paymentMethod: "cash", items: [{ assetId: A2, name: A2, price: 1000, cost: 700 }] });
    const draftId = d.json.id; cleanupInvoices.push(draftId);
    check(d.json.postingStatus === "draft", "draft created");
    check(!(await Invoice.findByPk(draftId)).invoiceNumber, "draft invoiceNumber is NULL");

    // ── C) post draft → final number, id unchanged ──
    console.log("\npost draft:");
    const p = await api("POST", `/sales/invoices/${draftId}/post`, {}, "PD-KEY");
    check(p.status === 200, "post draft → 200");
    const postedDraft = await Invoice.findByPk(draftId);
    check(postedDraft.id === draftId && draftId.startsWith("DRAFT-"), "posted draft KEEPS its DRAFT-* id (PK unchanged)");
    check(!!postedDraft.invoiceNumber && /^INV-.*-\d{6}$/.test(postedDraft.invoiceNumber), "posted draft gets a final sequential invoiceNumber");
    check(postedDraft.invoiceNumber !== co.json.invoiceNumber, "the two numbers are distinct (shared sequence, no collision)");
    check(await InvoiceItem.count({ where: { invoiceId: draftId } }) === 1, "InvoiceItems remain linked to the unchanged id");

    // idempotent re-post keeps the same number
    const p2 = await api("POST", `/sales/invoices/${draftId}/post`, {}, "PD-KEY");
    check(p2.status === 200 && (await Invoice.findByPk(draftId)).invoiceNumber === postedDraft.invoiceNumber, "idempotent re-post keeps the same invoiceNumber");

    // ── D) uniqueness within company ──
    console.log("\nuniqueness + search:");
    let dupRejected = false;
    try {
      await Invoice.update({ invoiceNumber: postedDraft.invoiceNumber }, { where: { id: coId } });
    } catch { dupRejected = true; }
    check(dupRejected, "duplicate invoiceNumber within the company is rejected (partial unique index)");

    // ── E) search by invoiceNumber ──
    const srch = await api("GET", `/invoices?pageSize=100&search=${encodeURIComponent(postedDraft.invoiceNumber)}`);
    check(listOf(srch.json).some((i) => i.id === draftId), "GET /invoices?search=<invoiceNumber> finds the invoice");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    for (const invId of cleanupInvoices) {
      const jes = await JournalEntry.findAll({ where: { companyId: COMPANY, sourceId: invId } });
      for (const je of jes) await JournalLine.destroy({ where: { journalEntryId: je.id } });
      await JournalEntry.destroy({ where: { companyId: COMPANY, sourceId: invId } });
      await CashTransaction.destroy({ where: { companyId: COMPANY, reference: invId } });
      await Payment.destroy({ where: { invoiceId: invId } });
      await InvoiceItem.destroy({ where: { invoiceId: invId } });
      await Invoice.destroy({ where: { id: invId }, force: true });
    }
    for (const id of [A1, A2]) await AssetEvent.destroy({ where: { assetId: id } });
    await LoyaltyTransaction.destroy({ where: { customerId: CUST } }).catch(() => {});
    for (const [id, bal] of accSnap) await Account.update({ balance: bal }, { where: { id } });
    for (const id of [A1, A2]) await Asset.destroy({ where: { id }, force: true }).catch(() => {});
    await Customer.destroy({ where: { id: CUST }, force: true }).catch(() => {});
    console.log("(reversed all effects + restored GL balances + removed fixtures)");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
