"use strict";

const { REFERENCES, MID_DATE_2 } = require("../config");

module.exports = {
  name: "12-treasury-transactions",
  description: "Create treasury cash-in and cash-out transactions",
  run: async (client, context) => {
    const branch = context.branches["BR-DXB"];

    // 1. Treasury Cash-In
    const key1 = client.deterministicUuid(`${REFERENCES.TREASURY_IN}-key`);
    const payload1 = {
      amount: 150,
      type: "cash_in",
      account: "cash",
      counterAccountCode: "4900", // Other Income
      description: "إيرادات أخرى متنوعة بذرة",
      reference: "TREASURY-IN-REF",
      branch: branch.name,
      date: MID_DATE_2
    };

    const res1 = await client.request("POST", "/api/v1/treasury/transactions", payload1, key1);
    if (res1.status !== 201) {
      throw new Error(`Treasury Cash-In failed with status ${res1.status}: ${JSON.stringify(res1.data)}`);
    }

    context.results.TREASURY_IN_ID = res1.data.id;

    // 2. Treasury Cash-Out
    const key2 = client.deterministicUuid(`${REFERENCES.TREASURY_OUT}-key`);
    const payload2 = {
      amount: 100,
      type: "cash_out",
      account: "cash",
      counterAccountCode: "6000", // Operating Expenses
      description: "مصروفات تشغيلية نثرية بذرة",
      reference: "TREASURY-OUT-REF",
      branch: branch.name,
      date: MID_DATE_2
    };

    const res2 = await client.request("POST", "/api/v1/treasury/transactions", payload2, key2);
    if (res2.status !== 201) {
      throw new Error(`Treasury Cash-Out failed with status ${res2.status}: ${JSON.stringify(res2.data)}`);
    }

    context.results.TREASURY_OUT_ID = res2.data.id;
  }
};
