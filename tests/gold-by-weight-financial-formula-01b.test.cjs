"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const valuation = require("../src/services/gold-valuation.service");
const pricing = require("../src/services/gold-sale-pricing.service");
const policy = require("../src/services/inventory-master-policy.service");

test("Gold By Weight purchase and current valuation use net gold weight for making and VAT", () => {
  const result = valuation.calculateReceiptGoldValuation({
    profile: "GOLD_BY_WEIGHT_JEWELLERY",
    weights: { grossWeight: "10.000", stoneWeight: "2.000", netGoldWeight: "8.000" },
    input: {
      purchaseGoldRate: "100.00",
      currentGoldRate: "120.00",
      makingPerGram: "5.00",
      currentMakingPerGram: "6.00",
      vatRate: "5.00",
      currentVatRate: "5.00",
    },
  });

  assert.equal(result.purchase.goldValue, "800.00000000");
  assert.equal(result.purchase.makingTotal, "40.00000000");
  assert.equal(result.purchase.vatBase, "840.00000000");
  assert.equal(result.purchase.vatAmount, "42.00000000");
  assert.equal(result.purchase.totalPurchaseCost, "882.00000000");
  assert.equal(result.current.goldValue, "960.00000000");
  assert.equal(result.current.makingValue, "48.00000000");
  assert.equal(result.current.vatBase, "1008.00000000");
  assert.equal(result.current.vatAmount, "50.40000000");
  assert.equal(result.current.totalValue, "1058.40000000");
});

test("Gold By Weight sale pricing uses net gold weight while retaining gross display weight", () => {
  const sale = pricing.calculateGoldByWeightSalePrice({
    netGoldWeight: "8.000",
    itemWeightGrams: "10.000",
    sellingGoldRate: "100.00",
    makingChargePerGram: "5.00",
    vatRate: "5.00",
  });

  assert.equal(sale.goldValue, "800.00000000");
  assert.equal(sale.makingTotal, "40.00000000");
  assert.equal(sale.subtotal, "840.00000000");
  assert.equal(sale.vatBase, "840.00000000");
  assert.equal(sale.vatAmount, "42.00000000");
  assert.equal(sale.total, "882.00000000");
  assert.equal(sale.invoiceTotal, "882.0000");
  assert.equal(sale.itemWeightGrams, "10.00000000");
});

test("zero stone weight preserves the gross/net result and impossible weights remain rejected", () => {
  const zeroStone = valuation.calculateReceiptGoldValuation({
    profile: "GOLD_BY_WEIGHT_JEWELLERY",
    weights: { grossWeight: "10.000", stoneWeight: "0.000", netGoldWeight: "10.000" },
    input: { purchaseGoldRate: 100, currentGoldRate: 100, makingPerGram: 5 },
  });
  assert.equal(zeroStone.purchase.makingTotal, "50.00000000");
  assert.equal(zeroStone.purchase.totalPurchaseCost, "1050.00000000");
  assert.throws(
    () => policy.calculateGoldWeights({ grossWeight: "1.000", stoneWeight: "1.001", karat: 21 }),
    /INVENTORY_WEIGHT_FACTS_INVALID/
  );
});

test("Gold Bar 24K certificate/VAT semantics remain separate from Jewellery making basis", () => {
  const purchase = valuation.calculateReceiptGoldValuation({
    profile: "GOLD_BAR_24K",
    weights: { grossWeight: 100, stoneWeight: 0, netGoldWeight: 100 },
    input: {
      purchaseGoldRate: 500,
      currentGoldRate: 600,
      certificateCost: 100,
      currentCertificateCost: 120,
      vatRate: 7.25,
      currentVatRate: 7.25,
    },
  });
  assert.equal(purchase.purchase.makingTotal, null);
  assert.equal(purchase.purchase.vatBase, "100.00000000");
  assert.equal(purchase.purchase.vatAmount, "7.25000000");
  assert.equal(purchase.purchase.totalPurchaseCost, "50107.25000000");

  const sale = pricing.calculateGoldBar24KSalePrice({
    netGoldWeight: 100,
    sellingGoldRate: 600,
    certificateSaleAmount: 0,
    configuredVatRate: 7.25,
  });
  assert.equal(sale.vatBase, "0.00000000");
  assert.equal(sale.vatAmount, "0.00000000");
  assert.equal(sale.total, "60000.00000000");
});

test("Gold By Piece pricing regression remains current-cost/markup based", () => {
  const sale = pricing.calculateGoldByPieceSalePrice({
    currentTotalCost: 1000,
    markupPercent: 20,
    maximumDiscountPercent: 10,
    proposedDiscount: 0,
    vatRate: 5,
  });
  assert.equal(sale.totalSellingPrice, "1200.00000000");
  assert.equal(sale.minAllowedSellingPrice, "1080.00000000");
  assert.equal(sale.finalSalePrice, "1200.00000000");
  assert.equal(sale.vatAmount, "60.00000000");
});

test("invoice draft source routes Gold By Weight making through the net-weight helper only", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
  assert.match(source, /calculateGoldByWeightMakingTotal/);
  assert.match(source, /profile === "GOLD_BY_WEIGHT_JEWELLERY"/);
  assert.match(source, /netGoldWeight: asset\.netGoldWeight \?\? asset\.netWeight \?\? asset\.goldWeight/);
});
