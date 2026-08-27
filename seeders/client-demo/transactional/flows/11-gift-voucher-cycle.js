"use strict";

const { VOUCHER_CODE } = require("../config");

module.exports = {
  name: "11-gift-voucher-cycle",
  description: "Issue a new gift voucher and partially redeem it",
  run: async (client, context) => {
    const mariam = context.customers["mariam@example.com"];
    const branch = context.branches["BR-DXB"];

    // 1. Issue Gift Voucher
    const issuePayload = {
      code: VOUCHER_CODE,
      value: 500,
      customerId: mariam.id,
      customerName: mariam.name,
      paymentMethod: "Cash",
      branch: branch.name
    };

    const res1 = await client.request("POST", "/api/v1/gift-vouchers/issue", issuePayload);
    if (res1.status !== 201) {
      throw new Error(`Gift Voucher Issue failed with status ${res1.status}: ${JSON.stringify(res1.data)}`);
    }

    context.results.VOUCHER_ID = res1.data.id;

    // 2. Partially Redeem Gift Voucher
    const redeemPayload = {
      code: VOUCHER_CODE,
      amount: 200
    };

    const res2 = await client.request("POST", "/api/v1/gift-vouchers/redeem", redeemPayload);
    if (res2.status !== 200) {
      throw new Error(`Gift Voucher Redeem failed with status ${res2.status}: ${JSON.stringify(res2.data)}`);
    }
  }
};
