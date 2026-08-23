"use strict";

const { REFERENCES, START_DATE } = require("../config");

module.exports = {
  name: "01-supplier-purchases",
  description: "Create three supplier purchases (cash, credit, and product-based)",
  run: async (client, context) => {
    // Resolve suppliers and branch
    const emiratesDiamonds = context.suppliers["emirates diamonds"];
    const swissTimeMe = context.suppliers["swiss time me"];
    const branch = context.branches["BR-DXB"];

    // 1. Supplier Purchase 1: Cash/Paid purchase of a diamond asset
    const key1 = client.deterministicUuid(`${REFERENCES.PO_1}-key`);
    const payload1 = {
      id: REFERENCES.PO_1,
      supplierId: emiratesDiamonds.id,
      branchId: branch.id,
      purchaseDate: START_DATE,
      paymentMethod: "cash",
      paidAmount: 6500,
      items: [{
        name: "Diamond Solitaire Stone GW-Seed",
        type: "diamond",
        inventoryCode: "DD",
        itemCode: "LOS",
        category: "أحجار كريمة",
        karat: 18,
        quantity: 1,
        weightPerUnit: 0.8,
        unitCost: 6500,
        price: 8500,
        assetId: "AST-SEED-DIAMOND-001"
      }],
      notes: "Cash purchase of solitaire stone for seed"
    };

    const res1 = await client.request("POST", "/api/v1/purchase-orders/receive", payload1, key1);
    if (res1.status !== 201) {
      throw new Error(`Purchase 1 failed with status ${res1.status}: ${JSON.stringify(res1.data)}`);
    }

    // Save PO 1 ID to context
    context.results.PO_1_ID = REFERENCES.PO_1;

    // 2. Supplier Purchase 2: Credit purchase of a luxury watch asset
    const key2 = client.deterministicUuid(`${REFERENCES.PO_2}-key`);
    const payload2 = {
      id: REFERENCES.PO_2,
      supplierId: swissTimeMe.id,
      branchId: branch.id,
      purchaseDate: START_DATE,
      paymentMethod: "credit",
      paidAmount: 0,
      items: [{
        name: "Swiss Chrono Luxury Watch GW-Seed",
        type: "watch",
        inventoryCode: "WT",
        itemCode: "WCH",
        category: "ساعات",
        karat: null,
        quantity: 1,
        weightPerUnit: 140,
        unitCost: 12000,
        price: 16500,
        assetId: "AST-SEED-WATCH-001"
      }],
      notes: "Credit purchase of swiss watch for seed"
    };

    const res2 = await client.request("POST", "/api/v1/purchase-orders/receive", payload2, key2);
    if (res2.status !== 201) {
      throw new Error(`Purchase 2 failed with status ${res2.status}: ${JSON.stringify(res2.data)}`);
    }

    context.results.PO_2_ID = REFERENCES.PO_2;

    // 3. Supplier Purchase 3: Credit purchase of products (quantity inventory, e.g. gold-piece productCode)
    const key3 = client.deterministicUuid(`${REFERENCES.PO_3}-key`);
    const payload3 = {
      id: REFERENCES.PO_3,
      supplierId: emiratesDiamonds.id,
      branchId: branch.id,
      purchaseDate: START_DATE,
      paymentMethod: "credit",
      paidAmount: 0,
      items: [{
        name: "Gold Ring 21K Seed-Bulk",
        productCode: "RNG-21K-BULK-SEED",
        type: "gold-piece",
        category: "خواتم",
        karat: 21,
        quantity: 10,
        weightPerUnit: 4.5,
        unitCost: 950,
        price: 1350
      }],
      notes: "Credit purchase of ring products in bulk"
    };

    const res3 = await client.request("POST", "/api/v1/purchase-orders/receive", payload3, key3);
    if (res3.status !== 201) {
      throw new Error(`Purchase 3 failed with status ${res3.status}: ${JSON.stringify(res3.data)}`);
    }

    context.results.PO_3_ID = REFERENCES.PO_3;
    // Store the product ID for rng bulk
    if (res3.data && res3.data.purchaseOrder && res3.data.purchaseOrder.items && res3.data.purchaseOrder.items[0]) {
      context.results.RNG_BULK_PRODUCT_ID = res3.data.purchaseOrder.items[0].productId;
    }
  }
};
