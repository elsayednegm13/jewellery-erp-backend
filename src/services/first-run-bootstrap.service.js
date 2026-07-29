"use strict";

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { AppError, ValidationError } = require("../utils/errors");
const { validatePasswordPolicy } = require("../utils/password-policy");
const { ensureRolesForCompany, assignUserRole } = require("../bootstrap/accessControl");
const financialBootstrapService = require("./financial-bootstrap.service");
const { ACCOUNT_ROLE_CATALOG, BRANCH_MAPPING_CATALOG } = require("./financial-account-catalog.service");
const auditService = require("./audit.service");
const { STATES, GLOBAL_SETUP_ID, resolveSetupState } = require("./first-run-setup-state.service");

const SETUP_SCOPE = "first-run.bootstrap";
const ACCOUNT_TEMPLATE = Object.freeze(Object.entries(ACCOUNT_ROLE_CATALOG).map(([roleCode, definition]) => ({ roleCode, ...definition })));

function fail(code, status, message = "First-run setup is not available.") {
  return new AppError(message, status, code);
}

function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function stable(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function cleanText(value, field, max = 120) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new ValidationError("First-run setup data is invalid.", { [field]: ["Required or too long."] });
  return normalized;
}

function validatePayload(body = {}) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("First-run setup data is invalid.", { email: ["Invalid email."] });
  const firstName = cleanText(body.firstName, "firstName", 80);
  const lastName = cleanText(body.lastName, "lastName", 80);
  const password = String(body.password || "");
  if (password !== String(body.passwordConfirmation || "")) throw new ValidationError("First-run setup data is invalid.", { passwordConfirmation: ["Does not match."] });
  validatePasswordPolicy(password, { email, firstName, lastName });
  const companyName = cleanText(body.companyName, "companyName", 160);
  const workspace = cleanText(body.workspace, "workspace", 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(workspace)) throw new ValidationError("First-run setup data is invalid.", { workspace: ["Invalid workspace."] });
  const branchName = cleanText(body.branchName, "branchName", 120);
  const branchCode = cleanText(body.branchCode, "branchCode", 40).toUpperCase();
  if (!/^[A-Z0-9-]{2,40}$/.test(branchCode)) throw new ValidationError("First-run setup data is invalid.", { branchCode: ["Invalid branch code."] });
  const currency = cleanText(body.currency || "AED", "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError("First-run setup data is invalid.", { currency: ["Invalid currency."] });
  return { email, firstName, lastName, password, companyName, workspace, branchName, branchCode, currency };
}

function verifyAuthorization(providedToken, environment = process.env) {
  const expected = environment.FIRST_RUN_SETUP_TOKEN;
  if (!expected || typeof providedToken !== "string") throw fail("FIRST_RUN_TOKEN_REQUIRED", 403);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(providedToken);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw fail("FIRST_RUN_TOKEN_INVALID", 403);
  }
}

async function ensureFinancialReadiness(models, { company, branch, actorId, transaction }) {
  await financialBootstrapService.reconcile({
    models,
    companyId: company.id,
    branchId: branch.id,
    actorId,
    transaction,
  });
  const readiness = await financialBootstrapService.evaluateReadiness({
    models,
    companyId: company.id,
    branchId: branch.id,
    transaction,
  });
  if (readiness.status !== "READY") throw fail("FIRST_RUN_FINANCIAL_MAPPING_INCOMPLETE", 422);
}

async function bootstrapFirstRun({ models, body, token, idempotencyKey, environment = process.env, dependencies = {} }) {
  const accessControl = dependencies.accessControl || { ensureRolesForCompany, assignUserRole };
  const audit = dependencies.audit || auditService;
  verifyAuthorization(token, environment);
  if (!idempotencyKey || String(idempotencyKey).trim().length < 16) throw fail("FIRST_RUN_IDEMPOTENCY_CONFLICT", 400, "An idempotency key is required.");
  const input = validatePayload(body);
  const payloadHash = hash(stable({ ...input, password: "[redacted]" }));
  const idempotencyKeyHash = hash(idempotencyKey);

  return models.sequelize.transaction(async (transaction) => {
    // PostgreSQL transaction-scoped advisory lock: independent processes cannot
    // both pass SETUP_REQUIRED. The durable marker then protects all retries.
    await models.sequelize.query("SELECT pg_advisory_xact_lock(736287401)", { transaction });
    let marker = await models.FirstRunSetupState.findByPk(GLOBAL_SETUP_ID, { transaction, lock: transaction.LOCK.UPDATE });
    if (marker?.state === STATES.READY) {
      if (marker.idempotencyKeyHash === idempotencyKeyHash && marker.payloadHash === payloadHash && marker.result) return { ...marker.result, replayed: true };
      if (marker.idempotencyKeyHash === idempotencyKeyHash) throw fail("FIRST_RUN_IDEMPOTENCY_CONFLICT", 409);
      throw fail("FIRST_RUN_ALREADY_COMPLETE", 409);
    }
    if (marker?.state === STATES.SETUP_IN_PROGRESS) throw fail("FIRST_RUN_IN_PROGRESS", 409);
    // The advisory transaction lock above is the global concurrency boundary.
    // State classification intentionally uses plain aggregate reads because
    // PostgreSQL forbids FOR UPDATE on COUNT queries.
    const state = await resolveSetupState(models, { transaction });
    if (state.state === STATES.CONFIGURATION_CONFLICT) throw fail("FIRST_RUN_CONFIGURATION_CONFLICT", 409);
    if (state.state === STATES.RECOVERY_REQUIRED) throw fail("FIRST_RUN_RECOVERY_REQUIRED", 409);
    if (state.state !== STATES.SETUP_REQUIRED) throw fail("FIRST_RUN_ALREADY_COMPLETE", 409);
    marker = await models.FirstRunSetupState.create({ id: GLOBAL_SETUP_ID, state: STATES.SETUP_IN_PROGRESS, idempotencyKeyHash, payloadHash }, { transaction });

    const duplicate = await models.User.findOne({ where: { email: input.email }, transaction, lock: transaction.LOCK.UPDATE });
    if (duplicate) throw new ValidationError("First-run setup data is invalid.", { email: ["Already in use."] });
    const company = await models.Company.create({ id: id("COMP"), businessName: input.companyName, workspace: input.workspace, currency: input.currency, branchName: input.branchName }, { transaction });
    await accessControl.ensureRolesForCompany(company.id, { transaction });
    const user = await models.User.create({
      id: id("USR"), companyId: company.id, firstName: input.firstName, lastName: input.lastName, email: input.email,
      password: await bcrypt.hash(input.password, 12), role: "admin", accountType: "super_admin", isActive: true,
      passwordVersion: 1, sessionVersion: 1, credentialsChangedAt: new Date(), lastPasswordChangeAt: new Date()
    }, { transaction });
    const role = await accessControl.assignUserRole(user.id, company.id, "admin", { transaction });
    if (!role) throw fail("FIRST_RUN_ROLE_BASELINE_INCOMPLETE", 422);
    const branch = await models.Branch.create({ id: id("BR"), companyId: company.id, name: input.branchName, code: input.branchCode, type: "store", isActive: true }, { transaction });
    await ensureFinancialReadiness(models, { company, branch, actorId: user.id, transaction });
    const [activeSuperAdmins, activeBranches, userRoleCount, mappingCount] = await Promise.all([
      models.User.count({ where: { companyId: company.id, accountType: "super_admin", isActive: true }, transaction }),
      models.Branch.count({ where: { companyId: company.id, isActive: true }, transaction }),
      models.UserRole.count({ where: { userId: user.id, roleId: role.id }, transaction }),
      models.BranchFinancialMapping.count({ where: { companyId: company.id, branchId: branch.id, isActive: true }, transaction })
    ]);
    if (activeSuperAdmins !== 1 || activeBranches < 1 || userRoleCount !== 1 || mappingCount < Object.keys(BRANCH_MAPPING_CATALOG).length) {
      throw fail("FIRST_RUN_FINANCIAL_MAPPING_INCOMPLETE", 422);
    }
    const result = { success: true, state: STATES.READY, next: "LOGIN" };
    await audit.record(company.id, {
      action: "first_run_setup_completed", description: "First-run setup completed.", user: "First-run setup",
      userId: user.id, severity: "info", after: JSON.stringify({ state: STATES.READY, branchCreated: true, financialMappings: "complete" })
    }, { transaction });
    await marker.update({ state: STATES.READY, result, completedAt: new Date(), lastErrorCode: null }, { transaction });
    return result;
  });
}

module.exports = { ACCOUNT_TEMPLATE, SETUP_SCOPE, validatePayload, verifyAuthorization, ensureFinancialReadiness, bootstrapFirstRun };
