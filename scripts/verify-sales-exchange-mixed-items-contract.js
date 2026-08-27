/**
 * Sales exchange mixed new items — Phase 18M verify.
 *
 * /sales/exchanges accepts a new `newItems` payload (asset+product mix) while the
 * legacy `newAssetIds` (assets only) keeps working as a fallback. `newItems` takes
 * priority when present. Financials are server-sourced; forged client values are
 * ignored. Product new items decrement stock + log StockMovement type exchange_out;
 * asset new items behave as before. Returned item (asset/product) unchanged from
 * 18I/18K. Double return/exchange guard intact. Journals balance.
 *
 * WRITE — fixtures under a throwaway company; cleanup is SCOPED (Phase 18G).
 *   cd backend && node scripts/verify-sales-exchange-mixed-items-contract.js
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
const CO = `CMP-VERIFY-MIX-${stamp}`;
const CUST = `CUS-MIX-${stamp}`;
const BR = `BR-MIX-${stamp}`;
const VAT = 5;

let passed = 0;
function check(condition, message) { if (!condition) throw new Error("FAILED: " + message); passed++; console.log("  ✓ " + message); }
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token, n = 0;
const H = () => ({ Authorization: `Bearer ${token}`, "X-Company-ID": CO, "X-Branch-ID": BR, "Content-Type": "application/json" });
async function exch(body) {
  const r = await fetch(`${base}/sales/exchanges`, { method: "POST", headers: H(), body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function returns(body) {
  const r = await fetch(`${base}/sales/returns`, { method: "POST", headers: H(), body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function mkProductSale({ unitPrice, unitCost, unitW, qty, start }) {
  const pid = `PRD-ID-MIX-${stamp}-${++n}`;
  await Product.create({ id: pid, companyId: CO, productCode: `PC-${stamp}-${n}`, productName: "منتج", karat: 21, branchId: BR, quantityOnHand: start - qty, quantityAvailable: start - qty, quantitySold: qty, totalWeight: (start - qty) * unitW, averageUnitWeight: unitW, unitCost, averageCost: unitCost, salePrice: unitPrice, isActive: true });
  const inv = `INV-MIX-${stamp}-${++n}`;
  await Invoice.create({ id: inv, companyId: CO, customerId: CUST, customerName: "عميل", type: "sale", subtotal: 0, tax: 0, total: 0, vatRate: VAT, date: "2026-06-01", status: "paid", postingStatus: "posted", paymentMethod: "Cash", branch: "Main", branchId: BR });
  await InvoiceItem.create({ invoiceId: inv, assetId: pid, name: "منتج", quantity: qty, price: unitPrice, cost: unitCost, weight: qty * unitW, karat: 21 });
  return { pid, inv };
}
async function mkAssetSale({ price, cost }) {
  const aid = `AST-MIX-${stamp}-${++n}`;
  await Asset.create({ id: aid, companyId: CO, name: "قطعة", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost, price, branch: "Main", branchId: BR, category: "rings", location: "Showroom", barcode: `BC-${stamp}-${n}`, status: "sold" });
  const inv = `INV-MIX-${stamp}-${++n}`;
  await Invoice.create({ id: inv, companyId: CO, customerId: CUST, customerName: "عميل", type: "sale", subtotal: price, tax: 0, total: price, vatRate: VAT, date: "2026-06-01", status: "paid", postingStatus: "posted", paymentMethod: "Cash", branch: "Main", branchId: BR });
  await InvoiceItem.create({ invoiceId: inv, assetId: aid, name: "قطعة", quantity: 1, price, cost, weight: 5, karat: 21 });
  return { aid, inv };
}
async function mkAvailAsset({ price, cost }) {
  const aid = `AST-NEW-MIX-${stamp}-${++n}`;
  await Asset.create({ id: aid, companyId: CO, name: "قطعة جديدة", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost, price, branch: "Main", branchId: BR, category: "rings", location: "Showroom", barcode: `BC-${stamp}-${n}`, status: "available" });
  return aid;
}
async function mkAvailProduct({ unitPrice, unitCost, unitW, available }) {
  const pid = `PRD-ID-NEW-MIX-${stamp}-${++n}`;
  await Product.create({ id: pid, companyId: CO, productCode: `PCN-${stamp}-${n}`, productName: "منتج جديد", karat: 21, branchId: BR, quantityOnHand: available, quantityAvailable: available, quantitySold: 0, totalWeight: available * unitW, averageUnitWeight: unitW, unitCost, averageCost: unitCost, salePrice: unitPrice, isActive: true });
  return pid;
}
async function jeBalanced(sourceId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceId }, order: [["created_at", "DESC"]] });
  if (!je) return { found: false };
  const rows = await JournalLine.findAll({ where: { journalEntryId: je.id } });
  const m = {}; let dr = 0, cr = 0;
  for (const l of rows) { m[l.accountCode] = m[l.accountCode] || { debit: 0, credit: 0 }; m[l.accountCode].debit += Number(l.debit || 0); m[l.accountCode].credit += Number(l.credit || 0); dr += Number(l.debit || 0); cr += Number(l.credit || 0); }
  return { found: true, m, balanced: approx(dr, cr) };
}
const lastExchange = async (origInv) => Invoice.findOne({ where: { companyId: CO, relatedInvoiceId: origInv, type: "exchange" }, order: [["created_at", "DESC"]] });

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify MIX Co", workspace: `verify-mix-${stamp}` });
    await Setting.create({ companyId: CO, key: "vatRate", value: VAT });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });

    console.log("1) legacy newAssetIds still works:");
    const s1 = await mkAssetSale({ price: 1000, cost: 700 });
    const s1b = await mkAvailAsset({ price: 1200, cost: 800 });
    const r1 = await exch({ originalInvoiceId: s1.inv, returnedAssetId: s1.aid, newAssetIds: [s1b] });
    check(r1.status < 400, "legacy newAssetIds exchange → success");
    const e1 = await lastExchange(s1.inv);
    check(approx(e1.subtotal, 200) && approx(e1.tax, 10) && approx(e1.total, 210), "legacy diff 200/10/210");
    check((await Asset.findByPk(s1b)).status === "sold", "legacy new asset → sold");

    console.log("\n2) newItems asset-only works:");
    const s2 = await mkAssetSale({ price: 1000, cost: 700 });
    const s2b = await mkAvailAsset({ price: 1100, cost: 750 });
    const r2 = await exch({ originalInvoiceId: s2.inv, returnedAssetId: s2.aid, newItems: [{ type: "asset", id: s2b }] });
    check(r2.status < 400, "newItems asset-only → success");
    check((await Asset.findByPk(s2b)).status === "sold", "newItems asset → sold");

    console.log("\n3) returned Asset + new Product (forged ignored):");
    const s3 = await mkAssetSale({ price: 1000, cost: 700 });
    const np3 = await mkAvailProduct({ unitPrice: 500, unitCost: 300, unitW: 2, available: 10 });
    const r3 = await exch({ originalInvoiceId: s3.inv, returnedAssetId: s3.aid, newItems: [{ type: "product", id: np3, quantity: 3 }], subtotal: 99999, tax: 99999, total: 99999, price: 99999, cost: 99999 });
    check(r3.status < 400, "returned asset + new product → success");
    const e3 = await lastExchange(s3.inv);
    // returnedValue 1000; new 500*3=1500; diff 500; tax 25; total 525
    check(approx(e3.subtotal, 500) && approx(e3.tax, 25) && approx(e3.total, 525), "diff server-computed 500/25/525 (forged ignored)");
    const np3After = await Product.findByPk(np3);
    check(approx(np3After.quantityAvailable, 7) && approx(np3After.quantityOnHand, 7), "new product stock decremented to 7");
    check(approx(np3After.quantitySold, 3), "new product quantitySold = 3");
    const sm3 = await StockMovement.findOne({ where: { companyId: CO, productId: np3, type: "exchange_out" } });
    check(sm3 && approx(sm3.quantityOut, 3) && approx(sm3.totalCost, 900), "StockMovement exchange_out qty 3, totalCost 900");
    const npLine = await InvoiceItem.findOne({ where: { invoiceId: e3.id, assetId: np3 } });
    check(Number(npLine.quantity) === 3 && approx(npLine.cost, 300) && approx(npLine.price, 500), "new product line qty 3, per-unit cost 300 price 500 (server)");
    const j3 = await jeBalanced(e3.id);
    check(j3.found && j3.balanced, "exchange journal balanced");
    check(approx(j3.m["5000"].debit, 900) && approx(j3.m["5000"].credit, 700), "COGS(5000): new product 900 debit, returned asset 700 credit (server)");

    console.log("\n4) returned Product + new Product:");
    const s4 = await mkProductSale({ unitPrice: 500, unitCost: 300, unitW: 2, qty: 2, start: 8 });
    const np4 = await mkAvailProduct({ unitPrice: 400, unitCost: 250, unitW: 1, available: 5 });
    const r4 = await exch({ originalInvoiceId: s4.inv, returnedAssetId: s4.pid, newItems: [{ type: "product", id: np4, quantity: 2 }] });
    check(r4.status < 400, "returned product + new product → success");
    const e4 = await lastExchange(s4.inv);
    // returned 500*2=1000; new 400*2=800; diff -200; tax -10; total -210
    check(approx(e4.subtotal, -200) && approx(e4.tax, -10) && approx(e4.total, -210), "diff -200/-10/-210");
    check(approx((await Product.findByPk(s4.pid)).quantityAvailable, 8), "returned product restocked to 8");
    check(approx((await Product.findByPk(np4)).quantityAvailable, 3), "new product decremented to 3");
    check((await jeBalanced(e4.id)).balanced, "journal balanced");

    console.log("\n5) returned Product + mixed Asset/Product:");
    const s5 = await mkProductSale({ unitPrice: 500, unitCost: 300, unitW: 2, qty: 3, start: 10 });
    const na5 = await mkAvailAsset({ price: 1200, cost: 800 });
    const np5 = await mkAvailProduct({ unitPrice: 400, unitCost: 250, unitW: 1, available: 5 });
    const r5 = await exch({ originalInvoiceId: s5.inv, returnedAssetId: s5.pid, newItems: [{ type: "asset", id: na5 }, { type: "product", id: np5, quantity: 2 }] });
    check(r5.status < 400, "returned product + mixed new → success");
    const e5 = await lastExchange(s5.inv);
    // returned 500*3=1500; new = 1200 + 400*2=800 => 2000; diff 500; tax 25; total 525
    check(approx(e5.subtotal, 500) && approx(e5.tax, 25) && approx(e5.total, 525), "mixed diff 500/25/525");
    check((await Asset.findByPk(na5)).status === "sold", "mixed new asset → sold");
    check(approx((await Product.findByPk(np5)).quantityAvailable, 3), "mixed new product decremented to 3");
    const j5 = await jeBalanced(e5.id);
    check(j5.balanced, "mixed journal balanced");
    check(approx(j5.m["5000"].debit, 800 + 250 * 2), "new COGS = asset 800 + product 500 (server)");

    console.log("\n6) negative validations (no write):");
    const sneg = await mkAssetSale({ price: 1000, cost: 700 });
    const pAvail = await mkAvailProduct({ unitPrice: 100, unitCost: 60, unitW: 1, available: 2 });
    const aAvail = await mkAvailAsset({ price: 100, cost: 50 });
    check((await exch({ originalInvoiceId: sneg.inv, returnedAssetId: sneg.aid, newItems: [{ type: "product", id: pAvail, quantity: 5 }] })).status >= 400, "qty > available → rejected");
    check((await exch({ originalInvoiceId: sneg.inv, returnedAssetId: sneg.aid, newItems: [{ type: "product", id: pAvail, quantity: 0 }] })).status >= 400, "qty 0 → rejected");
    check((await exch({ originalInvoiceId: sneg.inv, returnedAssetId: sneg.aid, newItems: [{ type: "product", id: pAvail, quantity: 1.5 }] })).status >= 400, "non-integer qty → rejected");
    check((await exch({ originalInvoiceId: sneg.inv, returnedAssetId: sneg.aid, newItems: [{ type: "product", id: pAvail, quantity: 1 }, { type: "product", id: pAvail, quantity: 1 }] })).status >= 400, "duplicate product → rejected");
    check((await exch({ originalInvoiceId: sneg.inv, returnedAssetId: sneg.aid, newItems: [{ type: "asset", id: aAvail }, { type: "asset", id: aAvail }] })).status >= 400, "duplicate asset → rejected");
    check((await exch({ originalInvoiceId: sneg.inv, returnedAssetId: sneg.aid, newItems: [{ type: "product", id: "NOPE", quantity: 1 }] })).status >= 400, "unknown id → rejected");
    check((await exch({ originalInvoiceId: sneg.inv, returnedAssetId: sneg.aid, newItems: [{ type: "widget", id: aAvail }] })).status >= 400, "invalid type → rejected");
    check((await exch({ originalInvoiceId: sneg.inv, returnedAssetId: sneg.aid, newItems: [] })).status >= 400, "empty newItems → rejected");
    // nothing was created/changed by the rejected calls
    check((await Asset.findByPk(sneg.aid)).status === "sold", "returned asset untouched after rejections");
    check(approx((await Product.findByPk(pAvail)).quantityAvailable, 2), "available product stock untouched after rejections");

    console.log("\n7) newItems takes priority over newAssetIds:");
    const s7 = await mkAssetSale({ price: 1000, cost: 700 });
    const ignored = await mkAvailAsset({ price: 5000, cost: 4000 }); // in newAssetIds, must be ignored
    const used = await mkAvailAsset({ price: 1100, cost: 750 });     // in newItems, must be used
    const r7 = await exch({ originalInvoiceId: s7.inv, returnedAssetId: s7.aid, newAssetIds: [ignored], newItems: [{ type: "asset", id: used }] });
    check(r7.status < 400, "newItems+newAssetIds → success");
    const e7 = await lastExchange(s7.inv);
    check(Boolean(await InvoiceItem.findOne({ where: { invoiceId: e7.id, assetId: used } })), "newItems id used");
    check(!(await InvoiceItem.findOne({ where: { invoiceId: e7.id, assetId: ignored } })), "newAssetIds id ignored");
    check((await Asset.findByPk(ignored)).status === "available", "ignored asset untouched (still available)");

    console.log("\n8) double exchange of same returned line rejected:");
    const dNew = await mkAvailAsset({ price: 100, cost: 50 });
    check((await exch({ originalInvoiceId: s3.inv, returnedAssetId: s3.aid, newItems: [{ type: "asset", id: dNew }] })).status >= 400, "re-exchange same returned line → rejected");

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
