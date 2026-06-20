/**
 * Hotfix verification — supplier purchase receive product/asset FK (HTTP E2E).
 *
 * Receives (A) a quantity-based PRODUCT and (B) a serialized ASSET and asserts
 * the purchase_order_items_asset_id_fkey error is gone and each line links to
 * the right table (product_id for products, asset_id for serialized assets).
 * Uses a throwaway supplier, snapshots/restores GL balances and reverses every
 * created artifact.
 *
 * Run: node scripts/verify-purchase-receive.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const {
  sequelize, Supplier, Product, Asset, AssetEvent, StockMovement,
  PurchaseOrder, PurchaseOrderItem, JournalEntry, JournalLine, Account,
} = models;

const COMPANY = "CMP-DEMO";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

let base, token;
async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Company-ID": COMPANY, "X-Branch-ID": "BR-WH" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const ts = Date.now();
const SUP = `SUP-PROBE-${ts}`;
const PRODCODE = `PROBE-PRD-${ts}`;
const poIds = [];

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  console.log("App listening for E2E\n");

  await Supplier.create({ id: SUP, companyId: COMPANY, name: "Probe Supplier", category: "Gold", phone: `3${ts}`.slice(-10), due: 0 });
  const accSnap = new Map((await Account.findAll({ where: { companyId: COMPANY } })).map((a) => [a.id, a.balance]));

  try {
    // ── A) Quantity-based PRODUCT ──
    console.log("receive quantity-based product:");
    const a = await api("POST", "/purchase-orders/receive", {
      supplierId: SUP, branchId: "BR-WH", paymentMethod: "credit", paidAmount: 0,
      items: [{ name: "Probe Ring", type: "gold-piece", category: "Rings", karat: 21, weightPerUnit: 5, grossWeight: 5, netWeight: 5, unitCost: 1000, cost: 1000, price: 1320, quantity: 10, unit: "piece", productCode: PRODCODE }],
    });
    check(a.status === 201, "receive product → 201 (no purchase_order_items_asset_id_fkey error)");
    const poA = a.json.data?.purchaseOrder?.id || a.json.purchaseOrder?.id; poIds.push(poA);

    const product = await Product.findOne({ where: { companyId: COMPANY, productCode: PRODCODE } });
    check(!!product, "product created for the quantity-based receipt");
    check(Number(product.quantityAvailable) === 10 && Number(product.quantityOnHand) === 10, "product quantity increased by 10 (available + on hand)");
    check(await StockMovement.count({ where: { companyId: COMPANY, referenceId: poA, type: "purchase_receive" } }) === 1, "purchase_receive StockMovement created for the product");

    const poiA = await PurchaseOrderItem.findOne({ where: { purchaseOrderId: poA } });
    check(poiA.productId === product.id, "PurchaseOrderItem links to productId (the product)");
    check(poiA.assetId === null, "PurchaseOrderItem.assetId is NULL for a product line (no bad FK)");

    // ── B) Serialized ASSET ──
    console.log("\nreceive serialized asset:");
    const b = await api("POST", "/purchase-orders/receive", {
      supplierId: SUP, branchId: "BR-WH", paymentMethod: "credit", paidAmount: 0,
      items: [{ barcode: `PBARC-${ts}`, name: "Probe Diamond", type: "diamond", category: "Stones", weightPerUnit: 2, grossWeight: 2, netWeight: 2, unitCost: 5000, cost: 5000, price: 6600, quantity: 1, unit: "piece" }],
    });
    check(b.status === 201, "receive serialized asset → 201");
    const poB = b.json.data?.purchaseOrder?.id || b.json.purchaseOrder?.id; poIds.push(poB);

    const poiB = await PurchaseOrderItem.findOne({ where: { purchaseOrderId: poB } });
    check(!!poiB.assetId && poiB.productId === null, "serialized PurchaseOrderItem uses assetId (productId NULL)");
    const linkedAsset = await Asset.findByPk(poiB.assetId);
    check(!!linkedAsset, "PurchaseOrderItem.assetId references a REAL existing assets row (FK valid)");
    check(linkedAsset.status === "available", "received asset is available");
    check(await AssetEvent.count({ where: { assetId: poiB.assetId, action: "PURCHASE_RECEIVED" } }) === 1, "PURCHASE_RECEIVED AssetEvent created for the asset");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    for (const poId of poIds) {
      if (!poId) continue;
      const jes = await JournalEntry.findAll({ where: { companyId: COMPANY, sourceId: poId } });
      for (const je of jes) await JournalLine.destroy({ where: { journalEntryId: je.id } });
      await JournalEntry.destroy({ where: { companyId: COMPANY, sourceId: poId } });
      await StockMovement.destroy({ where: { companyId: COMPANY, referenceId: poId } });
      const items = await PurchaseOrderItem.findAll({ where: { purchaseOrderId: poId } });
      for (const it of items) {
        if (it.assetId) { await AssetEvent.destroy({ where: { assetId: it.assetId } }); await Asset.destroy({ where: { id: it.assetId }, force: true }).catch(() => {}); }
      }
      await PurchaseOrderItem.destroy({ where: { purchaseOrderId: poId } });
      await PurchaseOrder.destroy({ where: { id: poId }, force: true });
    }
    await Product.destroy({ where: { companyId: COMPANY, productCode: PRODCODE }, force: true }).catch(() => {});
    for (const [id, bal] of accSnap) await Account.update({ balance: bal }, { where: { id } });
    await Supplier.destroy({ where: { id: SUP }, force: true }).catch(() => {});
    console.log("(reversed PO artifacts + restored GL balances + removed fixtures)");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
