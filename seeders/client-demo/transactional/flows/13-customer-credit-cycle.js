"use strict";

const { REFERENCES, MID_DATE_2 } = require("../config");

module.exports = {
  name: "13-customer-credit-cycle",
  description: "Create a customer credit deposit and a partial credit refund",
  run: async (client, context) => {
    const khaled = context.customers["khaled@example.com"];
    const branch = context.branches["BR-DXB"];

    // 1. Customer Credit Deposit
    const key1 = client.deterministicUuid(`${REFERENCES.CREDIT_DEPOSIT}-key`);
    const depositPayload = {
      amount: 800,
      paymentMethod: "cash",
      accountCode: "1110",
      branchId: branch.id,
      date: MID_DATE_2,
      description: "إيداع رصيد دائن للعميل خالد بذرة"
    };

    const res1 = await client.request("POST", `/api/v1/customers/${khaled.id}/credit/deposit`, depositPayload, key1);
    if (res1.status !== 201) {
      throw new Error(`Customer Credit Deposit failed with status ${res1.status}: ${JSON.stringify(res1.data)}`);
    }

    context.results.CREDIT_DEPOSIT_ID = res1.data.data.customerCreditTransaction.id;

    // 2. Customer Credit Refund
    const key2 = client.deterministicUuid(`${REFERENCES.CREDIT_REFUND}-key`);
    const refundPayload = {
      amount: 300,
      paymentMethod: "cash",
      accountCode: "1110",
      branchId: branch.id,
      date: MID_DATE_2,
      description: "استرداد جزء من رصيد العميل خالد بذرة"
    };

    const res2 = await client.request("POST", `/api/v1/customers/${khaled.id}/credit/refund`, refundPayload, key2);
    if (res2.status !== 201) {
      throw new Error(`Customer Credit Refund failed with status ${res2.status}: ${JSON.stringify(res2.data)}`);
    }

    context.results.CREDIT_REFUND_ID = res2.data.data.customerCreditTransaction.id;
  }
};
