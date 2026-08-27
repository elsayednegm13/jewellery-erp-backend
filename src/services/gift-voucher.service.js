"use strict";

const crypto = require("crypto");
const Decimal = require("decimal.js");
const { Op } = require("sequelize");
const financialAccountResolver = require("./financial-account-resolver.service");
const postingService = require("./posting.service");
const auditService = require("./audit.service");
const { AppError, ValidationError } = require("../utils/errors");

const PURCHASED_FUNDING_SOURCE = "PURCHASED";
const PURCHASED_VOUCHER_TYPE = "PURCHASED_GIFT_VOUCHER";
const GIFT_VOUCHER_PAYMENT_METHOD = "gift_voucher";
const GIFT_VOUCHER_LIABILITY_ROLE = "GIFT_VOUCHER_LIABILITY";
const MONEY_DECIMALS = 4;

function fail(message, errorCode, status = 422) {
  return new AppError(message, status, errorCode);
}

function positiveMoney(value, field) {
  let amount;
  try { amount = new Decimal(value); } catch { throw new ValidationError(`${field} must be a valid amount.`); }
  if (!amount.isFinite() || !amount.greaterThan(0) || amount.decimalPlaces() > MONEY_DECIMALS) {
    throw new ValidationError(`${field} must be a positive amount with at most ${MONEY_DECIMALS} decimal places.`);
  }
  return amount.toDecimalPlaces(MONEY_DECIMALS);
}

function exactMoney(value) {
  return new Decimal(value || 0).toDecimalPlaces(MONEY_DECIMALS);
}

function moneyEqual(left, right) {
  return exactMoney(left).equals(exactMoney(right));
}

function normalizeVoucherCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code || code.length > 128 || !/^[A-Z0-9][A-Z0-9-]*$/.test(code)) {
    throw new ValidationError("A valid Gift Voucher code is required.");
  }
  return code;
}

function normalizeBranchEligibility(input = {}) {
  const mode = String(input.branchEligibilityMode || "ALL_BRANCHES").trim().toUpperCase();
  if (!["ALL_BRANCHES", "SELECTED_BRANCHES"].includes(mode)) {
    throw new ValidationError("branchEligibilityMode must be ALL_BRANCHES or SELECTED_BRANCHES.");
  }
  const branchIds = Array.isArray(input.eligibleBranchIds)
    ? [...new Set(input.eligibleBranchIds.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  if (mode === "ALL_BRANCHES" && branchIds.length) {
    throw new ValidationError("eligibleBranchIds is only valid for SELECTED_BRANCHES.");
  }
  if (mode === "SELECTED_BRANCHES" && !branchIds.length) {
    throw new ValidationError("SELECTED_BRANCHES requires at least one eligible Branch.");
  }
  return { mode, branchIds };
}

function normalizeIssuePaymentMethod(value) {
  const paymentMethod = String(value || "").trim().toLowerCase();
  if (paymentMethod === "cash") return { paymentMethod, treasuryMappingRole: "CASH_TREASURY", cashAccount: "cash" };
  if (["card", "transfer", "bank"].includes(paymentMethod)) return { paymentMethod, treasuryMappingRole: "BANK_ACCOUNT", cashAccount: "bank" };
  throw new ValidationError("Gift Voucher issue paymentMethod must be cash, card, transfer, or bank.");
}

function canonicalPaymentMethod(value) {
  const method = String(value || "").trim().toLowerCase();
  if (!["cash", "card", "transfer"].includes(method)) {
    throw new ValidationError("The non-voucher part of a Gift Voucher split may use only cash, card, or transfer.");
  }
  return method;
}

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function allocateVoucherIdentity(models, transaction) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    const voucherCode = `GV-${suffix}`;
    const voucherNumber = `GVN-${suffix}`;
    const existing = await models.GiftVoucher.findOne({
      where: { [Op.or]: [{ voucherCode }, { voucherNumber }] },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!existing) return { voucherCode, voucherNumber };
  }
  throw fail("Unable to allocate a unique Gift Voucher identity.", "GIFT_VOUCHER_IDENTITY_ALLOCATION_FAILED", 409);
}

function assertPurchasedVoucher(voucher) {
  if (!voucher || voucher.fundingSource !== PURCHASED_FUNDING_SOURCE || voucher.voucherType !== PURCHASED_VOUCHER_TYPE) {
    throw fail("This Gift Voucher funding source is not enabled.", "GIFT_VOUCHER_FUNDING_SOURCE_NOT_ENABLED");
  }
}

async function assertSelectedBranches({ models, companyId, branchIds, transaction }) {
  const rows = await models.Branch.findAll({
    where: { id: branchIds, companyId, isActive: true },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (rows.length !== branchIds.length) {
    throw fail("One or more selected Gift Voucher branches are invalid.", "GIFT_VOUCHER_BRANCH_ELIGIBILITY_INVALID");
  }
}

async function issuePurchasedVoucher({ models, companyId, branch, actor, input, currency, idempotencyKey, transaction }) {
  const faceValue = positiveMoney(input.faceValue, "faceValue");
  const payment = normalizeIssuePaymentMethod(input.paymentMethod);
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    throw fail("Company currency is not configured for Gift Voucher issuance.", "GIFT_VOUCHER_CURRENCY_NOT_CONFIGURED");
  }
  const eligibility = normalizeBranchEligibility(input);
  if (eligibility.mode === "SELECTED_BRANCHES") {
    await assertSelectedBranches({ models, companyId, branchIds: eligibility.branchIds, transaction });
  }

  let customer = null;
  if (input.customerId) {
    customer = await models.Customer.findOne({
      where: { id: String(input.customerId), companyId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!customer) throw fail("The selected customer is invalid for the active Company.", "GIFT_VOUCHER_CUSTOMER_SCOPE_INVALID");
  }

  const [treasuryAccount, liabilityAccount, identity] = await Promise.all([
    financialAccountResolver.resolveRequiredBranchFinancialAccount({ companyId, branchId: branch.id, mappingRole: payment.treasuryMappingRole, transaction, modelSet: models }),
    financialAccountResolver.resolveRequiredSemanticAccount({ companyId, branchId: branch.id, roleCode: GIFT_VOUCHER_LIABILITY_ROLE, transaction, modelSet: models }),
    allocateVoucherIdentity(models, transaction),
  ]);
  const issuedAt = new Date();
  const voucher = await models.GiftVoucher.create({
    id: newId("GV"),
    companyId,
    issueBranchId: branch.id,
    voucherNumber: identity.voucherNumber,
    voucherCode: identity.voucherCode,
    voucherType: PURCHASED_VOUCHER_TYPE,
    fundingSource: PURCHASED_FUNDING_SOURCE,
    faceValue: faceValue.toFixed(MONEY_DECIMALS),
    currency: normalizedCurrency,
    status: "issued",
    branchEligibilityMode: eligibility.mode,
    customerId: customer?.id || null,
    issuedAt,
    issuedByUserId: actor.technicalUserId || null,
    issuedByEmployeeId: actor.employeeId || null,
  }, { transaction });

  if (eligibility.mode === "SELECTED_BRANCHES") {
    await models.GiftVoucherBranchEligibility.bulkCreate(
      eligibility.branchIds.map((branchId) => ({ voucherId: voucher.id, branchId })),
      { transaction }
    );
  }

  const journal = await postingService.postEntry(companyId, {
    description: `إصدار قسيمة هدية ${voucher.voucherCode}`,
    sourceType: "gift_voucher_issue",
    sourceId: voucher.id,
    postedBy: actor.employeeName || actor.technicalUserName || "System",
    transaction,
    branchId: branch.id,
    // Face value is stored at four decimal places. Preserve that exact amount
    // in the purchased-voucher liability journal rather than letting the
    // generic cent-rounded posting default silently discard a sub-cent value.
    precision: MONEY_DECIMALS,
  }, [
    { accountId: treasuryAccount.id, debit: faceValue.toFixed(MONEY_DECIMALS), credit: 0, description: "تحصيل شراء قسيمة هدية" },
    { accountId: liabilityAccount.id, debit: 0, credit: faceValue.toFixed(MONEY_DECIMALS), description: "التزام قسيمة هدية" },
  ]);

  const cashTransaction = await models.CashTransaction.create({
    id: newId("TX"),
    companyId,
    branchId: branch.id,
    branch: branch.name,
    type: "cash_in",
    account: payment.cashAccount,
    amount: faceValue.toFixed(MONEY_DECIMALS),
    category: "Gift Voucher Purchase",
    description: `Gift Voucher purchase ${voucher.voucherCode}`,
    reference: voucher.id,
    date: issuedAt.toISOString().slice(0, 10),
    status: "posted",
    createdBy: actor.technicalUserId || "System",
    journalEntryId: journal.id,
    idempotencyKey: String(idempotencyKey),
  }, { transaction });

  await auditService.record(companyId, {
    action: "gift_voucher.issued",
    description: `Issued purchased Gift Voucher ${voucher.voucherCode}`,
    place: branch.name,
    branch: branch.name,
    sourceDocument: "gift_voucher",
    severity: "info",
    before: null,
    after: JSON.stringify({ voucherId: voucher.id, voucherCode: voucher.voucherCode, faceValue: voucher.faceValue, currency: voucher.currency, journalEntryId: journal.id, cashTransactionId: cashTransaction.id }),
    technicalUserId: actor.technicalUserId || null,
    employeeId: actor.employeeId || null,
    employeeCodeSnapshot: actor.employeeCode || null,
    employeeNameSnapshot: actor.employeeName || null,
    requiredPermission: "treasury.update + sales.create",
    requestedOperation: "gift_voucher.issue",
    authorizationResult: "allowed",
  }, { transaction });

  return { voucher: voucher.toJSON(), journal, cashTransaction };
}

async function activateVoucher({ models, companyId, branch, actor, voucherCode, transaction }) {
  const voucher = await models.GiftVoucher.findOne({
    where: { companyId, voucherCode: normalizeVoucherCode(voucherCode) },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!voucher) throw fail("Gift Voucher was not found.", "GIFT_VOUCHER_NOT_FOUND", 404);
  assertPurchasedVoucher(voucher);
  if (voucher.status !== "issued") {
    throw fail("Only an issued Gift Voucher can be activated.", "GIFT_VOUCHER_ACTIVATION_STATE_INVALID", 409);
  }
  await voucher.update({
    status: "active",
    activatedAt: new Date(),
    activatedByUserId: actor.technicalUserId || null,
    activatedByEmployeeId: actor.employeeId || null,
  }, { transaction });
  await auditService.record(companyId, {
    action: "gift_voucher.activated",
    description: `Activated Gift Voucher ${voucher.voucherCode}`,
    place: branch.name,
    branch: branch.name,
    sourceDocument: "gift_voucher",
    severity: "info",
    before: JSON.stringify({ status: "issued" }),
    after: JSON.stringify({ voucherId: voucher.id, status: "active" }),
    technicalUserId: actor.technicalUserId || null,
    employeeId: actor.employeeId || null,
    employeeCodeSnapshot: actor.employeeCode || null,
    employeeNameSnapshot: actor.employeeName || null,
    requiredPermission: "sales.create",
    requestedOperation: "gift_voucher.activate",
    authorizationResult: "allowed",
  }, { transaction });
  return voucher.toJSON();
}

async function assertBranchEligibility({ models, voucher, branchId, transaction }) {
  if (voucher.branchEligibilityMode === "ALL_BRANCHES") return;
  if (voucher.branchEligibilityMode !== "SELECTED_BRANCHES") {
    throw fail("Gift Voucher branch eligibility is invalid.", "GIFT_VOUCHER_BRANCH_ELIGIBILITY_INVALID");
  }
  const match = await models.GiftVoucherBranchEligibility.findOne({
    where: { voucherId: voucher.id, branchId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!match) throw fail("Gift Voucher is not eligible in the operational Branch.", "GIFT_VOUCHER_BRANCH_INELIGIBLE");
}

async function prepareGiftVoucherSettlement({ models, companyId, branchId, currency, paymentMethod, paymentSplits, invoiceTotal, transaction }) {
  const rawSplits = Array.isArray(paymentSplits) ? paymentSplits : [];
  const voucherSplits = rawSplits.filter((split) => String(split?.method || "").trim().toLowerCase() === GIFT_VOUCHER_PAYMENT_METHOD);
  const hasVoucher = voucherSplits.length > 0;
  if (!hasVoucher) {
    if (String(paymentMethod || "").trim().toLowerCase() === GIFT_VOUCHER_PAYMENT_METHOD) {
      throw fail("Gift Voucher redemption must use canonical split settlement.", "GIFT_VOUCHER_CANONICAL_SPLIT_REQUIRED");
    }
    return { paymentSplits: rawSplits, voucherSettlements: [] };
  }
  if (String(paymentMethod || "").trim().toLowerCase() !== "split") {
    throw fail("Gift Voucher redemption must use canonical split settlement.", "GIFT_VOUCHER_CANONICAL_SPLIT_REQUIRED");
  }

  const invoiceAmount = positiveMoney(invoiceTotal, "invoiceTotal");
  const seen = new Set();
  const requested = voucherSplits.map((split) => {
    const voucherCode = normalizeVoucherCode(split?.voucherCode);
    if (seen.has(voucherCode)) throw fail("A Gift Voucher may only appear once in one settlement.", "GIFT_VOUCHER_DUPLICATE_IN_REQUEST");
    seen.add(voucherCode);
    return { voucherCode, requestedAmount: split?.amount };
  }).sort((left, right) => left.voucherCode.localeCompare(right.voucherCode));

  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const vouchers = [];
  for (const request of requested) {
    const voucher = await models.GiftVoucher.findOne({
      where: { voucherCode: request.voucherCode },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!voucher || String(voucher.companyId) !== String(companyId)) {
      throw fail("Gift Voucher is not available for this Company.", "GIFT_VOUCHER_SCOPE_INVALID");
    }
    assertPurchasedVoucher(voucher);
    if (voucher.status !== "active" || voucher.redeemedAt || voucher.redemptionPaymentId) {
      throw fail("Gift Voucher is not available for redemption.", "GIFT_VOUCHER_NOT_REDEEMABLE", 409);
    }
    if (voucher.currency !== normalizedCurrency) {
      throw fail("Gift Voucher currency does not match the Company currency.", "GIFT_VOUCHER_CURRENCY_MISMATCH");
    }
    await assertBranchEligibility({ models, voucher, branchId, transaction });
    const faceValue = positiveMoney(voucher.faceValue, "voucher.faceValue");
    if (request.requestedAmount !== undefined && request.requestedAmount !== null && request.requestedAmount !== "" && !moneyEqual(request.requestedAmount, faceValue)) {
      throw fail("Gift Voucher must be applied for its exact full face value.", "GIFT_VOUCHER_FULL_VALUE_REQUIRED");
    }
    vouchers.push({ voucher, faceValue });
  }

  const voucherTotal = vouchers.reduce((sum, item) => sum.plus(item.faceValue), new Decimal(0));
  if (voucherTotal.greaterThan(invoiceAmount)) {
    throw fail("Gift Voucher value cannot exceed the Sales Invoice total.", "GIFT_VOUCHER_VALUE_EXCEEDS_INVOICE_TOTAL");
  }

  const ordinarySplits = rawSplits
    .filter((split) => String(split?.method || "").trim().toLowerCase() !== GIFT_VOUCHER_PAYMENT_METHOD)
    .map((split) => ({
      method: canonicalPaymentMethod(split?.method),
      amount: positiveMoney(split?.amount, "payment split amount").toFixed(MONEY_DECIMALS),
      reference: split?.reference ? String(split.reference).trim() : "",
    }));
  const ordinaryTotal = ordinarySplits.reduce((sum, split) => sum.plus(split.amount), new Decimal(0));
  if (!ordinaryTotal.plus(voucherTotal).equals(invoiceAmount)) {
    throw fail("Gift Voucher and ordinary payment splits must equal the Sales Invoice total.", "GIFT_VOUCHER_SPLIT_TOTAL_MISMATCH");
  }

  const liabilityAccount = await financialAccountResolver.resolveRequiredSemanticAccount({
    companyId,
    branchId,
    roleCode: GIFT_VOUCHER_LIABILITY_ROLE,
    transaction,
    modelSet: models,
  });
  const canonicalVoucherSplits = vouchers.map(({ voucher, faceValue }) => ({
    method: GIFT_VOUCHER_PAYMENT_METHOD,
    amount: faceValue.toFixed(MONEY_DECIMALS),
    reference: voucher.voucherCode,
    voucherCode: voucher.voucherCode,
    giftVoucherId: voucher.id,
  }));
  return {
    paymentSplits: [...ordinarySplits, ...canonicalVoucherSplits],
    voucherSettlements: vouchers.map(({ voucher, faceValue }) => ({
      voucher,
      voucherId: voucher.id,
      voucherCode: voucher.voucherCode,
      amount: faceValue.toFixed(MONEY_DECIMALS),
      liabilityAccountId: liabilityAccount.id,
    })),
  };
}

async function completeGiftVoucherSettlement({ companyId, branch, actor, voucherSettlements, payments, invoice, transaction }) {
  if (!voucherSettlements?.length) return [];
  const paymentByVoucherId = new Map((payments || []).filter((payment) => payment.giftVoucherId).map((payment) => [payment.giftVoucherId, payment]));
  const completed = [];
  for (const settlement of voucherSettlements) {
    const payment = paymentByVoucherId.get(settlement.voucherId);
    if (!payment || !moneyEqual(payment.amount, settlement.amount)) {
      throw fail("Gift Voucher settlement payment linkage is incomplete.", "GIFT_VOUCHER_PAYMENT_LINKAGE_INVALID");
    }
    const voucher = settlement.voucher;
    await voucher.update({
      status: "redeemed",
      redeemedAt: new Date(),
      redeemedByUserId: actor.technicalUserId || null,
      redeemedByEmployeeId: actor.employeeId || null,
      redemptionInvoiceId: invoice.id,
      redemptionPaymentId: payment.id,
    }, { transaction });
    await auditService.record(companyId, {
      action: "gift_voucher.redeemed",
      description: `Redeemed Gift Voucher ${voucher.voucherCode} through Sales Invoice ${invoice.id}`,
      place: branch.name,
      branch: branch.name,
      sourceDocument: "invoice",
      severity: "info",
      before: JSON.stringify({ voucherId: voucher.id, status: "active" }),
      after: JSON.stringify({ voucherId: voucher.id, status: "redeemed", invoiceId: invoice.id, paymentId: payment.id, amount: settlement.amount }),
      technicalUserId: actor.technicalUserId || null,
      employeeId: actor.employeeId || null,
      employeeCodeSnapshot: actor.employeeCode || null,
      employeeNameSnapshot: actor.employeeName || null,
      requiredPermission: "pos.sell",
      requestedOperation: "pos.checkout",
      authorizationResult: "allowed",
    }, { transaction });
    completed.push(voucher.toJSON());
  }
  return completed;
}

async function recordPrintEvent({ models, companyId, branch, actor, voucherCode, transaction }) {
  const voucher = await models.GiftVoucher.findOne({
    where: { companyId, voucherCode: normalizeVoucherCode(voucherCode) },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!voucher) throw fail("Gift Voucher was not found.", "GIFT_VOUCHER_NOT_FOUND", 404);
  // The Voucher row is already locked above, serializing print/reprint events
  // for this identity. PostgreSQL cannot apply FOR UPDATE to an aggregate
  // COUNT query, so the event count itself must remain an ordinary read in
  // that protected transaction.
  const priorCount = await models.GiftVoucherPrintEvent.count({ where: { voucherId: voucher.id }, transaction });
  const event = await models.GiftVoucherPrintEvent.create({
    id: newId("GVPRINT"),
    voucherId: voucher.id,
    companyId,
    branchId: branch.id,
    technicalUserId: actor.technicalUserId || null,
    employeeId: actor.employeeId || null,
    printKind: priorCount === 0 ? "original" : "reprint",
    printedAt: new Date(),
  }, { transaction });
  await auditService.record(companyId, {
    action: "gift_voucher.print",
    description: `${event.printKind === "original" ? "Printed" : "Reprinted"} Gift Voucher ${voucher.voucherCode}`,
    place: branch.name,
    branch: branch.name,
    sourceDocument: "gift_voucher",
    severity: "info",
    before: null,
    after: JSON.stringify({ voucherId: voucher.id, voucherCode: voucher.voucherCode, printEventId: event.id, printKind: event.printKind }),
    technicalUserId: actor.technicalUserId || null,
    employeeId: actor.employeeId || null,
    employeeCodeSnapshot: actor.employeeCode || null,
    employeeNameSnapshot: actor.employeeName || null,
    requiredPermission: "sales.print",
    requestedOperation: "gift_voucher.print",
    authorizationResult: "allowed",
  }, { transaction });
  return { voucher: voucher.toJSON(), event: event.toJSON() };
}

module.exports = {
  PURCHASED_FUNDING_SOURCE,
  PURCHASED_VOUCHER_TYPE,
  GIFT_VOUCHER_PAYMENT_METHOD,
  GIFT_VOUCHER_LIABILITY_ROLE,
  MONEY_DECIMALS,
  positiveMoney,
  moneyEqual,
  normalizeVoucherCode,
  issuePurchasedVoucher,
  activateVoucher,
  prepareGiftVoucherSettlement,
  completeGiftVoucherSettlement,
  recordPrintEvent,
};
