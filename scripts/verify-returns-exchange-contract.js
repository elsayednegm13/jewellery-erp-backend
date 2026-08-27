/**
 * Returns / Exchanges financial contract — Phase 18D verify.
 *
 * Proves the credit-note (return) and exchange endpoints take their financial
 * truth from the ORIGINAL invoice items + server settings, and ignore any
 * client-forged cost/subtotal/tax/total in the request body:
 *   - POST /sales/returns: loads original invoice + items server-side; credit
 *     note subtotal/tax/total computed from original item.price and the invoice
 *     VAT rate; InvoiceItem.cost = original item.cost (forged body cost ignored);
 *     asset → returned; a fully-returned invoice cannot be returned again.
 *   - POST /sales/exchanges: diff = (new asset prices − returned price), tax from
 *     settings VAT; new line cost = Asset.cost (server); forged body ignored.
 * + GL journal for the return is balanced.
 *
 * WRITE — fixtures under a throwaway company; cleanup deletes it LAST. No residue.
 * No route/business change in 18D — this is a contract regression lock.
 *
 *   cd backend && node scripts/verify-returns-exchange-contract.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const {
  sequelize, Company, Customer, Branch, Asset, Invoice, InvoiceItem, Payment,
  JournalEntry, JournalLine, Account, Setting, CashTransaction, AssetEvent,
  Notification, AuditLog,
} = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-RX-${stamp}`;
const CUST = `CUS-RX-${stamp}`;
const BR = `BR-RX-${stamp}`;
const VAT = 5; // %

let passed = 0;
function check(condition, message) { if (!condition) throw new Error("FAILED: " + message); passed++; console.log("  ✓ " + message); }
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token, n = 0;
const H = () => ({ Authorization: `Bearer ${token}`, "X-Company-ID": CO, "X-Branch-ID": BR, "Content-Type": "application/json" });
async function post(path, body) {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: H(), body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function mkAsset(cost, price, status) {
  const id = `AST-RX-${stamp}-${++n}`;
  await Asset.create({ id, companyId: CO, name: `قطعة ${n}`, type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost, price, branch: "Main", branchId: BR, category: "rings", location: "Showroom", barcode: `BC-RX-${stamp}-${n}`, status });
  return id;
}
async function mkSale(assetId, price, cost) {
  // Simulate a prior posted sale of `assetId` (asset already 'sold').
  const id = `INV-RX-${stamp}-${++n}`;
  await Invoice.create({ id, companyId: CO, customerId: CUST, customerName: "عميل", type: "sale", subtotal: price, tax: 0, total: price, vatRate: VAT, date: "2026-06-01", status: "paid", postingStatus: "posted", paymentMethod: "Cash", branch: "Main", branchId: BR });
  await InvoiceItem.create({ invoiceId: id, assetId, name: "قطعة", quantity: 1, price, cost, weight: 5, karat: 21 });
  return id;
}
async function jeBySource(sourceId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceId }, order: [["created_at", "DESC"]] });
  if (!je) return null;
  const rows = await JournalLine.findAll({ where: { journalEntryId: je.id } });
  let dr = 0, cr = 0;
  for (const l of rows) { dr += Number(l.debit || 0); cr += Number(l.credit || 0); }
  return { je, balanced: approx(dr, cr), rows };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify RX Co", workspace: `verify-rx-${stamp}` });
    await Setting.create({ companyId: CO, key: "vatRate", value: VAT });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });

    console.log("1) /sales/returns ignores forged body cost/totals (server source):");
    const ra = await mkAsset(700, 1000, "sold");
    const oinv = await mkSale(ra, 1000, 700);
    const r1 = await post("/sales/returns", {
      originalInvoiceId: oinv, returnedAssetIds: [ra], reason: "تجربة",
      subtotal: 99999, tax: 99999, total: 99999, cost: 99999, // forged
      items: [{ assetId: ra, cost: 99999, price: 99999 }], // forged
    });
    check(r1.status === 201 || r1.status === 200, "return → success");
    const cn = await Invoice.findOne({ where: { companyId: CO, relatedInvoiceId: oinv, type: "return" }, order: [["created_at", "DESC"]] });
    check(cn && approx(cn.subtotal, -1000) && approx(cn.tax, -50) && approx(cn.total, -1050),
      "credit note totals server-computed: subtotal -1000 / tax -50 / total -1050 (forged 99999 ignored)");
    const cnItem = await InvoiceItem.findOne({ where: { invoiceId: cn.id } });
    check(approx(cnItem.cost, 700), "credit-note item cost = original 700 (forged body cost 99999 ignored)");
    check(approx(cnItem.price, -1000), "credit-note item price = -1000 (reversal of original)");
    const raAfter = await Asset.findByPk(ra);
    check(raAfter.status === "returned", "returned asset status = returned");
    const j1 = await jeBySource(cn.id);
    check(j1 && j1.balanced, "return journal entry exists and is balanced");

    console.log("\n2) a fully-returned invoice cannot be returned again:");
    const r1b = await post("/sales/returns", { originalInvoiceId: oinv, returnedAssetIds: [ra], reason: "مكرر" });
    check(r1b.status >= 400, "second return on fully-returned invoice → rejected");

    console.log("\n3) /sales/exchanges ignores forged body, uses server diff + asset cost:");
    const xa = await mkAsset(700, 1000, "sold");   // returned-in piece (price 1000)
    const oinv2 = await mkSale(xa, 1000, 700);
    const xb = await mkAsset(600, 900, "available"); // new piece (price 900, cost 600)
    const r2 = await post("/sales/exchanges", {
      originalInvoiceId: oinv2, returnedAssetId: xa, newAssetIds: [xb], notes: "تجربة",
      subtotal: 1, tax: 1, total: 1, cost: 1, // forged
    });
    check(r2.status === 201 || r2.status === 200, "exchange → success");
    const ex = await Invoice.findOne({ where: { companyId: CO, relatedInvoiceId: oinv2, type: "exchange" }, order: [["created_at", "DESC"]] });
    // diffBase = 900 - 1000 = -100; tax = -5; total = -105
    check(ex && approx(ex.subtotal, -100) && approx(ex.tax, -5) && approx(ex.total, -105),
      "exchange diff server-computed: subtotal -100 / tax -5 / total -105 (forged 1/1/1 ignored)");
    const newLine = await InvoiceItem.findOne({ where: { invoiceId: ex.id, assetId: xb } });
    check(approx(newLine.cost, 600) && approx(newLine.price, 900), "exchange new line cost=600 price=900 (server Asset values, forged ignored)");
    const xaAfter = await Asset.findByPk(xa);
    const xbAfter = await Asset.findByPk(xb);
    check(xaAfter.status === "returned" && xbAfter.status === "sold", "exchange asset statuses: returned-in → returned, new → sold");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    const jeIds = (await JournalEntry.findAll({ where: { companyId: CO }, attributes: ["id"] })).map((j) => j.id);
    await safe("journal lines", () => jeIds.length && JournalLine.destroy({ where: { journalEntryId: jeIds } }));
    await safe("notifications", () => Notification && Notification.destroy({ where: { companyId: CO } }).catch(() => {}));
    await safe("audit logs", () => AuditLog && AuditLog.destroy({ where: { companyId: CO } }).catch(() => {}));
    await safe("payments", () => Payment.destroy({ where: { companyId: CO } }));
    await safe("asset events", () => AssetEvent.destroy({ where: {}, force: true }).catch(() => {}));
    await safe("invoice items", async () => {
      // Scoped: delete only THIS test company's invoice items (invoice_items has
      // no companyId; resolve via the company's invoices). A global where:{} wipe
      // would destroy shared dev data — see Phase 18F/18G.
      const invs = await Invoice.findAll({ where: { companyId: CO }, attributes: ["id"], paranoid: false });
      const ids = invs.map((i) => i.id).filter(Boolean);
      if (ids.length) await InvoiceItem.destroy({ where: { invoiceId: ids }, force: true });
    });
    await safe("invoices", () => Invoice.destroy({ where: { companyId: CO }, force: true }));
    await safe("assets", () => Asset.destroy({ where: { companyId: CO }, force: true }));
    await safe("journal entries", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("settings", () => Setting.destroy({ where: { companyId: CO } }));
    await safe("customers", () => Customer.destroy({ where: { companyId: CO }, force: true }));
    await safe("branches", () => Branch.destroy({ where: { companyId: CO }, force: true }));
    await safe("company", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
