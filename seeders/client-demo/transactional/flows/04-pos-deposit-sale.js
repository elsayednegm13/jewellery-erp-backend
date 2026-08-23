"use strict";

const { REFERENCES, MID_DATE_1 } = require("../config");

module.exports = {
  name: "04-pos-deposit-sale",
  description: "Create a POS deposit/arbon sale",
  run: async (client, context) => {
    const khaled = context.customers["khaled@example.com"];
    const branch = context.branches["BR-DXB"];
    const goldBarAsset = context.assets["AST-CD-gw-bar"]; // GW Bar 24K 10g

    const key = client.deterministicUuid(`${REFERENCES.SALE_DEPOSIT}-key`);
    const payload = {
      customerId: khaled.id,
      branchId: branch.id,
      date: MID_DATE_1,
      paymentMethod: "deposit",
      items: [{
        assetId: goldBarAsset.id,
        price: 2300
      }],
      discount: 0,
      makingCharge: 0,
      stoneValue: 0,
      deposit: 1500, // Deposit paid amount
      notes: "Deposit/Arbon sale of Gold Bar 24K"
    };

    const res = await client.request("POST", "/api/v1/pos/checkout", payload, key);
    if (res.status !== 201) {
      throw new Error(`POS Deposit Sale failed with status ${res.status}: ${JSON.stringify(res.data)}`);
    }

    context.results.SALE_DEPOSIT_ID = res.data.id;
  }
};
