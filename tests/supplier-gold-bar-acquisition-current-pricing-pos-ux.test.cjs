const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const goldValuation = require("../src/services/gold-valuation.service");
const goldSalePricing = require("../src/services/gold-sale-pricing.service");
const goldReference = require("../src/services/gold-center-reference-price.service");

test("supplier gold valuation uses net gold weight for making and preserves rate sources", () => {
  const result = goldValuation.calculateReceiptGoldValuation({
    profile: "GOLD_BY_WEIGHT_JEWELLERY",
    weights: { grossWeight: 10, netGoldWeight: 8.75 },
    input: {
      purchaseGoldRate: 100,
      purchaseRateSource: "GOLD_CENTER",
      currentGoldRate: 200,
      currentRateSource: "GOLD_CENTER",
      makingPerGram: 3,
      currentMakingPerGram: 4,
    },
  });
  assert.equal(result.purchase.goldRateSource, "GOLD_CENTER");
  assert.equal(result.current.rateSource, "GOLD_CENTER");
  assert.equal(result.purchase.makingTotal, "26.25000000");
  assert.equal(result.current.makingValue, "35.00000000");
});

test("24K purchase and sale VAT remain certificate-only", () => {
  const purchase = goldValuation.calculateReceiptGoldValuation({
    profile: "GOLD_BAR_24K",
    weights: { grossWeight: 100, netGoldWeight: 100 },
    input: {
      purchaseGoldRate: 500,
      currentGoldRate: 600,
      certificateCost: 100,
      currentCertificateCost: 120,
      vatRate: 7.25,
      currentVatRate: 7.25,
    },
  });
  assert.equal(purchase.purchase.vatBase, "100.00000000");
  assert.equal(purchase.purchase.vatAmount, "7.25000000");
  assert.equal(purchase.purchase.totalPurchaseCost, "50107.25000000");

  const sale = goldSalePricing.calculateGoldBar24KSalePrice({
    netGoldWeight: 100,
    sellingGoldRate: 600,
    certificateSaleAmount: 0,
    configuredVatRate: 7.25,
  });
  assert.equal(sale.goldVat, "0.00000000");
  assert.equal(sale.vatBase, "0.00000000");
  assert.equal(sale.vatAmount, "0.00000000");
  assert.equal(sale.total, "60000.00000000");
  const noVatConfig = goldSalePricing.calculateGoldBar24KSalePrice({
    netGoldWeight: 100,
    sellingGoldRate: 600,
    certificateSaleAmount: 0,
  });
  assert.equal(noVatConfig.vatRateSource, "NOT_APPLICABLE");
});

test("Gold Center derives one canonical karat rate from one fine spot quote", () => {
  const snapshot = goldReference.buildReferenceSnapshot({
    settings: { marketCurrency: "AED", staleAfterSeconds: 120 },
    latestQuote: { spot: "240", currency: "AED", quoteTimestamp: "2026-08-12T00:00:00.000Z", provider: "test" },
    health: { status: "HEALTHY" },
  }, { currency: "AED", now: new Date("2026-08-12T00:00:30.000Z") });
  assert.equal(snapshot.status, "FRESH");
  assert.equal(snapshot.prices.find((row) => row.karat === 24).pricePerGram, 240);
  assert.equal(snapshot.prices.find((row) => row.karat === 18).pricePerGram, 180);
});

test("supplier receive and POS source contain the server-side dynamic gold guard", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
  const pos = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/pos/page.tsx"), "utf8");
  assert.match(routes, /MANUAL_OVERRIDE/);
  assert.match(routes, /supplier_purchase_rate\.override/);
  assert.match(routes, /GOLD_BAR_24K/);
  assert.match(routes, /resolveCanonicalSellingGoldRate/);
  assert.match(pos, /GOLD_BY_WEIGHT_JEWELLERY/);
  assert.match(pos, /GOLD_BAR_24K/);
  assert.match(pos, /Current selling price unavailable/);
});
