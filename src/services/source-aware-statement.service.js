"use strict";

/**
 * Phase 30.11-Fix — Source-aware Customer Statement v3 Service.
 *
 * Implements the approved accounting rules:
 *  1. Dual-Ledger Structure (AR Statement and Customer Credit Ledger separate).
 *  2. Negative Exchange / Return Excess clamped to AR Relief.
 *  3. Cash Transactions shown as statement rows where linked/authoritative.
 *  4. Customer cash-credit ledger only, not full account 2300.
 *  5. Uncertain data (legacy policies, best_effort, etc.) marked non-authoritative.
 */

const { round2 } = require("./statement-reconciliation.service");
const reconciliationService = require("./statement-reconciliation.service");

const SOURCE_AWARE_STATEMENT_VERSION = "statement_v3_source_aware";

function toDateOnly(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

/**
 * Builds the dual-ledger source-aware customer statement.
 * Pure/read-only logic, no DB queries.
 *
 * @param {object} params
 * @param {string} params.customerId
 * @param {string} [params.customerName]
 * @param {string} [params.currency]
 * @param {string} [params.from] YYYY-MM-DD
 * @param {string} [params.to] YYYY-MM-DD
 * @param {Array} params.invoices
 * @param {Array} params.payments
 * @param {Array} params.cashTransactions
 * @param {Array} params.creditTransactions
 * @param {number} params.customerBalance Customer.balance AR mirror
 * @param {object} params.exchangeMeta
 * @param {object} params.returnMeta
 * @param {number} [params.legacyStatementV2ClosingBalance]
 */
function buildSourceAwareStatement({
  customerId,
  customerName,
  currency = "AED",
  from = null,
  to = null,
  invoices = [],
  payments = [],
  cashTransactions = [],
  creditTransactions = [],
  customerBalance = 0,
  exchangeMeta = {},
  returnMeta = {},
  legacyStatementV2ClosingBalance = undefined,
} = {}) {
  // 1. Gather all events that touch the Accounts Receivable (AR) Ledger
  const unifiedEvents = [];

  for (const inv of invoices) {
    unifiedEvents.push({
      eventKey: `INV-${inv.id}`,
      date: toDateOnly(inv.date),
      createdAt: inv.createdAt,
      type: "invoice_doc",
      raw: inv,
    });
  }

  for (const p of payments) {
    unifiedEvents.push({
      eventKey: `PAY-${p.id}`,
      date: toDateOnly(p.date),
      createdAt: p.createdAt,
      type: "payment_doc",
      raw: p,
    });
  }

  // Active customer credit applications reduce AR balance
  for (const c of creditTransactions) {
    if (c.status && c.status !== "active") continue;
    if (c.sourceType === "credit_application" || c.invoiceId) {
      unifiedEvents.push({
        eventKey: `CCT-APP-${c.id}`,
        date: toDateOnly(c.createdAt),
        createdAt: c.createdAt,
        type: "credit_application_doc",
        raw: c,
      });
    }
  }

  // Sort unified events chronologically
  unifiedEvents.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (ca !== cb) return ca - cb;
    return a.eventKey < b.eventKey ? -1 : 1;
  });

  // 2. Chronological simulation of the AR Ledger to apply clamping & cash mapping
  let arRunning = 0;
  const allArRows = [];

  for (const event of unifiedEvents) {
    if (event.type === "invoice_doc") {
      const inv = event.raw;
      const amount = round2(inv.total);

      if (inv.type === "invoice") {
        arRunning = round2(arRunning + amount);
        allArRows.push({
          id: `INV-${inv.id}`,
          date: event.date,
          type: "invoice",
          documentId: inv.id,
          documentNumber: inv.invoiceNumber || inv.id,
          description: inv.invoiceNumber ? `Invoice / فاتورة ${inv.invoiceNumber}` : "Invoice / فاتورة",
          debit: amount,
          credit: 0,
          runningBalance: arRunning,
          source: "invoice",
          authoritative: true,
        });
      } else if (inv.type === "return") {
        const m = returnMeta[inv.id] || {};
        const cashRefundExcess = round2(m.cashRefundExcess || 0);
        // Potential AR relief = return total minus refund portion
        const potCredit = round2(amount - cashRefundExcess);
        // Clamp credit so AR statement balance doesn't go below 0
        const arRelief = Math.max(0, Math.min(potCredit, round2(arRunning)));
        const unallocatedExcess = round2(potCredit - arRelief);

        arRunning = round2(arRunning - arRelief);
        allArRows.push({
          id: `RET-RELIEF-${inv.id}`,
          date: event.date,
          type: "return_ar_relief",
          documentId: inv.id,
          documentNumber: inv.invoiceNumber || inv.id,
          description: inv.invoiceNumber ? `Return AR Relief / مرتجع تسوية مدين ${inv.invoiceNumber}` : "Return AR Relief / مرتجع تسوية مدين",
          debit: 0,
          credit: arRelief,
          runningBalance: arRunning,
          source: "return_policy",
          authoritative: true,
        });

        if (cashRefundExcess > 0) {
          // Cash refund shown as visual transaction row (net 0 on AR)
          allArRows.push({
            id: `RET-CASH-${inv.id}`,
            date: event.date,
            type: "cash_refund",
            documentId: inv.id,
            documentNumber: inv.invoiceNumber || inv.id,
            description: `Return Cash Refund / مرتجع نقدي ${inv.invoiceNumber || inv.id}`,
            debit: cashRefundExcess,
            credit: cashRefundExcess,
            runningBalance: arRunning,
            source: "cash_transaction",
            authoritative: true,
          });
        }

        if (unallocatedExcess > 0) {
          allArRows.push({
            id: `RET-WARN-${inv.id}`,
            date: event.date,
            type: "warning",
            documentId: inv.id,
            documentNumber: inv.invoiceNumber || inv.id,
            description: `Return Excess / مرتجع زيادة ${inv.invoiceNumber || inv.id}`,
            debit: unallocatedExcess,
            credit: unallocatedExcess,
            runningBalance: arRunning,
            source: "diagnostic",
            authoritative: false,
            warnings: ["Return excess value exceeds outstanding AR balance; not applied to AR statement."],
          });
        }
      } else if (inv.type === "exchange") {
        const m = exchangeMeta[inv.id] || {};
        const amountDue = round2(m.amountDueFromCustomer || 0);
        const excess = round2(m.excessDueToCustomer || 0);
        const creditAmount = round2(m.creditAmount || 0);
        const authoritative = m.settlementSource === "linked_records";

        if (amountDue > 0) {
          arRunning = round2(arRunning + amountDue);
          allArRows.push({
            id: `EXC-CHARGE-${inv.id}`,
            date: event.date,
            type: "invoice",
            documentId: inv.id,
            documentNumber: inv.invoiceNumber || inv.id,
            description: `Exchange Charge / رسوم استبدال ${inv.invoiceNumber || inv.id}`,
            debit: amountDue,
            credit: 0,
            runningBalance: arRunning,
            source: "exchange_display",
            authoritative,
          });

          if (m.settlementMode === "paid_now") {
            arRunning = round2(arRunning - amountDue);
            allArRows.push({
              id: `EXC-COLLECT-${inv.id}`,
              date: event.date,
              type: "cash_collection",
              documentId: inv.id,
              documentNumber: inv.invoiceNumber || inv.id,
              description: `Exchange Cash Collection / تحصيل نقد استبدال ${inv.invoiceNumber || inv.id}`,
              debit: 0,
              credit: amountDue,
              runningBalance: arRunning,
              source: "cash_transaction",
              authoritative,
            });
          }
        } else if (excess > 0) {
          const cashRefund = round2(excess - creditAmount);
          const potCredit = round2(excess - cashRefund - creditAmount);
          const arRelief = Math.max(0, Math.min(potCredit, round2(arRunning)));
          const unallocatedExcess = round2(potCredit - arRelief);

          arRunning = round2(arRunning - arRelief);
          allArRows.push({
            id: `EXC-RELIEF-${inv.id}`,
            date: event.date,
            type: "exchange_ar_relief",
            documentId: inv.id,
            documentNumber: inv.invoiceNumber || inv.id,
            description: `Exchange AR Relief / تسوية استبدال مدين ${inv.invoiceNumber || inv.id}`,
            debit: 0,
            credit: arRelief,
            runningBalance: arRunning,
            source: "exchange_display",
            authoritative,
          });

          if (cashRefund > 0) {
            allArRows.push({
              id: `EXC-CASH-${inv.id}`,
              date: event.date,
              type: "cash_refund",
              documentId: inv.id,
              documentNumber: inv.invoiceNumber || inv.id,
              description: `Exchange Cash Refund / استرداد نقدي استبدال ${inv.invoiceNumber || inv.id}`,
              debit: cashRefund,
              credit: cashRefund,
              runningBalance: arRunning,
              source: "cash_transaction",
              authoritative,
            });
          }

          if (creditAmount > 0) {
            allArRows.push({
              id: `EXC-TRANSFER-${inv.id}`,
              date: event.date,
              type: "transfer_to_customer_credit",
              documentId: inv.id,
              documentNumber: inv.invoiceNumber || inv.id,
              description: `Exchange Credit Transfer / تحويل كريدت استبدال ${inv.invoiceNumber || inv.id}`,
              debit: creditAmount,
              credit: creditAmount,
              runningBalance: arRunning,
              source: "customer_credit_transaction",
              authoritative,
            });
          }

          if (unallocatedExcess > 0) {
            allArRows.push({
              id: `EXC-WARN-${inv.id}`,
              date: event.date,
              type: "warning",
              documentId: inv.id,
              documentNumber: inv.invoiceNumber || inv.id,
              description: `Exchange Excess / زيادة استبدال ${inv.invoiceNumber || inv.id}`,
              debit: unallocatedExcess,
              credit: unallocatedExcess,
              runningBalance: arRunning,
              source: "diagnostic",
              authoritative: false,
              warnings: ["Exchange excess exceeds outstanding AR balance; not applied to AR statement."],
            });
          }
        } else {
          // Unknown policy or legacy exchange with no excess
          allArRows.push({
            id: `EXC-LEGACY-${inv.id}`,
            date: event.date,
            type: "warning",
            documentId: inv.id,
            documentNumber: inv.invoiceNumber || inv.id,
            description: `Legacy/Unknown Exchange / استبدال قديم ${inv.invoiceNumber || inv.id}`,
            debit: 0,
            credit: 0,
            runningBalance: arRunning,
            source: "exchange_display",
            authoritative: false,
            warnings: ["Legacy or unknown exchange policy settlement details unavailable."],
          });
        }
      }
    } else if (event.type === "payment_doc") {
      const p = event.raw;
      const amount = round2(p.amount);

      arRunning = round2(arRunning - amount);
      allArRows.push({
        id: `PAY-${p.id}`,
        date: event.date,
        type: "payment",
        documentId: p.id,
        documentNumber: p.reference || p.id,
        description: `Payment / دفعة ${p.reference || p.id}`,
        debit: 0,
        credit: amount,
        runningBalance: arRunning,
        source: "payment",
        authoritative: true,
      });
    } else if (event.type === "credit_application_doc") {
      const c = event.raw;
      const amount = round2(c.amount);

      arRunning = round2(arRunning - amount);
      allArRows.push({
        id: `CCT-APP-${c.id}`,
        date: event.date,
        type: "credit_application",
        documentId: c.id,
        documentNumber: c.sourceNumber || c.id,
        description: c.description || "Credit Applied / تطبيق رصيد دائن",
        debit: 0,
        credit: amount,
        runningBalance: arRunning,
        source: "customer_credit_transaction",
        authoritative: true,
      });
    }
  }

  // 3. Slice and calculate AR statement rows for the filtered date range
  let arOpeningBalance = 0;
  const filteredArRows = [];

  for (const r of allArRows) {
    const delta = round2(r.debit - r.credit);
    if (from && r.date < from) {
      arOpeningBalance = round2(arOpeningBalance + delta);
      continue;
    }
    if (to && r.date > to) continue;
    filteredArRows.push(r);
  }

  let runningAr = arOpeningBalance;
  const finalArRows = filteredArRows.map((r) => {
    const delta = round2(r.debit - r.credit);
    runningAr = round2(runningAr + delta);
    return {
      ...r,
      runningBalance: runningAr,
    };
  });

  const arClosing = finalArRows.length ? finalArRows[finalArRows.length - 1].runningBalance : arOpeningBalance;

  // 4. Gather customer credit (2300 ledger) transactions
  const activeCreditTx = creditTransactions.filter((c) => !c.status || c.status === "active");
  const creditEvents = activeCreditTx.map((c) => {
    let type = "credit_in";
    if (c.sourceType === "exchange_credit") type = "exchange_credit";
    else if (c.sourceType === "return_credit") type = "return_credit";
    else if (c.sourceType === "manual_deposit") type = "manual_deposit";
    else if (c.sourceType === "credit_application") type = "credit_application";
    else if (c.sourceType === "credit_refund") type = "credit_refund";
    else if (c.direction === "credit_out") type = "credit_out";

    return {
      id: `CCT-${c.id}`,
      date: toDateOnly(c.date || c.createdAt),
      createdAt: c.createdAt,
      type,
      sourceType: c.sourceType || null,
      sourceId: c.sourceId || null,
      documentNumber: c.sourceNumber || c.id,
      description: c.description || (c.direction === "credit_in" ? "Credit Deposit / إيداع رصيد" : "Credit Applied / تطبيق رصيد"),
      creditIn: c.direction === "credit_in" ? round2(c.amount) : 0,
      creditOut: c.direction === "credit_out" ? round2(c.amount) : 0,
      authoritative: true,
    };
  });

  // Sort credit transactions chronologically
  creditEvents.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : 1;
  });

  // 5. Slice and calculate credit statement rows for the filtered date range
  let creditOpeningBalance = 0;
  const filteredCreditRows = [];

  for (const r of creditEvents) {
    const delta = round2(r.creditIn - r.creditOut);
    if (from && r.date < from) {
      creditOpeningBalance = round2(creditOpeningBalance + delta);
      continue;
    }
    if (to && r.date > to) continue;
    filteredCreditRows.push(r);
  }

  let runningCredit = creditOpeningBalance;
  const finalCreditRows = filteredCreditRows.map((r) => {
    const delta = round2(r.creditIn - r.creditOut);
    runningCredit = round2(runningCredit + delta);
    return {
      ...r,
      runningCreditBalance: runningCredit,
    };
  });

  const creditClosing = finalCreditRows.length ? finalCreditRows[finalCreditRows.length - 1].runningCreditBalance : creditOpeningBalance;

  // 6. Run diagnostics/reconciliation report
  const recon = reconciliationService.reconcileCustomer({
    customerId,
    invoices,
    payments,
    creditTransactions,
    customerBalance,
    exchangeMeta,
    returnMeta,
  });

  return {
    customerId,
    customerName,
    currency,
    version: SOURCE_AWARE_STATEMENT_VERSION,

    arStatement: {
      openingBalance: arOpeningBalance,
      closingBalance: arClosing,
      rows: finalArRows,
      meta: {
        source: "source_aware_ar",
        matchesCustomerBalance: round2(arClosing) === round2(customerBalance),
        customerBalance: round2(customerBalance),
        legacyStatementV2Unchanged: true,
      },
    },

    customerCreditLedger: {
      openingBalance: creditOpeningBalance,
      closingBalance: creditClosing,
      rows: finalCreditRows,
      meta: {
        source: "customer_credit_ledger",
        creditScope: "customer_credit_ledger_only",
        notFullAccount2300: true,
      },
    },

    reconciliation: {
      legacyStatementV2ClosingBalance: legacyStatementV2ClosingBalance !== undefined ? round2(legacyStatementV2ClosingBalance) : undefined,
      customerBalance: round2(customerBalance),
      customerCreditBalance: recon.customerCreditBalance,
      arDifference: round2(arClosing - customerBalance),
      warnings: recon.warnings,
      categories: recon.categories,
    },

    meta: {
      source: SOURCE_AWARE_STATEMENT_VERSION,
      mutatesData: false,
      statementV2Changed: false,
      ledgerBased: "source_aware_read_only",
      accountingRules: {
        structure: "dual_ledger",
        negativeExchangeReturnHandling: "clamp_to_ar_relief",
        cashTransactions: "shown_as_statement_rows",
        legacyStatement: "statement_v2_retained",
        creditScope: "customer_cash_credit_ledger_only",
      },
    },
  };
}

module.exports = {
  buildSourceAwareStatement,
  SOURCE_AWARE_STATEMENT_VERSION,
};
