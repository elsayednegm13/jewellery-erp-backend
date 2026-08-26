"use strict";

const { Op, QueryTypes } = require("sequelize");
const { v4: uuidv4 } = require("uuid");
const models = require("../models");
const auditService = require("./audit.service");
const permissionService = require("./permission.service");
const {
  BUSINESS_CONTEXT,
  PRICING_MODES,
  SCOPE_TYPES,
  POLICY_STATUSES,
  normalizePolicyInput,
  policyScopeKey,
  calculateEffectiveRate,
} = require("./gold-pricing-policy.contract");
const { AppError, ForbiddenError, NotFoundError, ValidationError } = require("../utils/errors");
const { GOLD_PRICING_POLICY_PERMISSION } = require("../bootstrap/gold-pricing-policy-permission-catalog");

const PRICING_POLICY_PERMISSION = GOLD_PRICING_POLICY_PERMISSION.name;
const READ_PERMISSION = "gold.view";

function requireCompany(context = {}) {
  if (!context.companyId) throw new AppError("Gold pricing policy company context is required", 422, "GOLD_PRICING_COMPANY_CONTEXT_REQUIRED");
}

async function assertPermission(context, permission = PRICING_POLICY_PERMISSION) {
  requireCompany(context);
  if (!context.user || !(await permissionService.userHasPermission(context.user, permission))) {
    throw new ForbiddenError(`${permission} is required`);
  }
}

function scopeWhere({ companyId, businessContext = BUSINESS_CONTEXT, scopeType, karat }) {
  return {
    companyId,
    businessContext,
    scopeType,
    karat: scopeType === SCOPE_TYPES.DEFAULT ? null : Number(karat),
  };
}

function policyWindowOverlaps(a, b) {
  const aStart = new Date(a.effectiveFrom).getTime();
  const bStart = new Date(b.effectiveFrom).getTime();
  const aEnd = a.effectiveUntil ? new Date(a.effectiveUntil).getTime() : Infinity;
  const bEnd = b.effectiveUntil ? new Date(b.effectiveUntil).getTime() : Infinity;
  return aStart < bEnd && bStart < aEnd;
}

async function lockScope(transaction, scope) {
  const key = policyScopeKey(scope);
  await models.sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:lockKey))", {
    replacements: { lockKey: key },
    transaction,
    type: QueryTypes.SELECT,
  });
}

async function rowsForScope(scope, { transaction, lock = false } = {}) {
  return models.GoldPricingPolicy.findAll({
    where: scopeWhere(scope),
    order: [["version", "DESC"], ["effectiveFrom", "DESC"], ["id", "DESC"]],
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
}

function activeAt(row, now) {
  if (row.status !== POLICY_STATUSES.ACTIVE) return false;
  const from = new Date(row.effectiveFrom);
  const until = row.effectiveUntil ? new Date(row.effectiveUntil) : null;
  return from <= now && (!until || now < until);
}

async function resolveScopePolicy(scope, { now = new Date(), transaction } = {}) {
  const rows = await rowsForScope(scope, { transaction });
  const eligible = rows.filter((row) => activeAt(row, now));
  if (eligible.length > 1) throw new AppError("Multiple active CGP pricing policies overlap", 409, "GOLD_PRICING_POLICY_AMBIGUOUS");
  if (eligible.length === 1) return eligible[0];
  return null;
}

function assertNoUsablePolicy(rows, now) {
  if (rows.some((row) => row.status === POLICY_STATUSES.ACTIVE && new Date(row.effectiveFrom) > now)) {
    throw new AppError("CGP pricing policy is not effective yet", 422, "GOLD_PRICING_POLICY_NOT_EFFECTIVE");
  }
  if (rows.length) throw new AppError("CGP pricing policy is inactive or expired", 422, "GOLD_PRICING_POLICY_INACTIVE");
  throw new AppError("No active CGP pricing policy exists", 422, "GOLD_PRICING_POLICY_MISSING");
}

async function resolvePolicy({ companyId, karat, businessContext = BUSINESS_CONTEXT, now = new Date(), transaction } = {}) {
  if (!companyId) throw new AppError("Gold pricing policy company context is required", 422, "GOLD_PRICING_COMPANY_CONTEXT_REQUIRED");
  const numericKarat = Number(karat);
  if (!Number.isInteger(numericKarat)) throw new ValidationError("karat is required", { karat: ["required"] });
  const overrideScope = { companyId, businessContext, scopeType: SCOPE_TYPES.KARAT, karat: numericKarat };
  const overrideRows = await rowsForScope(overrideScope, { transaction });
  const override = await resolveScopePolicy(overrideScope, { now, transaction });
  if (override) return { policy: override, policyScope: SCOPE_TYPES.KARAT, resolution: "PER_KARAT_OVERRIDE" };
  const fallbackScope = { companyId, businessContext, scopeType: SCOPE_TYPES.DEFAULT, karat: null };
  const fallbackRows = await rowsForScope(fallbackScope, { transaction });
  const fallback = await resolveScopePolicy(fallbackScope, { now, transaction });
  if (fallback) return { policy: fallback, policyScope: SCOPE_TYPES.DEFAULT, resolution: "DEFAULT" };
  assertNoUsablePolicy(fallbackRows.length ? fallbackRows : overrideRows, now);
}

async function assertNoOverlap(scope, candidate, { transaction } = {}) {
  const rows = await rowsForScope(scope, { transaction, lock: true });
  const overlap = rows.find((row) => row.status === POLICY_STATUSES.ACTIVE && policyWindowOverlaps(row, candidate));
  if (overlap) throw new AppError("An active CGP pricing policy overlaps the requested effective window", 409, "GOLD_PRICING_POLICY_OVERLAP");
}

function snapshotPolicy(policy) {
  return {
    id: policy.id,
    companyId: policy.companyId,
    businessContext: policy.businessContext,
    pricingMode: policy.pricingMode,
    scopeType: policy.scopeType,
    karat: policy.karat,
    baseQuoteType: policy.baseQuoteType,
    adjustmentType: policy.adjustmentType,
    adjustmentValue: policy.adjustmentValue,
    version: policy.version,
    status: policy.status,
    effectiveFrom: policy.effectiveFrom,
    effectiveUntil: policy.effectiveUntil,
    createdBy: policy.createdBy || null,
    createdAt: policy.createdAt || null,
    updatedAt: policy.updatedAt || null,
    supersedesPolicyId: policy.supersedesPolicyId,
  };
}

async function createPolicyVersion({ context, input, activate = false, supersedesPolicyId = null, reason = null, transaction, now = new Date() } = {}) {
  requireCompany(context);
  await assertPermission(context);
  const normalized = normalizePolicyInput(input, { now });
  const scope = { companyId: context.companyId, businessContext: normalized.businessContext, scopeType: normalized.scopeType, karat: normalized.karat };
  const run = async (t) => {
    await lockScope(t, scope);
    const rows = await rowsForScope(scope, { transaction: t, lock: true });
    const latest = rows[0];
    const version = Number(latest?.version || 0) + 1;
    let superseded = null;
    if (supersedesPolicyId) {
      superseded = await models.GoldPricingPolicy.findOne({ where: { id: supersedesPolicyId, companyId: context.companyId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!superseded) throw new NotFoundError("Superseded CGP pricing policy was not found");
      if (superseded.businessContext !== normalized.businessContext || superseded.scopeType !== normalized.scopeType || String(superseded.karat ?? "") !== String(normalized.karat ?? "")) {
        throw new AppError("Superseded policy scope does not match the new version", 409, "GOLD_PRICING_POLICY_SCOPE_MISMATCH");
      }
      if (new Date(normalized.effectiveFrom) < new Date(superseded.effectiveFrom)) throw new AppError("A policy version cannot start before its predecessor", 409, "GOLD_PRICING_POLICY_EFFECTIVE_ORDER_INVALID");
      if (superseded.status === POLICY_STATUSES.ACTIVE && (!superseded.effectiveUntil || new Date(superseded.effectiveUntil) > normalized.effectiveFrom)) {
        await superseded.update({ status: POLICY_STATUSES.SUPERSEDED, effectiveUntil: normalized.effectiveFrom }, { transaction: t, pricingPolicyTransition: "supersede" });
      }
    }
    const candidate = { ...normalized, companyId: context.companyId, version, status: activate ? POLICY_STATUSES.ACTIVE : POLICY_STATUSES.INACTIVE };
    if (activate) await assertNoOverlap(scope, candidate, { transaction: t });
    const policy = await models.GoldPricingPolicy.create({ id: `GPOL-${uuidv4()}`, ...candidate, createdBy: context.user?.id || null, supersedesPolicyId: superseded?.id || null }, { transaction: t });
    await auditService.record(context.companyId, {
      action: "gold_pricing_policy.version_created",
      description: `CGP pricing policy ${policy.id} version ${version} created`,
      user: context.user?.email || context.user?.username || context.user?.id || "System",
      userId: context.user?.id || null,
      place: "GoldCenter",
      branch: null,
      sourceDocument: policy.id,
      severity: "info",
      operatorReason: reason || null,
      before: superseded ? JSON.stringify(snapshotPolicy(superseded)) : null,
      after: JSON.stringify({ ...snapshotPolicy(policy), resolutionScope: normalized.scopeType }),
    }, { transaction: t });
    return { policy, superseded, replayed: false };
  };
  return transaction ? run(transaction) : models.sequelize.transaction(run);
}

async function activatePolicyVersion({ context, policyId, reason = null, transaction, now = new Date() } = {}) {
  requireCompany(context);
  await assertPermission(context);
  const run = async (t) => {
    const policy = await models.GoldPricingPolicy.findOne({ where: { id: policyId, companyId: context.companyId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!policy) throw new NotFoundError("CGP pricing policy was not found");
    if (policy.status === POLICY_STATUSES.ACTIVE) return { policy, replayed: true };
    if (policy.status !== POLICY_STATUSES.INACTIVE) throw new AppError("Only an inactive CGP pricing policy can be activated", 409, "GOLD_PRICING_POLICY_STATUS_INVALID");
    const scope = { companyId: policy.companyId, businessContext: policy.businessContext, scopeType: policy.scopeType, karat: policy.karat };
    await lockScope(t, scope);
    await assertNoOverlap(scope, { ...policy.toJSON(), status: POLICY_STATUSES.ACTIVE }, { transaction: t });
    await policy.update({ status: POLICY_STATUSES.ACTIVE }, { transaction: t, pricingPolicyTransition: "activate" });
    await auditService.record(context.companyId, {
      action: "gold_pricing_policy.activated",
      description: `CGP pricing policy ${policy.id} activated`,
      user: context.user?.email || context.user?.username || context.user?.id || "System",
      userId: context.user?.id || null,
      place: "GoldCenter",
      sourceDocument: policy.id,
      severity: "info",
      operatorReason: reason || null,
      before: JSON.stringify({ status: POLICY_STATUSES.INACTIVE }),
      after: JSON.stringify(snapshotPolicy(policy)),
    }, { transaction: t });
    return { policy, replayed: false };
  };
  return transaction ? run(transaction) : models.sequelize.transaction(run);
}

async function listPolicyHistory({ companyId, businessContext = BUSINESS_CONTEXT, karat = null, scopeType = null, page = 1, pageSize = 25, paginate = false } = {}) {
  if (!companyId) throw new AppError("Gold pricing policy company context is required", 422, "GOLD_PRICING_COMPANY_CONTEXT_REQUIRED");
  const where = { companyId, businessContext };
  if (scopeType) where.scopeType = scopeType;
  if (karat !== null && karat !== undefined) where.karat = Number(karat);
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 25));
  const query = { where, order: [["scopeType", "ASC"], ["karat", "ASC"], ["version", "DESC"]] };
  if (!paginate) return models.GoldPricingPolicy.findAll(query);
  const result = await models.GoldPricingPolicy.findAndCountAll({ ...query, limit: safePageSize, offset: (safePage - 1) * safePageSize });
  return { items: result.rows.map(snapshotPolicy), page: safePage, pageSize: safePageSize, total: result.count, hasMore: safePage * safePageSize < result.count };
}

function calculateFromPolicy({ quote, policy, companyId, karat, currency, now, staleAfterSeconds, marketQuoteId } = {}) {
  return calculateEffectiveRate({ quote, policy, companyId, karat, currency, now, staleAfterSeconds, marketQuoteId });
}

module.exports = { BUSINESS_CONTEXT, PRICING_POLICY_PERMISSION, READ_PERMISSION, PRICING_MODES, POLICY_STATUSES, resolvePolicy, createPolicyVersion, activatePolicyVersion, listPolicyHistory, calculateFromPolicy, assertPermission };
