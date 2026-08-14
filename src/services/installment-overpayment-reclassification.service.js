"use strict";

const customerCreditServiceDefault = require("./customer-credit.service");
const companyBootstrapService = require("./company-bootstrap.service");
const financialAccountResolver = require("./financial-account-resolver.service");
const auditServiceDefault = require("./audit.service");
const { AppError, NotFoundError, ValidationError } = require("../utils/errors");

const MONEY_SCALE = 10000n;
const MONEY_DECIMAL_15_4 = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

function moneyToTenThousandths(value) {
  const text = String(value ?? "").trim();
  if (!MONEY_DECIMAL_15_4.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * MONEY_SCALE + BigInt(`${fraction}0000`.slice(0, 4));
}

function moneyFromTenThousandths(units) {
  const value = BigInt(units);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / MONEY_SCALE}.${(absolute % MONEY_SCALE).toString().padStart(4, "0")}`;
}

function plain(row) {
  return row && typeof row.toJSON === "function" ? row.toJSON() : row;
}

function parseAuditAfter(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function defaultResolveAccounts({ companyId, branchId, transaction }) {
  const receivableAccount = await financialAccountResolver.resolvePostingAccount({
    companyId, branchId, accountCode: "1300", transaction,
  });
  const customerDepositAccount = await companyBootstrapService.resolveSystemAccountRole(
    companyId,
    branchId,
    companyBootstrapService.SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY,
    transaction,
  );
  return { receivableAccount, customerDepositAccount };
}

function lockFor(transaction, model) {
  return transaction ? { level: transaction.LOCK.UPDATE, of: model } : undefined;
}

/**
 * Reclassifies only the source-level overage of the payment that first drove an
 * installment over its exact scheduled amount. Original financial records are
 * read and locked but never updated; the new customer-credit row and its GL
 * journal are the sole financial effect.
 */
async function reclassifyInstallmentOverpayment({
  models,
  companyId,
  branchId,
  originalPaymentId,
  transaction,
  actor = {},
  customerCreditService = customerCreditServiceDefault,
  resolveAccounts = defaultResolveAccounts,
  auditService = auditServiceDefault,
}) {
  const paymentRow = await models.Payment.findOne({
    where: { id: originalPaymentId, companyId }, transaction,
    lock: lockFor(transaction, models.Payment),
  });
  if (!paymentRow) throw new NotFoundError("Installment collection event was not found.");
  const payment = plain(paymentRow);

  const invoiceRow = await models.Invoice.findOne({
    where: { id: payment.invoiceId, companyId }, transaction,
    lock: lockFor(transaction, models.Invoice),
  });
  if (!invoiceRow) throw new AppError("Collection invoice is unavailable.", 409, "OVERPAYMENT_SOURCE_INVOICE_INVALID");
  const invoice = plain(invoiceRow);
  if (!invoice.branchId || String(invoice.branchId) !== String(branchId) || String(payment.branchId || "") !== String(branchId)) {
    throw new AppError("Collection event is outside the active operational Branch.", 403, "OVERPAYMENT_SOURCE_BRANCH_INVALID");
  }

  const auditRows = await models.AuditLog.findAll({
    where: { companyId, action: "sales.installment.collect", sourceDocument: invoice.id }, transaction,
    lock: lockFor(transaction, models.AuditLog),
  });
  const auditEvents = auditRows.map(plain).map((row) => ({ row, after: parseAuditAfter(row.after) })).filter(({ after }) => after && after.installmentId && after.paymentId);
  const matchedAudit = auditEvents.filter(({ after }) => String(after.paymentId) === String(payment.id));
  if (matchedAudit.length !== 1) throw new AppError("Collection event cannot be deterministically linked to an installment.", 409, "OVERPAYMENT_SOURCE_AUDIT_AMBIGUOUS");
  const installmentId = matchedAudit[0].after.installmentId;

  const installmentRow = await models.Installment.findOne({
    where: { id: installmentId, companyId, invoiceId: invoice.id }, transaction,
    lock: lockFor(transaction, models.Installment),
  });
  if (!installmentRow) throw new AppError("Collection installment is unavailable.", 409, "OVERPAYMENT_SOURCE_INSTALLMENT_INVALID");
  const installment = plain(installmentRow);
  if (String(invoice.customerId || "") !== String(installment.customerId || "")) {
    throw new AppError("Collection customer linkage is inconsistent.", 409, "OVERPAYMENT_SOURCE_CUSTOMER_INVALID");
  }

  const customerRow = await models.Customer.findOne({
    where: { id: installment.customerId, companyId }, transaction,
    lock: lockFor(transaction, models.Customer),
  });
  if (!customerRow || plain(customerRow).status === "inactive") throw new AppError("Collection customer is unavailable.", 409, "OVERPAYMENT_SOURCE_CUSTOMER_INVALID");

  const paymentRows = await models.Payment.findAll({
    where: { companyId, invoiceId: invoice.id }, transaction,
    lock: lockFor(transaction, models.Payment),
  });
  const paymentsById = new Map(paymentRows.map(plain).map((row) => [String(row.id), row]));
  const linkedPayments = [];
  const seenPaymentIds = new Set();
  for (const { after } of auditEvents) {
    if (String(after.installmentId) !== String(installment.id) || seenPaymentIds.has(String(after.paymentId))) continue;
    const linked = paymentsById.get(String(after.paymentId));
    if (!linked) throw new AppError("Collection payment linkage is inconsistent.", 409, "OVERPAYMENT_SOURCE_PAYMENT_INVALID");
    seenPaymentIds.add(String(linked.id));
    linkedPayments.push(linked);
  }
  linkedPayments.sort((left, right) => String(left.createdAt || left.created_at || "").localeCompare(String(right.createdAt || right.created_at || "")) || String(left.id).localeCompare(String(right.id)));
  if (linkedPayments.length === 0) throw new AppError("Collection history is unavailable.", 409, "OVERPAYMENT_SOURCE_LEDGER_AMBIGUOUS");

  const scheduledUnits = moneyToTenThousandths(installment.amount);
  const recordedPaidUnits = moneyToTenThousandths(installment.paidAmount);
  if (scheduledUnits === null || recordedPaidUnits === null || scheduledUnits <= 0n) {
    throw new ValidationError("The selected collection has no remediable overage.");
  }

  let cumulativeUnits = 0n;
  let crossingPayment = null;
  for (const linked of linkedPayments) {
    const units = moneyToTenThousandths(linked.amount);
    if (units === null || units <= 0n) throw new AppError("Collection history contains an invalid monetary amount.", 409, "OVERPAYMENT_SOURCE_LEDGER_AMBIGUOUS");
    const before = cumulativeUnits;
    cumulativeUnits += units;
    if (!crossingPayment && before <= scheduledUnits && cumulativeUnits > scheduledUnits) crossingPayment = linked;
  }
  if (!crossingPayment || String(crossingPayment.id) !== String(payment.id)) {
    throw new AppError("The requested collection is not the authoritative overpayment source.", 422, "OVERPAYMENT_SOURCE_PAYMENT_INVALID");
  }
  const overageUnits = recordedPaidUnits - scheduledUnits;
  const sourceOverageUnits = cumulativeUnits - scheduledUnits;
  if (sourceOverageUnits <= 0n) {
    throw new ValidationError("The selected collection has no remediable overage.");
  }

  const originalJournal = await models.JournalEntry.findOne({
    where: { companyId, sourceType: "installment_collection", sourceId: payment.id }, transaction,
    lock: lockFor(transaction, models.JournalEntry),
  });
  const originalTreasury = originalJournal ? await models.CashTransaction.findOne({
    where: { companyId, journalEntryId: plain(originalJournal).id }, transaction,
    lock: lockFor(transaction, models.CashTransaction),
  }) : null;
  if (!originalJournal || !originalTreasury) throw new AppError("Original collection financial linkage is incomplete.", 409, "OVERPAYMENT_SOURCE_FINANCIAL_LINK_INVALID");

  const existing = await models.CustomerCreditTransaction.findOne({
    where: { companyId, sourceType: "overpayment", sourceId: payment.id, status: "active" }, transaction,
    lock: lockFor(transaction, models.CustomerCreditTransaction),
  });
  if (existing) {
    // A former version could create the correct credit event while leaving the
    // installment's derived applied total above its collectible amount. Repair
    // only that derived state on an idempotent replay; no original payment,
    // Treasury, journal, or credit row is changed or duplicated.
    const existingAmount = moneyToTenThousandths(plain(existing).amount);
    if (existingAmount === null || existingAmount !== sourceOverageUnits) {
      throw new AppError("Existing overpayment reclassification is inconsistent.", 409, "OVERPAYMENT_RECLASSIFICATION_CONFLICT");
    }
    if (recordedPaidUnits !== scheduledUnits) {
      await installmentRow.update({ paidAmount: moneyFromTenThousandths(scheduledUnits), status: "paid" }, { transaction });
    }
    return { creditRow: plain(existing), overageAmount: moneyFromTenThousandths(sourceOverageUnits), originalPaymentId: payment.id, originalInstallmentId: installment.id, originalInvoiceId: invoice.id, replayed: true };
  }
  if (recordedPaidUnits !== cumulativeUnits || recordedPaidUnits <= scheduledUnits || overageUnits !== sourceOverageUnits) {
    throw new AppError("Collection history does not match the pre-remediation installment state.", 409, "OVERPAYMENT_SOURCE_LEDGER_AMBIGUOUS");
  }

  const { receivableAccount, customerDepositAccount } = await resolveAccounts({ companyId, branchId, transaction });
  if (!receivableAccount || !customerDepositAccount) throw new AppError("Required financial accounts are unavailable.", 422, "OVERPAYMENT_RECLASSIFICATION_ACCOUNT_INVALID");
  const overageAmount = moneyFromTenThousandths(overageUnits);
  const creditRow = await customerCreditService.recordCreditIn({
    models,
    companyId,
    customerId: installment.customerId,
    branchId,
    amount: overageAmount,
    exactMoney: true,
    sourceType: "overpayment",
    sourceId: payment.id,
    cashTransactionId: null,
    invoiceId: invoice.id,
    description: "Installment collection overpayment reclassified to customer credit",
    createdBy: actor.id || null,
    metadata: { remediationKind: "installment_overpayment_reclassification", originalPaymentId: payment.id, originalInstallmentId: installment.id, originalInvoiceId: invoice.id },
    transaction,
    glPosting: {
      enabled: true,
      precision: 4,
      sourceType: "installment_overpayment_reclassification",
      debitAccountId: receivableAccount.id,
      creditAccountId: customerDepositAccount.id,
      customerDepositAccountId: customerDepositAccount.id,
      description: "Installment overpayment customer-credit reclassification",
      postedBy: actor.name || "System",
    },
  });

  // Payment records remain immutable. `paidAmount` is the installment's
  // derived amount applied to its receivable, so its supported postcondition is
  // the scheduled collectible amount once the excess becomes customer credit.
  await installmentRow.update({ paidAmount: moneyFromTenThousandths(scheduledUnits), status: "paid" }, { transaction });

  await auditService.record(companyId, {
    action: "installment_overpayment_reclassified",
    description: "Installment collection overpayment reclassified to customer credit",
    user: actor.name || "System",
    userId: actor.id || null,
    place: branchId,
    branch: branchId,
    sourceDocument: payment.id,
    severity: "info",
    after: JSON.stringify({ originalPaymentId: payment.id, installmentId: installment.id, invoiceId: invoice.id, customerCreditTransactionId: plain(creditRow).id, journalEntryId: plain(creditRow).journalEntryId, overageAmount }),
  }, { transaction });

  return { creditRow: plain(creditRow), overageAmount, originalPaymentId: payment.id, originalInstallmentId: installment.id, originalInvoiceId: invoice.id };
}

module.exports = { reclassifyInstallmentOverpayment, moneyToTenThousandths, moneyFromTenThousandths };
