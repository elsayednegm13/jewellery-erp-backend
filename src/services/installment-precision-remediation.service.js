"use strict";

const { AppError, NotFoundError } = require("../utils/errors");
const postingService = require("./posting.service");
const financialAccountResolver = require("./financial-account-resolver.service");
const auditService = require("./audit.service");

const SCALE = 10000n;
const REMEDIATION_SOURCE_TYPE = "installment_precision_remediation";

function exactUnits(value, field) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(text)) {
    throw new AppError(`${field} is not a valid DECIMAL(15,4) value.`, 409, "INSTALLMENT_PRECISION_SOURCE_INVALID");
  }
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * SCALE + BigInt(`${fraction}0000`.slice(0, 4));
}

function fromUnits(units) {
  const value = BigInt(units);
  if (value < 0n) throw new Error("Negative exact money is not supported by this workflow.");
  return `${value / SCALE}.${(value % SCALE).toString().padStart(4, "0")}`;
}

function fail(code, message, statusCode = 422) {
  throw new AppError(message, statusCode, code);
}

function lockFor(transaction, model) {
  return transaction ? { level: transaction.LOCK.UPDATE, of: model } : undefined;
}

function plain(row) {
  return row && typeof row.toJSON === "function" ? row.toJSON() : row;
}

/**
 * Repair only the accounting representation of one immutable installment
 * collection. The caller supplies the durable Payment reference; every amount,
 * mapping, source linkage, and correction direction is derived and validated on
 * the server inside the caller's transaction.
 */
async function remediateInstallmentPrecision({
  models,
  companyId,
  branchId,
  originalPaymentId,
  transaction,
  actor = {},
}) {
  if (!models || !companyId || !branchId || !transaction) {
    fail("INSTALLMENT_PRECISION_CONTEXT_REQUIRED", "Company, Branch, models, and a transaction are required.", 409);
  }

  await models.sequelize.query(
    "SELECT pg_advisory_xact_lock(hashtext(:scope))",
    { replacements: { scope: `installment-precision-remediation:${companyId}:${originalPaymentId}` }, transaction },
  );

  const payment = await models.Payment.findOne({
    where: { id: originalPaymentId, companyId },
    transaction,
    lock: lockFor(transaction, models.Payment),
  });
  if (!payment) throw new NotFoundError("The original installment Payment was not found.");

  const existingRemediation = await models.JournalEntry.findOne({
    where: { companyId, sourceType: REMEDIATION_SOURCE_TYPE, sourceId: payment.id },
    transaction,
    lock: lockFor(transaction, models.JournalEntry),
  });
  if (existingRemediation) {
    fail("INSTALLMENT_PRECISION_ALREADY_REMEDIATED", "This installment collection already has a precision remediation.", 409);
  }

  const invoice = await models.Invoice.findOne({
    where: { id: payment.invoiceId, companyId },
    transaction,
    lock: lockFor(transaction, models.Invoice),
  });
  if (!invoice || !invoice.branchId || String(invoice.branchId) !== String(branchId) || String(payment.branchId || "") !== String(branchId)) {
    fail("INSTALLMENT_PRECISION_BRANCH_INVALID", "The original collection is outside the authorized operational Branch.", 403);
  }

  const installments = await models.Installment.findAll({
    where: { companyId, invoiceId: invoice.id },
    transaction,
    lock: lockFor(transaction, models.Installment),
  });
  if (installments.length === 0) {
    fail("INSTALLMENT_PRECISION_SOURCE_NOT_INSTALLMENT", "The Payment is not linked to an installment source.");
  }

  const originalJournal = await models.JournalEntry.findOne({
    where: { companyId, sourceType: "installment_collection", sourceId: payment.id },
    transaction,
    lock: lockFor(transaction, models.JournalEntry),
  });
  if (!originalJournal) fail("INSTALLMENT_PRECISION_JOURNAL_MISSING", "The original installment Journal is missing.");
  if (originalJournal.status !== "posted") fail("INSTALLMENT_PRECISION_JOURNAL_NOT_POSTED", "The original installment Journal is not posted.");

  const treasuryRows = await models.CashTransaction.findAll({
    where: { companyId, journalEntryId: originalJournal.id, status: "posted" },
    transaction,
    lock: lockFor(transaction, models.CashTransaction),
  });
  if (treasuryRows.length !== 1) {
    fail("INSTALLMENT_PRECISION_TREASURY_AMBIGUOUS", "The original installment Treasury linkage is missing or ambiguous.");
  }
  const treasury = treasuryRows[0];
  const accountKey = String(treasury.account || "").trim().toLowerCase();
  if (!["cash", "bank"].includes(accountKey) || treasury.type !== "cash_in") {
    fail("INSTALLMENT_PRECISION_TREASURY_SOURCE_INVALID", "The original installment Treasury source is not a cash or bank receipt.");
  }

  const paymentUnits = exactUnits(payment.amount, "Payment.amount");
  const treasuryUnits = exactUnits(treasury.amount, "Treasury.amount");
  if (paymentUnits <= 0n || treasuryUnits <= 0n || paymentUnits !== treasuryUnits) {
    fail("INSTALLMENT_PRECISION_SOURCE_AMOUNT_MISMATCH", "Payment and Treasury do not carry the same exact economic amount.");
  }

  const mappingRole = accountKey === "cash" ? "CASH_TREASURY" : "BANK_ACCOUNT";
  const treasuryAccount = await financialAccountResolver.resolveRequiredBranchFinancialAccount({
    companyId,
    branchId,
    mappingRole,
    transaction,
    modelSet: models,
  });
  const receivableAccount = await financialAccountResolver.resolveRequiredBranchFinancialAccount({
    companyId,
    branchId,
    mappingRole: "ACCOUNTS_RECEIVABLE",
    transaction,
    modelSet: models,
  });

  const lines = await models.JournalLine.findAll({
    where: { journalEntryId: originalJournal.id },
    transaction,
    lock: lockFor(transaction, models.JournalLine),
  });
  if (lines.length !== 2) fail("INSTALLMENT_PRECISION_STRUCTURAL_DEFECT", "The original Journal does not have exactly two posting lines.");

  const debitUnits = lines.reduce((sum, line) => sum + exactUnits(line.debit, "JournalLine.debit"), 0n);
  const creditUnits = lines.reduce((sum, line) => sum + exactUnits(line.credit, "JournalLine.credit"), 0n);
  if (debitUnits <= 0n || debitUnits !== creditUnits || exactUnits(originalJournal.totalDebit, "Journal.totalDebit") !== debitUnits || exactUnits(originalJournal.totalCredit, "Journal.totalCredit") !== creditUnits) {
    fail("INSTALLMENT_PRECISION_STRUCTURAL_DEFECT", "The original Journal is not exactly balanced.");
  }

  const cashLine = lines.find((line) => String(line.accountId) === String(treasuryAccount.id));
  const arLine = lines.find((line) => String(line.accountId) === String(receivableAccount.id));
  if (!cashLine || !arLine || lines.some((line) => line !== cashLine && line !== arLine)) {
    fail("INSTALLMENT_PRECISION_MAPPING_INVALID", "The original Journal does not resolve exactly to the mapped Treasury and AR accounts.");
  }

  const cashDebit = exactUnits(cashLine.debit, "JournalLine.debit");
  const cashCredit = exactUnits(cashLine.credit, "JournalLine.credit");
  const arDebit = exactUnits(arLine.debit, "JournalLine.debit");
  const arCredit = exactUnits(arLine.credit, "JournalLine.credit");
  if (cashDebit <= 0n || cashCredit !== 0n || arDebit !== 0n || arCredit <= 0n || cashDebit !== arCredit) {
    fail("INSTALLMENT_PRECISION_STRUCTURAL_DEFECT", "The original Journal has an unexpected posting direction or amount.");
  }

  const deltaUnits = cashDebit - treasuryUnits;
  const arDeltaUnits = arCredit - paymentUnits;
  // A cent-rounding representation delta must be positive and strictly below
  // one cent. Larger or opposite-sign differences require a separate owner
  // decision and cannot be silently remediated by this workflow.
  if (deltaUnits <= 0n || deltaUnits >= 100n || deltaUnits !== arDeltaUnits) {
    fail("INSTALLMENT_PRECISION_NOT_ELIGIBLE", "The source is exact or has a non-precision accounting defect.");
  }

  const correctionAmount = fromUnits(deltaUnits);
  const correctionJournal = await postingService.postEntry(
    companyId,
    {
      description: `Installment precision remediation for ${payment.id}`,
      date: originalJournal.date,
      sourceType: REMEDIATION_SOURCE_TYPE,
      sourceId: payment.id,
      postedBy: actor.name || "System",
      transaction,
      branchId,
      precision: 4,
    },
    [
      { accountId: receivableAccount.id, debit: correctionAmount, credit: 0, description: "Restore exact installment AR representation" },
      { accountId: treasuryAccount.id, debit: 0, credit: correctionAmount, description: "Correct rounded installment cash/bank representation" },
    ],
  );

  await auditService.record(companyId, {
    action: "installment_precision_remediation",
    description: "Corrected a source-linked installment Journal precision representation.",
    user: actor.name || "System",
    userId: actor.id || null,
    place: branchId,
    branch: branchId,
    sourceDocument: payment.id,
    severity: "info",
    after: JSON.stringify({
      sourceType: REMEDIATION_SOURCE_TYPE,
      sourceId: payment.id,
      correctionAmount,
      treasuryAccount: accountKey,
      treasuryDelta: "0.0000",
      journalEntryId: correctionJournal.id,
      reason: "installment precision remediation",
    }),
  }, { transaction });

  return {
    sourceType: REMEDIATION_SOURCE_TYPE,
    sourceId: payment.id,
    journalEntryId: correctionJournal.id,
    correctionAmount,
    treasuryAccount: accountKey,
    branchId,
    treasuryDelta: "0.0000",
  };
}

module.exports = {
  REMEDIATION_SOURCE_TYPE,
  exactUnits,
  fromUnits,
  remediateInstallmentPrecision,
};
