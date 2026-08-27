"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pricing = require("../src/services/gold-sale-pricing.service");

const posPage = fs.readFileSync(path.join(__dirname, "..", "..", "app", "[locale]", "(dashboard)", "pos", "page.tsx"), "utf8");
const posHook = fs.readFileSync(path.join(__dirname, "..", "..", "features", "sales", "hooks", "use-pos.ts"), "utf8");
const erpRoutes = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "erp.routes.js"), "utf8");

function gbw(overrides = {}) {
  return pricing.calculateGoldByWeightSalePrice({
    netGoldWeight: 10,
    itemWeightGrams: 12,
    makingWeightGrams: 10,
    sellingGoldRate: 100,
    makingChargePerGram: 50,
    vatRate: 0,
    ...overrides,
  });
}

test("MC-01: 10g × 50 AED/g = 500 AED", () => {
  assert.equal(gbw().makingTotal, "500.00000000");
});

test("MC-02: one rate applies per eligible item and sums to 950 AED", () => {
  const total = [5, 4, 10].reduce((sum, weight) => sum + Number(gbw({ netGoldWeight: weight, itemWeightGrams: weight, makingWeightGrams: weight }).makingTotal), 0);
  assert.equal(total, 950);
});

test("MC-03: item-specific rates produce 890 AED", () => {
  const total = [
    [5, 50],
    [4, 60],
    [10, 40],
  ].reduce((sum, [weight, rate]) => sum + Number(gbw({ netGoldWeight: weight, itemWeightGrams: weight, makingWeightGrams: weight, makingChargePerGram: rate }).makingTotal), 0);
  assert.equal(total, 890);
});

test("MC-04: stone-present GBW item uses net eligible weight, not gross", () => {
  assert.equal(gbw({ netGoldWeight: 8, itemWeightGrams: 10, makingWeightGrams: 8 }).makingTotal, "400.00000000");
});

test("MC-05: forged client weight is not an input to the canonical GBW calculator", () => {
  const result = pricing.calculateGoldByWeightSalePrice({ ...gbw(), weight: 1, totalWeight: 1, forgedWeight: 1 });
  assert.equal(result.netGoldWeight, "10.00000000");
  assert.equal(result.makingTotal, "500.00000000");
  assert.match(erpRoutes, /delete pricingItem\.price/);
  assert.match(erpRoutes, /calculateGoldSalePriceForAsset/);
});

test("MC-06: forged client total making is not a canonical pricing input", () => {
  const result = pricing.calculateGoldByWeightSalePrice({ ...gbw(), totalMakingCharge: 1, makingCharge: 1 });
  assert.equal(result.makingTotal, "500.00000000");
  assert.match(erpRoutes, /dynamicGoldMakingTotal/);
});

test("MC-07: zero making follows the non-negative policy", () => {
  assert.equal(gbw({ makingChargePerGram: 0 }).makingTotal, "0.00000000");
});

test("MC-08: negative making is rejected", () => {
  assert.throws(() => gbw({ makingChargePerGram: -1 }), /MAKING_CHARGE_PER_GRAM_INVALID/);
});

test("MC-09: below-minimum making requires the existing approval flag", () => {
  assert.equal(gbw({ makingChargePerGram: 49, minimumMakingPerGram: 50 }).approvalRequired, true);
});

test("MC-10: exact minimum making does not require approval", () => {
  assert.equal(gbw({ makingChargePerGram: 50, minimumMakingPerGram: 50 }).approvalRequired, false);
});

test("MC-11: non-GBW profiles keep distinct pricing strategies", () => {
  const bar = pricing.calculateGoldBar24KSalePrice({ netGoldWeight: 10, sellingGoldRate: 100, certificateSaleAmount: 20, vatRate: 0 });
  const piece = pricing.calculateGoldByPieceSalePrice({ currentTotalCost: 100, markupPercent: 10, vatRate: 0 });
  const loose = pricing.calculateLooseProfileSalePrice({ profile: "LOOSE_DIAMOND", currentTotalCost: 100, sellingPrice: 150, vatRate: 0 });
  assert.equal(bar.makingTotal, undefined);
  assert.equal(piece.totalSellingPrice, "110.00000000");
  assert.equal(loose.finalSalePrice, "150.00000000");
});

test("MC-12: VAT uses the canonical GBW subtotal once", () => {
  const result = gbw({ netGoldWeight: 10, makingChargePerGram: 20, sellingGoldRate: 100, vatRate: 14 });
  assert.equal(result.subtotal, "1200.00000000");
  assert.equal(result.vatAmount, "168.00000000");
  assert.equal(result.total, "1368.00000000");
});

test("MC-13: accounting input parity is base + VAT = total", () => {
  const result = gbw({ netGoldWeight: 10, makingChargePerGram: 20, sellingGoldRate: 100, vatRate: 14 });
  assert.equal(Number(result.subtotal) + Number(result.vatAmount), Number(result.total));
});

test("MC-14: pricing is pure and does not change historical cost input", () => {
  const input = { netGoldWeight: 8, itemWeightGrams: 10, makingWeightGrams: 8, sellingGoldRate: 100, makingChargePerGram: 20, vatRate: 14, historicalCost: 1234 };
  const before = JSON.stringify(input);
  pricing.calculateGoldByWeightSalePrice(input);
  assert.equal(JSON.stringify(input), before);
});

test("MC-15: Gold Center rate remains an explicit server-side input boundary", () => {
  assert.match(path.join(__dirname, "..", "src", "services", "gold-sale-pricing.service.js"), /gold-sale-pricing\.service\.js/);
  assert.match(erpRoutes, /resolveCanonicalSellingGoldRate/);
});

test("MC-16: CGP remains a separately named pricing profile", () => {
  assert.match(posPage, /CGP_CUSTOMER_GOLD_PURCHASE/);
  assert.match(erpRoutes, /CGP_CUSTOMER_GOLD_PURCHASE/);
});

test("POS UI labels the input as a per-gram rate and shows eligible GBW weight", () => {
  assert.match(posPage, /makingChargePerGram/);
  assert.match(posPage, /Eligible gold weight/);
  assert.match(posPage, /const makingWeight = profile === \"GOLD_BY_WEIGHT_JEWELLERY\" \? net : gross/);
});

test("mock preview uses net gold weight for GBW and preserves other-profile compatibility", () => {
  assert.match(posHook, /profile === \"GOLD_BY_WEIGHT_JEWELLERY\"/);
  assert.match(posHook, /netGoldWeight \?\? .*netWeight/);
});

test("pricing preview reports dynamic making without adding it twice to tax base", () => {
  assert.match(erpRoutes, /const reportedTotalMakingCharge = dynamicGoldMakingTotal \+ totalMakingCharge/);
  assert.match(erpRoutes, /const taxBase = Math\.max\(0, basePrice \+ totalMakingCharge/);
  assert.match(erpRoutes, /totalMakingCharge: String\(reportedTotalMakingCharge\)/);
});
