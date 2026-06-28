/**
 * Gold cost snapshot fields — Phase 15D verify.
 *
 * Confirms the additive migration + model attributes exist on BOTH
 * purchase_order_items and assets as a forward-only foundation: the 12 columns
 * are present in DB and mapped on the models, computed fields are nullable,
 * cost_source/cost_overridden carry safe metadata defaults, the migration file
 * is guarded + carries no destructive execution, and creating rows without the
 * new fields works (legacy-safe). No StockMovement change, no posting/report.
 *
 * WRITE/READ — fixtures under a throwaway company; cleanup deletes the company
 * LAST so FK cascade removes every row. No residue.
 *
 *   cd backend && node scripts/verify-gold-cost-snapshot-fields.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const models = require("../src/models");

const { sequelize, Company, Supplier, Branch, PurchaseOrder, PurchaseOrderItem, Asset, StockMovement } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-GCSF-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

const COLS = ["gold_price_snapshot", "gold_price_source", "gold_price_karat", "gold_price_at", "computed_gold_cost", "final_purchase_cost", "cost_source", "cost_overridden", "override_reason", "override_by", "override_at", "net_gold_weight"];
const ATTRS = ["goldPriceSnapshot", "goldPriceSource", "goldPriceKarat", "goldPriceAt", "computedGoldCost", "finalPurchaseCost", "costSource", "costOverridden", "overrideReason", "overrideBy", "overrideAt", "netGoldWeight"];
const ATTR_TO_COL = {
  goldPriceSnapshot: "gold_price_snapshot", goldPriceSource: "gold_price_source", goldPriceKarat: "gold_price_karat",
  goldPriceAt: "gold_price_at", computedGoldCost: "computed_gold_cost", finalPurchaseCost: "final_purchase_cost",
  costSource: "cost_source", costOverridden: "cost_overridden", overrideReason: "override_reason",
  overrideBy: "override_by", overrideAt: "override_at", netGoldWeight: "net_gold_weight",
};
const NULLABLE_COMPUTED = ["gold_price_snapshot", "gold_price_at", "computed_gold_cost", "final_purchase_cost", "net_gold_weight", "override_reason", "override_by", "override_at"];

(async () => {
  await sequelize.authenticate();
  try {
    console.log("1) migration file is guarded and non-destructive:");
    const migFile = path.join(__dirname, "..", "migrations", "20260627020000-add-gold-cost-snapshot-fields.js");
    check(fs.existsSync(migFile), "migration file exists");
    const src = fs.readFileSync(migFile, "utf8");
    check(/columnExists/.test(src) && /describeTable/.test(src), "migration uses columnExists/describeTable guards");
    check(/addColumn/.test(src) && /purchase_order_items/.test(src) && /assets/.test(src), "migration addColumn on purchase_order_items + assets");
    check(/down\s*:/.test(src) && /removeColumn/.test(src), "migration has a safe down() (not executed)");
    check(!/db:seed|migrate:undo|db:reset|bulkDelete|destroy\(/.test(src), "migration contains no seed/reset/undo/destroy execution");

    console.log("\n2) DB columns exist on both tables, computed fields nullable, metadata defaults:");
    for (const table of ["purchase_order_items", "assets"]) {
      const desc = await sequelize.getQueryInterface().describeTable(table);
      for (const c of COLS) check(Boolean(desc[c]), `${table}.${c} exists`);
      for (const c of NULLABLE_COMPUTED) check(desc[c].allowNull === true, `${table}.${c} is nullable`);
      check(desc.cost_source.allowNull === false && String(desc.cost_source.defaultValue ?? "").includes("manual"), `${table}.cost_source NOT NULL default manual`);
      check(desc.cost_overridden.allowNull === false, `${table}.cost_overridden NOT NULL`);
    }

    console.log("\n3) model attributes + field mapping (PurchaseOrderItem + Asset):");
    for (const [label, model] of [["PurchaseOrderItem", PurchaseOrderItem], ["Asset", Asset]]) {
      for (const a of ATTRS) {
        check(a in model.rawAttributes, `${label}.${a} attribute defined`);
        check(model.rawAttributes[a].field === ATTR_TO_COL[a], `${label}.${a} maps to ${ATTR_TO_COL[a]}`);
      }
    }

    console.log("\n4) StockMovement was NOT touched (no new fields):");
    for (const a of ATTRS) check(!(a in StockMovement.rawAttributes), `StockMovement has NO ${a}`);

    console.log("\n5) legacy-safe: create rows WITHOUT the new fields → metadata defaults applied:");
    await Company.create({ id: CO, businessName: "Verify GCSF Co", workspace: `verify-gcsf-${stamp}` });
    await Supplier.create({ id: `SUP-${stamp}`, companyId: CO, name: "م", phone: "+1", category: "general" });
    await Branch.create({ id: `BR-${stamp}`, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });
    const po = await PurchaseOrder.create({ id: `PO-${stamp}`, companyId: CO, supplierId: `SUP-${stamp}`, supplierName: "م", status: "received", date: "2026-05-01", total: 100, branch: "Main" });
    const poi = await PurchaseOrderItem.create({ id: `POI-${stamp}`, purchaseOrderId: po.id, description: "بند", quantity: 1, unitPrice: 100, total: 100 });
    check(poi.costSource === "manual" && poi.costOverridden === false, "PurchaseOrderItem defaults: costSource=manual, costOverridden=false");
    check(poi.computedGoldCost === null && poi.goldPriceSnapshot === null && poi.netGoldWeight === null, "PurchaseOrderItem computed fields default to null (no fake snapshot)");
    const asset = await Asset.create({ id: `AST-${stamp}`, companyId: CO, name: "قطعة", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, cost: 100, price: 130, branch: "Main", category: "rings", location: "Showroom", barcode: `BC-${stamp}` });
    check(asset.costSource === "manual" && asset.costOverridden === false, "Asset defaults: costSource=manual, costOverridden=false");
    check(asset.computedGoldCost === null && asset.finalPurchaseCost === null && asset.netGoldWeight === null, "Asset computed fields default to null");
    check(Number(asset.cost) === 100, "existing Asset.cost field unaffected (100)");

    console.log("\n6) new fields persist when set:");
    await asset.update({ goldPriceSnapshot: 250.5, goldPriceKarat: "21", computedGoldCost: 1252.5, finalPurchaseCost: 1252.5, netGoldWeight: 5, costSource: "gold_center" });
    const a2 = await Asset.findByPk(asset.id);
    check(Number(a2.goldPriceSnapshot) === 250.5 && Number(a2.computedGoldCost) === 1252.5 && a2.costSource === "gold_center", "snapshot/computed/source persist on Asset");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("assets", () => Asset.destroy({ where: { companyId: CO }, force: true }));
    await safe("purchase order items", () => PurchaseOrderItem.destroy({ where: { purchaseOrderId: `PO-${stamp}` }, force: true }));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("branches", () => Branch.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascade remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all rows removed; no residue");
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
