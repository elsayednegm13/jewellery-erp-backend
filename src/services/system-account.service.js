const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const models = require("../models");
const auditService = require("./audit.service");
const permissionService = require("./permission.service");
const technicalSessions = require("./technical-session.service");
const { AppError, ValidationError, ForbiddenError, NotFoundError, ConflictError } = require("../utils/errors");
const { validatePasswordPolicy } = require("../utils/password-policy");

const ACCOUNT_TYPES = new Set(["legacy", "super_admin", "branch_shell"]);

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
    isActive: plain.isActive !== false,
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
  return {
    active: true,
    accountType: "super_admin",
    operation: operation || permissionName || "system-account.sensitive",
    context: null
  };
}

async function findUserByNormalizedEmail(email, { excludeId = null, transaction = null } = {}) {
  const where = models.sequelize.where(
    models.sequelize.fn("lower", models.sequelize.col("email")),
    String(email || "").trim().toLowerCase()
  );
  return models.User.findOne({
    where: excludeId ? { [Op.and]: [where, { id: { [Op.ne]: excludeId } }] } : where,
    transaction
  });
}

function stableError(message, statusCode, code, fieldErrors = null) {
  return new AppError(message, statusCode, code, fieldErrors);
}

async function validateAccountShape({ accountType, companyId, branchId, defaultEmployeeId, transaction }) {
  if (!ACCOUNT_TYPES.has(accountType)) throw new ValidationError("Invalid account type.", { accountType: ["Invalid account type."] });
  if (accountType === "branch_shell" && !branchId) {
    throw stableError("Branch Account requires a branch.", 422, "BRANCH_ACCOUNT_BRANCH_REQUIRED", { branchId: ["Branch Account requires a branch."] });
  }
  if (accountType === "super_admin" && branchId) {
    throw new ValidationError("Super Admin must not be fixed to a branch.", { branchId: ["Super Admin cannot have a branch assignment."] });
  }
  if (branchId) {
    const branch = await models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction });
    if (!branch) throw stableError("Branch does not belong to this company or is inactive.", 422, "BRANCH_ACCOUNT_BRANCH_INACTIVE", { branchId: ["Invalid branch."] });
  }
  if (defaultEmployeeId) {
    const employee = await models.Employee.findOne({ where: { id: defaultEmployeeId, companyId, status: { [Op.ne]: "inactive" } }, transaction });
    if (!employee) throw new ValidationError("Default Employee must be active and in the same company.", { defaultEmployeeId: ["Invalid default Employee."] });
  }
}

async function assertNoBranchAccountForBranch(branchId, { excludeId = null, transaction = null } = {}) {
  if (!branchId) return;
  const where = {
    accountType: "branch_shell",
    branchId,
    deletedAt: null
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const existing = await models.User.findOne({ where, transaction, paranoid: false });
  if (existing) {
    throw stableError("A Branch Account already exists for this branch.", 409, "BRANCH_ACCOUNT_ALREADY_EXISTS", {
      branchId: ["A Branch Account already exists for this branch."]
    });
  }
}

async function activeSuperAdminCount(companyId, transaction = null) {
  return models.User.count({
    where: {
      companyId,
      accountType: "super_admin",
      deletedAt: null,
      [Op.or]: [{ lockedUntil: null }, { lockedUntil: { [Op.lte]: new Date() } }]
    },
    transaction
  });
}

async function isFinalActiveSuperAdmin(user, transaction = null) {
  if ((user?.accountType || "legacy") !== "super_admin") return false;
  const count = await activeSuperAdminCount(user.companyId, transaction);
  return count <= 1;
}

async function assertNotFinalSuperAdmin(targetUser, operation, transaction = null) {
  if ((targetUser.accountType || "legacy") !== "super_admin") return;
  const count = await activeSuperAdminCount(targetUser.companyId, transaction);
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

async function assertFinalRecoveryPathPreserved(targetUser, nextRecoveryEmail, transaction = null) {
  if ((targetUser.accountType || "legacy") !== "super_admin") return;
  if (nextRecoveryEmail) return;
  const count = await activeSuperAdminCount(targetUser.companyId, transaction);
  if (count > 1) return;
  await auditService.record(targetUser.companyId, {
    action: "system_account.final_recovery_safeguard_denied",
    description: "Final Super Admin recovery safeguard denied recovery removal.",
    user: "System",
    place: "System Accounts",
    sourceDocument: targetUser.id,
    severity: "critical",
    after: JSON.stringify({ operation: "remove_recovery_email", targetUserId: targetUser.id })
  }, { transaction });
  throw new ConflictError("Final active Super Admin must retain a recovery email.");
}

async function listAccounts(req) {
  await requireSuperAdminTechnicalScope(req);
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
  if (accountType === "branch_shell") {
    return createBranchAccount(req);
  }
  const email = normalizeEmail(body.email);
  const password = body.password || body.newPassword || body.temporaryPassword;
  if (!password) throw new ValidationError("A new password is required.", { password: ["A new password is required."] });
  validatePasswordPolicy(password, { email, firstName: body.firstName, lastName: body.lastName });
  await validateAccountShape({
    accountType,
    companyId: req.companyId,
    branchId: body.branchId || null,
    defaultEmployeeId: body.defaultEmployeeId || null
  });
  const exists = await findUserByNormalizedEmail(email);
  if (exists) throw stableError("Email is already used by another account.", 409, "EMAIL_ALREADY_USED", { email: ["Email is already used."] });
  if (accountType === "branch_shell") {
    await assertNoBranchAccountForBranch(body.branchId);
  }
  const user = await models.User.create({
    id: id("USR"),
    companyId: req.companyId,
    firstName: String(body.firstName || "System").trim(),
    lastName: String(body.lastName || "Account").trim(),
    email,
    phone: body.phone || "",
    jobTitle: body.jobTitle || "",
    role: body.role || "sales",
    isActive: body.active !== false,
    password: await bcrypt.hash(password, 10),
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
  return { account: safeUser(user), passwordSet: true };
}

async function createBranchAccount(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "system_accounts.manage", operation: "branch-account.create" });
  const body = req.body || {};
  const allowed = new Set(["branchId", "email", "password", "newPassword", "temporaryPassword", "active", "reason"]);
  const forbidden = Object.keys(body).filter((key) => !allowed.has(key));
  if (forbidden.length) {
    throw stableError("Branch Account creation accepts only branch, login email, temporary password, and active status.", 422, "VALIDATION_FAILED", {
      body: [`Forbidden fields: ${forbidden.join(", ")}`]
    });
  }
  if (!body.branchId) {
    throw stableError("Branch Account requires a branch.", 422, "BRANCH_ACCOUNT_BRANCH_REQUIRED", { branchId: ["Branch Account requires a branch."] });
  }
  const branch = await models.Branch.findOne({
    where: { id: body.branchId, isActive: true },
    include: [{ model: models.Company, as: "company", required: true }],
    attributes: ["id", "companyId", "name", "code", "isActive"]
  });
  if (!branch) {
    throw stableError("Branch does not exist or is inactive.", 422, "BRANCH_ACCOUNT_BRANCH_INACTIVE", { branchId: ["Branch is inactive or missing."] });
  }
  if (!branch.company) {
    throw stableError("Branch company is missing.", 422, "BRANCH_ACCOUNT_COMPANY_MISMATCH");
  }
  if (String(branch.companyId) !== String(req.companyId)) {
    throw stableError("Branch belongs to a different company.", 422, "BRANCH_ACCOUNT_COMPANY_MISMATCH");
  }
  const email = normalizeEmail(body.email);
  const password = body.password || body.newPassword || body.temporaryPassword;
  if (!password) throw new ValidationError("A Branch Account password is required.", { password: ["A password is required."] });
  validatePasswordPolicy(password, { email, firstName: "Branch", lastName: "Account" });
  return models.sequelize.transaction(async (transaction) => {
    await assertNoBranchAccountForBranch(branch.id, { transaction });
    const exists = await findUserByNormalizedEmail(email, { transaction });
    if (exists) throw stableError("Email is already used by another account.", 409, "EMAIL_ALREADY_USED", { email: ["Email is already used."] });
    const user = await models.User.create({
      id: id("USR"),
      companyId: branch.companyId,
      firstName: "Branch",
      lastName: branch.name || branch.code || "Account",
      email,
      phone: "",
      jobTitle: "Branch Account",
      role: "sales",
      isActive: body.active !== false,
      password: await bcrypt.hash(password, 10),
      accountType: "branch_shell",
      branchId: branch.id,
      defaultEmployeeId: null,
      forcePasswordChange: true,
      credentialsChangedAt: new Date()
    }, { transaction });
    await auditService.record(branch.companyId, {
      action: "branch_account.created",
      description: `Branch Account created for ${branch.name || branch.id}.`,
      user: actorName(req.user),
      userId: req.user.id,
      technicalUserId: req.user.id,
      place: "System Accounts",
      sourceDocument: user.id,
      severity: "warning",
      after: JSON.stringify({ targetUserId: user.id, branchId: branch.id, active: user.isActive !== false })
    }, { transaction });
    return { account: safeUser(user), passwordSet: true };
  });
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
  if ((user.accountType || "legacy") === "branch_shell") {
    const blocked = ["companyId", "accountType", "role", "defaultEmployeeId", "isActive", "active"];
    const found = blocked.filter((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
    if (found.length) throw stableError("Branch Account fixed fields cannot be changed.", 403, "BRANCH_ACCOUNT_FIXED_SCOPE");
  }
  const updates = {};
  for (const key of ["firstName", "lastName", "phone", "jobTitle", "recoveryPhone"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key] || "";
  }
  if (Object.prototype.hasOwnProperty.call(body, "recoveryEmail")) {
    const nextRecoveryEmail = body.recoveryEmail ? normalizeEmail(body.recoveryEmail) : null;
    await assertFinalRecoveryPathPreserved(user, nextRecoveryEmail, null);
    updates.recoveryEmail = nextRecoveryEmail;
  }
  if (Object.prototype.hasOwnProperty.call(body, "defaultEmployeeId")) {
    await validateAccountShape({
      accountType: user.accountType || "legacy",
      companyId: req.companyId,
      branchId: user.branchId || null,
      defaultEmployeeId: body.defaultEmployeeId || null
    });
    updates.defaultEmployeeId = body.defaultEmployeeId || null;
  }
  await models.sequelize.transaction(async (transaction) => {
    const before = user.toJSON();
    if ((user.accountType || "legacy") === "branch_shell" && Object.prototype.hasOwnProperty.call(body, "branchId")) {
      const nextBranchId = String(body.branchId || "").trim();
      if (!nextBranchId) throw stableError("Branch Account requires a branch.", 422, "BRANCH_ACCOUNT_BRANCH_REQUIRED", { branchId: ["Branch Account requires a branch."] });
      await validateAccountShape({
        accountType: "branch_shell",
        companyId: req.companyId,
        branchId: nextBranchId,
        defaultEmployeeId: null
      }, transaction);
      await assertNoBranchAccountForBranch(nextBranchId, { excludeId: user.id, transaction });
      updates.branchId = nextBranchId;
    }
    await user.update(updates, { transaction });
    if (Object.prototype.hasOwnProperty.call(updates, "branchId")) {
      await technicalSessions.bumpSessionVersion(user, "branch_account_branch_changed", transaction);
    }
    await auditService.record(req.companyId, {
      action: "system_account.updated",
      description: `System account updated for ${user.email}.`,
      user: actorName(req.user),
      userId: req.user.id,
      technicalUserId: req.user.id,
      place: "System Accounts",
      sourceDocument: user.id,
      severity: "warning",
      before: JSON.stringify({ targetUserId: user.id, branchId: before.branchId || null }),
      after: JSON.stringify({ targetUserId: user.id, fields: Object.keys(updates), branchId: user.branchId || null })
    }, { transaction });
  });
  return safeUser(user);
}

async function resetPassword(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "system_accounts.credentials.reset", operation: "system-account.reset-password" });
  const user = await getAccountOrThrow(req.companyId, req.params.id);
  const password = req.body?.password || req.body?.newPassword || req.body?.temporaryPassword;
  if (!password) throw new ValidationError("A new password is required.", { password: ["A new password is required."] });
  validatePasswordPolicy(password, { email: user.email, firstName: user.firstName, lastName: user.lastName });
  await models.sequelize.transaction(async (transaction) => {
    await user.update({
      password: await bcrypt.hash(password, 10),
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
  return { account: safeUser(user), passwordSet: true };
}

async function changeEmail(req) {
  await requireSensitiveAdminLevel2(req, { permissionName: "system_accounts.manage", operation: "system-account.change-email" });
  const user = await getAccountOrThrow(req.companyId, req.params.id);
  const email = normalizeEmail(req.body?.email);
  if (String(user.id) === String(req.user.id)) {
    const currentPassword = String(req.body?.currentPassword || "");
    if (!currentPassword) throw new ValidationError("Current password is required.", { currentPassword: ["Current password is required."] });
    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) throw new ValidationError("Current password is invalid.", { currentPassword: ["Current password is invalid."] });
  }
  const exists = await findUserByNormalizedEmail(email, { excludeId: user.id });
  if (exists) throw stableError("Email is already used by another account.", 409, "EMAIL_ALREADY_USED", { email: ["Email is already used."] });
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

async function setActive(req, active) {
  await requireSensitiveAdminLevel2(req, { permissionName: "system_accounts.manage", operation: active ? "system-account.activate" : "system-account.deactivate" });
  const user = await getAccountOrThrow(req.companyId, req.params.id);
  if (!active) await assertNotFinalSuperAdmin(user, "deactivate", null);
  await models.sequelize.transaction(async (transaction) => {
    await user.update({ isActive: Boolean(active) }, { transaction });
    await technicalSessions.bumpSessionVersion(user, active ? "account_activated" : "account_deactivated", transaction);
    await auditService.record(req.companyId, {
      action: active ? "system_account.activated" : "system_account.deactivated",
      description: `${active ? "Activated" : "Deactivated"} system account ${user.email}.`,
      user: actorName(req.user),
      userId: req.user.id,
      technicalUserId: req.user.id,
      place: "System Accounts",
      sourceDocument: user.id,
      severity: "warning",
      after: JSON.stringify({ targetUserId: user.id, active: Boolean(active), reason: req.body?.reason || null })
    }, { transaction });
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
  if (targetType === "branch_shell") {
    await assertNoBranchAccountForBranch(body.branchId, { excludeId: user.id });
  }
  await models.sequelize.transaction(async (transaction) => {
    await user.update({
      accountType: targetType,
      branchId: targetType === "branch_shell" ? body.branchId : null,
      defaultEmployeeId: targetType === "branch_shell" ? null : (body.defaultEmployeeId || user.defaultEmployeeId || null)
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
  const currentAccountType = req.user?.accountType || "legacy";
  const [superAdmins, superAdminsWithRecovery, branchShells, eligibleEmployees] = await Promise.all([
    models.User.count({ where: { companyId: req.companyId, accountType: "super_admin" } }),
    models.User.count({ where: { companyId: req.companyId, accountType: "super_admin", recoveryEmail: { [Op.ne]: null } } }),
    models.User.count({ where: { companyId: req.companyId, accountType: "branch_shell", branchId: { [Op.ne]: null } } }),
    models.Employee.count({ where: { companyId: req.companyId, status: "present", employeeCode: { [Op.ne]: null } } })
  ]);
  if (currentAccountType !== "super_admin" && superAdmins > 0) {
    await requireSuperAdminTechnicalScope(req);
  }
  return {
    superAdmins,
    bootstrapNeeded: superAdmins === 0,
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
  assertFinalRecoveryPathPreserved,
  isFinalActiveSuperAdmin,
  listAccounts,
  createAccount,
  createBranchAccount,
  patchAccount,
  resetPassword,
  changeEmail,
  unlockAccount,
  revokeSessions,
  setActive,
  convertAccountType,
  readiness
};
