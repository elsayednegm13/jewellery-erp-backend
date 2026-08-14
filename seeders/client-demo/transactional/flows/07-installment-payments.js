"use strict";

const { REFERENCES } = require("../config");

module.exports = {
  name: "07-installment-payments",
  description: "Collect payments for two pending installments",
  run: async (client, context) => {
    const inst1Id = context.results.INSTALLMENT_1_ID;
    const inst2Id = context.results.INSTALLMENT_2_ID;

    if (!inst1Id || !inst2Id) {
      throw new Error("Installment IDs from flow 3 are missing in context.");
    }

    // 1. Pay Installment 1
    const key1 = client.deterministicUuid(`${REFERENCES.INSTALLMENT_PAY_1}-key`);
    const payload1 = {
      amount: 1000,
      paymentMethod: "Cash"
    };

    const res1 = await client.request("POST", `/api/v1/installments/${inst1Id}/pay`, payload1, key1);
    if (res1.status !== 200) {
      throw new Error(`Payment of installment 1 failed with status ${res1.status}: ${JSON.stringify(res1.data)}`);
    }

    // 2. Pay Installment 2
    const key2 = client.deterministicUuid(`${REFERENCES.INSTALLMENT_PAY_2}-key`);
    const payload2 = {
      amount: 1000,
      paymentMethod: "Cash"
    };

    const res2 = await client.request("POST", `/api/v1/installments/${inst2Id}/pay`, payload2, key2);
    if (res2.status !== 200) {
      throw new Error(`Payment of installment 2 failed with status ${res2.status}: ${JSON.stringify(res2.data)}`);
    }
  }
};
