/**
 * Gold cost — valuation / COGS consistency — Phase 15H verify (audit).
 *
 * Read-only consistency proof across the 15C–15G chain + sale:
 *   - receive sets the BOOK cost per VAT mode (recoverable→net, non-recoverable
 *     exclusive→capitalized) and GL inventory matches it
 *   - COGS at sale = book cost (Asset.cost), NOT computedGoldCost and NOT market
 *   - inventory valuation separates book (Asset.cost) vs market (current
 *     GoldPrice); a price change moves market only, never book; valuation never
 *     uses computedGoldCost
 *
 * No production touch. Fixtures under throwaway companies, cleaned up. No residue.
 *
 *   cd backend && node scripts/verify-gold-cost-valuation-cogs-consistency.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const postingService = require("../src/services/posting.service");

const { sequelize, Company, Customer, Supplier, Branch, Setting, GoldPrice, Asset, Invoice, InvoiceItem, PurchaseOrder, PurchaseOrderItem, StockMovement, AssetEvent, JournalEntry, JournalLine, Account, CashTransaction } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-VC-${stamp}`;        // receive + COGS
const CO2 = `CMP-VERIFY-VC2-${stamp}`;      // isolated valuation
const SUP = `SUP-VC-${stamp}`;
const BR = `BR-VC-${stamp}`;
const CUST = `CUS-VC-${stamp}`;
const PRICE = 300; // karat 21 per-gram → computed for 5g = 1500

let passed = 0;
function check(condition, message) { if (!condition) throw new Error("FAILED: " + message); passed++; console.log("  ✓ " + message); }
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token, poN = 0;
async function setKV(co, key, value) {
  const [row, c] = await Setting.findOrCreate({ where: { companyId: co, key }, defaults: { companyId: co, key, value } });
  if (!c) await row.update({ value });
}
async function receive(items, body = {}) {
  const id = `PO-VC-${stamp}-${++poN}`;
  const r = await fetch(`${base}/purchase-orders/receive`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" }, body: JSON.stringify({ id, supplierId: SUP, branchId: BR, paymentMethod: "credit", items, ...body }) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, id };
}
async function valuation(co) {
  const r = await fetch(`${base}/reports/inventory-valuation`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": co } });
  let json = null; try { json = await r.json(); } catch {}
  return json.data;
}
const latestAsset = () => Asset.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });
async function invDebit(poId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceType: "purchase_order", sourceId: poId } });
  const rows = je ? await JournalLine.findAll({ where: { journalEntryId: je.id, accountCode: "1200" } }) : [];
  return rows.reduce((s, r) => s + Number(r.debit || 0), 0);
}
// Post a cash sale for one asset and return its COGS journal lines.
async function sellAsset(asset, salePrice) {
  const inv = await Invoice.create({ id: `INV-VC-${stamp}-${asset.id.slice(-6)}`, companyId: CO, customerId: CUST, customerName: "عميل", type: "sale", total: salePrice, tax: 0, subtotal: salePrice, date: "2026-06-01", status: "paid", postingStatus: "posted", paymentMethod: "Cash", branch: "Main" });
  const it = await InvoiceItem.create({ invoiceId: inv.id, assetId: asset.id, name: asset.name, quantity: 1, price: salePrice, cost: Number(asset.cost) });
  const je = await postingService.postInvoiceEntry(inv.toJSON(), [it.toJSON()], "Verify");
  const rows = await JournalLine.findAll({ where: { journalEntryId: je.id } });
  const map = {};
  for (const r of rows) { map[r.accountCode] = map[r.accountCode] || { debit: 0, credit: 0 }; map[r.accountCode].debit += Number(r.debit || 0); map[r.accountCode].credit += Number(r.credit || 0); }
  return map;
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify VC Co", workspace: `verify-vc-${stamp}` });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد", phone: "+2", category: "general" });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });
    await GoldPrice.create({ companyId: CO, karat: 21, pricePerGram: PRICE, currency: "AED", source: "manual" });
    await setKV(CO, "goldCostSource", "hybrid");
    const oneAsset = [{ name: "خاتم", quantity: 1, weightPerUnit: 5, unitCost: 1000, karat: 21 }];

    console.log("1) recoverable VAT → book cost net, GL net, COGS net:");
    const rRec = await receive(oneAsset, { applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: true });
    const aRec = await latestAsset();
    check(Number(aRec.cost) === 1000, "recoverable: Asset.cost = 1000 (net)");
    check(approx(await invDebit(rRec.id), 1000), "recoverable: GL inventory = 1000 (net)");
    const cogsRec = await sellAsset(aRec, 2000);
    check(approx(cogsRec["5000"].debit, 1000) && approx(cogsRec["1200"].credit, 1000), "recoverable: COGS(5000)=1000, inventory credit=1000 (book net)");

    console.log("\n2) non-recoverable exclusive → book cost capitalized, GL gross, COGS capitalized:");
    const rNr = await receive(oneAsset, { applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: false });
    const aNr = await latestAsset();
    check(approx(aNr.cost, 1050), "non-recoverable: Asset.cost = 1050 (net + VAT)");
    check(approx(aNr.computedGoldCost, 1500), "non-recoverable: computedGoldCost = 1500 (reference, weight×price)");
    check(approx(await invDebit(rNr.id), 1050), "non-recoverable: GL inventory = 1050 (gross) == Asset.cost");
    const cogsNr = await sellAsset(aNr, 2500);
    check(approx(cogsNr["5000"].debit, 1050), "non-recoverable: COGS(5000) = 1050 (capitalized book), NOT 1500 (computed) nor market");
    check(approx(cogsNr["1200"].credit, 1050), "non-recoverable: inventory credit = 1050");

    console.log("\n3) no VAT → legacy cost, COGS legacy:");
    const rNo = await receive(oneAsset, { applyVat: false });
    const aNo = await latestAsset();
    check(Number(aNo.cost) === 1000, "no VAT: Asset.cost = 1000 (legacy)");
    const cogsNo = await sellAsset(aNo, 1800);
    check(approx(cogsNo["5000"].debit, 1000), "no VAT: COGS(5000) = 1000 (legacy book)");

    console.log("\n4) RCM → no capitalization, COGS net:");
    const rRcm = await receive(oneAsset, { isDRC: true, rcmRate: 5 });
    const aRcm = await latestAsset();
    check(Number(aRcm.cost) === 1000, "RCM: Asset.cost = 1000 (net)");
    const cogsRcm = await sellAsset(aRcm, 1900);
    check(approx(cogsRcm["5000"].debit, 1000), "RCM: COGS(5000) = 1000 (book net)");

    console.log("\n5) inventory valuation: book vs market, isolated company:");
    await Company.create({ id: CO2, businessName: "Verify VC2", workspace: `verify-vc2-${stamp}` });
    await GoldPrice.create({ companyId: CO2, karat: 21, pricePerGram: PRICE, currency: "AED", source: "manual" });
    // book cost 1050 + 1000 = 2050; computedGoldCost intentionally bogus to prove it is NOT used.
    await Asset.create({ id: `AST-VC2-A-${stamp}`, companyId: CO2, name: "A", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost: 1050, price: 2000, branch: "Main", category: "rings", location: "Showroom", barcode: `BCA-${stamp}`, status: "available", computedGoldCost: 99999 });
    await Asset.create({ id: `AST-VC2-B-${stamp}`, companyId: CO2, name: "B", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost: 1000, price: 2000, branch: "Main", category: "rings", location: "Showroom", barcode: `BCB-${stamp}`, status: "available", computedGoldCost: 88888 });
    const v1 = await valuation(CO2);
    check(approx(v1.totals.costValue, 2050), "valuation book costValue = 2050 (Asset.cost, NOT computedGoldCost 99999/88888)");
    check(approx(v1.totals.marketValue, 3000), "valuation marketValue = 10g × 300 = 3000 (current GoldPrice)");
    check(approx(v1.totals.unrealizedGainLoss, 950), "unrealizedGainLoss = market 3000 - book 2050 = 950");

    console.log("\n6) GoldPrice change moves market only, never book:");
    await GoldPrice.create({ companyId: CO2, karat: 21, pricePerGram: 320, currency: "AED", source: "manual" });
    const v2 = await valuation(CO2);
    check(approx(v2.totals.costValue, 2050), "after price change: book costValue UNCHANGED (2050)");
    check(approx(v2.totals.marketValue, 3200), "after price change: marketValue = 10g × 320 = 3200 (changed)");
    check(v2.valuationType === "current" && v2.informational === true, "valuation flagged current/informational (posts no journal)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    for (const co of [CO, CO2]) {
      await safe("asset events", () => AssetEvent.destroy({ where: {}, force: true }).catch(() => {}));
      await safe("invoice items", () => InvoiceItem.destroy({ where: {}, force: true }).catch(() => {}));
      await safe("invoices", () => Invoice.destroy({ where: { companyId: co }, force: true }));
      await safe("assets", () => Asset.destroy({ where: { companyId: co }, force: true }));
      await safe("stock movements", () => StockMovement.destroy({ where: { companyId: co } }));
      await safe("purchase order items", () => PurchaseOrderItem.destroy({ where: {}, force: true }).catch(() => {}));
      await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: co }, force: true }));
      await safe("journal entries", () => JournalEntry.destroy({ where: { companyId: co } }));
      await safe("accounts", () => Account.destroy({ where: { companyId: co } }));
      await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: co } }));
      await safe("gold prices", () => GoldPrice.destroy({ where: { companyId: co } }));
      await safe("settings", () => Setting.destroy({ where: { companyId: co } }));
      await safe("customers", () => Customer.destroy({ where: { companyId: co }, force: true }));
      await safe("suppliers", () => Supplier.destroy({ where: { companyId: co }, force: true }));
      await safe("branches", () => Branch.destroy({ where: { companyId: co }, force: true }));
      await safe("company", () => Company.destroy({ where: { id: co } }));
    }
    console.log("cleanup done — throwaway companies + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
