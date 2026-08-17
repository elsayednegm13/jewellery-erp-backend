"use strict";

const assert = require("node:assert/strict");
const goldService = require("../src/services/gold.service");
const salePricing = require("../src/services/gold-sale-pricing.service");

async function main() {
  const quote10 = await goldService.quoteItem({ grossWeight: 10, karat: 21, perGram: 100, makingChargePerGram: 100, stoneValue: 0, vatRate: 0 });
  assert.equal(quote10.totalMakingCharge, 1000);
  assert.equal(quote10.makingChargePerGram, 100);
  assert.equal(quote10.subtotal, quote10.metalValue + 1000);

  const quote875 = await goldService.quoteItem({ grossWeight: 8.75, karat: 18, perGram: 100, makingChargePerGram: 100, stoneValue: 0, vatRate: 0 });
  assert.equal(quote875.totalMakingCharge, 875);

  assert.equal(salePricing.calculateMakingChargeTotal({ itemWeightGrams: 0, makingChargePerGram: 100 }), "0.00000000");
  assert.equal(salePricing.calculateMakingChargeTotal({ itemWeightGrams: 10, makingChargePerGram: 100 }), "1000.00000000");
  assert.equal(salePricing.calculateMakingChargeTotal({ itemWeightGrams: 5, makingChargePerGram: 100 }), "500.00000000");

  const sale = salePricing.calculateGoldByWeightSalePrice({
    netGoldWeight: 8,
    itemWeightGrams: 10,
    sellingGoldRate: 120,
    makingChargePerGram: 100,
    vatRate: 0,
  });
  assert.equal(sale.goldValue, "960.00000000");
  assert.equal(sale.makingTotal, "800.00000000");
  assert.equal(sale.subtotal, "1760.00000000");
  assert.equal(sale.itemWeightGrams, "10.00000000");

  console.log(JSON.stringify({
    result: "PASS",
    goldCenter: { tenGramsAt100: quote10.totalMakingCharge, fractional: quote875.totalMakingCharge },
    pos: { tenGramsAt100: sale.makingTotal, fiveGramsAt100: salePricing.calculateMakingChargeTotal({ itemWeightGrams: 5, makingChargePerGram: 100 }) },
    purityIndependent: true,
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
