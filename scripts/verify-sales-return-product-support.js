/**
 * Sales return product support — Phase 18I verify.
 *
 * Proves /sales/returns now handles BOTH item kinds (InvoiceItem.assetId carries
 * an Asset id or a Product id), with server-sourced financials:
 *   - Product FULL return: accepts a PRD-ID in returnedAssetIds; credit-note line
 *     quantity = original line qty; subtotal = origItem.price × qty; VAT server;
 *     COGS reversal = origItem.cost × qty; product stock restocked
 *     (quantityAvailable/onHand += qty, quantitySold -= qty, totalWeight restored);
 *     a StockMovement type="return" is logged; forged body cost/tax/total ignored.
 *   - Double product return rejected; unknown id rejected.
 *   - Asset return STILL works (qty 1, asset → returned, COGS = asset cost).
 *   - Return journals balance.
 *
 * WRITE — fixtures under a throwaway company; cleanup is SCOPED (Phase 18G):
 * invoice_items deleted only for this company's invoices. No residue.
 *
 *   cd backend && node scripts/verify-sales-return-product-support.js
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
const CO = `CMP-VERIFY-RPS-${stamp}`;
const CUST = `CUS-RPS-${stamp}`;
const BR = `BR-RPS-${stamp}`;
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
async function mkSale(itemRow, { vat = VAT } = {}) {
  const id = `INV-RPS-${stamp}-${++n}`;
  await Invoice.create({ id, companyId: CO, customerId: CUST, customerName: "عميل", type: "sale", subtotal: 0, tax: 0, total: 0, vatRate: vat, date: "2026-06-01", status: "paid", postingStatus: "posted", paymentMethod: "Cash", branch: "Main", branchId: BR });
  await InvoiceItem.create({ invoiceId: id, ...itemRow });
  return id;
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
    await Company.create({ id: CO, businessName: "Verify RPS Co", workspace: `verify-rps-${stamp}` });
    await Setting.create({ companyId: CO, key: "vatRate", value: VAT });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });

    // ── Product full-return ────────────────────────────────────────────────
    // unit: price 500, cost 300, unit weight 2g. Sold qty 3 from a stock of 10.
    const PRD = `PRD-ID-RPS-${stamp}`;
    const UNIT_PRICE = 500, UNIT_COST = 300, UNIT_W = 2, QTY = 3, START = 10;
    await Product.create({
      id: PRD, companyId: CO, productCode: `PC-${stamp}`, productName: "منتج كمي", karat: 21, branchId: BR,
      quantityOnHand: START - QTY, quantityAvailable: START - QTY, quantitySold: QTY, quantityReserved: 0,
      totalWeight: (START - QTY) * UNIT_W, averageUnitWeight: UNIT_W, unitCost: UNIT_COST, averageCost: UNIT_COST, salePrice: UNIT_PRICE, isActive: true,
    });
    const prodInv = await mkSale({ assetId: PRD, name: "منتج كمي", quantity: QTY, price: UNIT_PRICE, cost: UNIT_COST, weight: QTY * UNIT_W, karat: 21 });

    console.log("1) product full return accepts PRD-ID and ignores forged body:");
    const r1 = await post("/sales/returns", {
      originalInvoiceId: prodInv, returnedAssetIds: [PRD], reason: "تجربة",
      subtotal: 99999, tax: 99999, total: 99999, cost: 99999, price: 99999, // forged
      items: [{ assetId: PRD, cost: 99999, price: 99999, quantity: 99 }], // forged
    });
    check(r1.status === 201 || r1.status === 200, "product return → success");
    const cn = await Invoice.findOne({ where: { companyId: CO, relatedInvoiceId: prodInv, type: "return" }, order: [["created_at", "DESC"]] });
    check(approx(cn.subtotal, -(UNIT_PRICE * QTY)) && approx(cn.tax, -(UNIT_PRICE * QTY * VAT / 100)) && approx(cn.total, -(UNIT_PRICE * QTY * (1 + VAT / 100))),
      `credit note server totals: subtotal ${-(UNIT_PRICE * QTY)} / tax ${-(UNIT_PRICE * QTY * VAT / 100)} (forged 99999 ignored)`);
    const cnItem = await InvoiceItem.findOne({ where: { invoiceId: cn.id } });
    check(Number(cnItem.quantity) === QTY, `credit-note item quantity = original ${QTY} (not forged 99, not 1)`);
    check(approx(cnItem.cost, UNIT_COST), `credit-note item unit cost = original ${UNIT_COST} (forged ignored)`);

    console.log("\n2) product stock restocked + StockMovement logged:");
    const prodAfter = await Product.findByPk(PRD);
    check(approx(prodAfter.quantityAvailable, START) && approx(prodAfter.quantityOnHand, START), `quantityAvailable & onHand back to ${START}`);
    check(approx(prodAfter.quantitySold, 0), "quantitySold reduced to 0 (not negative)");
    check(approx(prodAfter.totalWeight, START * UNIT_W), `totalWeight restored to ${START * UNIT_W}`);
    const sm = await StockMovement.findOne({ where: { companyId: CO, productId: PRD, type: "return" }, order: [["created_at", "DESC"]] });
    check(sm && approx(sm.quantityIn, QTY) && approx(sm.quantityOut, 0), `StockMovement type=return, quantityIn=${QTY}`);
    check(sm && approx(sm.totalCost, UNIT_COST * QTY), `StockMovement totalCost = ${UNIT_COST * QTY} (server cost)`);

    console.log("\n3) product return COGS/VAT reversal server-sourced + balanced:");
    const j1 = await jeBySource(cn.id);
    check(j1 && approx(j1.m["5000"].credit, UNIT_COST * QTY), `COGS(5000) reversal = ${UNIT_COST * QTY} (origItem.cost × qty)`);
    check(j1 && approx(j1.m["1200"].debit, UNIT_COST * QTY), `inventory(1200) restored = ${UNIT_COST * QTY}`);
    check(j1 && approx(j1.m["4100"].debit, UNIT_PRICE * QTY), `revenue(4100) reversed = ${UNIT_PRICE * QTY}`);
    check(j1 && approx(j1.m["2200"].debit, UNIT_PRICE * QTY * VAT / 100), "VAT(2200) reversed = server tax");
    check(j1 && j1.balanced, "product return journal balanced");

    console.log("\n4) double product return rejected, unknown id rejected:");
    check((await post("/sales/returns", { originalInvoiceId: prodInv, returnedAssetIds: [PRD], reason: "مكرر" })).status >= 400, "second product return → rejected");
    const prodInv2 = await mkSale({ assetId: PRD, name: "منتج كمي", quantity: 1, price: UNIT_PRICE, cost: UNIT_COST, weight: UNIT_W, karat: 21 });
    check((await post("/sales/returns", { originalInvoiceId: prodInv2, returnedAssetIds: ["DOES-NOT-EXIST"], reason: "x" })).status >= 400, "unknown returned id → rejected");

    console.log("\n5) asset return still works (qty 1, asset → returned):");
    const AST = `AST-RPS-${stamp}`;
    await Asset.create({ id: AST, companyId: CO, name: "قطعة", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost: 700, price: 1000, branch: "Main", branchId: BR, category: "rings", location: "Showroom", barcode: `BC-RPS-${stamp}`, status: "sold" });
    const astInv = await mkSale({ assetId: AST, name: "قطعة", quantity: 1, price: 1000, cost: 700, weight: 5, karat: 21 });
    const r5 = await post("/sales/returns", { originalInvoiceId: astInv, returnedAssetIds: [AST], reason: "تجربة" });
    check(r5.status === 201 || r5.status === 200, "asset return → success");
    const acn = await Invoice.findOne({ where: { companyId: CO, relatedInvoiceId: astInv, type: "return" }, order: [["created_at", "DESC"]] });
    const acnItem = await InvoiceItem.findOne({ where: { invoiceId: acn.id } });
    check(Number(acnItem.quantity) === 1, "asset credit-note item quantity = 1");
    check((await Asset.findByPk(AST)).status === "returned", "asset status → returned");
    const j5 = await jeBySource(acn.id);
    check(j5 && approx(j5.m["5000"].credit, 700) && j5.balanced, "asset return COGS reversal = 700, balanced");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    const jeIds = (await JournalEntry.findAll({ where: { companyId: CO }, attributes: ["id"] })).map((j) => j.id);
    await safe("journal lines", () => jeIds.length && JournalLine.destroy({ where: { journalEntryId: jeIds } }));
    await safe("notifications", () => Notification && Notification.destroy({ where: { companyId: CO } }).catch(() => {}));
    await safe("audit logs", () => AuditLog && AuditLog.destroy({ where: { companyId: CO } }).catch(() => {}));
    await safe("payments", () => Payment.destroy({ where: { companyId: CO } }));
    await safe("asset events", () => AssetEvent.destroy({ where: { assetId: `AST-RPS-${stamp}` }, force: true }).catch(() => {}));
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
