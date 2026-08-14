/**
 * P4.4 verification — the POS draft flow contract (HTTP E2E).
 *
 * Exercises the exact API sequence the POS screen drives:
 *   Save-as-Draft → drafts list (GET /invoices?postingStatus=draft) → load
 *   (items present for cart hydration) → update → post (effects once).
 * Uses a throwaway customer + asset, snapshots/restores GL balances, and fully
 * reverses the posted invoice. Confirms /pos/checkout is NOT involved.
 *
 * Run: node scripts/verify-pos-draft-flow.js
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
const A1 = `AST-PROBE-${ts}`;
const cleanupInvoices = [];

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  console.log("App listening for E2E\n");

  await Customer.create({ id: CUST, companyId: COMPANY, name: "POS Probe", phone: `2${ts}`.slice(-10), balance: 0, purchases: 0 });
  await Asset.create({ id: A1, companyId: COMPANY, name: "POS Asset", type: "gold-piece", status: "available", category: "P", grossWeight: 6, netWeight: 6, price: 2000, cost: 1500, branch: "المستودع الرئيسي", branchId: "BR-WH", location: "P", barcode: `POSPB-${ts}` });
  const accSnap = new Map((await Account.findAll({ where: { companyId: COMPANY } })).map((a) => [a.id, a.balance]));

  try {
    // ── Save as Draft (what the POS "حفظ كمسودة" button sends) ──
    console.log("Save-as-Draft → list → load:");
    const save = await api("POST", "/sales/invoices/drafts", {
      customerId: CUST, customerName: "POS Probe", branchId: "BR-WH", paymentMethod: "cash",
      discount: 0, makingCharge: 0, stoneValue: 0, notes: "from POS",
      items: [{ assetId: A1, name: "POS Asset", quantity: 1, price: 2000, cost: 1500, weight: 6, karat: 21 }],
    }, "SAVEKEY");
    check(save.status === 201, "save-as-draft → 201");
    const draftId = save.json.id; cleanupInvoices.push(draftId);
    check(save.json.postingStatus === "draft", "created invoice is a draft");
    // no side effects on save
    check((await Asset.findByPk(A1)).status === "available", "save-as-draft does NOT touch inventory");
    check(await JournalEntry.count({ where: { companyId: COMPANY, sourceId: draftId } }) === 0, "save-as-draft creates NO journal entry");

    // POS drafts list source.
    const list = await api("GET", `/invoices?postingStatus=draft&pageSize=100&filters=${encodeURIComponent(JSON.stringify({ customerId: CUST }))}`);
    const drafts = listOf(list.json);
    check(drafts.some((d) => d.id === draftId), "draft appears in GET /invoices?postingStatus=draft (POS drafts list)");
    const loaded = drafts.find((d) => d.id === draftId);
    check(Array.isArray(loaded.items) && loaded.items.length === 1 && loaded.items[0].assetId === A1, "draft carries items for cart hydration");

    // ── Update draft (POS "تحديث المسودة") ──
    console.log("\nupdate:");
    const upd = await api("PATCH", `/sales/invoices/${draftId}`, {
      notes: "edited from POS",
      items: [{ assetId: A1, name: "POS Asset", quantity: 1, price: 1800, cost: 1500, weight: 6, karat: 21 }],
    });
    check(upd.status === 200, "update draft → 200");
    check((await Asset.findByPk(A1)).status === "available", "update does NOT touch inventory");

    // ── Post draft (POS "ترحيل المسودة") ──
    console.log("\npost:");
    const post = await api("POST", `/sales/invoices/${draftId}/post`, {}, "POSTKEY");
    check(post.status === 200 && post.json.postingStatus === "posted", "post draft → posted");
    check((await Asset.findByPk(A1)).status === "sold", "post deducts inventory (asset sold)");
    const je = await JournalEntry.findOne({ where: { companyId: COMPANY, sourceId: draftId } });
    check(!!je, "post creates a journal entry");
    const lines = await JournalLine.findAll({ where: { journalEntryId: je.id } });
    const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    check(Math.abs(dr - cr) < 0.01, `journal balanced (Dr ${dr} = Cr ${cr})`);
    check(await Payment.count({ where: { invoiceId: draftId } }) === 1, "post creates one payment");
    check(await CashTransaction.count({ where: { companyId: COMPANY, reference: draftId } }) === 1, "post creates one cash transaction");

    // idempotent re-post (POS reuses the same post key)
    const post2 = await api("POST", `/sales/invoices/${draftId}/post`, {}, "POSTKEY");
    check(post2.status === 200, "re-post with same key → 200 (idempotent)");
    check(await Payment.count({ where: { invoiceId: draftId } }) === 1, "no duplicate payment on re-post");

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
    await AssetEvent.destroy({ where: { assetId: A1 } });
    await LoyaltyTransaction.destroy({ where: { customerId: CUST } }).catch(() => {});
    for (const [id, bal] of accSnap) await Account.update({ balance: bal }, { where: { id } });
    await Asset.destroy({ where: { id: A1 }, force: true }).catch(() => {});
    await Customer.destroy({ where: { id: CUST }, force: true }).catch(() => {});
    console.log("(reversed effects + restored GL balances + removed fixtures)");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
