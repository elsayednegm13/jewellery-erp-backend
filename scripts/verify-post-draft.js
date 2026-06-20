/**
 * P4.3 verification — post a draft (HTTP E2E).
 *
 * Drives POST /sales/invoices/:id/post against the real app. Uses a THROWAWAY
 * customer + asset to isolate effects, snapshots GL account balances, and after
 * the success path FULLY reverses every committed artifact (journal + lines,
 * account balances, payment, cash, asset event, loyalty, invoice, fixtures) so
 * the DB returns to baseline. Guard paths roll back internally (no effects).
 *
 * Run: node scripts/verify-post-draft.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
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

const ts = Date.now();
const CUST = `CUS-PROBE-${ts}`;
const ASSET = `AST-PROBE-${ts}`;
const createdInvoices = [];

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  console.log("App listening for E2E\n");

  // Fixtures.
  await Customer.create({ id: CUST, companyId: COMPANY, name: "Probe Customer", phone: `0000${ts}`.slice(-10), balance: 0, purchases: 0 });
  await Asset.create({ id: ASSET, companyId: COMPANY, name: "Probe Asset", type: "gold-piece", status: "available", category: "Probe", grossWeight: 5, netWeight: 5, price: 1000, cost: 700, branch: "المستودع الرئيسي", branchId: "BR-WH", location: "Probe", barcode: `PB-${ts}` });

  // Snapshot GL balances for full reversal.
  const accSnap = new Map((await Account.findAll({ where: { companyId: COMPANY } })).map((a) => [a.id, a.balance]));

  try {
    // ---- create draft (cash, the throwaway asset) ----
    const c = await api("POST", "/sales/invoices/drafts", {
      customerId: CUST, branchId: "BR-WH", paymentMethod: "cash",
      items: [{ assetId: ASSET, name: "Probe Asset", price: 1000, weight: 5, karat: 21, cost: 700 }],
    });
    check(c.status === 201, "draft created");
    const invId = c.json.id; createdInvoices.push(invId);

    const before = {
      je: await JournalEntry.count({ where: { companyId: COMPANY } }),
      pay: await Payment.count({ where: { invoiceId: invId } }),
      cash: await CashTransaction.count({ where: { companyId: COMPANY, reference: invId } }),
      custBalance: Number((await Customer.findByPk(CUST)).balance || 0),
    };

    // ---- POST the draft ----
    console.log("post draft:");
    const p = await api("POST", `/sales/invoices/${invId}/post`, {}, "POSTKEY-1");
    check(p.status === 200, "POST /sales/invoices/:id/post → 200");
    check(p.json.postingStatus === "posted", "postingStatus → posted");
    check(!!p.json.postedAt, "postedAt is set");

    check((await Asset.findByPk(ASSET)).status === "sold", "serialized asset → sold (once)");
    check(await AssetEvent.count({ where: { assetId: ASSET, action: "SALE" } }) === 1, "one SALE AssetEvent created");
    check(await InvoiceItem.count({ where: { invoiceId: invId } }) === 1, "InvoiceItems not duplicated (still 1)");

    check(await JournalEntry.count({ where: { companyId: COMPANY } }) === before.je + 1, "exactly one JournalEntry created");
    const je = await JournalEntry.findOne({ where: { companyId: COMPANY, sourceId: invId }, order: [["created_at", "DESC"]] });
    check(!!je, "journal entry linked to the invoice (sourceId)");
    const lines = await JournalLine.findAll({ where: { journalEntryId: je.id } });
    const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    check(Math.abs(dr - cr) < 0.01, `journal entry is balanced (Dr ${dr.toFixed(2)} = Cr ${cr.toFixed(2)})`);

    check(await Payment.count({ where: { invoiceId: invId } }) === before.pay + 1, "exactly one Payment created");
    check(await CashTransaction.count({ where: { companyId: COMPANY, reference: invId } }) === before.cash + 1, "exactly one CashTransaction created");
    check(Number((await Customer.findByPk(CUST)).balance || 0) === before.custBalance, "customer.balance unchanged (cash sale, nothing owed)");

    // ---- idempotent re-post (same key) ----
    console.log("\nidempotency:");
    const p2 = await api("POST", `/sales/invoices/${invId}/post`, {}, "POSTKEY-1");
    check(p2.status === 200 && p2.json.postingStatus === "posted", "re-post with same key → 200 (idempotent)");
    check(await JournalEntry.count({ where: { companyId: COMPANY } }) === before.je + 1, "no duplicate JournalEntry on re-post");
    check(await Payment.count({ where: { invoiceId: invId } }) === before.pay + 1, "no duplicate Payment on re-post");
    check(await CashTransaction.count({ where: { companyId: COMPANY, reference: invId } }) === before.cash + 1, "no duplicate CashTransaction on re-post");

    const p3 = await api("POST", `/sales/invoices/${invId}/post`, {}, "POSTKEY-DIFFERENT");
    check(p3.status === 409, "re-post with a different key → 409");

    // ---- guards (roll back internally, no effects) ----
    console.log("\nguards:");
    // unavailable asset (already sold by the post above)
    const dUnavail = await api("POST", "/sales/invoices/drafts", { customerId: CUST, branchId: "BR-WH", paymentMethod: "cash", items: [{ assetId: ASSET, name: "x", price: 100 }] });
    createdInvoices.push(dUnavail.json.id);
    const pUnavail = await api("POST", `/sales/invoices/${dUnavail.json.id}/post`, {}, "K-UNAVAIL");
    check(pUnavail.status === 409 || pUnavail.status === 422, "post draft with an unavailable (sold) asset → rejected");

    // cancelled draft
    const dCanc = await api("POST", "/sales/invoices/drafts", { customerId: CUST, branchId: "BR-WH", paymentMethod: "cash", items: [{ assetId: ASSET, name: "x", price: 100 }] });
    createdInvoices.push(dCanc.json.id);
    await api("POST", `/sales/invoices/${dCanc.json.id}/cancel`, { reason: "test" });
    const pCanc = await api("POST", `/sales/invoices/${dCanc.json.id}/post`, {}, "K-CANC");
    check(pCanc.status === 409, "post a cancelled draft → 409");

    // no items
    const dEmpty = await api("POST", "/sales/invoices/drafts", { customerId: CUST, branchId: "BR-WH", paymentMethod: "cash", items: [{ assetId: ASSET, name: "x", price: 100 }] });
    createdInvoices.push(dEmpty.json.id);
    await InvoiceItem.destroy({ where: { invoiceId: dEmpty.json.id } });
    const pEmpty = await api("POST", `/sales/invoices/${dEmpty.json.id}/post`, {}, "K-EMPTY");
    check(pEmpty.status >= 400 && pEmpty.status < 500, "post a draft with no items → rejected");

    // not-found
    const pNF = await api("POST", "/sales/invoices/NOPE-123/post", {}, "K-NF");
    check(pNF.status === 404, "post a non-existent invoice → 404");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    // ---- full reversal of committed artifacts ----
    for (const invId of createdInvoices) {
      const jes = await JournalEntry.findAll({ where: { companyId: COMPANY, sourceId: invId } });
      for (const je of jes) await JournalLine.destroy({ where: { journalEntryId: je.id } });
      await JournalEntry.destroy({ where: { companyId: COMPANY, sourceId: invId } });
      await CashTransaction.destroy({ where: { companyId: COMPANY, reference: invId } });
      await Payment.destroy({ where: { invoiceId: invId } });
      await InvoiceItem.destroy({ where: { invoiceId: invId } });
      await Invoice.destroy({ where: { id: invId }, force: true });
    }
    await AssetEvent.destroy({ where: { assetId: ASSET } });
    await LoyaltyTransaction.destroy({ where: { customerId: CUST } }).catch(() => {});
    // restore GL balances exactly.
    for (const [id, bal] of accSnap) await Account.update({ balance: bal }, { where: { id } });
    await Asset.destroy({ where: { id: ASSET }, force: true }).catch(() => {});
    await Customer.destroy({ where: { id: CUST }, force: true }).catch(() => {});
    console.log("(reversed all test artifacts + restored GL balances + removed fixtures)");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
