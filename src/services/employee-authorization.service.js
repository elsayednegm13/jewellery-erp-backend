const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const models = require("../models");
const auditService = require("./audit.service");
const permissionService = require("./permission.service");
const { AppError, ValidationError, ForbiddenError, NotFoundError } = require("../utils/errors");

const PIN_RE = /^\d{6}$/;
const MAX_CODE_LENGTH = 64;
const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;
const LEVEL2_FRESHNESS_MINUTES = 5;
const DUMMY_BCRYPT_HASH = "$2a$10$7EqJtq98hPqEX7fNZaFWoOhiHNO7Q8NOq8B4EGKGU9Yh/8q0LJcMK"; // bcrypt("000000")

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function actorName(user) {
  return user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || user.id : "System";
}

function normalizeEmployeeCode(value) {
  if (typeof value !== "string") throw new ValidationError("Employee Code is required.", { employeeCode: ["Employee Code must be a string."] });
  const normalized = value.trim().normalize("NFKC").toUpperCase();
  if (!normalized) throw new ValidationError("Employee Code is required.", { employeeCode: ["Employee Code is required."] });
  if (normalized.length > MAX_CODE_LENGTH) throw new ValidationError("Employee Code is too long.", { employeeCode: [`Employee Code must be ${MAX_CODE_LENGTH} characters or fewer.`] });
  return normalized;
}

function validatePin(pin) {
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    throw new ValidationError("PIN must be exactly 6 numeric digits.", { pin: ["PIN must be exactly 6 numeric digits."] });
  }
}

function verificationError(code = "EMPLOYEE_VERIFICATION_FAILED", statusCode = 403) {
  return new AppError("Employee verification failed.", statusCode, code);
}

async function assertManagerPermission(user, permission) {
  const allowed = await permissionService.userHasPermission(user, permission);
  if (!allowed) throw new ForbiddenError(`${permission} is required.`);
}

async function recordVerificationAttempt({
  companyId,
  branchId,
  technicalUserId,
  employeeId = null,
  employeeCodeNormalized = null,
  requestedPermission = null,
  requestedOperation = null,
  requestedLevel,
  result,
  failureCode = null,
  ipAddress = null,
  userAgent = null,
  transaction
}) {
  return models.EmployeeVerificationAttempt.create({
    id: id("EVA"),
    companyId,
    branchId: branchId || null,
    technicalUserId: technicalUserId || null,
    employeeId,
    employeeCodeNormalized,
    requestedPermission,
    requestedOperation,
    requestedLevel,
    result,
    failureCode,
    ipAddress,
    userAgent
  }, { transaction });
}

async function getEmployeeOrThrow(companyId, employeeId, transaction) {
  const employee = await models.Employee.findOne({ where: { id: employeeId, companyId }, transaction });
  if (!employee) throw new NotFoundError("Employee not found.");
  return employee;
}

async function setEmployeePin({ companyId, employeeId, pin, resetRequired = false, actorUser, transaction }) {
  await assertManagerPermission(actorUser, "employees.credentials.manage");
  validatePin(pin);
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const pinHash = await bcrypt.hash(pin, 10);
    const existing = await models.EmployeeCredential.findOne({
      where: { companyId, employeeId },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    const now = new Date();
    let credential;
    if (existing) {
      await existing.update({
        pinHash,
        credentialVersion: Number(existing.credentialVersion || 1) + 1,
        failedAttemptCount: 0,
        lockedUntil: null,
        lastFailedAt: null,
        pinChangedAt: now,
        resetAt: now,
        resetByUserId: actorUser?.id || null,
        resetRequired: Boolean(resetRequired),
        active: true
      }, { transaction: t });
      credential = existing;
    } else {
      credential = await models.EmployeeCredential.create({
        id: id("ECRED"),
        companyId,
        employeeId,
        pinHash,
        credentialVersion: 1,
        failedAttemptCount: 0,
        pinChangedAt: now,
        resetAt: now,
        resetByUserId: actorUser?.id || null,
        resetRequired: Boolean(resetRequired),
        active: true
      }, { transaction: t });
    }
    await auditService.record(companyId, {
      action: "employee.credential.reset",
      description: `Employee credential reset for ${employee.employeeCode || employee.id}.`,
      user: actorName(actorUser),
      userId: actorUser?.id || null,
      place: "Employees",
      sourceDocument: employee.id,
      severity: "warning",
      after: JSON.stringify({ employeeId: employee.id, credentialVersion: credential.credentialVersion, resetRequired: credential.resetRequired })
    }, { transaction: t });
    return { employee, credential };
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

async function resetEmployeePin(args) {
  return setEmployeePin(args);
}

async function assertEmployeeBranchAccess({ companyId, employeeId, branchId, transaction }) {
  const branch = await models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction });
  if (!branch) return false;
  const access = await models.EmployeeBranchAccess.findOne({
    where: {
      companyId,
      employeeId,
      branchId,
      active: true,
      [Op.and]: [
        { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: new Date() } }] },
        { [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: new Date() } }] }
      ]
    },
    transaction
  });
  return Boolean(access);
}

async function resolveEmployeePermissions({ companyId, employeeId, branchId = null, transaction = null }) {
  const employee = await getEmployeeOrThrow(companyId, employeeId, transaction);
  if (branchId) {
    const hasBranch = await assertEmployeeBranchAccess({ companyId, employeeId, branchId, transaction });
    if (!hasBranch) {
      return { employee, rolePermissionNames: [], directGrantNames: [], directDenialNames: [], effectivePermissionNames: [] };
    }
  }
  const roleAssignments = await models.EmployeeRoleAssignment.findAll({
    where: { companyId, employeeId, active: true },
    include: [{ model: models.Role, as: "role", include: [{ model: models.Permission, as: "permissions", through: { attributes: [] } }] }],
    transaction
  });
  const rolePermissions = new Set();
  for (const assignment of roleAssignments) {
    if (assignment.role?.companyId !== companyId) continue;
    for (const permission of assignment.role.permissions || []) rolePermissions.add(permission.name);
  }
  const grants = await models.EmployeePermissionGrant.findAll({
    where: { companyId, employeeId, active: true },
    include: [{ model: models.Permission, as: "permission" }],
    transaction
  });
  const denials = await models.EmployeePermissionDenial.findAll({
    where: { companyId, employeeId, active: true },
    include: [{ model: models.Permission, as: "permission" }],
    transaction
  });
  const directGrantNames = new Set(grants.map((row) => row.permission?.name).filter(Boolean));
  const directDenialNames = new Set(denials.map((row) => row.permission?.name).filter(Boolean));
  const effective = new Set([...rolePermissions, ...directGrantNames]);
  for (const denied of directDenialNames) effective.delete(denied);
  return {
    employee,
    rolePermissionNames: [...rolePermissions].sort(),
    directGrantNames: [...directGrantNames].sort(),
    directDenialNames: [...directDenialNames].sort(),
    effectivePermissionNames: [...effective].sort()
  };
}

async function employeeHasPermission(args, permissionName) {
  const resolved = await resolveEmployeePermissions(args);
  return resolved.effectivePermissionNames.includes(permissionName);
}

async function verifyEmployeeCredential({
  companyId,
  branchId,
  user,
  employeeCode,
  pin,
  requestedLevel = 1,
  requestedPermission = null,
  requestedOperation = null,
  ipAddress = null,
  userAgent = null
}) {
  validatePin(pin);
  if (![1, 2].includes(Number(requestedLevel))) throw new ValidationError("requestedLevel must be 1 or 2.", { requestedLevel: ["requestedLevel must be 1 or 2."] });
  if (!branchId) throw new ValidationError("branchId is required.", { branchId: ["branchId is required."] });
  if (requestedOperation && String(requestedOperation).length > 160) throw new ValidationError("requestedOperation is too long.", { requestedOperation: ["requestedOperation is too long."] });
  const normalized = normalizeEmployeeCode(employeeCode);
  if (requestedPermission) {
    const permission = await models.Permission.findOne({ where: { name: requestedPermission } });
    if (!permission) throw new ValidationError("requestedPermission does not exist.", { requestedPermission: ["Unknown permission."] });
  }

  const result = await models.sequelize.transaction(async (t) => {
    const baseAttempt = {
      companyId,
      branchId,
      technicalUserId: user?.id || null,
      employeeCodeNormalized: normalized,
      requestedPermission,
      requestedOperation,
      requestedLevel: Number(requestedLevel),
      ipAddress,
      userAgent,
      transaction: t
    };
    const employee = await models.Employee.findOne({ where: { companyId, employeeCodeNormalized: normalized }, transaction: t });
    if (!employee) {
      await bcrypt.compare(pin, DUMMY_BCRYPT_HASH);
      const attempt = await recordVerificationAttempt({ ...baseAttempt, result: "failure", failureCode: "EMPLOYEE_VERIFICATION_FAILED" });
      return { failed: true, code: attempt.failureCode, statusCode: 403 };
    }
    const credential = await models.EmployeeCredential.findOne({
      where: { companyId, employeeId: employee.id, active: true },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    const attemptWithEmployee = { ...baseAttempt, employeeId: employee.id };
    if (employee.status === "inactive") {
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_INACTIVE" });
      return { failed: true, code: "EMPLOYEE_VERIFICATION_FAILED", statusCode: 403 };
    }
    if (employee.status === "leave" && Number(requestedLevel) === 2) {
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_STATUS_LEVEL_DENIED" });
      return { failed: true, code: "EMPLOYEE_VERIFICATION_FAILED", statusCode: 403 };
    }
    const branchAllowed = await assertEmployeeBranchAccess({ companyId, employeeId: employee.id, branchId, transaction: t });
    if (!branchAllowed) {
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_BRANCH_FORBIDDEN" });
      return { failed: true, code: "EMPLOYEE_VERIFICATION_FAILED", statusCode: 403 };
    }
    if (!credential) {
      await bcrypt.compare(pin, DUMMY_BCRYPT_HASH);
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_VERIFICATION_FAILED" });
      return { failed: true, code: "EMPLOYEE_VERIFICATION_FAILED", statusCode: 403 };
    }
    const now = new Date();
    if (credential.lockedUntil && new Date(credential.lockedUntil) > now) {
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_LOCKED" });
      return { failed: true, code: "EMPLOYEE_LOCKED", statusCode: 423 };
    }
    const matches = await bcrypt.compare(pin, credential.pinHash);
    if (!matches) {
      const failedCount = Number(credential.failedAttemptCount || 0) + 1;
      const lockedUntil = failedCount >= MAX_FAILURES ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000) : null;
      await credential.update({
        failedAttemptCount: failedCount,
        lastFailedAt: now,
        lockedUntil
      }, { transaction: t });
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: lockedUntil ? "EMPLOYEE_LOCKED" : "EMPLOYEE_VERIFICATION_FAILED" });
      return { failed: true, code: lockedUntil ? "EMPLOYEE_LOCKED" : "EMPLOYEE_VERIFICATION_FAILED", statusCode: lockedUntil ? 423 : 403 };
    }
    let allowed = true;
    let resolved = null;
    if (requestedPermission) {
      resolved = await resolveEmployeePermissions({ companyId, employeeId: employee.id, branchId, transaction: t });
      allowed = resolved.effectivePermissionNames.includes(requestedPermission);
      if (!allowed) {
        await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_PERMISSION_DENIED" });
        return { failed: true, code: "EMPLOYEE_PERMISSION_DENIED", statusCode: 403 };
      }
    }
    await credential.update({
      failedAttemptCount: 0,
      lastFailedAt: null,
      lockedUntil: null,
      lastVerifiedAt: now
    }, { transaction: t });
    const attempt = await recordVerificationAttempt({ ...attemptWithEmployee, result: "success", failureCode: null });
    const expiresAt = new Date(now.getTime() + (Number(requestedLevel) === 2 ? LEVEL2_FRESHNESS_MINUTES : 15) * 60 * 1000);
    return { employee, attempt, verifiedAt: now, expiresAt, authorization: { requestedPermission, allowed }, resolved };
  });
  if (result.failed) throw verificationError(result.code, result.statusCode);
  return result;
}

async function updateEmployeeAuthorization({ companyId, employeeId, actorUser, roleIds = [], grantPermissionIds = [], denialPermissionIds = [], transaction }) {
  await assertManagerPermission(actorUser, "employees.permissions.manage");
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const roleIdSet = [...new Set(roleIds)];
    const grantSet = [...new Set(grantPermissionIds)];
    const denialSet = [...new Set(denialPermissionIds)];
    const contradictions = grantSet.filter((id) => denialSet.includes(id));
    if (contradictions.length) throw new ValidationError("Permission cannot be both granted and denied.", { permissions: ["Grant and denial sets overlap."] });
    const roles = roleIdSet.length ? await models.Role.findAll({ where: { id: roleIdSet, companyId }, transaction: t }) : [];
    if (roles.length !== roleIdSet.length) throw new ValidationError("One or more roles are invalid for this company.", { roleIds: ["Invalid role ID."] });
    const permissionIds = [...new Set([...grantSet, ...denialSet])];
    const permissions = permissionIds.length ? await models.Permission.findAll({ where: { id: permissionIds }, transaction: t }) : [];
    if (permissions.length !== permissionIds.length) throw new ValidationError("One or more permissions are invalid.", { permissions: ["Invalid permission ID."] });
    await models.EmployeeRoleAssignment.destroy({ where: { companyId, employeeId }, transaction: t });
    await models.EmployeePermissionGrant.destroy({ where: { companyId, employeeId }, transaction: t });
    await models.EmployeePermissionDenial.destroy({ where: { companyId, employeeId }, transaction: t });
    await models.EmployeeRoleAssignment.bulkCreate(roleIdSet.map((roleId) => ({
      id: id("ERA"), companyId, employeeId, roleId, assignedByUserId: actorUser?.id || null, active: true
    })), { transaction: t });
    await models.EmployeePermissionGrant.bulkCreate(grantSet.map((permissionId) => ({
      id: id("EPG"), companyId, employeeId, permissionId, grantedByUserId: actorUser?.id || null, active: true
    })), { transaction: t });
    await models.EmployeePermissionDenial.bulkCreate(denialSet.map((permissionId) => ({
      id: id("EPD"), companyId, employeeId, permissionId, deniedByUserId: actorUser?.id || null, active: true
    })), { transaction: t });
    await auditService.record(companyId, {
      action: "employee.authorization.updated",
      description: `Employee authorization updated for ${employee.employeeCode || employee.id}.`,
      user: actorName(actorUser),
      userId: actorUser?.id || null,
      place: "Employees",
      sourceDocument: employee.id,
      after: JSON.stringify({ roleIds: roleIdSet, grantPermissionIds: grantSet, denialPermissionIds: denialSet })
    }, { transaction: t });
    return resolveEmployeePermissions({ companyId, employeeId, transaction: t });
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

async function updateEmployeeBranches({ companyId, employeeId, actorUser, branchIds = [], transaction }) {
  await assertManagerPermission(actorUser, "employees.branches.manage");
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const branchIdSet = [...new Set(branchIds)];
    const branches = branchIdSet.length ? await models.Branch.findAll({ where: { id: branchIdSet, companyId, isActive: true }, transaction: t }) : [];
    if (branches.length !== branchIdSet.length) throw new ValidationError("One or more branches are invalid for this company.", { branchIds: ["Invalid branch ID."] });
    await models.EmployeeBranchAccess.destroy({ where: { companyId, employeeId }, transaction: t });
    await models.EmployeeBranchAccess.bulkCreate(branchIdSet.map((branchId) => ({
      id: id("EBA"), companyId, employeeId, branchId, active: true, validFrom: new Date(), createdByUserId: actorUser?.id || null
    })), { transaction: t });
    await auditService.record(companyId, {
      action: "employee.branches.updated",
      description: `Employee branch access updated for ${employee.employeeCode || employee.id}.`,
      user: actorName(actorUser),
      userId: actorUser?.id || null,
      place: "Employees",
      sourceDocument: employee.id,
      after: JSON.stringify({ branchIds: branchIdSet })
    }, { transaction: t });
    return models.EmployeeBranchAccess.findAll({ where: { companyId, employeeId }, include: [{ model: models.Branch, as: "branch" }], transaction: t });
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

module.exports = {
  normalizeEmployeeCode,
  setEmployeePin,
  resetEmployeePin,
  verifyEmployeeCredential,
  assertEmployeeBranchAccess,
  resolveEmployeePermissions,
  employeeHasPermission,
  updateEmployeeAuthorization,
  updateEmployeeBranches,
  recordVerificationAttempt
};
