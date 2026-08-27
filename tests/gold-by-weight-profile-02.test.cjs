const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const profile = require("../src/services/gold-by-weight-profile.service");

const jewellery = (overrides = {}) => ({
  profile: "GOLD_BY_WEIGHT_JEWELLERY", description: "Gold Ring", karat: 21,
  grossWeight: 10, stoneWeight: 2, purchaseGoldRate: 450, currentGoldRate: 500,
  makingPerGram: 5, currentMakingPerGram: 5, ...overrides,
});

test("GBW classifier preserves Jewellery and Gold Bar strategies", () => {
  assert.equal(profile.canonicalProfile("GOLD_BY_WEIGHT_JEWELLERY"), profile.PROFILE_JEWELLERY);
  assert.equal(profile.canonicalProfile("GOLD_BAR"), profile.PROFILE_BAR);
  assert.throws(() => profile.canonicalProfile("GOLD_BY_PIECE"), /GBW_PROFILE_UNSUPPORTED/);
});

test("GBW server calculations use net weight for pure gold and making", () => {
  const result = profile.calculate({ input: jewellery(), configuredVatRate: 5 });
  assert.equal(result.weights.netGoldWeight, "8.00000000");
  assert.equal(result.weights.pureGoldWeight9999, "7.00000000");
  assert.equal(result.purchase.makingTotal, "40.00000000");
  assert.equal(result.purchase.goldValue, "3600.00000000");
  assert.equal(result.purchase.totalPurchaseCost, "3822.00000000");
});

test("GBW zero-stone 21K regression keeps pure weight at 7g for 8g gross", () => {
  const result = profile.calculate({ input: jewellery({ grossWeight: 8, stoneWeight: 0 }), configuredVatRate: 5 });
  assert.equal(result.weights.netGoldWeight, "8.00000000");
  assert.equal(result.weights.pureGoldWeight9999, "7.00000000");
});

test("GBW rejects quantity/Product physical authority", () => {
  assert.throws(() => profile.normalizeInput(jewellery({ quantity: 1 })), (error) => error.code === "GBW_PRODUCT_QUANTITY_AUTHORITY_FORBIDDEN");
  assert.throws(() => profile.normalizeInput(jewellery({ productId: "PRD-1" })), (error) => error.code === "GBW_PRODUCT_QUANTITY_AUTHORITY_FORBIDDEN");
});

test("Gold Bar remains a separate 24K certificate strategy", () => {
  const result = profile.calculate({ input: { profile: "GOLD_BAR_24K", description: "Gold Bar", karat: 24, grossWeight: 8, stoneWeight: 0, certificateCost: 20, purchaseGoldRate: 500, currentGoldRate: 510 }, configuredVatRate: 5 });
  assert.equal(result.strategy, "BAR_CERTIFICATE_STRATEGY");
  assert.equal(result.purchase.makingTotal, null);
  assert.equal(result.purchase.vatAmount, "1.00000000");
  assert.throws(() => profile.normalizeInput({ profile: "GOLD_BAR_24K", description: "Gold Bar", karat: 21, grossWeight: 8, stoneWeight: 0, certificateCost: 20 }), (error) => error.code === "GBW_BAR_KARAT_REQUIRED");
});

test("GBW sale pricing exposes net-making and manager approval", () => {
  const result = profile.calculate({ input: jewellery(), configuredVatRate: 5, sale: { sellingGoldRate: 500, makingPerGram: 3, minimumMakingPerGram: 5 } });
  assert.equal(result.sale.makingTotal, "24.00000000");
  assert.equal(result.sale.approvalRequired, true);
});

test("GBW browser receive payload supplies canonical receive transport fields", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "app", "[locale]", "(dashboard)", "inventory", "gold-by-weight", "page.tsx"), "utf8");
  assert.match(page, /weightPerUnit:\s*number\(draft\.grossWeight\)/);
  assert.match(page, /grossWeight:\s*number\(draft\.grossWeight\)/);
  assert.match(page, /unitCost/);
  assert.match(page, /inventoryV2:\s*true/);
  assert.match(page, /perPiece:\s*\[piece\]/);
});
