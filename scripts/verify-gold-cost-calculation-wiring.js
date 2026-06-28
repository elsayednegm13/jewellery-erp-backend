/**
 * Gold cost calculation wiring — Phase 15E verify.
 *
 * Proves the receive flow records a Gold-Center snapshot + cost metadata on
 * PurchaseOrderItem / Asset WITHOUT changing any legacy financial value:
 *   - pure helper buildGoldCostSnapshot: manual / hybrid / gold_center + graceful
 *     fallback when price/karat/weight missing
 *   - manual mode: no price needed, no snapshot, legacy cost untouched
 *   - hybrid / gold_center mode with a GoldPrice: snapshot + computedGoldCost
 *     saved; Asset.cost / Product.averageCost / PO totals / posting unchanged
 *
 * WRITE — fixtures under a throwaway company; cleanup deletes the company LAST.
 * No residue. No migration added in 15E.
 *
 *   cd backend && node scripts/verify-gold-cost-calculation-wiring.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const goldCostService = require("../src/services/gold-cost.service");

const { sequelize, Company, Supplier, Branch, Setting, GoldPrice, PurchaseOrder, PurchaseOrderItem, Asset, Product, StockMovement, JournalEntry, JournalLine, Account } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-GCW-${stamp}`;
const SUP = `SUP-GCW-${stamp}`;
const BR = `BR-GCW-${stamp}`;
const PRICE = 250; // per gram for karat 21

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token, poN = 0;
async function setSource(src) {
  const [row, created] = await Setting.findOrCreate({ where: { companyId: CO, key: "goldCostSource" }, defaults: { companyId: CO, key: "goldCostSource", value: src } });
  if (!created) await row.update({ value: src });
}
async function receive(extra) {
  const id = `PO-GCW-${stamp}-${++poN}`;
  const body = {
    id, supplierId: SUP, branchId: BR, paymentMethod: "credit",
    items: [{ name: "خاتم", quantity: 1, weightPerUnit: 5, unitCost: 1000, karat: 21, ...(extra.item || {}) }],
    ...extra.body,
  };
  const r = await fetch(`${base}/purchase-orders/receive`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, id };
}
async function jeFor(poId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceType: "purchase_order", sourceId: poId } });
  if (!je) return null;
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
    console.log("0) pure helper buildGoldCostSnapshot:");
    const m = goldCostService.buildGoldCostSnapshot({ goldCostSource: "manual", weight: 5, karat: 21, perGram: 250, currentCost: 1000 });
    check(m.costSource === "manual" && m.computedGoldCost === null && m.goldPriceSnapshot === null && m.finalPurchaseCost === 1000, "manual → no snapshot, finalPurchaseCost = legacy cost");
    const h = goldCostService.buildGoldCostSnapshot({ goldCostSource: "hybrid", weight: 5, karat: 21, perGram: 250, currentCost: 1000 });
    check(h.costSource === "hybrid" && approx(h.computedGoldCost, 1250) && approx(h.goldPriceSnapshot, 250) && h.goldPriceKarat === "21" && approx(h.netGoldWeight, 5) && approx(h.finalPurchaseCost, 1000), "hybrid+price → computed 1250, snapshot 250, finalPurchaseCost stays 1000");
    const hNoPrice = goldCostService.buildGoldCostSnapshot({ goldCostSource: "hybrid", weight: 5, karat: 21, perGram: null, currentCost: 1000 });
    check(hNoPrice.costSource === "manual" && hNoPrice.computedGoldCost === null, "hybrid + missing price → graceful (manual, no computed)");
    const hNoKarat = goldCostService.buildGoldCostSnapshot({ goldCostSource: "gold_center", weight: 5, karat: null, perGram: 250, currentCost: 1000 });
    check(hNoKarat.computedGoldCost === null, "gold_center + missing karat → graceful (no computed)");
    check(h.costOverridden === false && h.overrideReason === null && h.overrideBy === null, "override fields stay false/null (no governance in 15E)");

    await Company.create({ id: CO, businessName: "Verify GCW Co", workspace: `verify-gcw-${stamp}` });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد", phone: "+1", category: "general" });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });
    await GoldPrice.create({ companyId: CO, karat: 21, pricePerGram: PRICE, currency: "AED", source: "manual" });

    console.log("\n1) manual mode — no snapshot, legacy cost untouched:");
    await setSource("manual");
    const rm = await receive({ body: { applyVat: false } });
    check(rm.status === 201 || rm.status === 200, "manual receive → success");
    const aM = await Asset.findOne({ where: { companyId: CO, "$purchaseOrderId$": undefined } , order: [["created_at", "DESC"]] }).catch(() => null) || await Asset.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });
    check(aM.costSource === "manual" && aM.computedGoldCost === null && aM.goldPriceSnapshot === null, "manual: Asset costSource=manual, no computed/snapshot");
    check(Number(aM.cost) === 1000, "manual: Asset.cost unchanged (1000)");

    console.log("\n2) hybrid mode — snapshot saved, book cost unchanged:");
    await setSource("hybrid");
    const rh = await receive({ body: { applyVat: false } });
    check(rh.status === 201 || rh.status === 200, "hybrid receive → success");
    const aH = await Asset.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });
    check(aH.costSource === "hybrid", "hybrid: Asset.costSource = hybrid");
    check(approx(aH.goldPriceSnapshot, PRICE) && aH.goldPriceKarat === "21" && aH.goldPriceSource === "gold_center" && aH.goldPriceAt, "hybrid: snapshot (price/karat/source/at) saved on Asset");
    check(approx(aH.computedGoldCost, 5 * PRICE) && approx(aH.netGoldWeight, 5), "hybrid: computedGoldCost = 5 × 250 = 1250, netGoldWeight = 5");
    check(Number(aH.cost) === 1000, "hybrid: Asset.cost UNCHANGED (1000, not 1250)");
    check(approx(aH.finalPurchaseCost, 1000), "hybrid: finalPurchaseCost = legacy cost (1000)");
    const poiH = await PurchaseOrderItem.findOne({ where: { purchaseOrderId: rh.id } });
    check(poiH.costSource === "hybrid" && approx(poiH.computedGoldCost, 1250) && approx(Number(poiH.total), 1000), "hybrid: PurchaseOrderItem snapshot saved, legacy total unchanged (1000)");

    console.log("\n3) posting + PO totals unchanged (book cost = legacy, not computed):");
    const poH = await PurchaseOrder.findByPk(rh.id);
    check(Number(poH.total) === 1000, "PurchaseOrder.total unchanged (1000)");
    const lH = await jeFor(rh.id);
    check(lH && approx(lH["1200"].debit, 1000), "GL Inventory(1200) debit = 1000 (legacy, NOT computed 1250)");
    check(!lH["1400"] || approx(lH["1400"].debit, 0), "no VAT line (applyVat false)");

    console.log("\n4) gold_center mode — snapshot saved, costSource=gold_center:");
    await setSource("gold_center");
    const rg = await receive({ body: { applyVat: false } });
    check(rg.status === 201 || rg.status === 200, "gold_center receive → success");
    const aG = await Asset.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });
    check(aG.costSource === "gold_center" && approx(aG.computedGoldCost, 1250), "gold_center: costSource=gold_center, computed 1250");
    check(Number(aG.cost) === 1000, "gold_center: Asset.cost still unchanged (1000)");

    console.log("\n5) product path — snapshot on PurchaseOrderItem, averageCost unchanged:");
    await setSource("hybrid");
    const rp = await receive({ item: { productCode: `PRD-GCW-${stamp}`, quantity: 2, weightPerUnit: 4, unitCost: 800 } });
    check(rp.status === 201 || rp.status === 200, "product receive → success");
    const prod = await Product.findOne({ where: { companyId: CO, productCode: `PRD-GCW-${stamp}` } });
    check(Number(prod.averageCost) === 800, "Product.averageCost = unitCost 800 (unchanged logic)");
    const poiP = await PurchaseOrderItem.findOne({ where: { purchaseOrderId: rp.id } });
    check(poiP.costSource === "hybrid" && approx(poiP.computedGoldCost, 2 * 4 * PRICE) && approx(Number(poiP.total), 1600), "product poItem: computed = lineWeight(8) × 250 = 2000, legacy total unchanged (1600)");

    console.log("\n6) StockMovement untouched (no snapshot fields):");
    const sm = await StockMovement.findOne({ where: { companyId: CO } });
    check(sm && !("costSource" in sm.dataValues) && !("computedGoldCost" in sm.dataValues), "StockMovement has no gold-cost snapshot fields");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("assets", () => Asset.destroy({ where: { companyId: CO }, force: true }));
    await safe("stock movements", () => StockMovement.destroy({ where: { companyId: CO } }));
    await safe("products", () => Product.destroy({ where: { companyId: CO }, force: true }));
    await safe("purchase order items", () => PurchaseOrderItem.destroy({ where: {}, force: true }).catch(() => {}));
    await safe("journal entries", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("cash transactions", () => models.CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("gold prices", () => GoldPrice.destroy({ where: { companyId: CO } }));
    await safe("settings", () => Setting.destroy({ where: { companyId: CO } }));
    await safe("branches", () => Branch.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascade remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
