/**
 * P4.2 verification — draft invoice create / edit / cancel (HTTP E2E).
 *
 * Boots the real Express app on an ephemeral port, drives the new endpoints
 * over HTTP with an admin JWT, and asserts a draft has ZERO side effects
 * (no inventory / journal / payment / cash / customer balance / loyalty).
 * Test drafts (side-effect free) are hard-deleted at the end. process.exit
 * is forced so background timers can't keep the process alive.
 *
 * Run: node scripts/verify-draft-lifecycle.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const { sequelize, Invoice, InvoiceItem, Asset, Customer, StockMovement, JournalEntry, Payment, CashTransaction } = models;

const COMPANY = "CMP-DEMO";
let passed = 0;
const createdDraftIds = [];
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

let base, token;
async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Company-ID": COMPANY,
      "X-Branch-ID": "BR-WH",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  console.log("App listening for E2E\n");

  try {
    const asset = await Asset.findOne({ where: { companyId: COMPANY, status: "available" } });
    const customer = await Customer.findOne({ where: { companyId: COMPANY } });
    const postedInv = await Invoice.findOne({ where: { companyId: COMPANY, postingStatus: "posted" } });

    // Baseline side-effect counters.
    const before = {
      stock: await StockMovement.count({ where: { companyId: COMPANY } }),
      je: await JournalEntry.count({ where: { companyId: COMPANY } }),
      pay: await Payment.count(),
      cash: await CashTransaction.count({ where: { companyId: COMPANY } }),
      assetStatus: asset.status,
      custBalance: Number(customer.balance || 0),
    };

    // ---- create draft ----
    console.log("create draft:");
    const c = await api("POST", "/sales/invoices/drafts", {
      customerId: customer.id, branchId: "BR-WH",
      items: [{ assetId: asset.id, name: asset.name, price: 1234, weight: 5, karat: 21 }],
      notes: "probe draft", total: 1234, subtotal: 1234,
    });
    check(c.status === 201, "POST /sales/invoices/drafts → 201");
    const draftId = c.json.id; createdDraftIds.push(draftId);
    check(c.json.postingStatus === "draft", "draft postingStatus = draft");
    check(!c.json.postedAt, "draft postedAt is null/unset");
    check(Array.isArray(c.json.items) && c.json.items.length === 1, "draft created its InvoiceItems");

    const itemCount = await InvoiceItem.count({ where: { invoiceId: draftId } });
    check(itemCount === 1, "exactly one InvoiceItem row persisted for the draft");

    // ---- no side effects ----
    console.log("\nno side effects:");
    const freshAsset = await Asset.findByPk(asset.id);
    const freshCust = await Customer.findByPk(customer.id);
    check(freshAsset.status === before.assetStatus, "asset.status unchanged (no inventory deduction)");
    check(await StockMovement.count({ where: { companyId: COMPANY } }) === before.stock, "no StockMovement created");
    check(await JournalEntry.count({ where: { companyId: COMPANY } }) === before.je, "no JournalEntry created");
    check(await Payment.count() === before.pay, "no Payment created");
    check(await CashTransaction.count({ where: { companyId: COMPANY } }) === before.cash, "no CashTransaction created");
    check(Number(freshCust.balance || 0) === before.custBalance, "customer.balance unchanged");

    // ---- edit draft ----
    console.log("\nedit draft:");
    const e = await api("PATCH", `/sales/invoices/${draftId}`, {
      notes: "edited", items: [
        { assetId: asset.id, name: asset.name, price: 1000 },
        { assetId: asset.id, name: asset.name, price: 500 },
      ],
    });
    check(e.status === 200, "PATCH draft → 200");
    check(await InvoiceItem.count({ where: { invoiceId: draftId } }) === 2, "items replaced (now 2) with no stock effects");
    check((await Asset.findByPk(asset.id)).status === before.assetStatus, "asset.status still unchanged after edit");

    // edit with a lifecycle field → 403
    const eBad = await api("PATCH", `/sales/invoices/${draftId}`, { postingStatus: "posted" });
    check(eBad.status === 403, "PATCH draft with postingStatus → 403 (lifecycle protected)");

    // edit a POSTED invoice → 409
    const ePosted = await api("PATCH", `/sales/invoices/${postedInv.id}`, { notes: "x" });
    check(ePosted.status === 409, "PATCH a posted invoice → 409 (only drafts editable)");

    // ---- validation ----
    console.log("\nvalidation:");
    const noItems = await api("POST", "/sales/invoices/drafts", { customerId: customer.id, branchId: "BR-WH", items: [] });
    check(noItems.status >= 400 && noItems.status < 500, "draft without items is rejected");
    const noCust = await api("POST", "/sales/invoices/drafts", { customerId: "CUS-NOPE", branchId: "BR-WH", items: [{ assetId: asset.id, name: "x", price: 1 }] });
    check(noCust.status === 404, "draft for a non-existent customer → 404");

    // ---- cancel draft ----
    console.log("\ncancel draft:");
    const cancelNoReason = await api("POST", `/sales/invoices/${draftId}/cancel`, {});
    check(cancelNoReason.status === 422, "cancel without reason → 422");
    const cancel = await api("POST", `/sales/invoices/${draftId}/cancel`, { reason: "customer changed mind" });
    check(cancel.status === 200 && cancel.json.postingStatus === "cancelled", "cancel draft → cancelled");
    check(!!cancel.json.cancelledAt, "cancelledAt is set");
    check(cancel.json.cancelReason === "customer changed mind", "cancelReason is stored");
    // idempotent re-cancel
    const cancel2 = await api("POST", `/sales/invoices/${draftId}/cancel`, { reason: "again" });
    check(cancel2.status === 200 && cancel2.json.postingStatus === "cancelled", "re-cancel is idempotent (200, still cancelled)");
    // editing a cancelled draft is rejected
    const editCancelled = await api("PATCH", `/sales/invoices/${draftId}`, { notes: "y" });
    check(editCancelled.status === 409, "editing a cancelled draft → 409");
    // cancel a POSTED invoice → 409
    const cancelPosted = await api("POST", `/sales/invoices/${postedInv.id}/cancel`, { reason: "z" });
    check(cancelPosted.status === 409, "cancel a posted invoice → 409 (needs return/void)");
    check((await Invoice.findByPk(postedInv.id)).postingStatus === "posted", "the posted invoice was NOT changed");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    // Clean up test drafts (side-effect free → safe to hard-delete).
    for (const id of createdDraftIds) {
      await InvoiceItem.destroy({ where: { invoiceId: id } });
      await Invoice.destroy({ where: { id }, force: true });
    }
    console.log(`(cleaned up ${createdDraftIds.length} test draft(s))`);
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
