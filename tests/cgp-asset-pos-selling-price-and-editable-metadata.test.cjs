"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const pricing = require("../src/services/gold-sale-pricing.service");
const metadata = require("../src/services/asset-metadata.service");
const goldCenter = require("../src/services/gold-center-reference-price.service");
const audit = require("../src/services/audit.service");
const routeSource = fs.readFileSync(path.join(root, "backend/src/routes/erp.routes.js"), "utf8");
const posSource = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/pos/page.tsx"), "utf8");
const detailSource = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/inventory/[id]/page.tsx"), "utf8");

function fakeModels() {
  return {
    GoldPrice: { findAll: async () => [] },
    sequelize: { QueryTypes: { SELECT: "SELECT" }, query: async (sql) => sql.includes("asset_gold_details") ? [{ net_gold_weight: "10.000000", gross_weight: "11.000000" }] : [{}] },
  };
}

test("CGP sale pricing is current-rate driven and purchase cost is not a retail fallback", async () => {
  const original = goldCenter.getReferenceSnapshot;
  let spot = 500;
  goldCenter.getReferenceSnapshot = async () => ({ prices: [{ karat: 24, pricePerGram: spot }], status: "FRESH" });
  try {
    const asset = { id: "clone-asset", inventoryProfile: "CGP_CUSTOMER_GOLD_PURCHASE", karat: 24, price: "0", cost: "5182.4854", grossWeight: "11", netGoldWeight: "10" };
    const cache = { rates: new Map(), snapshots: new Map() };
    const firstRate = await pricing.resolveCanonicalSellingGoldRate({ models: fakeModels(), companyId: "clone-company", karat: 24, cache });
    const first = await pricing.calculateGoldSalePriceForAsset({ asset, models: fakeModels(), companyId: "clone-company", itemInput: { sellingGoldRate: firstRate, makingChargePerGram: "10" }, configuredVatRate: null });
    assert.equal(first.invoicePrice, "5110.0000");
    spot = 600;
    const secondRate = await pricing.resolveCanonicalSellingGoldRate({ models: fakeModels(), companyId: "clone-company", karat: 24, cache: { rates: new Map(), snapshots: new Map() } });
    const second = await pricing.calculateGoldSalePriceForAsset({ asset, models: fakeModels(), companyId: "clone-company", itemInput: { sellingGoldRate: secondRate, makingChargePerGram: "10" }, configuredVatRate: null });
    assert.equal(second.invoicePrice, "6110.0000");
    assert.notEqual(first.invoicePrice, asset.cost);
    const zero = pricing.calculateGoldByWeightSalePrice({ netGoldWeight: 10, itemWeightGrams: 11, sellingGoldRate: 0, makingChargePerGram: 0 });
    assert.equal(zero.invoiceTotal, "0.0000");
    assert.match(routeSource, /assertPositiveSaleAmount\(itemSubtotal/);
  } finally { goldCenter.getReferenceSnapshot = original; }
});

test("allowlisted metadata supports no-op and optimistic concurrency without protected fields", async () => {
  assert.deepEqual(metadata.normalize({ name: "Ring", category: "Gold", location: "" }), { name: "Ring", category: "Gold", location: "" });
  assert.throws(() => metadata.normalize({ price: "1" }), /حقول بيانات الأصل غير مسموحة/);
  const originalRecord = audit.record;
  let audits = 0;
  audit.record = async () => { audits += 1; };
  try {
    const asset = { id: "clone-asset", name: "Ring", description: "Old", category: "Gold", brand: null, notes: null, location: "", updatedAt: new Date("2026-08-12T10:00:00Z"), branch: "clone-branch", update: async function (updates) { Object.assign(this, updates); }, toJSON: function () { return { ...this }; } };
    const req = { companyId: "clone-company", user: { id: "clone-user" }, branchId: "clone-branch" };
    const noop = await metadata.update({ asset, body: { name: "Ring", expectedUpdatedAt: asset.updatedAt.toISOString() }, req, transaction: {} });
    assert.equal(noop.changed, false);
    assert.equal(audits, 0);
    const changed = await metadata.update({ asset, body: { description: "Updated", expectedUpdatedAt: asset.updatedAt.toISOString() }, req, transaction: {} });
    assert.equal(changed.changed, true);
    assert.equal(asset.description, "Updated");
    assert.equal(audits, 1);
    await assert.rejects(() => metadata.update({ asset, body: { description: "Stale", expectedUpdatedAt: "2026-08-11T10:00:00Z" }, req, transaction: {} }), /تم تحديث الأصل/);
  } finally { audit.record = originalRecord; }
});

test("POS and inventory surfaces enforce the safe contracts", () => {
  assert.match(routeSource, /POS_SELLING_PRICE_REQUIRED/);
  assert.match(routeSource, /inventory-v2\/assets\/:id\/metadata/);
  assert.match(routeSource, /requireBusinessPermission\("inventory\.adjust"/);
  assert.match(posSource, /currentSellingPriceForAsset/);
  assert.match(posSource, /Current selling price unavailable/);
  assert.match(detailSource, /Editable Operational Metadata/);
  assert.match(detailSource, /expectedUpdatedAt/);
  assert.doesNotMatch(detailSource, /price.*input-base/);
});

console.log("CGP_CLONE_DYNAMIC_PRICING: PASS");
console.log("CGP_CLONE_METADATA_ALLOWLIST: PASS");
console.log("CGP_POS_ZERO_PRICE_GUARD: PASS");
