"use strict";

/**
 * Customer Credit Ledger service (Phase 23-Fix) — infrastructure only.
 *
 * Records and summarizes per-customer credit movements in
 * `customer_credit_transactions`. Available credit = SUM(active credit_in) −
 * SUM(active credit_out). This service:
 *   - NEVER mutates Customer.balance (which stays AR-only) or
 *     Invoice.remainingAmount.
 *   - Can optionally create a GL bridge entry to account 2300 when a caller
 *     supplies an explicit `glPosting` counter-account context. Without that
 *     context it remains ledger-only and does not invent the other side.
 *   - Always accepts an optional `transaction` and is company/customer scoped.
 *
 * No current route calls the record* helpers yet — returns/exchanges still
 * cash-refund, overpayment is still prevented. This is the ledger foundation.
 */

const postingService = require("./posting.service");

const DEFAULT_CURRENCY = "AED";
const CUSTOMER_DEPOSITS_ACCOUNT = "2300";

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function genId() {
  return `CCT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Validate the shared inputs for a record* call. Throws on bad input. */
function assertRecordInput({ companyId, customerId, amount }) {
  if (!companyId) throw new Error("customer-credit: companyId is required");
  if (!customerId) throw new Error("customer-credit: customerId is required");
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error("customer-credit: amount must be a finite number greater than zero");
  }
  return round4(amt);
}

async function createRow(models, direction, opts) {
  const amount = assertRecordInput(opts);
  const row = await models.CustomerCreditTransaction.create({
    id: opts.id || genId(),
    companyId: opts.companyId,
    branchId: opts.branchId || null,
    customerId: opts.customerId,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId || null,
    direction,
    amount,
    currency: opts.currency || DEFAULT_CURRENCY,
    description: opts.description || null,
    status: "active",
    journalEntryId: opts.journalEntryId || null,
    cashTransactionId: opts.cashTransactionId || null,
    invoiceId: opts.invoiceId || null,
    createdBy: opts.createdBy || null,
    metadata: opts.metadata || null
  }, { transaction: opts.transaction });
  return row;
}

function isGlPostingEnabled(glPosting) {
  return Boolean(glPosting && glPosting.enabled === true);
}

function validatePostingContext(direction, opts) {
  if (opts.journalEntryId && isGlPostingEnabled(opts.glPosting)) {
    throw new Error("customer-credit: pass either journalEntryId or glPosting.enabled, not both");
  }
  if (!isGlPostingEnabled(opts.glPosting)) return null;

  const gl = opts.glPosting || {};
  const debitAccountCode = String(gl.debitAccountCode || "").trim();
  const creditAccountCode = String(gl.creditAccountCode || "").trim();
  const customerDepositAccountCode = String(gl.customerDepositAccountCode || CUSTOMER_DEPOSITS_ACCOUNT).trim();
  if (!debitAccountCode || !creditAccountCode) {
    throw new Error("customer-credit: glPosting requires debitAccountCode and creditAccountCode");
  }

  if (direction === "credit_in" && creditAccountCode !== customerDepositAccountCode) {
    throw new Error("customer-credit: credit_in GL bridge must credit account 2300");
  }
  if (direction === "credit_out" && debitAccountCode !== customerDepositAccountCode) {
    throw new Error("customer-credit: credit_out GL bridge must debit account 2300");
  }

  return {
    debitAccountCode,
    creditAccountCode,
    description: gl.description || opts.description || "Customer credit movement",
    date: gl.date,
    postedBy: gl.postedBy || opts.createdBy || "System",
  };
}

async function postCreditJournal(direction, opts, amount, creditRowId, postingContext) {
  const isCreditIn = direction === "credit_in";
  const description = postingContext.description;
  return postingService.postEntry(
    opts.companyId,
    {
      description,
      date: postingContext.date,
      sourceType: "customer_credit",
      sourceId: creditRowId,
      postedBy: postingContext.postedBy,
      transaction: opts.transaction,
      branchId: opts.branchId || null,
    },
    [
      {
        accountCode: postingContext.debitAccountCode,
        debit: amount,
        credit: 0,
        description: isCreditIn ? "Customer credit counter-account" : "Customer deposits liability reduction",
      },
      {
        accountCode: postingContext.creditAccountCode,
        debit: 0,
        credit: amount,
        description: isCreditIn ? "Customer deposits liability increase" : "Customer credit counter-account",
      },
    ],
  );
}

async function createRowWithOptionalGl(models, direction, opts) {
  const amount = assertRecordInput(opts);
  const postingContext = validatePostingContext(direction, opts);

  const execute = async (transaction) => {
    const creditRowId = opts.id || genId();
    let journalEntryId = opts.journalEntryId || null;
    const operationOpts = { ...opts, id: creditRowId, transaction };

    if (postingContext) {
      const journalEntry = await postCreditJournal(direction, operationOpts, amount, creditRowId, postingContext);
      journalEntryId = journalEntry.id;
    }

    return createRow(models, direction, {
      ...operationOpts,
      journalEntryId,
    });
  };

  if (postingContext && !opts.transaction) {
    if (!models.sequelize || typeof models.sequelize.transaction !== "function") {
      throw new Error("customer-credit: models.sequelize transaction is required for GL posting");
    }
    return models.sequelize.transaction((transaction) => execute(transaction));
  }

  return execute(opts.transaction);
}

/**
 * Record a credit_in movement (raises the customer's available credit).
 * `opts`: { models, companyId, customerId, branchId?, amount, sourceType,
 *           sourceId?, description?, currency?, invoiceId?, journalEntryId?,
 *           cashTransactionId?, createdBy?, metadata?, transaction?, glPosting? }
 */
async function recordCreditIn({ models, ...opts }) {
  return createRowWithOptionalGl(models, "credit_in", opts);
}

/**
 * Record a credit_out movement (consumes available credit). Rejects if it would
 * drive available credit below zero (never lets credit go negative).
 */
async function recordCreditOut({ models, ...opts }) {
  const amount = assertRecordInput(opts);
  const summary = await getCustomerCreditSummary({
    models, companyId: opts.companyId, customerId: opts.customerId, transaction: opts.transaction
  });
  if (amount > round4(summary.availableCredit) + 0.0001) {
    throw new Error(
      `customer-credit: insufficient credit (available ${round4(summary.availableCredit)}, requested ${amount})`
    );
  }
  return createRowWithOptionalGl(models, "credit_out", opts);
}

/**
 * Aggregate the active ledger rows for one customer.
 * Returns { customerId, totalCreditIn, totalCreditOut, availableCredit,
 *           currency, recentTransactions }.
 */
async function getCustomerCreditSummary({ models, companyId, customerId, transaction, recentLimit = 5 }) {
  const rows = await models.CustomerCreditTransaction.findAll({
    where: { companyId, customerId, status: "active" },
    order: [["created_at", "DESC"]],
    transaction
  });
  let totalCreditIn = 0;
  let totalCreditOut = 0;
  let currency = DEFAULT_CURRENCY;
  for (const r of rows) {
    const amt = round4(r.amount);
    if (r.direction === "credit_in") totalCreditIn = round4(totalCreditIn + amt);
    else if (r.direction === "credit_out") totalCreditOut = round4(totalCreditOut + amt);
  }
  if (rows.length && rows[0].currency) currency = rows[0].currency;
  const availableCredit = round4(totalCreditIn - totalCreditOut);
  const recentTransactions = rows.slice(0, recentLimit).map(serializeRow);
  return { customerId, totalCreditIn, totalCreditOut, availableCredit, currency, recentTransactions };
}

/** Paged raw transactions for one customer (newest first). Read-only. */
async function getCustomerCreditTransactions({ models, companyId, customerId, limit = 50, offset = 0, transaction }) {
  const rows = await models.CustomerCreditTransaction.findAll({
    where: { companyId, customerId },
    order: [["created_at", "DESC"]],
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
    offset: Math.max(Number(offset) || 0, 0),
    transaction
  });
  return rows.map(serializeRow);
}

function serializeRow(r) {
  const j = typeof r.toJSON === "function" ? r.toJSON() : r;
  return {
    id: j.id,
    customerId: j.customerId,
    branchId: j.branchId,
    sourceType: j.sourceType,
    sourceId: j.sourceId,
    direction: j.direction,
    amount: round4(j.amount),
    currency: j.currency,
    description: j.description,
    status: j.status,
    journalEntryId: j.journalEntryId,
    cashTransactionId: j.cashTransactionId,
    invoiceId: j.invoiceId,
    createdBy: j.createdBy,
    createdAt: j.createdAt
  };
}

module.exports = {
  recordCreditIn,
  recordCreditOut,
  getCustomerCreditSummary,
  getCustomerCreditTransactions
};
