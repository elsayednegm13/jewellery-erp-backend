const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const gbp = require("../src/services/gold-by-piece-profile.service");

const settings = { vatEnabled: true, vatRate: "5", purchaseVatRate: "5" };

test("GBP R2 central karat normalization vector is exact", () => {
  const expected = new Map([[24, "300.00000000"], [22, "275.00000000"], [21, "262.50000000"], [18, "225.00000000"], [14, "175.00000000"], [12, "150.00000000"], [10, "125.00000000"], [9, "112.50000000"]]);
  for (const [karat, rate] of expected) {
    const result = gbp.calculate({ input: { grossWeight: "1", stoneWeight: "0", karat, makingPerGram: "0", markupPercent: "0", vatRate: "0" }, settings: { vatEnabled: false, vatRate: "0", purchaseVatRate: "0" }, purchaseRate: rate, currentRate: rate });
    assert.equal(result.gold.purchaseRate, rate);
  }
});

test("GBP R2 golden weight, purchase and sale vectors", () => {
  const result = gbp.calculate({ input: { grossWeight: "10", stoneWeight: "2", karat: "21", makingPerGram: "5", currentMakingPerGram: "5", markupPercent: "20", maximumDiscountPercent: "10", vatRate: "5", currentVatRate: "5" }, settings, purchaseRate: "262.5", currentRate: "262.5" });
  assert.equal(result.weights.netGoldWeight, "8.00000000");
  assert.equal(result.weights.pureGoldWeight9999, "7.00000000");
  assert.equal(result.purchase.goldValue, "2100.00000000");
  assert.equal(result.purchase.makingTotal, "40.00000000");
  assert.equal(result.purchase.vatAmount, "107.00000000");
  assert.equal(result.purchase.totalPurchaseCost, "2247.00000000");
  assert.equal(result.sale.markupValue, "449.40000000");
  assert.equal(result.sale.totalSellingPrice, "2696.40000000");
  assert.equal(result.sale.minAllowedSellingPrice, "2426.76000000");
});

test("GBP R2 rejects missing/invalid stone and unsupported karat", () => {
  assert.throws(() => gbp.validateWeights({ grossWeight: "10", karat: "21" }), /GBP_STONE_WEIGHT_REQUIRED/);
  assert.throws(() => gbp.validateWeights({ grossWeight: "10", stoneWeight: "11", karat: "21" }), /GBP_STONE_WEIGHT_EXCEEDS_GROSS/);
  assert.throws(() => gbp.validateWeights({ grossWeight: "10", stoneWeight: "0", karat: "20" }), /GBP_KARAT_UNSUPPORTED/);
  assert.doesNotThrow(() => gbp.validateWeights({ grossWeight: "10", stoneWeight: "0", karat: "9" }));
});

test("GBP Retail is fail-closed and current mode is server-backed", async () => {
  await assert.rejects(() => gbp.resolveRate({ companyId: "company", currency: "AED", karat: 21, rateType: "RETAIL" }), /GBP_RETAIL_RATE_NOT_CONFIGURED/);
  assert.equal(gbp.resolveCurrentRateMode({ _raw: {} }), "GLOBAL");
  assert.equal(gbp.resolveCurrentRateMode({ _raw: { goldByPieceCurrentRateMode: "GLOBAL" } }), "GLOBAL");
  assert.throws(() => gbp.resolveCurrentRateMode({ _raw: { goldByPieceCurrentRateMode: "BID" } }), /GBP_CURRENT_RATE_MODE_INVALID/);
});

test("GBP server receive wiring keeps the canonical asset path and snapshot metadata", () => {
  const route = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
  const runtime = fs.readFileSync(path.join(__dirname, "../src/services/inventory-v2-runtime.service.js"), "utf8");
  assert.match(route, /goldByPieceProfileService\.resolveRate/);
  assert.match(route, /Gold By Piece stoneWeight is required/);
  assert.match(route, /body\.inventoryV2 === true/);
  assert.match(runtime, /goldRateSnapshot/);
  assert.match(runtime, /GBP_STONE_WEIGHT_REQUIRED/);
});
