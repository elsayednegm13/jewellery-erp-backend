"use strict";

const crypto = require("crypto");
const Decimal = require("decimal.js");
const { Op } = require("sequelize");
const { AppError } = require("../utils/errors");
const idempotency = require("./idempotency.service");
const audit = require("./audit.service");
const permissionService = require("./permission.service");

const DECISION = Object.freeze({
  APPROVAL_NOT_REQUIRED: "APPROVAL_NOT_REQUIRED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  POLICY_CONFIGURATION_MISSING: "POLICY_CONFIGURATION_MISSING",
  POLICY_CONFIGURATION_AMBIGUOUS: "POLICY_CONFIGURATION_AMBIGUOUS",
  INVALID_CONTEXT: "INVALID_CONTEXT",
});
const FINANCIAL_OPERATION_TYPE = "financial-operation";
const FUTURE_IMP09_OPERATION_TYPE = "CUSTOMER_PAYOUT";
const REQUEST_SCOPE = "financial-approval-request:v1";

const asTrimmed = (value) => typeof value === "string" ? value.trim() : "";
const upper = (value) => asTrimmed(value).toUpperCase();
const nowIso = (value) => new Date(value).toISOString();
const uuid = () => crypto.randomUUID();

function invalidContext(reason) {
  return { status: DECISION.INVALID_CONTEXT, reason };
}

function normalizeContext(input = {}) {
  const operationType = upper(input.operationType);
  const companyId = asTrimmed(input.companyId);
  const branchId = asTrimmed(input.branchId);
  const currency = upper(input.currency);
  const paymentMethod = upper(input.paymentMethod);
  if (!operationType || !companyId || !branchId || !/^[A-Z][A-Z0-9_]{1,63}$/.test(operationType)) return { invalid: invalidContext("operationType, companyId, and branchId are required") };
  if (!/^[A-Z]{3}$/.test(currency)) return { invalid: invalidContext("currency must be a three-letter code") };
  if (!/^(CASH|BANK_TRANSFER|MIXED)$/.test(paymentMethod)) return { invalid: invalidContext("paymentMethod is invalid") };
  let amount;
  try {
    amount = new Decimal(input.amount);
    if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 4) throw new Error("amount");
  } catch {
    return { invalid: invalidContext("amount must be a non-negative decimal with at most four places") };
  }
  let occurredAt;
  try {
    occurredAt = new Date(input.occurredAt || new Date());
    if (Number.isNaN(occurredAt.valueOf())) throw new Error("occurredAt");
  } catch {
    return { invalid: invalidContext("occurredAt is invalid") };
  }
  return { context: { operationType, companyId, branchId, currency, paymentMethod, amount, occurredAt } };
}

function policyMatches(policy, context) {
  if (policy.companyId !== context.companyId || upper(policy.operationType) !== context.operationType || policy.isActive !== true) return false;
  if (policy.branchId && policy.branchId !== context.branchId) return false;
  if (policy.currency && upper(policy.currency) !== context.currency) return false;
  if (policy.paymentMethod && upper(policy.paymentMethod) !== context.paymentMethod) return false;
  if (policy.effectiveFrom && new Date(policy.effectiveFrom) > context.occurredAt) return false;
  // Effective-to is exclusive: the next policy can start at that exact instant.
  if (policy.effectiveTo && new Date(policy.effectiveTo) <= context.occurredAt) return false;
  if (policy.minAmount !== null && policy.minAmount !== undefined && context.amount.lt(new Decimal(policy.minAmount))) return false;
  if (policy.maxAmount !== null && policy.maxAmount !== undefined && context.amount.gt(new Decimal(policy.maxAmount))) return false;
  return true;
}

function specificity(policy) {
  const hasMin = policy.minAmount !== null && policy.minAmount !== undefined;
  const hasMax = policy.maxAmount !== null && policy.maxAmount !== undefined;
  const rangeKind = hasMin && hasMax ? 2 : (hasMin || hasMax ? 1 : 0);
  const width = hasMin && hasMax ? new Decimal(policy.maxAmount).minus(policy.minAmount) : null;
  return [policy.branchId ? 1 : 0, policy.currency ? 1 : 0, policy.paymentMethod ? 1 : 0, rangeKind, width];
}

function compareCandidates(left, right) {
  const priority = Number(right.priority || 0) - Number(left.priority || 0);
  if (priority) return priority;
  const a = specificity(left), b = specificity(right);
  for (let i = 0; i < 4; i += 1) if (a[i] !== b[i]) return b[i] - a[i];
  if (a[4] && b[4] && !a[4].eq(b[4])) return a[4].lt(b[4]) ? -1 : 1;
  if (a[4] && !b[4]) return -1;
  if (!a[4] && b[4]) return 1;
  return 0;
}

function evaluateCandidates(policies, input) {
  const normalized = normalizeContext(input);
  if (normalized.invalid) return normalized.invalid;
  const { context } = normalized;
  const matches = policies.filter((policy) => policyMatches(policy, context));
  if (!matches.length) return { status: DECISION.POLICY_CONFIGURATION_MISSING, context };
  const ranked = [...matches].sort(compareCandidates);
  const winner = ranked[0];
  if (ranked.length > 1 && compareCandidates(winner, ranked[1]) === 0) {
    return { status: DECISION.POLICY_CONFIGURATION_AMBIGUOUS, context, policyIds: ranked.filter((row) => compareCandidates(winner, row) === 0).map((row) => row.id) };
  }
  return {
    status: winner.approvalRequired ? DECISION.APPROVAL_REQUIRED : DECISION.APPROVAL_NOT_REQUIRED,
    context,
    policy: winner,
    decisionSnapshot: {
      policyId: winner.id,
      policyVersion: winner.version,
      approvalRequired: winner.approvalRequired,
      evaluatedAt: context.occurredAt.toISOString(),
      operationType: context.operationType,
      companyId: context.companyId,
      branchId: context.branchId,
      currency: context.currency,
      amount: context.amount.toFixed(4),
      paymentMethod: context.paymentMethod,
    },
  };
}

async function evaluateFinancialApprovalPolicy({ models = require("../models"), ...input }) {
  const normalized = normalizeContext(input);
  if (normalized.invalid) return normalized.invalid;
  const { context } = normalized;
  // Filter the authoritative scope in SQL first; in-memory matching then makes
  // wildcard/range/specificity semantics explicit and independently testable.
  const policies = await models.FinancialApprovalPolicy.findAll({
    where: {
      companyId: context.companyId,
      operationType: context.operationType,
      isActive: true,
      [Op.and]: [
        { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: context.occurredAt } }] },
        { [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gt]: context.occurredAt } }] },
      ],
    },
    transaction: input.transaction,
  });
  return evaluateCandidates(policies.map((row) => row.toJSON ? row.toJSON() : row), input);
}

async function assertPolicyScope({ models, companyId, branchId, transaction }) {
  const [company, branch] = await Promise.all([
    models.Company.findOne({ where: { id: companyId }, transaction }),
    models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction }),
  ]);
  if (!company || !branch) throw new AppError("Financial approval policy context is invalid.", 422, "FINANCIAL_APPROVAL_POLICY_INVALID_CONTEXT");
}

function normalizePolicyInput(input = {}) {
  const normalized = normalizeContext({ ...input, branchId: input.branchId || "policy-branch", currency: input.currency || "AED", paymentMethod: input.paymentMethod || "CASH", amount: input.minAmount ?? input.maxAmount ?? 0 });
  if (normalized.invalid || !asTrimmed(input.companyId) || !upper(input.operationType)) throw new AppError("Financial approval policy is invalid.", 422, "FINANCIAL_APPROVAL_POLICY_INVALID");
  const minAmount = input.minAmount === null || input.minAmount === undefined || input.minAmount === "" ? null : new Decimal(input.minAmount);
  const maxAmount = input.maxAmount === null || input.maxAmount === undefined || input.maxAmount === "" ? null : new Decimal(input.maxAmount);
  if ((minAmount && (!minAmount.isFinite() || minAmount.isNegative() || minAmount.decimalPlaces() > 4)) || (maxAmount && (!maxAmount.isFinite() || maxAmount.isNegative() || maxAmount.decimalPlaces() > 4)) || (minAmount && maxAmount && minAmount.gt(maxAmount))) throw new AppError("Financial approval policy amount range is invalid.", 422, "FINANCIAL_APPROVAL_POLICY_INVALID_RANGE");
  if (typeof input.approvalRequired !== "boolean" || !Number.isInteger(Number(input.priority ?? 0)) || Number(input.priority ?? 0) < 0) throw new AppError("Financial approval policy decision or priority is invalid.", 422, "FINANCIAL_APPROVAL_POLICY_INVALID");
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : null;
  const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if ((effectiveFrom && Number.isNaN(effectiveFrom.valueOf())) || (effectiveTo && Number.isNaN(effectiveTo.valueOf())) || (effectiveFrom && effectiveTo && effectiveFrom >= effectiveTo)) throw new AppError("Financial approval policy effective window is invalid.", 422, "FINANCIAL_APPROVAL_POLICY_INVALID_EFFECTIVE_WINDOW");
  return { companyId: asTrimmed(input.companyId), operationType: upper(input.operationType), branchId: input.branchId ? asTrimmed(input.branchId) : null, currency: input.currency ? upper(input.currency) : null, paymentMethod: input.paymentMethod ? upper(input.paymentMethod) : null, minAmount: minAmount ? minAmount.toFixed(4) : null, maxAmount: maxAmount ? maxAmount.toFixed(4) : null, approvalRequired: input.approvalRequired, priority: Number(input.priority || 0), effectiveFrom, effectiveTo, description: input.description ? asTrimmed(input.description) : null, metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : null };
}

async function createFinancialApprovalPolicy({ models = require("../models"), context, input, transaction }) {
  if (!transaction) throw new Error("Financial approval policy creation requires a transaction.");
  const policy = normalizePolicyInput({ ...input, companyId: context?.companyId });
  if (context?.companyId !== policy.companyId) throw new AppError("Company context does not match policy input.", 403, "COMPANY_SCOPE_INVALID");
  if (policy.branchId) await assertPolicyScope({ models, companyId: policy.companyId, branchId: policy.branchId, transaction });
  const row = await models.FinancialApprovalPolicy.create({ id: `FAP-${uuid()}`, ...policy, version: 1, isActive: true }, { transaction });
  await audit.record(policy.companyId, audit.attachDualAuditActor({ action: "FINANCIAL_APPROVAL_POLICY_CREATED", description: "Financial approval policy created", branch: policy.branchId, after: JSON.stringify({ policyId: row.id, version: 1, operationType: policy.operationType, approvalRequired: policy.approvalRequired }) }, context?.actorContext || { technicalUserId: context?.actorId }), { transaction });
  return row;
}

async function deactivateFinancialApprovalPolicy({ models = require("../models"), context, policyId, transaction }) {
  if (!transaction) throw new Error("Financial approval policy deactivation requires a transaction.");
  const row = await models.FinancialApprovalPolicy.findOne({ where: { id: policyId, companyId: context?.companyId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!row || !row.isActive) throw new AppError("Financial approval policy cannot be deactivated.", 409, "FINANCIAL_APPROVAL_POLICY_STATE_CONFLICT");
  await row.update({ isActive: false, deactivatedAt: new Date(), deactivatedBy: context?.actorId || null }, { transaction, financialApprovalPolicyDeactivation: true });
  await audit.record(row.companyId, audit.attachDualAuditActor({ action: "FINANCIAL_APPROVAL_POLICY_DEACTIVATED", description: "Financial approval policy deactivated", branch: row.branchId, before: JSON.stringify({ policyId: row.id, version: row.version }) }, context?.actorContext || { technicalUserId: context?.actorId }), { transaction });
  return row;
}

function approvalRequestInputHash({ evaluation, subjectType, subjectId, description, requestedBy }) {
  return idempotency.hashRequest(REQUEST_SCOPE, { evaluation: evaluation.decisionSnapshot, subjectType, subjectId, description, requestedBy });
}

async function createFinancialApprovalRequest({ models = require("../models"), context, operation, subjectType, subjectId, description, idempotencyKey, transaction }) {
  if (!transaction) throw new Error("Financial approval request creation requires a transaction.");
  if (!context?.companyId || !context?.branchId || !context?.actorId || !asTrimmed(subjectType) || !asTrimmed(subjectId) || !asTrimmed(description) || !asTrimmed(idempotencyKey)) throw new AppError("Financial approval request context is invalid.", 422, "FINANCIAL_APPROVAL_REQUEST_INVALID_CONTEXT");
  if (operation?.companyId && operation.companyId !== context.companyId) throw new AppError("Company context does not match operation input.", 403, "COMPANY_SCOPE_INVALID");
  if (operation?.branchId && operation.branchId !== context.branchId) throw new AppError("Branch context does not match operation input.", 403, "BRANCH_CONTEXT_REQUIRED");
  const evaluation = await evaluateFinancialApprovalPolicy({ models, ...operation, companyId: context.companyId, branchId: context.branchId, transaction });
  if (evaluation.status === DECISION.POLICY_CONFIGURATION_MISSING || evaluation.status === DECISION.POLICY_CONFIGURATION_AMBIGUOUS || evaluation.status === DECISION.INVALID_CONTEXT) throw new AppError("Financial approval policy cannot authorize this operation.", 422, evaluation.status);
  if (evaluation.status !== DECISION.APPROVAL_REQUIRED) return { created: false, approvalRequired: false, evaluation };
  const requestHash = approvalRequestInputHash({ evaluation, subjectType, subjectId, description, requestedBy: context.actorId });
  const existing = await models.IdempotencyRequest.findOne({ where: { companyId: context.companyId, scope: REQUEST_SCOPE, key: String(idempotencyKey) }, transaction, lock: transaction.LOCK.KEY_SHARE });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError("Idempotency key was already used for a different approval request.", 409, "IDEMPOTENCY_KEY_CONFLICT");
    if (existing.status === "succeeded") return { ...existing.responseBody, replayed: true };
    throw new AppError("Equivalent financial approval request is already processing.", 409, "IDEMPOTENCY_REQUEST_IN_PROGRESS");
  }
  const claimed = await idempotency.claim({ models, companyId: context.companyId, scope: REQUEST_SCOPE, key: idempotencyKey, requestHash, transaction });
  if (!claimed.claimed) {
    const verdict = await idempotency.resolveExisting({ models, companyId: context.companyId, scope: REQUEST_SCOPE, key: idempotencyKey, requestHash });
    if (verdict.state === "replay") return { ...verdict.responseBody, replayed: true };
    throw new AppError(verdict.message, 409, verdict.state === "processing" ? "IDEMPOTENCY_REQUEST_IN_PROGRESS" : "IDEMPOTENCY_KEY_CONFLICT");
  }
  const requestContextSnapshot = { operationType: evaluation.context.operationType, companyId: evaluation.context.companyId, branchId: evaluation.context.branchId, currency: evaluation.context.currency, amount: evaluation.context.amount.toFixed(4), paymentMethod: evaluation.context.paymentMethod, occurredAt: nowIso(evaluation.context.occurredAt), subjectType: asTrimmed(subjectType), subjectId: asTrimmed(subjectId) };
  const request = await models.ApprovalRequest.create({ id: `FAR-${uuid()}`, companyId: context.companyId, type: FINANCIAL_OPERATION_TYPE, requestedBy: context.actorId, requestedAt: new Date().toISOString(), branch: context.branchId, description: asTrimmed(description), amount: evaluation.context.amount.toFixed(4), status: "pending", relatedId: asTrimmed(subjectId), policyId: evaluation.policy.id, operationType: evaluation.context.operationType, subjectType: asTrimmed(subjectType), subjectId: asTrimmed(subjectId), branchId: context.branchId, currency: evaluation.context.currency, paymentMethod: evaluation.context.paymentMethod, idempotencyKey: String(idempotencyKey), requestContextSnapshot, policyDecisionSnapshot: evaluation.decisionSnapshot }, { transaction, financialApprovalFoundation: true });
  const responseBody = { created: true, approvalRequired: true, approvalRequestId: request.id, status: request.status, policyId: request.policyId };
  await idempotency.succeed({ request: claimed.request, statusCode: 201, responseBody, transaction });
  await audit.record(context.companyId, audit.attachDualAuditActor({ action: "FINANCIAL_APPROVAL_REQUEST_CREATED", description: "Financial operation requires human approval", branch: context.branchId, after: JSON.stringify({ approvalRequestId: request.id, policyId: request.policyId, operationType: request.operationType, status: request.status }) }, context.actorContext || { technicalUserId: context.actorId }), { transaction });
  return responseBody;
}

// Reuses the existing canonical approvals.manage permission; no title/role is
// encoded here and execution never makes this decision implicitly.
async function approveFinancialApprovalRequest({ models = require("../models"), context, approvalRequestId, transaction }) {
  if (!transaction || !context?.companyId || !context?.branchId || !context?.actorId || !context?.user) throw new AppError("Financial approval decision context is invalid.", 422, "FINANCIAL_APPROVAL_DECISION_INVALID_CONTEXT");
  if (!await permissionService.userHasPermission(context.user, "approvals.manage")) throw new AppError("Financial approval permission is required.", 403, "FINANCIAL_APPROVAL_PERMISSION_REQUIRED");
  const request = await models.ApprovalRequest.findOne({ where: { id: approvalRequestId, companyId: context.companyId, type: FINANCIAL_OPERATION_TYPE }, transaction, lock: transaction.LOCK.UPDATE });
  if (!request || request.branchId !== context.branchId || request.status !== "pending") throw new AppError("Financial approval request is not pending in this context.", 409, "FINANCIAL_APPROVAL_STATE_CONFLICT");
  await request.update({ status: "approved", reviewedBy: context.actorId, reviewedAt: new Date().toISOString() }, { transaction, financialApprovalDecision: true });
  await audit.record(context.companyId, audit.attachDualAuditActor({ action: "FINANCIAL_APPROVAL_REQUEST_APPROVED", description: "Financial operation approved by authorized user", branch: context.branchId, after: JSON.stringify({ approvalRequestId: request.id, policyId: request.policyId }) }, context.actorContext || { technicalUserId: context.actorId }), { transaction });
  return request;
}

module.exports = { DECISION, FINANCIAL_OPERATION_TYPE, FUTURE_IMP09_OPERATION_TYPE, REQUEST_SCOPE, normalizeContext, policyMatches, compareCandidates, evaluateCandidates, evaluateFinancialApprovalPolicy, createFinancialApprovalPolicy, deactivateFinancialApprovalPolicy, createFinancialApprovalRequest, approveFinancialApprovalRequest };
