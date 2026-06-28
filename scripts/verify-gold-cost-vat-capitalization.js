/**
 * Non-recoverable VAT cost capitalization — Phase 15G verify.
 *
 * Proves forward-only capitalization at receive time:
 *   - no VAT / recoverable / RCM / inclusive / capitalization-disabled → legacy
 *     book cost unchanged
 *   - non-recoverable EXCLUSIVE VAT → Asset.cost / Product.averageCost /
 *     StockMovement cost = net + allocated VAT, reconciling to GL inventory (gross)
 *   - multi-line allocation sums exactly to inputVatAmount (last line absorbs
 *     rounding); PO totals/tax + line unitPrice/total unchanged; computedGoldCost
 *     stays reference-only; posting unchanged
 *
 * WRITE — fixtures under a throwaway company; cleanup deletes the company LAST.
 * No residue. No migration / schema change in 15G.
 *
 *   cd backend && node scripts/verify-gold-cost-vat-capitalization.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const goldCostService = require("../src/services/gold-cost.service");

const { sequelize, Company, Supplier, Branch, Setting, GoldPrice, PurchaseOrder, PurchaseOrderItem, Asset, Product, StockMovement, JournalEntry, JournalLine, Account, AssetEvent } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-VATCAP-${stamp}`;
const SUP = `SUP-VATCAP-${stamp}`;
const BR = `BR-VATCAP-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token, poN = 0;
async function setKV(key, value) {
  const [row, c] = await Setting.findOrCreate({ where: { companyId: CO, key }, defaults: { companyId: CO, key, value } });
  if (!c) await row.update({ value });
}
async function receive(items, body = {}) {
  const id = `PO-VATCAP-${stamp}-${++poN}`;
  const r = await fetch(`${base}/purchase-orders/receive`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" },
    body: JSON.stringify({ id, supplierId: SUP, branchId: BR, paymentMethod: "credit", items, ...body }),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, id };
}
async function invDebit(poId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceType: "purchase_order", sourceId: poId } });
  if (!je) return null;
  const rows = await JournalLine.findAll({ where: { journalEntryId: je.id, accountCode: "1200" } });
  return rows.reduce((s, r) => s + Number(r.debit || 0), 0);
}
const assetsOf = (poId) => Asset.findAll({ where: { companyId: CO }, order: [["created_at", "ASC"]] });

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    console.log("0) pure allocator allocateNonRecoverableVat:");
    const alloc = goldCostService.allocateNonRecoverableVat({ lineNetCosts: [1000, 3000], inputVatAmount: 200 });
    check(approx(alloc[0], 50) && approx(alloc[1], 150) && approx(alloc[0] + alloc[1], 200), "split 200 over 1000/3000 → 50 + 150 (sum 200)");
    const alloc2 = goldCostService.allocateNonRecoverableVat({ lineNetCosts: [333.33, 333.33, 333.34], inputVatAmount: 50 });
    check(approx(alloc2.reduce((s, n) => s + n, 0), 50), "3-way split still sums exactly to 50 (last absorbs remainder)");
    check(goldCostService.allocateNonRecoverableVat({ lineNetCosts: [100], inputVatAmount: 0 })[0] === 0, "zero VAT → zero allocation");

    await Company.create({ id: CO, businessName: "Verify VatCap Co", workspace: `verify-vatcap-${stamp}` });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد", phone: "+1", category: "general" });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });
    await GoldPrice.create({ companyId: CO, karat: 21, pricePerGram: 250, currency: "AED", source: "manual" });
    await setKV("goldCostSource", "manual"); // isolate capitalization from snapshot

    const oneAsset = [{ name: "خاتم", quantity: 1, weightPerUnit: 5, unitCost: 1000, karat: 21 }];
    const latestAsset = () => Asset.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });

    console.log("\n1) no VAT → legacy cost:");
    const r1 = await receive(oneAsset, { applyVat: false });
    check(Number((await latestAsset()).cost) === 1000, "no VAT: Asset.cost = 1000 (legacy)");

    console.log("\n2) recoverable exclusive → net cost (no capitalization):");
    const r2 = await receive(oneAsset, { applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: true });
    const a2 = await latestAsset();
    check(Number(a2.cost) === 1000, "recoverable: Asset.cost = 1000 (net, NOT capitalized)");
    check(approx(await invDebit(r2.id), 1000), "recoverable: GL inventory = taxBase 1000 (matches net cost)");

    console.log("\n3) non-recoverable EXCLUSIVE → capitalized (net + VAT):");
    const r3 = await receive(oneAsset, { applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: false });
    const a3 = await latestAsset();
    check(approx(a3.cost, 1050), "non-recoverable: Asset.cost = 1050 (1000 + 50 VAT)");
    check(approx(a3.finalPurchaseCost, 1050), "non-recoverable: finalPurchaseCost metadata = 1050 (book)");
    check(approx(await invDebit(r3.id), 1050), "non-recoverable: GL inventory (gross 1050) == Asset.cost");
    const po3 = await PurchaseOrder.findByPk(r3.id);
    check(Number(po3.total) === 1050 && approx(po3.taxBase, 1000) && approx(po3.inputVatAmount, 50), "PO total 1050 / taxBase 1000 / inputVat 50 unchanged");
    const poi3 = await PurchaseOrderItem.findOne({ where: { purchaseOrderId: r3.id } });
    check(approx(Number(poi3.unitPrice), 1000) && approx(Number(poi3.total), 1000), "PurchaseOrderItem unitPrice/total stay legacy net (1000)");
    check(approx(poi3.finalPurchaseCost, 1050), "PurchaseOrderItem.finalPurchaseCost = capitalized 1050");

    console.log("\n4) non-recoverable INCLUSIVE → already gross, no double-count:");
    const r4 = await receive([{ name: "خاتم", quantity: 1, weightPerUnit: 5, unitCost: 1050, karat: 21 }], { applyVat: true, vatRate: 5, taxIncluded: true, isRecoverable: false });
    const a4 = await latestAsset();
    check(approx(a4.cost, 1050), "inclusive non-recoverable: Asset.cost = 1050 (legacy gross, not 1050+VAT)");
    check(approx(await invDebit(r4.id), 1050), "inclusive: GL inventory 1050 == Asset.cost (no double-count)");

    console.log("\n5) multi-line non-recoverable exclusive allocation reconciles to GL:");
    const r5 = await receive([
      { name: "A", quantity: 1, weightPerUnit: 5, unitCost: 1000, karat: 21 },
      { name: "B", quantity: 1, weightPerUnit: 5, unitCost: 3000, karat: 21 },
    ], { applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: false });
    const aAll = await Asset.findAll({ where: { companyId: CO, source: "supplier_purchase" }, order: [["created_at", "DESC"]], limit: 2 });
    const costs = aAll.map((a) => Number(a.cost)).sort((x, y) => x - y);
    check(approx(costs[0], 1050) && approx(costs[1], 3150), "two lines capitalized: 1050 + 3150 (VAT 50 + 150)");
    check(approx(costs[0] + costs[1], 4200) && approx(await invDebit(r5.id), 4200), "sum capitalized 4200 == GL inventory (gross)");

    console.log("\n6) RCM → no capitalization:");
    const r6 = await receive(oneAsset, { isDRC: true, rcmRate: 5 });
    check(approx((await latestAsset()).cost, 1000), "RCM: Asset.cost = 1000 (legacy, no VAT capitalized)");

    console.log("\n7) nonRecoverableVatCapitalization=false → capitalization disabled:");
    await setKV("nonRecoverableVatCapitalization", false);
    const r7 = await receive(oneAsset, { applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: false });
    check(approx((await latestAsset()).cost, 1000), "setting off: Asset.cost = 1000 (net, capitalization skipped)");
    await setKV("nonRecoverableVatCapitalization", true);

    console.log("\n8) product path: averageCost + StockMovement capitalized:");
    const r8 = await receive([{ name: "P", productCode: `PRD-VC-${stamp}`, quantity: 2, weightPerUnit: 4, unitCost: 800, karat: 21 }], { applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: false });
    const prod = await Product.findOne({ where: { companyId: CO, productCode: `PRD-VC-${stamp}` } });
    check(approx(Number(prod.averageCost), 840) && approx(Number(prod.unitCost), 840), "Product averageCost/unitCost = 840 (800 + 40 VAT per unit)");
    const sm = await StockMovement.findOne({ where: { companyId: CO, referenceId: r8.id } });
    check(approx(Number(sm.unitCost), 840) && approx(Number(sm.totalCost), 1680), "StockMovement unitCost 840 / totalCost 1680 (capitalized)");
    check(approx(await invDebit(r8.id), 1680), "GL inventory 1680 == capitalized line cost");

    console.log("\n9) hybrid: computedGoldCost stays reference-only (does not drive book cost):");
    await setKV("goldCostSource", "hybrid");
    const r9 = await receive(oneAsset, { applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: false });
    const a9 = await latestAsset();
    check(approx(a9.computedGoldCost, 1250) && approx(a9.cost, 1050), "hybrid non-recoverable: computed 1250 (reference) but Asset.cost = 1050 (capitalized book)");

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
