"use strict";

const { REFERENCES } = require("../config");

module.exports = {
  name: "05-sales-return",
  description: "Create a sales return credit note against a prior cash sale",
  run: async (client, context) => {
    const originalInvoiceId = context.results.SALE_CASH_1_ID;
    if (!originalInvoiceId) {
      throw new Error("Original cash sale invoice ID is missing in context.");
    }

    const goldEarringsAsset = context.assets["AST-CD-gp"];

    const key = client.deterministicUuid(`${REFERENCES.RETURN}-key`);
    const payload = {
      originalInvoiceId,
      returnedAssetIds: [goldEarringsAsset.id],
      reason: "Customer changed mind - returned earrings",
      // refund the excess to cash
      settlement: {
        cashAmount: 3250 * 1.05, // include 5% default VAT
        bankAmount: 0,
        creditAmount: 0
      }
    };

    const res = await client.request("POST", "/api/v1/sales/returns", payload, key);
    if (res.status !== 201) {
      throw new Error(`Sales Return failed with status ${res.status}: ${JSON.stringify(res.data)}`);
    }

    context.results.RETURN_INVOICE_ID = res.data.id;
  }
};
