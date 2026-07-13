"use strict";

const { REFERENCES, MID_DATE_2 } = require("../config");

module.exports = {
  name: "09-supplier-payment",
  description: "Create a supplier payment against a prior received purchase order",
  run: async (client, context) => {
    const po3Id = context.results.PO_3_ID;
    if (!po3Id) {
      throw new Error("PO 3 ID is missing in context.");
    }

    const key = client.deterministicUuid(`${REFERENCES.SUPPLIER_PAY}-key`);
    const payload = {
      amount: 4500,
      account: "cash",
      date: MID_DATE_2,
      note: "سداد دفعة من الحساب لأمر الشراء"
    };

    const res = await client.request("POST", `/api/v1/purchase-orders/${po3Id}/pay`, payload, key);
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Supplier Payment failed with status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  }
};
