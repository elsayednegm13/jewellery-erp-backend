/**
 * Sales exchange returned-product support — Phase 18K verify.
 *
 * Proves /sales/exchanges accepts a PRODUCT as the returned item (its id lives in
 * InvoiceItem.assetId) while new items stay assets-only, with server-sourced
 * financials:
 *   - returned product FULL return: value/cost from the ORIGINAL InvoiceItem ×
 *     line qty; product restocked (qtyAvailable/onHand += qty, qtySold -= qty
 *     floored at 0, totalWeight restored); StockMovement type="return"; the new
 *     asset(s) sold as today; diff/VAT server-computed; forged body ignored.
 *   - asset exchange still works.
 *   - double exchange rejected; cross-guard with returns rejected both ways;
 *     unknown returned id rejected; non-asset new id rejected.
 *   - exchange journals balance.
 *
 * WRITE — fixtures under a throwaway company; cleanup is SCOPED (Phase 18G).
 *   cd backend && node scripts/verify-sales-exchange-product-support.js
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
const CO = `CMP-VERIFY-XPS-${stamp}`;
const CUST = `CUS-XPS-${stamp}`;
const BR = `BR-XPS-${stamp}`;
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
async function mkProductSale({ unitPrice, unitCost, unitW, qty, start }) {
  const pid = `PRD-ID-XPS-${stamp}-${++n}`;
  await Product.create({
    id: pid, companyId: CO, productCode: `PC-${stamp}-${n}`, productName: "منتج كمي", karat: 21, branchId: BR,
    quantityOnHand: start - qty, quantityAvailable: start - qty, quantitySold: qty, quantityReserved: 0,
    totalWeight: (start - qty) * unitW, averageUnitWeight: unitW, unitCost, averageCost: unitCost, salePrice: unitPrice, isActive: true,
  });
  const inv = `INV-XPS-${stamp}-${++n}`;
  await Invoice.create({ id: inv, companyId: CO, customerId: CUST, customerName: "عميل", type: "sale", subtotal: 0, tax: 0, total: 0, vatRate: VAT, date: "2026-06-01", status: "paid", postingStatus: "posted", paymentMethod: "Cash", branch: "Main", branchId: BR });
  await InvoiceItem.create({ invoiceId: inv, assetId: pid, name: "منتج كمي", quantity: qty, price: unitPrice, cost: unitCost, weight: qty * unitW, karat: 21 });
  return { pid, inv };
}
async function mkAssetSale({ price, cost }) {
  const aid = `AST-XPS-${stamp}-${++n}`;
  await Asset.create({ id: aid, companyId: CO, name: "قطعة", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost, price, branch: "Main", branchId: BR, category: "rings", location: "Showroom", barcode: `BC-${stamp}-${n}`, status: "sold" });
  const inv = `INV-XPS-${stamp}-${++n}`;
  await Invoice.create({ id: inv, companyId: CO, customerId: CUST, customerName: "عميل", type: "sale", subtotal: price, tax: 0, total: price, vatRate: VAT, date: "2026-06-01", status: "paid", postingStatus: "posted", paymentMethod: "Cash", branch: "Main", branchId: BR });
  await InvoiceItem.create({ invoiceId: inv, assetId: aid, name: "قطعة", quantity: 1, price, cost, weight: 5, karat: 21 });
  return { aid, inv };
}
async function mkAvailAsset({ price, cost }) {
  const aid = `AST-NEW-XPS-${stamp}-${++n}`;
  await Asset.create({ id: aid, companyId: CO, name: "قطعة جديدة", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost, price, branch: "Main", branchId: BR, category: "rings", location: "Showroom", barcode: `BC-${stamp}-${n}`, status: "available" });
  return aid;
}
async function jeBySource(sourceId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceId }, order: [["created_at", "DESC"]] });
  if (!je) return null;
  const rows = await JournalLine.findAll({ where: { journalEntryId: je.id } });
  const m = {}; let dr = 0, cr = 0;
  for (const l of rows) { m[l.accountCode] = m[l.accountCode] || { debit: 0, credit: 0 }; m[l.accountCode].debit += Number(l.debit || 0); m[l.accountCode].credit += Number(l.credit || 0); dr += Number(l.debit || 0); cr += Number(l.credit || 0); }
  return { m, balanced: approx(dr, cr) };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify XPS Co", workspace: `verify-xps-${stamp}` });
    await Setting.create({ companyId: CO, key: "vatRate", value: VAT });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });

    console.log("1) asset exchange still works:");
    const a1 = await mkAssetSale({ price: 1000, cost: 700 });
    const b1 = await mkAvailAsset({ price: 1200, cost: 800 });
    const rA = await post("/sales/exchanges", { originalInvoiceId: a1.inv, returnedAssetId: a1.aid, newAssetIds: [b1] });
    check(rA.status === 201 || rA.status === 200, "asset exchange → success");
    const exA = await Invoice.findOne({ where: { companyId: CO, relatedInvoiceId: a1.inv, type: "exchange" }, order: [["created_at", "DESC"]] });
    check(approx(exA.subtotal, 200) && approx(exA.tax, 10) && approx(exA.total, 210), "asset exchange diff: 200 / 10 / 210");
    check((await Asset.findByPk(a1.aid)).status === "returned" && (await Asset.findByPk(b1)).status === "sold", "asset statuses: old→returned, new→sold");
    check((await jeBySource(exA.id)).balanced, "asset exchange journal balanced");

    console.log("\n2) product returned + new asset (forged body ignored):");
    const UP = 500, UC = 300, UW = 2, QTY = 3, START = 10;
    const p = await mkProductSale({ unitPrice: UP, unitCost: UC, unitW: UW, qty: QTY, start: START });
    const c = await mkAvailAsset({ price: 900, cost: 600 });
    const rP = await post("/sales/exchanges", {
      originalInvoiceId: p.inv, returnedAssetId: p.pid, newAssetIds: [c],
      subtotal: 99999, tax: 99999, total: 99999, cost: 99999, price: 99999, returnedValue: 99999, // forged
    });
    check(rP.status === 201 || rP.status === 200, "product-returned exchange → success (accepts PRD-ID)");
    const exP = await Invoice.findOne({ where: { companyId: CO, relatedInvoiceId: p.inv, type: "exchange" }, order: [["created_at", "DESC"]] });
    // returnedValue = 500*3 = 1500; new = 900; diffBase = -600; tax = -30; total = -630
    check(approx(exP.subtotal, -600) && approx(exP.tax, -30) && approx(exP.total, -630), "diff server-computed: -600 / -30 / -630 (forged 99999 ignored)");
    const retLine = await InvoiceItem.findOne({ where: { invoiceId: exP.id, assetId: p.pid } });
    check(Number(retLine.quantity) === QTY, `returned line quantity = original ${QTY}`);
    check(approx(retLine.cost, UC) && approx(retLine.price, -UP), "returned line per-unit cost=300, price=-500 (origItem, forged ignored)");
    const newLine = await InvoiceItem.findOne({ where: { invoiceId: exP.id, assetId: c } });
    check(approx(newLine.cost, 600) && approx(newLine.price, 900), "new asset line cost=600 price=900 (server Asset values)");

    console.log("\n3) product restocked + StockMovement logged:");
    const prodAfter = await Product.findByPk(p.pid);
    check(approx(prodAfter.quantityAvailable, START) && approx(prodAfter.quantityOnHand, START), `quantityAvailable & onHand back to ${START}`);
    check(approx(prodAfter.quantitySold, 0), "quantitySold reduced to 0 (not negative)");
    check(approx(prodAfter.totalWeight, START * UW), `totalWeight restored to ${START * UW}`);
    const sm = await StockMovement.findOne({ where: { companyId: CO, productId: p.pid, type: "return" }, order: [["created_at", "DESC"]] });
    check(sm && approx(sm.quantityIn, QTY) && approx(sm.totalCost, UC * QTY), `StockMovement type=return, quantityIn=${QTY}, totalCost=${UC * QTY}`);
    check((await Asset.findByPk(c)).status === "sold", "new asset status → sold");

    console.log("\n4) product exchange GL: COGS/inventory/revenue/VAT server-sourced + balanced:");
    const j = await jeBySource(exP.id);
    // 5000: new cost 600 debit, returned cost 1500 credit → net credit 900
    check(j && approx(j.m["5000"].credit - j.m["5000"].debit, UC * QTY - 600), "COGS(5000) net = old 1500 reversed − new 600");
    check(j && approx(j.m["1200"].debit - j.m["1200"].credit, UC * QTY - 600), "inventory(1200) net = returned 1500 − new 600");
    check(j && approx(j.m["4100"].debit - j.m["4100"].credit, UP * QTY - 900), "revenue(4100) net = old 1500 reversed − new 900");
    check(j && approx(j.m["2200"].debit, 30), "VAT(2200) debit = 30 (server diff tax reversal)");
    check(j && j.balanced, "product exchange journal balanced");

    console.log("\n5) double product exchange rejected:");
    const d = await mkAvailAsset({ price: 100, cost: 50 });
    check((await post("/sales/exchanges", { originalInvoiceId: p.inv, returnedAssetId: p.pid, newAssetIds: [d] })).status >= 400, "second exchange of same product line → rejected");

    console.log("\n6) cross-guard returns<->exchanges:");
    // product return THEN product exchange of same line → rejected
    const q = await mkProductSale({ unitPrice: 400, unitCost: 250, unitW: 1, qty: 1, start: 5 });
    check((await post("/sales/returns", { originalInvoiceId: q.inv, returnedAssetIds: [q.pid], reason: "x" })).status < 400, "product return (setup) → success");
    const qNew = await mkAvailAsset({ price: 100, cost: 50 });
    check((await post("/sales/exchanges", { originalInvoiceId: q.inv, returnedAssetId: q.pid, newAssetIds: [qNew] })).status >= 400, "return-then-exchange same line → rejected");
    // product exchange THEN product return of same line → rejected
    const r = await mkProductSale({ unitPrice: 400, unitCost: 250, unitW: 1, qty: 1, start: 5 });
    const rNew = await mkAvailAsset({ price: 100, cost: 50 });
    check((await post("/sales/exchanges", { originalInvoiceId: r.inv, returnedAssetId: r.pid, newAssetIds: [rNew] })).status < 400, "product exchange (setup) → success");
    check((await post("/sales/returns", { originalInvoiceId: r.inv, returnedAssetIds: [r.pid], reason: "x" })).status >= 400, "exchange-then-return same line → rejected");

    console.log("\n7) unknown returned id + non-asset new id rejected:");
    const u = await mkProductSale({ unitPrice: 100, unitCost: 60, unitW: 1, qty: 1, start: 3 });
    const uNew = await mkAvailAsset({ price: 100, cost: 50 });
    check((await post("/sales/exchanges", { originalInvoiceId: u.inv, returnedAssetId: "DOES-NOT-EXIST", newAssetIds: [uNew] })).status >= 400, "unknown returned id → rejected");
    const u2 = await mkProductSale({ unitPrice: 100, unitCost: 60, unitW: 1, qty: 1, start: 3 });
    check((await post("/sales/exchanges", { originalInvoiceId: u2.inv, returnedAssetId: u2.pid, newAssetIds: [u.pid] })).status >= 400, "non-asset (product) as new item → rejected");

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
      const ids = assetRows.map((a) => a.id);
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
