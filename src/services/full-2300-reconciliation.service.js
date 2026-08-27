"use strict";

/**
 * Phase 30.13-Fix — pure, READ-ONLY full account-2300 per-customer diagnostic.
 *
 * Account 2300 "Customer Deposits" is NOT only the customer cash-credit ledger.
 * It also holds gold-pool liabilities and POS deposit-sale liabilities, and it
 * may contain movements that cannot be attributed to a customer. This service
 * reconstructs the 2300 GL balance per customer BY SOURCE CATEGORY, purely from
 * already-fetched data — it never queries a DB, never mutates anything, and has
 * NO side effects at import time (no IIFE, no execSync, no writes, no ORM calls).
 *
 * It is INFORMATIONAL only (not customer-facing) and does NOT inject gold-pool
 * liabilities into any customer statement. Per-customer 2300 is reconstructed by
 * hopping JournalEntry.sourceType → sourceId → source document → customerId,
 * because journal lines carry no customerId dimension. Anything unattributable
 * lands in an explicit "unresolved_or_other" bucket, and the result is
 * cross-checked against the company 2300 GL balance.
 *
 * Signed-amount convention (2300 is a liability): signedAmount = credit − debit.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const CATEGORY_2300 = {
  CUSTOMER_CREDIT_LEDGER: "customer_credit_ledger",
  GOLD_POOL_LIABILITY: "gold_pool_liability",
  POS_DEPOSIT_SALE_LIABILITY: "pos_deposit_sale_liability",
  UNRESOLVED_OR_OTHER: "unresolved_or_other",
};

/**
 * Maps a JournalEntry.sourceType (for a 2300 line) to its 2300 source category
 * and how the customer is resolved from JournalEntry.sourceId.
 *  - customer_credit    → manual deposit / refund / apply (credit service journal)
 *  - exchange / return  → the Cr 2300 credit portion inside the exchange/return journal
 *  - deposit            → POS deposit-sale liability
 *  - customer_gold_pool → customer gold-pool liability
 */
const SOURCE_2300 = {
  customer_credit: { category: CATEGORY_2300.CUSTOMER_CREDIT_LEDGER, resolveVia: "customer_credit_transaction" },
  exchange: { category: CATEGORY_2300.CUSTOMER_CREDIT_LEDGER, resolveVia: "invoice" },
  return: { category: CATEGORY_2300.CUSTOMER_CREDIT_LEDGER, resolveVia: "invoice" },
  deposit: { category: CATEGORY_2300.POS_DEPOSIT_SALE_LIABILITY, resolveVia: "invoice" },
  customer_gold_pool: { category: CATEGORY_2300.GOLD_POOL_LIABILITY, resolveVia: "gold_pool" },
};

const EXPLANATION = {
  [CATEGORY_2300.CUSTOMER_CREDIT_LEDGER]: "Customer cash-credit ledger movement on 2300.",
  [CATEGORY_2300.GOLD_POOL_LIABILITY]: "Customer gold-pool liability movement on 2300.",
  [CATEGORY_2300.POS_DEPOSIT_SALE_LIABILITY]: "POS deposit-sale liability movement on 2300.",
};

/**
 * Pure reconstruction. All inputs are already-fetched, plain data.
 *
 * @param {object} p
 * @param {string} [p.companyId]
 * @param {string} [p.accountName]
 * @param {number} [p.glBalance2300]        company 2300 GL balance (credit − debit)
 * @param {Array<{id,sourceType,sourceId}>} [p.journalEntries]
 * @param {Array<{id,journalEntryId,accountCode,debit,credit}>} [p.journalLines2300] 2300 lines ONLY
 * @param {Array<{id,customerId}>} [p.customerCreditTransactions]
 * @param {Array<{id,customerId,customerName}>} [p.customerGoldPools]
 * @param {Array<{id,customerId,customerName}>} [p.invoices]
 * @param {Array<{id,name}>} [p.customers]
 */
function buildFull2300Reconciliation({
  companyId,
  accountName,
  glBalance2300 = 0,
  journalEntries = [],
  journalLines2300 = [],
  customerCreditTransactions = [],
  customerGoldPools = [],
  invoices = [],
  customers = [],
} = {}) {
  const entryById = new Map(journalEntries.map((e) => [e.id, { sourceType: e.sourceType, sourceId: e.sourceId }]));
  const cctById = new Map(customerCreditTransactions.map((c) => [c.id, { customerId: c.customerId }]));
  const goldById = new Map(customerGoldPools.map((g) => [g.id, { customerId: g.customerId, customerName: g.customerName }]));
  const invoiceById = new Map(invoices.map((i) => [i.id, { customerId: i.customerId, customerName: i.customerName }]));
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

  const byCustomerMap = new Map();
  const unresolved = [];

  const ensureCustomer = (customerId, customerName) => {
    if (!byCustomerMap.has(customerId)) {
      byCustomerMap.set(customerId, {
        customerId,
        customerName: customerName || customerNameById.get(customerId) || null,
        totals: {
          customerCreditLedger: 0,
          goldPoolLiability: 0,
          posDepositSaleLiability: 0,
          unresolvedOrOther: 0,
          totalResolved2300: 0,
        },
        categories: new Set(),
        documents: [],
        warnings: [],
      });
    }
    return byCustomerMap.get(customerId);
  };

  for (const line of journalLines2300) {
    const debit = round2(line.debit);
    const credit = round2(line.credit);
    const signedAmount = round2(credit - debit); // liability: credit increases, debit decreases

    const entry = entryById.get(line.journalEntryId);
    if (!entry) {
      unresolved.push({ journalEntryId: line.journalEntryId, journalLineId: line.id, sourceType: undefined, sourceId: undefined, debit, credit, signedAmount, reason: "journal entry not found for line" });
      continue;
    }
    const mapping = SOURCE_2300[entry.sourceType];
    if (!mapping) {
      unresolved.push({ journalEntryId: line.journalEntryId, journalLineId: line.id, sourceType: entry.sourceType, sourceId: entry.sourceId, debit, credit, signedAmount, reason: `unmapped 2300 sourceType "${entry.sourceType}"` });
      continue;
    }

    let customerId;
    let customerName;
    if (mapping.resolveVia === "customer_credit_transaction") {
      const cct = cctById.get(entry.sourceId);
      customerId = cct && cct.customerId;
    } else if (mapping.resolveVia === "invoice") {
      const inv = invoiceById.get(entry.sourceId);
      customerId = inv && inv.customerId;
      customerName = inv && inv.customerName;
    } else if (mapping.resolveVia === "gold_pool") {
      const g = goldById.get(entry.sourceId);
      customerId = g && g.customerId;
      customerName = g && g.customerName;
    }

    if (!customerId) {
      unresolved.push({ journalEntryId: line.journalEntryId, journalLineId: line.id, sourceType: entry.sourceType, sourceId: entry.sourceId, debit, credit, signedAmount, reason: "source resolved but no customer attribution" });
      continue;
    }

    const bucket = ensureCustomer(customerId, customerName);
    bucket.categories.add(mapping.category);
    if (mapping.category === CATEGORY_2300.CUSTOMER_CREDIT_LEDGER) bucket.totals.customerCreditLedger = round2(bucket.totals.customerCreditLedger + signedAmount);
    else if (mapping.category === CATEGORY_2300.GOLD_POOL_LIABILITY) bucket.totals.goldPoolLiability = round2(bucket.totals.goldPoolLiability + signedAmount);
    else if (mapping.category === CATEGORY_2300.POS_DEPOSIT_SALE_LIABILITY) bucket.totals.posDepositSaleLiability = round2(bucket.totals.posDepositSaleLiability + signedAmount);
    bucket.totals.totalResolved2300 = round2(bucket.totals.totalResolved2300 + signedAmount);
    bucket.documents.push({
      sourceCategory: mapping.category,
      journalEntryId: line.journalEntryId,
      journalLineId: line.id,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      debit,
      credit,
      signedAmount,
      customerId,
      customerName: bucket.customerName,
      authoritative: true,
      explanation: EXPLANATION[mapping.category] || "2300 movement.",
    });
  }

  const byCustomer = [...byCustomerMap.values()].map((c) => ({
    ...c,
    categories: [...c.categories],
  }));

  const perCustomerResolvedTotal = round2(byCustomer.reduce((s, c) => s + c.totals.totalResolved2300, 0));
  const unresolvedTotal = round2(unresolved.reduce((s, u) => s + u.signedAmount, 0));
  const reconstructed2300Total = round2(perCustomerResolvedTotal + unresolvedTotal);
  const gl = round2(glBalance2300);
  const difference = round2(reconstructed2300Total - gl);

  return {
    companyId: companyId || null,
    accountCode: "2300",
    accountName: accountName || "Customer Deposits",
    glBalance2300: gl,
    byCustomer,
    unresolved,
    crossCheck: {
      perCustomerResolvedTotal,
      unresolvedTotal,
      reconstructed2300Total,
      glBalance2300: gl,
      difference,
      matchesGl: Math.abs(difference) <= 0.01,
    },
    meta: {
      source: "diagnostic_read_only",
      mutatesData: false,
      statementChanged: false,
      customerFacing: false,
      scope: "full_2300_breakdown",
      includesGoldPoolLiabilities: true,
      injectsGoldPoolIntoStatement: false,
      requiresAccountingSignoffForUiOrPostingChanges: true,
    },
  };
}

module.exports = { buildFull2300Reconciliation, CATEGORY_2300, SOURCE_2300 };
