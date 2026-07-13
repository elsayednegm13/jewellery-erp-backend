"use strict";

const { REFERENCES, MID_DATE_1 } = require("../config");

module.exports = {
  name: "02-pos-cash-sales",
  description: "Create two POS cash sales (one serialized asset and one product)",
  run: async (client, context) => {
    const dana = context.customers["dana@example.com"];
    const branch = context.branches["BR-DXB"];
    const goldEarringsAsset = context.assets["AST-CD-gp"]; // GP earring variant

    // 1. POS Cash Sale 1: Serialized Asset ("Gold Earrings 21K")
    const key1 = client.deterministicUuid(`${REFERENCES.SALE_CASH_1}-key`);
    const payload1 = {
      customerId: dana.id,
      branchId: branch.id,
      date: MID_DATE_1,
      paymentMethod: "cash",
      items: [{
        assetId: goldEarringsAsset.id,
        price: 3250
      }],
      discount: 0,
      makingCharge: 0,
      stoneValue: 0
    };

    const res1 = await client.request("POST", "/api/v1/pos/checkout", payload1, key1);
    if (res1.status !== 201) {
      throw new Error(`POS Cash Sale 1 failed with status ${res1.status}: ${JSON.stringify(res1.data)}`);
    }

    context.results.SALE_CASH_1_ID = res1.data.id;

    // 2. POS Cash Sale 2: Product quantity sale (from RNG-21K-BULK-SEED product created in flow 1)
    const key2 = client.deterministicUuid(`${REFERENCES.SALE_CASH_2}-key`);
    const bulkProductId = context.results.RNG_BULK_PRODUCT_ID;
    if (!bulkProductId) {
      throw new Error("Bulk product ID from flow 1 is missing in seed context.");
    }

    const payload2 = {
      customerId: dana.id,
      branchId: branch.id,
      date: MID_DATE_1,
      paymentMethod: "cash",
      items: [{
        assetId: bulkProductId,
        quantity: 2,
        price: 1350
      }],
      discount: 100, // discount
      makingCharge: 0,
      stoneValue: 0
    };

    const res2 = await client.request("POST", "/api/v1/pos/checkout", payload2, key2);
    if (res2.status !== 201) {
      throw new Error(`POS Cash Sale 2 failed with status ${res2.status}: ${JSON.stringify(res2.data)}`);
    }

    context.results.SALE_CASH_2_ID = res2.data.id;
  }
};
