const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Op } = require("sequelize");
const models = require("../models");
const auditService = require("./audit.service");
const permissionService = require("./permission.service");
const operatorSessionService = require("./operator-session.service");
const technicalSessions = require("./technical-session.service");
const { ValidationError, ForbiddenError, NotFoundError, ConflictError } = require("../utils/errors");

const ACCOUNT_TYPES = new Set(["legacy", "super_admin", "branch_shell"]);
const PASSWORD_MIN_LENGTH = 8;

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function actorName(user) {
  return user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || user.id : "System";
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new ValidationError("A valid email is required.", { email: ["Invalid email."] });
  return email;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    throw new ValidationError("Password does not meet policy.", { password: [`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`] });
  }
}

function generateTemporaryPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

function maskEmail(email) {
  const text = String(email || "");
  const [name, domain] = text.split("@");
  if (!name || !domain) return null;
  return `${name.slice(0, 2)}***@${domain}`;
}

function safeUser(user, extras = {}) {
  const plain = user.toJSON ? user.toJSON() : user;
  return {
    id: plain.id,
    companyId: plain.companyId,
    firstName: plain.firstName,
    lastName: plain.lastName,
    email: plain.email,
    phone: plain.phone || "",
    jobTitle: plain.jobTitle || "",
    role: plain.role,
    accountType: plain.accountType || "legacy",
    branchId: plain.branchId || null,
    branch: plain.branch ? { id: plain.branch.id, name: plain.branch.name, code: plain.branch.code } : null,
    recoveryEmailMasked: maskEmail(plain.recoveryEmail),
    recoveryEmailVerifiedAt: plain.recoveryEmailVerifiedAt || null,
    recoveryPhoneConfigured: Boolean(plain.recoveryPhone),
    recoveryPhoneVerifiedAt: plain.recoveryPhoneVerifiedAt || null,
    forcePasswordChange: Boolean(plain.forcePasswordChange),
    failedLoginCount: Number(plain.failedLoginCount || 0),
    lockedUntil: plain.lockedUntil || null,
    lastLoginAt: plain.lastLoginAt || null,
    lastPasswordChangeAt: plain.lastPasswordChangeAt || null,
    defaultEmployeeId: plain.defaultEmployeeId || null,
    defaultEmployee: plain.defaultEmployee ? {
      id: plain.defaultEmployee.id,
      employeeCode: plain.defaultEmployee.employeeCode || null,
      name: plain.defaultEmployee.name,
      status: plain.defaultEmployee.status
    } : null,
    activeSessions: extras.activeSessions ?? plain.activeSessions ?? 0
  };
}

async function requireSuperAdminTechnicalScope(req) {
  if ((req.user?.accountType || "legacy") !== "super_admin") {
    throw new ForbiddenError("Super Admin technical scope is required.");
  }
}

async function requireSystemAccountPermission(req, permissionName) {
  const allowed = await permissionService.userHasPermission(req.user, permissionName);
  if (!allowed) throw new ForbiddenError(`${permissionName} is required.`);
}

async function requireSensitiveAdminLevel2(req, { permissionName, operation }) {
  await requireSuperAdminTechnicalScope(req);
  if (permissionName) await requireSystemAccountPermission(req, permissionName);
  const current = await operatorSessionService.currentFromRequest(req, {
    touch: false,
    requiredLevel: 2,
    requiredPermission: permissionName || "system_accounts.manage",
    requestedOperation: operation || permissionName || "system-account.sensitive"
  });
  if (!current.active) {
    throw operatorSessionService.operatorError(current.reason || "OPERATOR_STEP_UP_REQUIRED", current.statusCode || 403);
  }
  return current;
}

async function validateAccountShape({ accountType, companyId, branchId, defaultEmployeeId, transaction }) {
  if (!ACCOUNT_TYPES.has(accountType)) throw new ValidationError("Invalid account type.", { accountType: ["Invalid account type."] });
  if (accountType === "branch_shell" && !branchId) {
    throw new ValidationError("Branch Shell requires a branch.", { branchId: ["Branch Shell requires a branch."] });
  }
  if (accountType === "super_admin" && branchId) {
    throw new ValidationError("Super Admin must not be fixed to a branch.", { branchId: ["Super Admin cannot have a branch assignment."] });
  }
  if (branchId) {
    const branch = await models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction });
    if (!branch) throw new ValidationError("Branch does not belong to this company or is inactive.", { branchId: ["Invalid branch."] });
  }
  if (defaultEmployeeId) {
    const employee = await models.Employee.findOne({ where: { id: defaultEmployeeId, companyId, status: { [Op.ne]: "inactive" } }, transaction });
    if (!employee) throw new ValidationError("Default Employee must be active and in the same company.", { defaultEmployeeId: ["Invalid default Employee."] });
  }
}

async function activeSuperAdminCount(transaction = null) {
  return models.User.count({
    where: {
      accountType: "super_admin",
      deletedAt: null,
      [Op.or]: [{ lockedUntil: null }, { lockedUntil: { [Op.lte]: new Date() } }]
    },
    transaction
  });
}

async function assertNotFinalSuperAdmin(targetUser, operation, transaction = null) {
  if ((targetUser.accountType || "legacy") !== "super_admin") return;
  const count = await activeSuperAdminCount(transaction);
  if (count <= 1) {
    await auditService.record(targetUser.companyId, {
      action: "system_account.final_admin_safeguard_denied",
      description: `Final Super Admin safeguard denied ${operation}.`,
      user: "System",
      place: "System Accounts",
      sourceDocument: targetUser.id,
      severity: "critical",
      after: JSON.stringify({ operation, targetUserId: targetUser.id })
    }, { transaction });
    throw new ConflictError("Final active Super Admin cannot be removed, demoted, disabled, or locked out.");
  }
}

async function listAccounts(req) {
  await requireSystemAccountPermission(req, "system_accounts.view");
  const where = { companyId: req.companyId };
  if (req.query.accountType) where.accountType = String(req.query.accountType);
  if ((req.user.accountType || "legacy") === "branch_shell") where.branchId = req.user.branchId;
  const rows = await models.User.findAll({
    where,
    include: [
      { model: models.Branch, as: "branch", attributes: ["id", "name", "code"] },
      { model: models.Employee, as: "defaultEmployee", attributes: ["id", "employeeCode", "name", "status"] }
    ],
    order: [["accountType", "ASC"], ["email", "ASC"]]
  });
  const counts = await models.TechnicalAccountSession.findAll({
    attributes: ["userId", [models.sequelize.fn("count", models.sequelize.col("id")), "count"]],
    where: { revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
    group: ["userId"],
    raw: true
  });
  const byUser = new Map(counts.map((row) => [row.userId, Number(row.count || 0)]));
  return rows.map((row) => safeUser(row, { activeSessions: byUser.get(row.id) || 0 }));
}

async function createAccount(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "system_accounts.manage", operation: "system-account.create" });
  const body = req.body || {};
  const accountType = body.accountType || "legacy";
  const email = normalizeEmail(body.email);
  const temporaryPassword = body.temporaryPassword || generateTemporaryPassword();
  validatePassword(temporaryPassword);
  await validateAccountShape({
    accountType,
    companyId: req.companyId,
    branchId: body.branchId || null,
    defaultEmployeeId: body.defaultEmployeeId || null
  });
  const exists = await models.User.findOne({ where: { email } });
  if (exists) throw new ConflictError("Email is already used by another account.");
  const user = await models.User.create({
    id: id("USR"),
    companyId: req.companyId,
    firstName: String(body.firstName || "System").trim(),
    lastName: String(body.lastName || "Account").trim(),
    email,
    phone: body.phone || "",
    jobTitle: body.jobTitle || "",
    role: body.role || "sales",
    password: await bcrypt.hash(temporaryPassword, 10),
    accountType,
    branchId: accountType === "branch_shell" ? body.branchId : null,
    recoveryEmail: body.recoveryEmail ? normalizeEmail(body.recoveryEmail) : null,
    recoveryPhone: body.recoveryPhone || null,
    defaultEmployeeId: body.defaultEmployeeId || null,
    forcePasswordChange: true,
    credentialsChangedAt: new Date()
  });
  await auditService.record(req.companyId, {
    action: "system_account.created",
    description: `System account created for ${email}.`,
    user: actorName(req.user),
    userId: req.user.id,
    technicalUserId: req.user.id,
    place: "System Accounts",
    sourceDocument: user.id,
    severity: "warning",
    after: JSON.stringify({ targetUserId: user.id, accountType, branchId: user.branchId || null })
  });
  return { account: safeUser(user), temporaryPassword };
}

async function getAccountOrThrow(companyId, id, transaction = null) {
  const user = await models.User.findOne({ where: { companyId, id }, transaction });
  if (!user) throw new NotFoundError("System account not found.");
  return user;
}

async function patchAccount(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "system_accounts.manage", operation: "system-account.update" });
  const user = await getAccountOrThrow(req.companyId, req.params.id);
  const body = req.body || {};
  const updates = {};
  for (const key of ["firstName", "lastName", "phone", "jobTitle", "recoveryPhone"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key] || "";
  }
  if (Object.prototype.hasOwnProperty.call(body, "recoveryEmail")) updates.recoveryEmail = body.recoveryEmail ? normalizeEmail(body.recoveryEmail) : null;
  if (Object.prototype.hasOwnProperty.call(body, "defaultEmployeeId")) {
    await validateAccountShape({
      accountType: user.accountType || "legacy",
      companyId: req.companyId,
      branchId: user.branchId || null,
      defaultEmployeeId: body.defaultEmployeeId || null
    });
    updates.defaultEmployeeId = body.defaultEmployeeId || null;
  }
  await user.update(updates);
  await auditService.record(req.companyId, {
    action: "system_account.updated",
    description: `System account updated for ${user.email}.`,
    user: actorName(req.user),
    userId: req.user.id,
    technicalUserId: req.user.id,
    place: "System Accounts",
    sourceDocument: user.id,
    severity: "warning",
    after: JSON.stringify({ targetUserId: user.id, fields: Object.keys(updates) })
  });
  return safeUser(user);
}

async function resetPassword(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "system_accounts.credentials.reset", operation: "system-account.reset-password" });
  const user = await getAccountOrThrow(req.companyId, req.params.id);
  const temporaryPassword = req.body?.temporaryPassword || generateTemporaryPassword();
  validatePassword(temporaryPassword);
  await models.sequelize.transaction(async (transaction) => {
    await user.update({
      password: await bcrypt.hash(temporaryPassword, 10),
      forcePasswordChange: true,
      failedLoginCount: 0,
      lockedUntil: null
    }, { transaction });
    await technicalSessions.bumpPasswordVersion(user, "password_reset", transaction);
    await auditService.record(req.companyId, {
      action: "system_account.password_reset",
      description: `System account password reset for ${user.email}.`,
      user: actorName(req.user),
      userId: req.user.id,
      technicalUserId: req.user.id,
      place: "System Accounts",
      sourceDocument: user.id,
      severity: "critical",
      after: JSON.stringify({ targetUserId: user.id, forcePasswordChange: true })
    }, { transaction });
  });
  return { account: safeUser(user), temporaryPassword };
}

async function changeEmail(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "system_accounts.manage", operation: "system-account.change-email" });
  const user = await getAccountOrThrow(req.companyId, req.params.id);
  const email = normalizeEmail(req.body?.email);
  const exists = await models.User.findOne({ where: { email, id: { [Op.ne]: user.id } } });
  if (exists) throw new ConflictError("Email is already used by another account.");
  await models.sequelize.transaction(async (transaction) => {
    await user.update({ email }, { transaction });
    await technicalSessions.bumpSessionVersion(user, "email_change", transaction);
    await auditService.record(req.companyId, {
      action: "system_account.email_changed",
      description: `System account email changed for ${user.id}.`,
      user: actorName(req.user),
      userId: req.user.id,
      technicalUserId: req.user.id,
      place: "System Accounts",
      sourceDocument: user.id,
      severity: "warning",
      after: JSON.stringify({ targetUserId: user.id, newEmail: email, reason: req.body?.reason || null })
    }, { transaction });
  });
  return safeUser(user);
}

async function unlockAccount(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "security.recovery.manage", operation: "system-account.unlock" });
  const user = await getAccountOrThrow(req.companyId, req.params.id);
  await user.update({ failedLoginCount: 0, lockedUntil: null });
  await auditService.record(req.companyId, {
    action: "system_account.unlocked",
    description: `System account unlocked for ${user.email}.`,
    user: actorName(req.user),
    userId: req.user.id,
    technicalUserId: req.user.id,
    place: "System Accounts",
    sourceDocument: user.id,
    severity: "warning"
  });
  return safeUser(user);
}

async function revokeSessions(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "system_accounts.sessions.revoke", operation: "system-account.revoke-sessions" });
  const user = await getAccountOrThrow(req.companyId, req.params.id);
  const count = await technicalSessions.revokeUserSessions(user.id, req.body?.reason || "admin_revocation");
  await technicalSessions.auditSessionRevocation({
    companyId: req.companyId,
    actorUser: req.user,
    targetUser: user,
    reason: req.body?.reason || "admin_revocation",
    count
  });
  return { account: safeUser(user), revoked: count };
}

async function convertAccountType(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "super_admin.manage", operation: "system-account.convert-account-type" });
  const body = req.body || {};
  const targetType = body.accountType;
  const user = await getAccountOrThrow(req.companyId, req.params.id);
  if (!ACCOUNT_TYPES.has(targetType)) throw new ValidationError("Invalid account type.", { accountType: ["Invalid account type."] });
  if ((user.accountType || "legacy") === "super_admin" && targetType !== "super_admin") {
    await assertNotFinalSuperAdmin(user, "demote", null);
  }
  await validateAccountShape({
    accountType: targetType,
    companyId: req.companyId,
    branchId: body.branchId || null,
    defaultEmployeeId: body.defaultEmployeeId || user.defaultEmployeeId || null
  });
  await models.sequelize.transaction(async (transaction) => {
    await user.update({
      accountType: targetType,
      branchId: targetType === "branch_shell" ? body.branchId : null,
      defaultEmployeeId: body.defaultEmployeeId || user.defaultEmployeeId || null
    }, { transaction });
    await technicalSessions.bumpSessionVersion(user, "account_type_change", transaction);
    await auditService.record(req.companyId, {
      action: "system_account.account_type_changed",
      description: `System account type changed for ${user.email}.`,
      user: actorName(req.user),
      userId: req.user.id,
      technicalUserId: req.user.id,
      place: "System Accounts",
      sourceDocument: user.id,
      severity: "critical",
      after: JSON.stringify({ targetUserId: user.id, accountType: targetType, branchId: user.branchId || null, reason: body.reason || null })
    }, { transaction });
  });
  return safeUser(user);
}

async function readiness(req) {
  await requireSuperAdminTechnicalScope(req);
  const [superAdmins, superAdminsWithRecovery, branchShells, eligibleEmployees] = await Promise.all([
    models.User.count({ where: { companyId: req.companyId, accountType: "super_admin" } }),
    models.User.count({ where: { companyId: req.companyId, accountType: "super_admin", recoveryEmail: { [Op.ne]: null } } }),
    models.User.count({ where: { companyId: req.companyId, accountType: "branch_shell", branchId: { [Op.ne]: null } } }),
    models.Employee.count({ where: { companyId: req.companyId, status: "present", employeeCode: { [Op.ne]: null } } })
  ]);
  return {
    superAdmins,
    superAdminsWithRecovery,
    finalAdminProtected: superAdmins >= 1,
    branchShells,
    eligibleAdminEmployees: eligibleEmployees,
    localDevRecoveryDelivery: process.env.NODE_ENV !== "production",
    productionEmailReady: false,
    deferred: ["production_smtp", "email_otp", "totp", "backup_codes", "sms", "break_glass"]
  };
}

module.exports = {
  safeUser,
  requireSuperAdminTechnicalScope,
  requireSystemAccountPermission,
  requireSensitiveAdminLevel2,
  validateAccountShape,
  assertNotFinalSuperAdmin,
  listAccounts,
  createAccount,
  patchAccount,
  resetPassword,
  changeEmail,
  unlockAccount,
  revokeSessions,
  convertAccountType,
  readiness
};
