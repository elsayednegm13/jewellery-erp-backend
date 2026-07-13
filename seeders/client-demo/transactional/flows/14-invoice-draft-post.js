"use strict";

const { REFERENCES } = require("../config");

module.exports = {
  name: "14-invoice-draft-post",
  description: "Create a draft invoice and then post it",
  run: async (client, context) => {
    const khaled = context.customers["khaled@example.com"];
    const watchAsset = context.assets["AST-CD-watch"];

    // 1. Create Draft Invoice
    // POST /api/v1/sales/invoices/drafts
    const draftKey = client.deterministicUuid(`${REFERENCES.DRAFT_INVOICE}-draft-key`);
    const draftPayload = {
      customerId: khaled.id,
      paymentMethod: "cash",
      items: [{
        assetId: watchAsset.id,
        price: 15000
      }],
      notes: "Draft invoice for provisional watch seed"
    };

    const res1 = await client.request("POST", "/api/v1/sales/invoices/drafts", draftPayload, draftKey);
    if (res1.status !== 201) {
      throw new Error(`Create Draft Invoice failed with status ${res1.status}: ${JSON.stringify(res1.data)}`);
    }

    const draftInvoiceId = res1.data.data.id;
    context.results.DRAFT_INVOICE_ID = draftInvoiceId;

    // 2. Post Draft Invoice
    // POST /api/v1/sales/invoices/:id/post
    const postKey = client.deterministicUuid(`${REFERENCES.DRAFT_INVOICE}-post-key`);
    const res2 = await client.request("POST", `/api/v1/sales/invoices/${draftInvoiceId}/post`, {}, postKey);
    if (res2.status !== 201 && res2.status !== 200) {
      throw new Error(`Post Draft Invoice failed with status ${res2.status}: ${JSON.stringify(res2.data)}`);
    }

    context.results.POSTED_INVOICE_ID = draftInvoiceId;
  }
};
