"use strict";

const { REFERENCES, MID_DATE_1 } = require("../config");

module.exports = {
  name: "03-pos-installment-sale",
  description: "Create a POS installment sale with downpayment and guarantor details",
  run: async (client, context) => {
    const mariam = context.customers["mariam@example.com"];
    const branch = context.branches["BR-DXB"];
    const diamondRingAsset = context.assets["AST-CD-dd-jewellery"]; // RNG-18K-Diamond

    const key = client.deterministicUuid(`${REFERENCES.SALE_INSTALLMENT}-key`);
    const payload = {
      customerId: mariam.id,
      branchId: branch.id,
      date: MID_DATE_1,
      paymentMethod: "installment",
      items: [{
        assetId: diamondRingAsset.id,
        price: 8890
      }],
      discount: 0,
      makingCharge: 0,
      stoneValue: 0,
      downPayment: 2890,
      installmentCount: 6,
      installmentFrequency: "monthly",
      guarantorName: "Guarantor Ahmed",
      guarantorPhone: "+971 50 999 9999",
      notes: "Installment sale of Diamond Ring 18K"
    };

    const res = await client.request("POST", "/api/v1/pos/checkout", payload, key);
    if (res.status !== 201) {
      throw new Error(`POS Installment Sale failed with status ${res.status}: ${JSON.stringify(res.data)}`);
    }

    context.results.SALE_INSTALLMENT_ID = res.data.id;
    // Capture the generated installments
    if (res.data.installments && res.data.installments.length > 0) {
      context.results.INSTALLMENT_1_ID = res.data.installments[0].id;
      context.results.INSTALLMENT_2_ID = res.data.installments[1].id;
    }
  }
};
