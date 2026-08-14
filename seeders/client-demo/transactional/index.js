#!/usr/bin/env node
"use strict";

const { SEED_VERSION } = require("./config");
const { FLOWS, runAll } = require("./flow-runner");

// Map describing metadata of planned flows for Plan Mode
const PLAN_METADATA = [
  {
    name: "01-supplier-purchases",
    description: "Create three supplier purchases (cash, credit, and product-based)",
    operations: [
      { method: "POST", path: "/api/v1/purchase-orders/receive", scope: "purchase.receive", keys: ["CLIENT-DEMO-V1-DEMO-PO-001-*"] },
      { method: "POST", path: "/api/v1/purchase-orders/receive", scope: "purchase.receive", keys: ["CLIENT-DEMO-V1-DEMO-PO-002-*"] },
      { method: "POST", path: "/api/v1/purchase-orders/receive", scope: "purchase.receive", keys: ["CLIENT-DEMO-V1-DEMO-PO-003-*"] }
    ],
    prerequisites: ["Company", "Branch", "Supplier"],
    results: ["PurchaseOrder", "Product", "Asset", "StockMovement", "JournalEntry", "CashTransaction"],
    affects: { inventory: true, payments: true, treasury: true, customer: false, vat: true, cogs: false, journals: true }
  },
  {
    name: "02-pos-cash-sales",
    description: "Create two POS cash sales (one serialized asset and one product)",
    operations: [
      { method: "POST", path: "/api/v1/pos/checkout", scope: "pos.checkout", keys: ["CLIENT-DEMO-V1-DEMO-SALE-CASH-001-*"] },
      { method: "POST", path: "/api/v1/pos/checkout", scope: "pos.checkout", keys: ["CLIENT-DEMO-V1-DEMO-SALE-CASH-002-*"] }
    ],
    prerequisites: ["Customer", "Asset", "Product"],
    results: ["Invoice", "InvoiceItem", "Payment", "CashTransaction", "StockMovement", "AssetEvent", "JournalEntry"],
    affects: { inventory: true, payments: true, treasury: true, customer: false, vat: true, cogs: true, journals: true }
  },
  {
    name: "03-pos-installment-sale",
    description: "Create a POS installment sale with downpayment and guarantor details",
    operations: [
      { method: "POST", path: "/api/v1/pos/checkout", scope: "pos.checkout", keys: ["CLIENT-DEMO-V1-DEMO-SALE-INSTALLMENT-001-*"] }
    ],
    prerequisites: ["Customer", "Asset"],
    results: ["Invoice", "InvoiceItem", "Payment", "Installment", "CashTransaction", "AssetEvent", "JournalEntry"],
    affects: { inventory: true, payments: true, treasury: true, customer: true, vat: true, cogs: true, journals: true }
  },
  {
    name: "04-pos-deposit-sale",
    description: "Create a POS deposit/arbon sale",
    operations: [
      { method: "POST", path: "/api/v1/pos/checkout", scope: "pos.checkout", keys: ["CLIENT-DEMO-V1-DEMO-SALE-DEPOSIT-001-*"] }
    ],
    prerequisites: ["Customer", "Asset"],
    results: ["Invoice", "InvoiceItem", "Payment", "CashTransaction", "AssetEvent", "JournalEntry"],
    affects: { inventory: true, payments: true, treasury: true, customer: true, vat: false, cogs: false, journals: true }
  },
  {
    name: "05-sales-return",
    description: "Create a sales return credit note against a prior cash sale",
    operations: [
      { method: "POST", path: "/api/v1/sales/returns", scope: "sales.return", keys: ["CLIENT-DEMO-V1-DEMO-RETURN-001-*"] }
    ],
    prerequisites: ["Invoice", "Asset"],
    results: ["Invoice (CN)", "InvoiceItem", "CashTransaction", "AssetEvent", "JournalEntry"],
    affects: { inventory: true, payments: false, treasury: true, customer: true, vat: true, cogs: true, journals: true }
  },
  {
    name: "06-sales-exchange",
    description: "Create a sales exchange of a returned product for a new serialized asset",
    operations: [
      { method: "POST", path: "/api/v1/sales/exchanges", scope: "sales.exchange", keys: ["CLIENT-DEMO-V1-DEMO-EXCHANGE-001-*"] }
    ],
    prerequisites: ["Invoice", "Asset", "Product"],
    results: ["Invoice (EX)", "InvoiceItem", "CashTransaction", "AssetEvent", "JournalEntry"],
    affects: { inventory: true, payments: false, treasury: true, customer: true, vat: true, cogs: true, journals: true }
  },
  {
    name: "07-installment-payments",
    description: "Collect payments for two pending installments",
    operations: [
      { method: "POST", path: "/api/v1/installments/:id/pay", scope: "installment.payment", keys: ["CLIENT-DEMO-V1-DEMO-INSTALLMENT-PAY-001-*"] },
      { method: "POST", path: "/api/v1/installments/:id/pay", scope: "installment.payment", keys: ["CLIENT-DEMO-V1-DEMO-INSTALLMENT-PAY-002-*"] }
    ],
    prerequisites: ["Installment"],
    results: ["Payment", "CashTransaction", "JournalEntry"],
    affects: { inventory: false, payments: true, treasury: true, customer: true, vat: false, cogs: false, journals: true }
  },
  {
    name: "08-customer-gold",
    description: "Execute the customer gold cycle (deposit, payout, use-in-sale)",
    operations: [
      { method: "POST", path: "/api/v1/customers/:id/gold/deposit", scope: "N/A", keys: [] },
      { method: "POST", path: "/api/v1/customers/:id/gold/payout", scope: "customer.gold_payout", keys: ["CLIENT-DEMO-V1-DEMO-GOLD-PAYOUT-001-*"] },
      { method: "POST", path: "/api/v1/customers/:id/gold/use-in-sale", scope: "N/A", keys: [] }
    ],
    prerequisites: ["Customer", "Invoice"],
    results: ["CustomerGoldPool", "Asset (scrap)", "AssetEvent", "Invoice (CN)", "Payment", "CashTransaction", "JournalEntry"],
    affects: { inventory: true, payments: true, treasury: true, customer: true, vat: false, cogs: false, journals: true }
  },
  {
    name: "09-supplier-payment",
    description: "Create a supplier payment against a prior received purchase order",
    operations: [
      { method: "POST", path: "/api/v1/purchase-orders/:id/pay", scope: "purchase.payment", keys: ["CLIENT-DEMO-V1-DEMO-SUPPLIER-PAY-001-*"] }
    ],
    prerequisites: ["PurchaseOrder"],
    results: ["CashTransaction", "JournalEntry"],
    affects: { inventory: false, payments: true, treasury: true, customer: false, vat: false, cogs: false, journals: true }
  },
  {
    name: "10-manual-journal-cycle",
    description: "Execute a manual journal cycle (create draft, post, reverse)",
    operations: [
      { method: "POST", path: "/api/v1/journal-entries/manual-draft", scope: "N/A", keys: [] },
      { method: "POST", path: "/api/v1/journal-entries/:id/post", scope: "N/A", keys: [] },
      { method: "POST", path: "/api/v1/journal-entries/:id/reverse", scope: "N/A", keys: [] }
    ],
    prerequisites: ["Account"],
    results: ["JournalEntry", "JournalLine"],
    affects: { inventory: false, payments: false, treasury: false, customer: false, vat: false, cogs: false, journals: true }
  },
  {
    name: "11-gift-voucher-cycle",
    description: "Issue a new gift voucher and partially redeem it",
    operations: [
      { method: "POST", path: "/api/v1/gift-vouchers/issue", scope: "N/A", keys: [] },
      { method: "POST", path: "/api/v1/gift-vouchers/redeem", scope: "N/A", keys: [] }
    ],
    prerequisites: ["Customer"],
    results: ["GiftVoucher", "JournalEntry"],
    affects: { inventory: false, payments: true, treasury: false, customer: false, vat: false, cogs: false, journals: true }
  },
  {
    name: "12-treasury-transactions",
    description: "Create treasury cash-in and cash-out transactions",
    operations: [
      { method: "POST", path: "/api/v1/treasury/transactions", scope: "treasury.cash_transaction", keys: ["CLIENT-DEMO-V1-DEMO-TREASURY-IN-001-*"] },
      { method: "POST", path: "/api/v1/treasury/transactions", scope: "treasury.cash_transaction", keys: ["CLIENT-DEMO-V1-DEMO-TREASURY-OUT-001-*"] }
    ],
    prerequisites: ["Account"],
    results: ["CashTransaction", "JournalEntry"],
    affects: { inventory: false, payments: true, treasury: true, customer: false, vat: false, cogs: false, journals: true }
  },
  {
    name: "13-customer-credit-cycle",
    description: "Create a customer credit deposit and a partial credit refund",
    operations: [
      { method: "POST", path: "/api/v1/customers/:id/credit/deposit", scope: "customer.credit_deposit", keys: ["CLIENT-DEMO-V1-DEMO-CREDIT-DEPOSIT-001-*"] },
      { method: "POST", path: "/api/v1/customers/:id/credit/refund", scope: "customer.credit_refund", keys: ["CLIENT-DEMO-V1-DEMO-CREDIT-REFUND-001-*"] }
    ],
    prerequisites: ["Customer"],
    results: ["CustomerCreditTransaction", "CashTransaction", "JournalEntry"],
    affects: { inventory: false, payments: true, treasury: true, customer: true, vat: false, cogs: false, journals: true }
  },
  {
    name: "14-invoice-draft-post",
    description: "Create a draft invoice and then post it",
    operations: [
      { method: "POST", path: "/api/v1/sales/invoices/drafts", scope: "N/A", keys: [] },
      { method: "POST", path: "/api/v1/sales/invoices/:id/post", scope: "N/A", keys: [] }
    ],
    prerequisites: ["Customer", "Asset"],
    results: ["Invoice", "InvoiceItem", "Payment", "CashTransaction", "JournalEntry"],
    affects: { inventory: true, payments: true, treasury: true, customer: false, vat: true, cogs: true, journals: true }
  }
];

function printPlan() {
  console.log("================================================================================");
  console.log(`  DARFUS Jewellery ERP — Transactional Seed Plan Mode (Version: ${SEED_VERSION})`);
  console.log("================================================================================");
  console.log("This dry-run plan mode did not perform database mutations, login queries, or seeds.");
  console.log("The following execution map defines the strict order, enums, paths, and GL impacts:\n");

  let totalCalls = 0;
  PLAN_METADATA.forEach((flow, idx) => {
    console.log(`${idx + 1}. [Flow] ${flow.name}`);
    console.log(`   Description  : ${flow.description}`);
    console.log(`   Prereqs      : ${flow.prerequisites.join(", ")}`);
    console.log(`   HTTP Calls   :`);
    flow.operations.forEach((op) => {
      totalCalls++;
      console.log(`     - ${op.method} ${op.path} (scope: ${op.scope})`);
      if (op.keys.length > 0) {
        console.log(`       Idempotency Keys: ${op.keys.join(", ")}`);
      }
    });
    console.log(`   Expected DB  : ${flow.results.join(", ")}`);
    console.log(`   Financials   : ` + Object.entries(flow.affects)
      .map(([k, v]) => `${k}: ${v ? "✅" : "❌"}`)
      .join(" | ")
    );
    console.log("--------------------------------------------------------------------------------");
  });
  console.log(`Total Planned Flows     : ${PLAN_METADATA.length}`);
  console.log(`Total Endpoint HTTP Calls: ${totalCalls}`);
  console.log("================================================================================");
}

async function main() {
  const args = process.argv.slice(2);
  const isPlan = args.includes("--plan");

  if (isPlan) {
    printPlan();
    process.exit(0);
  }

  // Live execution (not run in this phase, but wired ready for Phase 32.4-Run-C)
  try {
    const success = await runAll();
    if (success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (error) {
    console.error(`[Seeder] Seeder script failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
