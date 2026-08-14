"use strict";

const { REFERENCES } = require("../config");

module.exports = {
  name: "08-customer-gold",
  description: "Execute the customer gold cycle (deposit, payout, use-in-sale)",
  run: async (client, context) => {
    const khaled = context.customers["khaled@example.com"];
    const branch = context.branches["BR-DXB"];
    // Outstanding invoice from baseline seeds
    const invoiceId = "INV-10484";

    // 1. Customer Gold Deposit
    // POST /api/v1/customers/:id/gold/deposit
    const depositPayload = {
      description: "إيداع ذهب كسر عيار 21 للعميل خالد",
      karat: 21,
      weight: 15.0,
      ratePerGram: 210,
      payout: false
    };

    const res1 = await client.request("POST", `/api/v1/customers/${khaled.id}/gold/deposit`, depositPayload, null, branch.id);
    if (res1.status !== 201) {
      throw new Error(`Customer Gold Deposit failed with status ${res1.status}: ${JSON.stringify(res1.data)}`);
    }

    // 2. Customer Gold Payout (requires Idempotency-Key)
    // POST /api/v1/customers/:id/gold/payout
    const payoutKey = client.deterministicUuid(`${REFERENCES.GOLD_PAYOUT}-key`);
    const payoutPayload = {
      weight: 5.0,
      ratePerGram: 210,
      payMethod: "cash"
    };

    const res2 = await client.request("POST", `/api/v1/customers/${khaled.id}/gold/payout`, payoutPayload, payoutKey);
    if (res2.status !== 200) {
      throw new Error(`Customer Gold Payout failed with status ${res2.status}: ${JSON.stringify(res2.data)}`);
    }

    // 3. Customer Gold Use in Sale
    // POST /api/v1/customers/:id/gold/use-in-sale
    const usePayload = {
      invoiceId,
      weightUsed: 5.0,
      ratePerGram: 210
    };

    const res3 = await client.request("POST", `/api/v1/customers/${khaled.id}/gold/use-in-sale`, usePayload);
    if (res3.status !== 200) {
      throw new Error(`Customer Gold Use in Sale failed with status ${res3.status}: ${JSON.stringify(res3.data)}`);
    }
  }
};
