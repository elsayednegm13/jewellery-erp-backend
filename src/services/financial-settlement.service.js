"use strict";

// Generic Accounting/Treasury settlement authority.  CGP supplies a recognised
// customer liability; it does not own the payment journal, Treasury movement,
// policy decision, or sub-ledger allocation.
const Decimal = require("decimal.js");
const { v4: uuid } = require("uuid");
const models = require("../models");
const { AppError } = require("../utils/errors");
const posting = require("./posting.service");
const idempotency = require("./idempotency.service");
const audit = require("./audit.service");
const resolver = require("./financial-account-resolver.service");
const cashRegisterService = require("./cash-register.service");

const OPERATION_TYPE = "CUSTOMER_PAYOUT";
const IDEMPOTENCY_SCOPE = "financial-settlement:v1";
const SOURCE_TYPE = "FINANCIAL_SETTLEMENT";
const METHODS = new Set(["CASH", "BANK_TRANSFER"]);

function fail(message, code, status = 422) { throw new AppError(message, status, code); }
function fixed(value) {
  try {
    const amount = new Decimal(value);
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 4) throw new Error();
    return amount;
  } catch { fail("Settlement amount must be a positive decimal with at most four places.", "FINANCIAL_SETTLEMENT_AMOUNT_INVALID"); }
}
function normalizedLegs(input = {}) {
  if (!Array.isArray(input.legs) || !input.legs.length || input.legs.length > 2) fail("Settlement legs are invalid.", "FINANCIAL_SETTLEMENT_LEGS_INVALID");
  const legs = input.legs.map((leg) => {
    const method = String(leg?.method || "").trim().toUpperCase();
    if (!METHODS.has(method)) fail("Settlement method is invalid.", "FINANCIAL_SETTLEMENT_METHOD_INVALID");
    const amount = fixed(leg.amount);
    const bankReference = leg.bankReference == null ? null : String(leg.bankReference).trim();
    if (method === "BANK_TRANSFER" && !bankReference) fail("Bank settlement requires a bank reference.", "FINANCIAL_SETTLEMENT_BANK_REFERENCE_REQUIRED");
    return { method, amount, bankReference: bankReference || null };
  });
  if (new Set(legs.map((leg) => leg.method)).size !== legs.length) fail("Settlement may contain one leg per payment method.", "FINANCIAL_SETTLEMENT_LEGS_INVALID");
  return legs;
}
function settlementHash({ liabilityId, legs, idempotencyKey }) {
  return idempotency.hashRequest(IDEMPOTENCY_SCOPE, {
    liabilityId,
    legs: legs.map((leg) => ({ method: leg.method, amount: leg.amount.toFixed(4), bankReference: leg.bankReference })),
    idempotencyKey,
  });
}
function statusFor(liability, amount) {
  const original = new Decimal(liability.originalAmount);
  const settled = new Decimal(liability.settledAmount).plus(amount);
  return settled.eq(original) ? "SETTLED" : "PARTIALLY_SETTLED";
}
function maybeFail(input, stage) {
  if (input.failureStage === stage) throw new Error(`FINANCIAL_SETTLEMENT_INJECTED_FAILURE:${stage}`);
}

async function executeCustomerPayoutSettlement({ context, input, modelSet = models }) {
  if (!context?.companyId || !context?.branchId || !context?.actorId) fail("Settlement context is invalid.", "FINANCIAL_SETTLEMENT_CONTEXT_REQUIRED");
  if (!input?.liabilityId || !input?.idempotencyKey) fail("Settlement request is invalid.", "FINANCIAL_SETTLEMENT_REQUEST_INVALID");
  const legs = normalizedLegs(input);
  const total = legs.reduce((sum, leg) => sum.plus(leg.amount), new Decimal(0));
  const paymentMethod = legs.length === 2 ? "MIXED" : legs[0].method;
  const requestHash = settlementHash({ liabilityId: String(input.liabilityId), legs, idempotencyKey: String(input.idempotencyKey) });

  try {
    return await modelSet.sequelize.transaction(async (transaction) => {
      const liability = await modelSet.CustomerFinancialLiability.findOne({ where: { id: String(input.liabilityId), companyId: context.companyId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!liability) fail("Customer financial liability was not found.", "CUSTOMER_FINANCIAL_LIABILITY_NOT_FOUND", 404);
      if (liability.branchId !== context.branchId) fail("Settlement branch does not match the recognised liability.", "BRANCH_CONTEXT_REQUIRED");
      const existing = await modelSet.IdempotencyRequest.findOne({ where: { companyId: context.companyId, scope: IDEMPOTENCY_SCOPE, key: String(input.idempotencyKey) }, transaction, lock: transaction.LOCK.KEY_SHARE });
      if (existing) {
        if (existing.requestHash !== requestHash) fail("Idempotency key was already used for a different settlement.", "IDEMPOTENCY_KEY_CONFLICT", 409);
        if (existing.status === "succeeded") return { ...existing.responseBody, replayed: true };
        fail("Equivalent settlement is already processing.", "IDEMPOTENCY_REQUEST_IN_PROGRESS", 409);
      }
      if (String(liability.currency).toUpperCase() !== "AED") fail("Settlement currency must match the recognised liability currency.", "FINANCIAL_SETTLEMENT_CURRENCY_INVALID");
      if (!new Decimal(liability.outstandingAmount).gt(0) || !["OPEN", "PARTIALLY_SETTLED"].includes(liability.status)) fail("Customer financial liability is not open for settlement.", "CUSTOMER_FINANCIAL_LIABILITY_NOT_OPEN", 409);
      if (total.gt(new Decimal(liability.outstandingAmount))) fail("Settlement exceeds the current outstanding customer liability.", "CUSTOMER_FINANCIAL_LIABILITY_OVERSETTLEMENT", 409);

      const claim = await idempotency.claim({ models: modelSet, companyId: context.companyId, scope: IDEMPOTENCY_SCOPE, key: String(input.idempotencyKey), requestHash, transaction });
      if (!claim.claimed) fail("Equivalent settlement is already processing.", "IDEMPOTENCY_REQUEST_IN_PROGRESS", 409);
      maybeFail(input, "AFTER_IDEMPOTENCY_CLAIM");

      const creditor = await resolver.resolveRequiredSemanticAccount({ companyId: context.companyId, branchId: context.branchId, roleCode: "CUSTOMER_CREDITOR", transaction, modelSet });
      const cash = legs.some((leg) => leg.method === "CASH") ? await resolver.resolveRequiredSemanticAccount({ companyId: context.companyId, branchId: context.branchId, roleCode: "CASH_TREASURY", transaction, modelSet }) : null;
      const bank = legs.some((leg) => leg.method === "BANK_TRANSFER") ? await resolver.resolveRequiredSemanticAccount({ companyId: context.companyId, branchId: context.branchId, roleCode: "BANK_ACCOUNT", transaction, modelSet }) : null;
      const branch = await modelSet.Branch.findOne({ where: { id: context.branchId, companyId: context.companyId, isActive: true }, transaction, lock: transaction.LOCK.KEY_SHARE });
      if (!branch) fail("Settlement branch is invalid.", "BRANCH_CONTEXT_REQUIRED");
      const cashSession = cash ? await modelSet.CashRegisterSession.findOne({ where: { companyId: context.companyId, branchId: context.branchId, status: "OPEN" }, transaction, lock: transaction.LOCK.UPDATE }) : null;
      if (cash && !cashSession) fail("An open cash session is required for cash payout.", "CASH_SESSION_REQUIRED");
      if (cash && cashSession) {
        // The session row is locked before deriving available cash. This makes
        // concurrent payouts serialize on the same canonical cash session and
        // prevents two requests from spending the same pre-payout balance.
        const available = await cashRegisterService.calculateExpectedDecimal(cashSession, { transaction });
        const cashLeg = legs.find((leg) => leg.method === "CASH");
        if (cashLeg && available.lt(cashLeg.amount)) {
          fail("رصيد الخزنة غير كافٍ لإتمام عملية الصرف.", "INSUFFICIENT_CASH_BALANCE", 409);
        }
      }
      maybeFail(input, "BEFORE_JOURNAL");

      const settlementId = `FST-${uuid()}`;
      const journal = await posting.postEntry(context.companyId, {
        id: `JE-${settlementId}`,
        branchId: context.branchId,
        sourceType: SOURCE_TYPE,
        sourceId: settlementId,
        postedBy: context.actorId,
        precision: 4,
        transaction,
        description: "Customer payout settlement",
      }, [
        { accountId: creditor.id, debit: total.toFixed(4), credit: "0.0000", description: "Settlement of customer creditor" },
        ...legs.map((leg) => ({ accountId: leg.method === "CASH" ? cash.id : bank.id, debit: "0.0000", credit: leg.amount.toFixed(4), description: leg.method === "CASH" ? "Cash customer payout" : "Bank customer payout" })),
      ]);
      maybeFail(input, "AFTER_JOURNAL");

      const settlement = await modelSet.FinancialSettlement.create({
        id: settlementId, companyId: context.companyId, branchId: context.branchId, customerId: liability.customerId,
        operationType: OPERATION_TYPE, sourceType: liability.sourceType, sourceDocumentId: liability.sourceDocumentId,
        currency: liability.currency, totalAmount: total.toFixed(4), status: "EXECUTED", approvalPolicyId: null,
        approvalPolicyVersion: null, approvalDecisionSnapshot: {
          decision: "PERMISSION_BASED_NO_FINANCIAL_APPROVAL",
          operationType: OPERATION_TYPE,
          companyId: context.companyId,
          branchId: context.branchId,
          currency: liability.currency,
          paymentMethod,
          amount: total.toFixed(4),
          evaluatedAt: new Date().toISOString(),
        }, approvalRequestId: null,
        journalEntryId: journal.id, idempotencyKey: String(input.idempotencyKey), requestHash,
        correlationId: liability.correlationId, causationId: liability.sourceEventId, executedAt: new Date(), executedBy: context.actorId,
        metadata: { testMarker: input.testMarker || null },
      }, { transaction });
      const persistedLegs = [];
      for (const leg of legs) {
        const treasury = await modelSet.CashTransaction.create({
          id: `CT-${uuid()}`, companyId: context.companyId, type: "cash_out", account: leg.method === "CASH" ? "cash" : "bank",
          amount: leg.amount.toFixed(4), category: "customer_payout_settlement", description: "Customer payout settlement",
          reference: settlementId, branch: branch.name || branch.nameAr || context.branchId, branchId: context.branchId,
          date: new Date().toISOString().slice(0, 10), createdBy: context.actorId, status: "posted", journalEntryId: journal.id,
          idempotencyKey: `${input.idempotencyKey}:${leg.method}`,
        }, { transaction });
        persistedLegs.push(await modelSet.FinancialSettlementLeg.create({
          id: `FSL-${uuid()}`, settlementId, method: leg.method, amount: leg.amount.toFixed(4),
          accountId: leg.method === "CASH" ? cash.id : bank.id, cashRegisterSessionId: leg.method === "CASH" ? cashSession.id : null,
          bankReference: leg.bankReference, cashTransactionId: treasury.id,
        }, { transaction }));
        maybeFail(input, leg.method === "CASH" ? "AFTER_FIRST_TREASURY_LEG" : "AFTER_BANK_TREASURY_LEG");
      }
      await modelSet.FinancialSettlementAllocation.create({ id: `FSA-${uuid()}`, settlementId, customerFinancialLiabilityId: liability.id, amount: total.toFixed(4) }, { transaction });
      maybeFail(input, "AFTER_ALLOCATION");
      const settled = new Decimal(liability.settledAmount).plus(total);
      await liability.update({ outstandingAmount: new Decimal(liability.outstandingAmount).minus(total).toFixed(4), settledAmount: settled.toFixed(4), status: statusFor(liability, total) }, { transaction });
      maybeFail(input, "AFTER_LIABILITY_UPDATE");
      const response = { settlementId, journalEntryId: journal.id, liabilityId: liability.id, totalAmount: total.toFixed(4), liabilityStatus: liability.status, legIds: persistedLegs.map((leg) => leg.id) };
      await idempotency.succeed({ request: claim.request, statusCode: 201, responseBody: response, transaction });
      await audit.record(context.companyId, audit.attachDualAuditActor({ action: "FINANCIAL_SETTLEMENT_EXECUTED", description: "Customer payout settlement executed", branch: context.branchId, after: JSON.stringify({ settlementId, liabilityId: liability.id, totalAmount: total.toFixed(4), journalEntryId: journal.id }) }, context.actorContext || { technicalUserId: context.actorId }), { transaction });
      return response;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const verdict = await idempotency.resolveExisting({ models: modelSet, companyId: context.companyId, scope: IDEMPOTENCY_SCOPE, key: String(input.idempotencyKey), requestHash });
    if (verdict.state === "replay") return { ...verdict.responseBody, replayed: true };
    throw error;
  }
}

module.exports = { OPERATION_TYPE, IDEMPOTENCY_SCOPE, executeCustomerPayoutSettlement };
