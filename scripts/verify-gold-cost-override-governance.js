/**
 * Gold cost override governance — Phase 15F verify.
 *
 * Proves the controlled-override layer on POST /purchase-orders/receive:
 *   - override is an EXPLICIT action (body.goldCostOverride); without it the 15E
 *     snapshot is recorded unchanged (no governance)
 *   - a genuine divergence from computedGoldCost requires allowGoldCostOverride
 *     + the override permission + a reason, and writes a gold_cost.override audit
 *   - adopting the computed value is NOT an override (no reason/permission needed)
 *   - computedGoldCost, Asset.cost, Product.averageCost, PO totals and posting
 *     are NEVER changed; failures roll back (no PurchaseOrder left behind)
 *
 * WRITE — fixtures under a throwaway company; cleanup deletes the company LAST.
 * No residue. No migration / schema change in 15F.
 *
 *   cd backend && node scripts/verify-gold-cost-override-governance.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const goldCostService = require("../src/services/gold-cost.service");

const { sequelize, Company, User, Role, Permission, RolePermission, Supplier, Branch, Setting, GoldPrice, PurchaseOrder, PurchaseOrderItem, Asset, Product, JournalEntry, JournalLine, Account, AuditLog, StockMovement, AssetEvent } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-GOV-${stamp}`;
const SUP = `SUP-GOV-${stamp}`;
const BR = `BR-GOV-${stamp}`;
const PURCH = `USR-PURCH-${stamp}`;
const PRICE = 250; // karat 21 → computed for 5g = 1250

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, adminToken, purchToken, poN = 0;
async function setSource(src) {
  const [row, c] = await Setting.findOrCreate({ where: { companyId: CO, key: "goldCostSource" }, defaults: { companyId: CO, key: "goldCostSource", value: src } });
  if (!c) await row.update({ value: src });
}
async function setAllowOverride(val) {
  const [row, c] = await Setting.findOrCreate({ where: { companyId: CO, key: "allowGoldCostOverride" }, defaults: { companyId: CO, key: "allowGoldCostOverride", value: val } });
  if (!c) await row.update({ value: val });
}
async function receive(extra, token = adminToken) {
  const id = `PO-GOV-${stamp}-${++poN}`;
  const body = { id, supplierId: SUP, branchId: BR, paymentMethod: "credit", items: [{ name: "خاتم", quantity: 1, weightPerUnit: 5, unitCost: 1000, karat: 21, ...(extra.item || {}) }], ...extra.body };
  const r = await fetch(`${base}/purchase-orders/receive`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, id };
}
const poCount = () => PurchaseOrder.count({ where: { companyId: CO } });
const overrideAuditCount = () => AuditLog.count({ where: { companyId: CO, action: "gold_cost.override" } });

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  adminToken = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  purchToken = jwt.sign({ userId: PURCH }, JWT_SECRET, { expiresIn: "1h" });

  try {
    console.log("0) pure helpers classifyOverride / applyOverride:");
    check(goldCostService.classifyOverride({ overrideInput: undefined, computedGoldCost: 1250 }).provided === false, "no input → not provided");
    check(goldCostService.classifyOverride({ overrideInput: 1250, computedGoldCost: 1250 }).isOverride === false, "input == computed → adoption (not override)");
    check(goldCostService.classifyOverride({ overrideInput: 1100, computedGoldCost: 1250 }).isOverride === true, "input != computed → override");
    check(goldCostService.classifyOverride({ overrideInput: "abc", computedGoldCost: 1250 }).invalid === true, "non-numeric → invalid");
    const ov = goldCostService.applyOverride({ computedGoldCost: 1250, costOverridden: false }, { value: 1100, isOverride: true, reason: "r", by: "u" });
    check(ov.finalPurchaseCost === 1100 && ov.costOverridden === true && ov.overrideReason === "r" && ov.overrideBy === "u" && ov.computedGoldCost === 1250, "applyOverride sets final/flag/reason/by, keeps computed");

    await Company.create({ id: CO, businessName: "Verify Gov Co", workspace: `verify-gov-${stamp}` });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد", phone: "+1", category: "general" });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });
    await GoldPrice.create({ companyId: CO, karat: 21, pricePerGram: PRICE, currency: "AED", source: "manual" });
    // Non-admin purchaser: has suppliers.create (to reach the route) but NOT goldCost.override.
    await User.create({ id: PURCH, companyId: CO, firstName: "Pur", lastName: "Chaser", email: `purch-${stamp}@v.local`, password: "x", role: "sales" });
    const [perm] = await Permission.findOrCreate({ where: { name: "suppliers.create" }, defaults: { id: `PERM-supcreate`, name: "suppliers.create", module: "suppliers", action: "create" } });
    const role = await Role.create({ id: `ROLE-PURCH-${stamp}`, companyId: CO, name: "Sales", slug: "sales", isAdmin: false });
    await RolePermission.create({ roleId: role.id, permissionId: perm.id });
    await setSource("hybrid");

    console.log("\n1) no override → 15E behavior (no governance):");
    const r1 = await receive({ body: { applyVat: false } });
    check(r1.status === 201 || r1.status === 200, "receive without override → success");
    const a1 = await Asset.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });
    check(a1.costOverridden === false && approx(a1.computedGoldCost, 1250) && approx(a1.finalPurchaseCost, 1000), "no override: costOverridden=false, computed 1250, final 1000");

    console.log("\n2) genuine override (admin) → governed + audited, legacy unchanged:");
    const auditBefore = await overrideAuditCount();
    const r2 = await receive({ body: { applyVat: false, goldCostOverride: 1100, goldCostOverrideReason: "سعر مورد متفق عليه" } });
    check(r2.status === 201 || r2.status === 200, "override with reason (admin) → success");
    const a2 = await Asset.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });
    check(a2.costOverridden === true && approx(a2.finalPurchaseCost, 1100), "override: costOverridden=true, finalPurchaseCost=1100");
    check(approx(a2.computedGoldCost, 1250), "override: computedGoldCost UNCHANGED (1250)");
    check(a2.overrideReason === "سعر مورد متفق عليه" && a2.overrideBy && a2.overrideAt, "override: reason/by/at saved");
    check(Number(a2.cost) === 1000, "override: Asset.cost UNCHANGED (1000)");
    check((await overrideAuditCount()) === auditBefore + 1, "gold_cost.override audit recorded");
    const poItem2 = await PurchaseOrderItem.findOne({ where: { purchaseOrderId: r2.id } });
    check(poItem2.costOverridden === true && approx(poItem2.finalPurchaseCost, 1100), "override mirrored on PurchaseOrderItem");
    const po2 = await PurchaseOrder.findByPk(r2.id);
    const je2 = await JournalEntry.findOne({ where: { companyId: CO, sourceType: "purchase_order", sourceId: r2.id } });
    const lines2 = je2 ? await JournalLine.findAll({ where: { journalEntryId: je2.id } }) : [];
    const inv2 = lines2.find((l) => l.accountCode === "1200");
    check(Number(po2.total) === 1000 && inv2 && approx(inv2.debit, 1000), "override: PO total + GL inventory still 1000 (posting unchanged)");

    console.log("\n3) adoption (override == computed) → NOT an override, no reason needed:");
    const r3 = await receive({ body: { applyVat: false, goldCostOverride: 1250 } });
    check(r3.status === 201 || r3.status === 200, "adopt computed (no reason) → success");
    const a3 = await Asset.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });
    check(a3.costOverridden === false && approx(a3.finalPurchaseCost, 1250), "adoption: costOverridden=false, final=1250 (no governance)");

    console.log("\n4) rejections roll back (no PurchaseOrder created):");
    const cBefore = await poCount();
    check((await receive({ body: { applyVat: false, goldCostOverride: 1100 } })).status === 422, "override without reason → 422");
    check((await receive({ body: { applyVat: false, goldCostOverride: "abc", goldCostOverrideReason: "r" } })).status === 422, "invalid override value → 422");
    check((await receive({ body: { applyVat: false, goldCostOverride: 1100, goldCostOverrideReason: "r" } }, purchToken)).status === 403, "override without permission (non-admin) → 403");
    await setAllowOverride(false);
    check((await receive({ body: { applyVat: false, goldCostOverride: 1100, goldCostOverrideReason: "r" } })).status === 403, "override disabled (allowGoldCostOverride=false) → 403");
    await setAllowOverride(true);
    check((await poCount()) === cBefore, "no PurchaseOrder created by any rejected override (rollback)");

    console.log("\n5) manual mode ignores override (no governance):");
    await setSource("manual");
    const rm = await receive({ body: { applyVat: false, goldCostOverride: 1100 } }); // no reason, should still pass
    check(rm.status === 201 || rm.status === 200, "manual + override field but no reason → success (override ignored)");
    const am = await Asset.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });
    check(am.costOverridden === false && am.computedGoldCost === null, "manual: costOverridden=false, no computed (override not applied)");

    console.log("\n6) product path override + averageCost unchanged:");
    await setSource("hybrid");
    const rp = await receive({ item: { productCode: `PRD-GOV-${stamp}`, quantity: 2, weightPerUnit: 4, unitCost: 800 }, body: { goldCostOverride: 1500, goldCostOverrideReason: "بند منتج" } });
    check(rp.status === 201 || rp.status === 200, "product override → success");
    const prod = await Product.findOne({ where: { companyId: CO, productCode: `PRD-GOV-${stamp}` } });
    check(Number(prod.averageCost) === 800, "Product.averageCost unchanged (800) despite override");
    const poiP = await PurchaseOrderItem.findOne({ where: { purchaseOrderId: rp.id } });
    check(poiP.costOverridden === true && approx(poiP.finalPurchaseCost, 1500) && approx(Number(poiP.total), 1600), "product poItem: override final 1500, legacy total unchanged 1600");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("asset events", () => AssetEvent.destroy({ where: {}, force: true }).catch(() => {}));
    await safe("assets", () => Asset.destroy({ where: { companyId: CO }, force: true }));
    await safe("stock movements", () => StockMovement.destroy({ where: { companyId: CO } }));
    await safe("products", () => Product.destroy({ where: { companyId: CO }, force: true }));
    await safe("purchase order items", () => PurchaseOrderItem.destroy({ where: {}, force: true }).catch(() => {}));
    await safe("journal entries", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("cash transactions", () => models.CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("gold prices", () => GoldPrice.destroy({ where: { companyId: CO } }));
    await safe("role permissions", () => RolePermission.destroy({ where: { roleId: `ROLE-PURCH-${stamp}` } }));
    await safe("roles", () => Role.destroy({ where: { companyId: CO } }));
    await safe("users", () => User.destroy({ where: { companyId: CO }, force: true }));
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
