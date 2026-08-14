"use strict";

const { REFERENCES } = require("../config");

module.exports = {
  name: "06-sales-exchange",
  description: "Create a sales exchange of a returned product for a new serialized asset",
  run: async (client, context) => {
    const originalInvoiceId = context.results.SALE_CASH_2_ID;
    if (!originalInvoiceId) {
      throw new Error("Original cash sale 2 invoice ID is missing in context.");
    }

    const returnedProductId = context.results.RNG_BULK_PRODUCT_ID;
    const newAsset = context.assets["AST-CD-gs-jewellery"]; // Precious Necklace 18K

    const key = client.deterministicUuid(`${REFERENCES.EXCHANGE}-key`);
    const payload = {
      originalInvoiceId,
      returnedAssetId: returnedProductId,
      newAssetIds: [newAsset.id],
      paymentMethod: "Exchange",
      settlementMode: "credit", // customer credit or AR relief
      notes: "Exchange of rings for precious gemstone necklace"
    };

    const res = await client.request("POST", "/api/v1/sales/exchanges", payload, key);
    if (res.status !== 201) {
      throw new Error(`Sales Exchange failed with status ${res.status}: ${JSON.stringify(res.data)}`);
    }

    context.results.EXCHANGE_INVOICE_ID = res.data.id;
  }
};
