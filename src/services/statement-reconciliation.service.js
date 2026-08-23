"use strict";

/**
 * Phase 30.9-Fix — pure, READ-ONLY customer statement / customer-credit
 * reconciliation logic (extracted from the Phase 30.8 diagnostic script so both
 * the verifier and the read-only endpoint share one source of truth).
 *
 * `reconcileCustomer()` takes already-fetched plain data (no DB access) and
 * returns a diagnostic report that CATEGORIZES the divergence between
 * statement-v2's source-document closing balance and the true source-aware AR /
 * customer-credit position. It mutates nothing and has NO side effects at import
 * time (no IIFE, no execSync, no git, no filesystem/DB writes, no ORM calls).
 *
 * This is a DIAGNOSTIC only — it never corrects balances. Settlement sources
 * `best_effort` / `unavailable` and legacy/unknown exchange policy are flagged
 * `authoritative: false` and are never auto-applied.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Stable diagnostic category identifiers.
const CATEGORY = {
  EXCHANGE_PAID_NOW_CASH_MISSING: "exchange_paid_now_cash_missing_from_statement",
  EXCHANGE_EXCESS_OVER_REDUCES_AR: "exchange_excess_over_reduces_ar",
  CUSTOMER_CREDIT_2300_CONFLATION: "customer_credit_2300_conflation",
  RETURN_EXCESS_OVER_CREDIT: "return_excess_cash_refund_over_credits_statement",
  SETTLEMENT_BEST_EFFORT: "settlement_best_effort_non_authoritative",
  SETTLEMENT_UNAVAILABLE: "settlement_unavailable",
  LEGACY_POLICY: "legacy_exchange_policy",
  UNKNOWN_POLICY: "unknown_exchange_policy",
};

/**
 * Pure, READ-ONLY reconciliation. All inputs are already-fetched, plain data.
 * Returns a diagnostic report; mutates nothing.
 *
 * @param {object} p
 * @param {string} p.customerId
 * @param {Array<{id,type,total,invoiceNumber?,date?}>} [p.invoices]  posted invoices
 * @param {Array<{id,amount,date?}>} [p.payments]                     payment rows
 * @param {Array<{id,type,amount,reference?,date?}>} [p.cashTransactions] (read-only)
 * @param {Array<{id,direction,amount,status?,sourceType?}>} [p.creditTransactions] 2300 credit ledger (read-only)
 * @param {number} [p.customerBalance]  Customer.balance AR mirror (relief-only truth)
 * @param {Object<string,object>} [p.exchangeMeta] per-invoice-id exchange settlement meta:
 *        { policyStatus, settlementSource, settlementMode, amountDueFromCustomer,
 *          excessDueToCustomer, creditAmount }
 * @param {Object<string,object>} [p.returnMeta] per-invoice-id return meta:
 *        { cashRefundExcess }
 */
function reconcileCustomer({
  customerId,
  invoices = [],
  payments = [],
  cashTransactions = [],
  creditTransactions = [],
  customerBalance = 0,
  exchangeMeta = {},
  returnMeta = {},
} = {}) {
  // 1. Mirror of statement-v2's document-based math (return→credit, else→debit,
  //    payment→credit), using signed inv.total exactly as statement-v2 does.
  let statementClosing = 0;
  for (const inv of invoices) {
    const amt = round2(inv.total);
    if (inv.type === "return") statementClosing -= amt;
    else statementClosing += amt; // invoice AND exchange both land here today
  }
  for (const p of payments) statementClosing -= round2(p.amount);
  statementClosing = round2(statementClosing);

  // 2. Read-only customer-credit (2300 ledger) balance.
  let creditIn = 0;
  let creditOut = 0;
  for (const c of creditTransactions) {
    if (c.status && c.status !== "active") continue;
    if (c.direction === "credit_in") creditIn += round2(c.amount);
    else if (c.direction === "credit_out") creditOut += round2(c.amount);
  }
  const customerCreditBalance = round2(creditIn - creditOut);

  const categories = new Set();
  const documents = [];
  const warnings = [];
  const flag = (doc, category, explanation, authoritative) => {
    categories.add(category);
    documents.push({ ...doc, category, explanation, authoritative: Boolean(authoritative) });
  };

  // 3. Categorize per exchange / return document.
  for (const inv of invoices) {
    const base = { documentId: inv.id, documentNumber: inv.invoiceNumber || inv.id, date: inv.date || null, amount: round2(inv.total) };

    if (inv.type === "exchange") {
      const m = exchangeMeta[inv.id] || {};
      const authoritative = m.settlementSource === "linked_records";
      const amountDue = round2(m.amountDueFromCustomer || 0);
      const excess = round2(m.excessDueToCustomer || 0);
      const creditAmount = round2(m.creditAmount || 0);

      if (m.policyStatus === "legacy_or_unknown") {
        flag({ ...base, documentType: "exchange" }, CATEGORY.LEGACY_POLICY, "Historical/unknown exchange policy — do not auto-correct.", false);
      } else if (m.policyStatus === "unknown") {
        flag({ ...base, documentType: "exchange" }, CATEGORY.UNKNOWN_POLICY, "Unknown exchange policy — do not auto-correct.", false);
      }

      if (m.settlementSource === "best_effort") {
        flag({ ...base, documentType: "exchange" }, CATEGORY.SETTLEMENT_BEST_EFFORT, "Settlement inferred (best_effort) — not authoritative.", false);
      } else if (m.settlementSource === "unavailable") {
        flag({ ...base, documentType: "exchange" }, CATEGORY.SETTLEMENT_UNAVAILABLE, "Settlement records unavailable — not authoritative.", false);
      }

      // Customer pays extra, settled paid_now via cash/bank CashTransaction: the
      // statement shows a debit but no matching Payment credit (exchange makes a
      // CashTransaction, not a Payment).
      if (amountDue > 0 && m.settlementMode === "paid_now") {
        flag({ ...base, documentType: "exchange" }, CATEGORY.EXCHANGE_PAID_NOW_CASH_MISSING,
          "Exchange paid_now via cash/bank; statement debit has no matching payment credit.", authoritative);
      }

      // Customer owed money: negative invoice total reduces AR by the full amount,
      // but only receivable-relief actually reduced AR; the excess was cash/credit.
      if (excess > 0) {
        flag({ ...base, documentType: "exchange" }, CATEGORY.EXCHANGE_EXCESS_OVER_REDUCES_AR,
          "Negative exchange total may over-reduce AR beyond the receivable relief.", authoritative);
        if (creditAmount > 0) {
          flag({ ...base, documentType: "customer_credit_transaction" }, CATEGORY.CUSTOMER_CREDIT_2300_CONFLATION,
            "Excess moved to customer credit (2300) AND reduces AR in the statement — conflation.", authoritative);
        }
      }
    }

    if (inv.type === "return") {
      const m = returnMeta[inv.id] || {};
      const cashRefundExcess = round2(m.cashRefundExcess || 0);
      if (cashRefundExcess > 0) {
        flag({ ...base, documentType: "return" }, CATEGORY.RETURN_EXCESS_OVER_CREDIT,
          "Return value exceeded outstanding AR; the cash-refunded excess over-credits the statement.", true);
      }
    }
  }

  // 4. Aggregate settlement authority across the customer's exchanges.
  const sources = new Set(Object.values(exchangeMeta).map((m) => m && m.settlementSource).filter(Boolean));
  let settlementAuthority;
  if (sources.size === 0) settlementAuthority = "unavailable";
  else if (sources.size === 1) settlementAuthority = [...sources][0];
  else settlementAuthority = "mixed";

  if (categories.size > 0) {
    warnings.push("Statement closing balance may diverge from the true AR position; see categories.");
  }

  // The Customer.balance AR mirror is the maintained (relief-only) AR truth; the
  // document-based statement can diverge. This diagnostic reports both and the gap.
  const sourceAwareEstimatedArBalance = round2(customerBalance);
  const difference = round2(statementClosing - sourceAwareEstimatedArBalance);

  return {
    customerId,
    statementClosingBalance: statementClosing,
    customerBalance: round2(customerBalance),
    customerCreditBalance,
    sourceAwareEstimatedArBalance,
    difference,
    categories: [...categories],
    documents,
    warnings,
    meta: {
      source: "diagnostic_read_only",
      mutatesData: false,
      statementChanged: false,
      ledgerBased: "diagnostic_only",
      settlementAuthority,
      // 2300 is shared with gold-pool/customer-liability flows; this figure is the
      // customer CREDIT LEDGER balance only, not the full per-customer 2300 balance.
      creditScope: "customer_credit_ledger_only",
    },
  };
}

module.exports = { reconcileCustomer, CATEGORY, round2 };
