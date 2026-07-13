"use strict";

/**
 * Verification manifest defining the expected database state and minimum counts
 * after the future transactional demo seed is executed in Phase 32.4-Run-C.
 */
module.exports = {
  version: "client-demo-transactions-v1",
  
  // Expected minimum records created dynamically by transactional seeds
  expectations: {
    purchaseOrders: {
      minCount: 3,
      descriptions: ["Paid cash purchase", "Credit purchase watch", "Credit purchase bulk product"]
    },
    invoices: {
      minCount: 10, // baseline + 2 cash sales + 1 installment sale + 1 deposit sale + 1 return + 1 exchange + 1 voucher payout/issue + 1 posted draft
      types: ["sale", "return", "exchange", "installment", "deposit"]
    },
    invoiceItems: {
      minCount: 12
    },
    payments: {
      minCount: 6 // checkout payments + down payments + installment collections + credit note splits
    },
    installments: {
      minCount: 6, // 6 installments created for the installment sale
      minPaidCount: 2 // 2 installments paid
    },
    cashTransactions: {
      minCount: 10 // sales cash-in + returns cash-out + treasury cash-in/out + gold deposit/payout
    },
    assetEvents: {
      minCount: 6 // PURCHASE_RECEIVED + SALE + RETURNED + EXCHANGED_IN + EXCHANGED_OUT
    },
    customerGoldPools: {
      minCount: 3, // deposit (positive) + payout (negative) + use-in-sale (negative)
      customerId: "CUS-0026" // Khaled
    },
    journalEntries: {
      minCount: 12, // automatically created entries + manual journal cycles
      status: "posted"
    },
    stockMovements: {
      minCount: 6 // purchase_receive + sale + return + exchange_out + exchange_in
    },
    customerCreditTransactions: {
      minCount: 3 // return credit + manual deposit + partial refund
    },
    giftVouchers: {
      minCount: 1, // code GV-DEMO-001
      redeemedMinCount: 1
    }
  }
};
