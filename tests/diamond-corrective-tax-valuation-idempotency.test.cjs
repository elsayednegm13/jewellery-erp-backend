const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const page = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/inventory/diamond-jewellery/page.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "backend/src/routes/erp.routes.js"), "utf8");
const profile = fs.readFileSync(path.join(root, "backend/src/services/diamond-jewellery-profile.service.js"), "utf8");
const runtime = fs.readFileSync(path.join(root, "backend/src/services/inventory-v2-runtime.service.js"), "utf8");
const acquisition = require(path.join(root, "backend/src/services/supplier-acquisition-preview.service.js"));
const idempotency = require(path.join(root, "backend/src/services/idempotency.service.js"));

test("Diamond profile exposes separate historical pre-tax and current tax-inclusive values", () => {
  assert.match(profile, /purchaseBasePreTax/);
  assert.match(profile, /historicalPurchaseBasePreTax/);
  assert.match(profile, /currentValuationBasePreTax/);
  assert.match(profile, /currentValuationTotalTaxInclusive/);
});

test("Diamond final payload maps Supplier V2 unitCost to the historical pre-tax base", () => {
  assert.match(page, /const historicalBase = preview\.historicalPurchase\?\.purchaseBasePreTax \?\? preview\.historicalPurchase\?\.taxableBase/);
  assert.match(page, /purchaseCost: historicalBase/);
  assert.match(page, /unitCost: historicalBase/);
  assert.doesNotMatch(page, /purchaseCost: preview\.historicalPurchase\?\.totalPurchaseCost/);
  assert.doesNotMatch(page, /unitCost: preview\.historicalPurchase\?\.totalPurchaseCost/);
});

test("shared Supplier V2 preview applies VAT exactly once to a pre-tax Diamond base", () => {
  const result = acquisition.calculateTotals({
    normalizedItems: [acquisition.normalizeItem({ quantity: 1 }, [{
      profile: "DIAMOND_JEWELLERY",
      purchaseCost: 3037,
      grossWeight: 10,
      vat: { vatRate: 0, vatAmount: 0 },
    }])],
    body: { applyVat: true, taxIncluded: false, vatRate: 14 },
    settings: { vatEnabled: true, purchaseVatRate: 14, vatRate: 14 },
    inventoryV2Target: true,
  });
  assert.equal(result.goodsTotal, 3037);
  assert.equal(result.taxBase, 3037);
  assert.equal(result.inputVatAmount, 425.18);
  assert.equal(result.total, 3462.18);
});

test("receive route resolves Diamond historical cost and current valuation on the server", () => {
  assert.match(route, /const historicalBase = diamondPreview\.historicalPurchase\.purchaseBasePreTax/);
  assert.match(route, /purchaseCost: historicalBase/);
  assert.match(route, /currentValuation: \{/);
  assert.match(route, /totalValue: current\.currentValuationTotalTaxInclusive/);
  assert.match(runtime, /totalPurchaseCost: piece\.purchaseCost/);
  assert.match(runtime, /currentValuation\.totalValue/);
});

test("exact replay preparation uses the real idempotency canonical hash contract", () => {
  const original = {
    idempotencyKey: "key-a",
    supplierId: "SUP-1",
    items: [{ profile: "DIAMOND_JEWELLERY", unitCost: 3037, perPiece: [{ purchaseCost: 3037, components: [{ stoneCaratWeight: 1 }] }] }],
  };
  const replay = { ...original, idempotencyKey: "key-a" };
  const changed = { ...original, items: [{ ...original.items[0], unitCost: 3462.18 }] };
  assert.equal(idempotency.hashRequest("purchase.receive", original), idempotency.hashRequest("purchase.receive", replay));
  assert.notEqual(idempotency.hashRequest("purchase.receive", original), idempotency.hashRequest("purchase.receive", changed));
  assert.match(page, /buildFinalReceiveRequest/);
  assert.match(page, /exactReceiveRequestRef\.current = exactRequest/);
  assert.match(page, /body: JSON\.stringify\(exactRequest\)/);
  assert.match(page, /exactReceiveFingerprintRef/);
});
