/**
 * Duplicate product invoice lines — line-level selection (Phase 18S).
 *
 * When the SAME product appears on more than one line of an invoice, the new
 * optional payloads target the exact line by InvoiceItem.id:
 *   - /sales/returns:  returnedInvoiceItemIds: [id, ...]
 *   - /sales/exchanges: returnedInvoiceItemId: id
 * The legacy assetId payloads (returnedAssetIds / returnedAssetId) still work and
 * select the first matching line. Value/cost/quantity come from the targeted line.
 *
 * NOTE: the double-return/exchange guard stays product-level (by assetId) because
 * credit-note lines do not persist the original line id. So this script proves
 * line SELECTION across SEPARATE invoices (it does not return a 2nd duplicate line
 * after the 1st on the same invoice — that needs a future migration).
 *
 * WRITE — fixtures under a throwaway company; cleanup is SCOPED (Phase 18G).
 *   cd backend && node scripts/verify-return-exchange-duplicate-product-lines-contract.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const {
  sequelize, Company, Customer, Branch, Asset, Product, Invoice, InvoiceItem,
  StockMovement, Payment, JournalEntry, JournalLine, Account, Setting,
  CashTransaction, AssetEvent, Notification, AuditLog,
} = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-DUP-${stamp}`;
const CUST = `CUS-DUP-${stamp}`;
const BR = `BR-DUP-${stamp}`;
const VAT = 5;

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
// Same product on two invoice lines with different price/qty.
async function mkTwoLineProductSale({ unitW = 1, start = 20 } = {}, line1, line2) {
  const pid = `PRD-ID-DUP-${stamp}-${++n}`;
  const sold = line1.qty + line2.qty;
  await Product.create({ id: pid, companyId: CO, productCode: `PC-${stamp}-${n}`, productName: "منتج مكرر", karat: 21, branchId: BR, quantityOnHand: start - sold, quantityAvailable: start - sold, quantitySold: sold, totalWeight: (start - sold) * unitW, averageUnitWeight: unitW, unitCost: 1, averageCost: 1, salePrice: 1, isActive: true });
  const inv = `INV-DUP-${stamp}-${++n}`;
  await Invoice.create({ id: inv, companyId: CO, customerId: CUST, customerName: "عميل", type: "sale", subtotal: 0, tax: 0, total: 0, vatRate: VAT, date: "2026-06-01", status: "paid", postingStatus: "posted", paymentMethod: "Cash", branch: "Main", branchId: BR });
  const i1 = await InvoiceItem.create({ invoiceId: inv, assetId: pid, name: "منتج مكرر", quantity: line1.qty, price: line1.price, cost: line1.cost, weight: line1.qty * unitW, karat: 21 });
  const i2 = await InvoiceItem.create({ invoiceId: inv, assetId: pid, name: "منتج مكرر", quantity: line2.qty, price: line2.price, cost: line2.cost, weight: line2.qty * unitW, karat: 21 });
  return { pid, inv, line1Id: i1.id, line2Id: i2.id, availAfterSale: start - sold, soldAfterSale: sold };
}
async function mkAvailAsset({ price, cost }) {
  const aid = `AST-NEW-DUP-${stamp}-${++n}`;
  await Asset.create({ id: aid, companyId: CO, name: "قطعة جديدة", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost, price, branch: "Main", branchId: BR, category: "rings", location: "Showroom", barcode: `BC-${stamp}-${n}`, status: "available" });
  return aid;
}
async function jeBalanced(sourceId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceId }, order: [["created_at", "DESC"]] });
  if (!je) return { found: false };
  const rows = await JournalLine.findAll({ where: { journalEntryId: je.id } });
  const m = {}; let dr = 0, cr = 0;
  for (const l of rows) { m[l.accountCode] = m[l.accountCode] || { debit: 0, credit: 0 }; m[l.accountCode].debit += Number(l.debit || 0); m[l.accountCode].credit += Number(l.credit || 0); dr += Number(l.debit || 0); cr += Number(l.credit || 0); }
  return { found: true, m, balanced: approx(dr, cr) };
}
const lastByType = async (origInv, type) => Invoice.findOne({ where: { companyId: CO, relatedInvoiceId: origInv, type }, order: [["created_at", "DESC"]] });

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify DUP Co", workspace: `verify-dup-${stamp}` });
    await Setting.create({ companyId: CO, key: "vatRate", value: VAT });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });

    // line1: price 500 x qty 2 (=1000, cost 300); line2: price 700 x qty 1 (=700, cost 400)
    const L1 = { price: 500, qty: 2, cost: 300 };
    const L2 = { price: 700, qty: 1, cost: 400 };

    console.log("1) returns: target the SECOND line by InvoiceItem.id:");
    const a = await mkTwoLineProductSale({ start: 20 }, L1, L2);
    const r1 = await post("/sales/returns", { originalInvoiceId: a.inv, returnedInvoiceItemIds: [a.line2Id], reason: "x" });
    check(r1.status < 400, "return by line id (2nd line) → success");
    const cn1 = await lastByType(a.inv, "return");
    check(approx(cn1.subtotal, -700) && approx(cn1.tax, -35), "credit note = 2nd line 700x1 (NOT 1st line 1000)");
    const cn1Item = await InvoiceItem.findOne({ where: { invoiceId: cn1.id } });
    check(Number(cn1Item.quantity) === 1 && approx(cn1Item.cost, 400), "credit line qty=1, cost=400 (2nd line)");
    const aProd = await Product.findByPk(a.pid);
    check(approx(aProd.quantityAvailable, a.availAfterSale + 1) && approx(aProd.quantitySold, a.soldAfterSale - 1), "restock by 2nd line qty (1)");
    const j1 = await jeBalanced(cn1.id);
    check(j1.found && approx(j1.m["5000"].credit, 400) && j1.balanced, "COGS reversal = 400 (2nd line cost), balanced");

    console.log("\n2) returns: target the FIRST line by id (separate invoice):");
    const b = await mkTwoLineProductSale({ start: 20 }, L1, L2);
    const r2 = await post("/sales/returns", { originalInvoiceId: b.inv, returnedInvoiceItemIds: [b.line1Id], reason: "x" });
    check(r2.status < 400, "return by line id (1st line) → success");
    const cn2 = await lastByType(b.inv, "return");
    check(approx(cn2.subtotal, -1000) && approx(cn2.tax, -50), "credit note = 1st line 500x2 = 1000");

    console.log("\n3) returns: legacy returnedAssetIds picks the FIRST matching line:");
    const c = await mkTwoLineProductSale({ start: 20 }, L1, L2);
    const r3 = await post("/sales/returns", { originalInvoiceId: c.inv, returnedAssetIds: [c.pid], reason: "x" });
    check(r3.status < 400, "legacy returnedAssetIds → success");
    const cn3 = await lastByType(c.inv, "return");
    check(approx(cn3.subtotal, -1000), "legacy fallback = first line (500x2 = 1000)");

    console.log("\n4) exchanges: target the SECOND line by returnedInvoiceItemId:");
    const d = await mkTwoLineProductSale({ start: 20 }, L1, L2);
    const dNew = await mkAvailAsset({ price: 900, cost: 600 });
    const r4 = await post("/sales/exchanges", { originalInvoiceId: d.inv, returnedInvoiceItemId: d.line2Id, newItems: [{ type: "asset", id: dNew }] });
    check(r4.status < 400, "exchange by line id (2nd line) → success");
    const ex4 = await lastByType(d.inv, "exchange");
    // returnedValue = 700; new 900; diff 200; tax 10; total 210
    check(approx(ex4.subtotal, 200) && approx(ex4.tax, 10), "exchange diff uses 2nd line (900-700=200)");
    check(approx((await Product.findByPk(d.pid)).quantityAvailable, d.availAfterSale + 1), "exchange restock by 2nd line qty (1)");
    check((await jeBalanced(ex4.id)).balanced, "exchange journal balanced");

    console.log("\n5) exchanges: target the FIRST line by returnedInvoiceItemId (separate invoice):");
    const e = await mkTwoLineProductSale({ start: 20 }, L1, L2);
    const eNew = await mkAvailAsset({ price: 900, cost: 600 });
    const r5 = await post("/sales/exchanges", { originalInvoiceId: e.inv, returnedInvoiceItemId: e.line1Id, newItems: [{ type: "asset", id: eNew }] });
    check(r5.status < 400, "exchange by line id (1st line) → success");
    const ex5 = await lastByType(e.inv, "exchange");
    // returnedValue = 1000; new 900; diff -100; tax -5
    check(approx(ex5.subtotal, -100) && approx(ex5.tax, -5), "exchange diff uses 1st line (900-1000=-100)");

    console.log("\n6) exchanges: legacy returnedAssetId fallback still works:");
    const f = await mkTwoLineProductSale({ start: 20 }, L1, L2);
    const fNew = await mkAvailAsset({ price: 900, cost: 600 });
    const r6 = await post("/sales/exchanges", { originalInvoiceId: f.inv, returnedAssetId: f.pid, newItems: [{ type: "asset", id: fNew }] });
    check(r6.status < 400, "legacy returnedAssetId → success");
    const ex6 = await lastByType(f.inv, "exchange");
    check(approx(ex6.subtotal, -100), "legacy fallback = first line (900-1000=-100)");

    console.log("\n7) negative validations (no write):");
    const g = await mkTwoLineProductSale({ start: 20 }, L1, L2);
    const gNew = await mkAvailAsset({ price: 100, cost: 50 });
    check((await post("/sales/returns", { originalInvoiceId: g.inv, returnedInvoiceItemIds: [99999999], reason: "x" })).status >= 400, "return unknown line id → 422");
    check((await post("/sales/returns", { originalInvoiceId: g.inv, returnedInvoiceItemIds: [] , reason: "x" })).status >= 400, "return empty returnedInvoiceItemIds → 422");
    check((await post("/sales/returns", { originalInvoiceId: g.inv, returnedInvoiceItemIds: [g.line1Id, g.line1Id], reason: "x" })).status >= 400, "return duplicate line ids → 422");
    check((await post("/sales/exchanges", { originalInvoiceId: g.inv, returnedInvoiceItemId: 99999999, newItems: [{ type: "asset", id: gNew }] })).status >= 400, "exchange unknown line id → 422");
    check((await post("/sales/exchanges", { originalInvoiceId: g.inv, returnedInvoiceItemId: g.line1Id, returnedAssetId: "MISMATCH-ID", newItems: [{ type: "asset", id: gNew }] })).status >= 400, "exchange line id + mismatched assetId → 422");
    // g untouched by the rejected calls
    check(approx((await Product.findByPk(g.pid)).quantityAvailable, g.availAfterSale), "product stock untouched after rejections");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    const jeIds = (await JournalEntry.findAll({ where: { companyId: CO }, attributes: ["id"] })).map((j) => j.id);
    await safe("journal lines", () => jeIds.length && JournalLine.destroy({ where: { journalEntryId: jeIds } }));
    await safe("notifications", () => Notification && Notification.destroy({ where: { companyId: CO } }).catch(() => {}));
    await safe("audit logs", () => AuditLog && AuditLog.destroy({ where: { companyId: CO } }).catch(() => {}));
    await safe("payments", () => Payment.destroy({ where: { companyId: CO } }));
    await safe("asset events", async () => {
      const assetRows = await Asset.findAll({ where: { companyId: CO }, attributes: ["id"], paranoid: false });
      const ids = assetRows.map((a2) => a2.id);
      if (ids.length) await AssetEvent.destroy({ where: { assetId: ids }, force: true });
    });
    await safe("stock movements", () => StockMovement.destroy({ where: { companyId: CO } }));
    await safe("invoice items", async () => {
      const invs = await Invoice.findAll({ where: { companyId: CO }, attributes: ["id"], paranoid: false });
      const ids = invs.map((i) => i.id).filter(Boolean);
      if (ids.length) await InvoiceItem.destroy({ where: { invoiceId: ids }, force: true });
    });
    await safe("invoices", () => Invoice.destroy({ where: { companyId: CO }, force: true }));
    await safe("products", () => Product.destroy({ where: { companyId: CO }, force: true }));
    await safe("assets", () => Asset.destroy({ where: { companyId: CO }, force: true }));
    await safe("journal entries", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("settings", () => Setting.destroy({ where: { companyId: CO } }));
    await safe("customers", () => Customer.destroy({ where: { companyId: CO }, force: true }));
    await safe("branches", () => Branch.destroy({ where: { companyId: CO }, force: true }));
    await safe("company", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + scoped invoice items removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
