const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const models = require("../models");
const auditService = require("./audit.service");
const permissionService = require("./permission.service");
const { AppError, ValidationError, ForbiddenError, NotFoundError } = require("../utils/errors");

const PIN_RE = /^\d{6}$/;
const MAX_CODE_LENGTH = 64;
const FAILED_VERIFY_DELAY_MS = 250;
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

function delayFailedVerification() {
  return new Promise((resolve) => setTimeout(resolve, FAILED_VERIFY_DELAY_MS));
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

function sortedUnique(values = []) {
  return [...new Set(values.map(String))].sort();
}

function sameStringSet(a = [], b = []) {
  const left = sortedUnique(a);
  const right = sortedUnique(b);
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function incrementEmployeeAuthorizationVersion({ companyId, employeeId, transaction }) {
  const employee = await getEmployeeOrThrow(companyId, employeeId, transaction);
  await employee.update({
    authorizationVersion: Number(employee.authorizationVersion || 1) + 1
  }, { transaction });
  return employee.authorizationVersion;
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
    await models.EmployeeOperationalSession.update({
      revokedAt: now,
      revokedReason: "pin_reset"
    }, {
      where: { companyId, employeeId, revokedAt: null },
      transaction: t
    });
    return { employee, credential };
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

async function createEmployeeCredentialForNewEmployee({ companyId, employeeId, pin, actorUser, transaction }) {
  validatePin(pin);
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const existing = await models.EmployeeCredential.findOne({
      where: { companyId, employeeId },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (existing) throw new ValidationError("Employee credential is already configured.", { pin: ["Employee credential is already configured."] });
    const now = new Date();
    const credential = await models.EmployeeCredential.create({
      id: id("ECRED"),
      companyId,
      employeeId,
      pinHash: await bcrypt.hash(pin, 10),
      credentialVersion: 1,
      failedAttemptCount: 0,
      lockedUntil: null,
      lastFailedAt: null,
      pinChangedAt: now,
      resetAt: now,
      resetByUserId: actorUser?.id || null,
      resetRequired: false,
      active: true
    }, { transaction: t });
    await auditService.record(companyId, {
      action: "employee.credential.created",
      description: `Employee credential configured for ${employee.employeeCode || employee.id}.`,
      user: actorName(actorUser),
      userId: actorUser?.id || null,
      technicalUserId: actorUser?.id || null,
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
      requestedLevel: 1,
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
    if (employee.status !== "present") {
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_INACTIVE" });
      return { failed: true, code: "EMPLOYEE_VERIFICATION_FAILED", statusCode: 403 };
    }
    const branchAllowed = await assertEmployeeBranchAccess({ companyId, employeeId: employee.id, branchId, transaction: t });
    if (!branchAllowed) {
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_BRANCH_FORBIDDEN" });
      return { failed: true, code: "EMPLOYEE_BRANCH_ACCESS_DENIED", statusCode: 403 };
    }
    if (!credential) {
      await bcrypt.compare(pin, DUMMY_BCRYPT_HASH);
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_VERIFICATION_FAILED" });
      return { failed: true, code: "EMPLOYEE_CREDENTIAL_REQUIRED", statusCode: 403 };
    }
    const now = new Date();
    const matches = await bcrypt.compare(pin, credential.pinHash);
    if (!matches) {
      const failedCount = Number(credential.failedAttemptCount || 0) + 1;
      await credential.update({
        failedAttemptCount: failedCount,
        lastFailedAt: now,
        lockedUntil: null
      }, { transaction: t });
      await recordVerificationAttempt({ ...attemptWithEmployee, result: "failure", failureCode: "EMPLOYEE_VERIFICATION_FAILED" });
      return { failed: true, code: "EMPLOYEE_VERIFICATION_FAILED", statusCode: 403 };
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
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    return { employee, attempt, verifiedAt: now, expiresAt, authorization: { requestedPermission, allowed }, resolved };
  });
  if (result.failed) {
    if (result.code === "EMPLOYEE_VERIFICATION_FAILED" || result.code === "EMPLOYEE_CREDENTIAL_REQUIRED") {
      await delayFailedVerification();
      throw verificationError("EMPLOYEE_VERIFICATION_FAILED", result.statusCode);
    }
    throw verificationError(result.code, result.statusCode);
  }
  return result;
}

async function updateEmployeeAuthorization({ companyId, employeeId, actorUser, roleIds = [], grantPermissionIds = [], denialPermissionIds = [], reason = null, transaction }) {
  await assertManagerPermission(actorUser, "employees.permissions.manage");
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const roleIdSet = sortedUnique(roleIds);
    const grantSet = sortedUnique(grantPermissionIds);
    const denialSet = sortedUnique(denialPermissionIds);
    const contradictions = grantSet.filter((id) => denialSet.includes(id));
    if (contradictions.length) throw new ValidationError("Permission cannot be both granted and denied.", { permissions: ["Grant and denial sets overlap."] });
    const roles = roleIdSet.length ? await models.Role.findAll({ where: { id: roleIdSet, companyId }, transaction: t }) : [];
    if (roles.length !== roleIdSet.length) throw new ValidationError("One or more roles are invalid for this company.", { roleIds: ["Invalid role ID."] });
    const permissionIds = [...new Set([...grantSet, ...denialSet])];
    const permissions = permissionIds.length ? await models.Permission.findAll({ where: { id: permissionIds }, transaction: t }) : [];
    if (permissions.length !== permissionIds.length) throw new ValidationError("One or more permissions are invalid.", { permissions: ["Invalid permission ID."] });
    const [existingRoles, existingGrants, existingDenials] = await Promise.all([
      models.EmployeeRoleAssignment.findAll({ where: { companyId, employeeId, active: true }, attributes: ["roleId"], transaction: t }),
      models.EmployeePermissionGrant.findAll({ where: { companyId, employeeId, active: true }, attributes: ["permissionId"], transaction: t }),
      models.EmployeePermissionDenial.findAll({ where: { companyId, employeeId, active: true }, attributes: ["permissionId"], transaction: t })
    ]);
    const changed =
      !sameStringSet(existingRoles.map((row) => row.roleId), roleIdSet) ||
      !sameStringSet(existingGrants.map((row) => row.permissionId), grantSet) ||
      !sameStringSet(existingDenials.map((row) => row.permissionId), denialSet);

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
      after: JSON.stringify({ roleIds: roleIdSet, grantPermissionIds: grantSet, denialPermissionIds: denialSet, reason: reason ? String(reason).trim() : null })
    }, { transaction: t });
    if (changed) {
      await incrementEmployeeAuthorizationVersion({ companyId, employeeId, transaction: t });
    }
    return resolveEmployeePermissions({ companyId, employeeId, transaction: t });
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

async function updateEmployeeBranches({ companyId, employeeId, actorUser, branchIds = [], transaction }) {
  await assertManagerPermission(actorUser, "employees.branches.manage");
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const branchIdSet = sortedUnique(branchIds);
    const branches = branchIdSet.length ? await models.Branch.findAll({ where: { id: branchIdSet, companyId, isActive: true }, transaction: t }) : [];
    if (branches.length !== branchIdSet.length) throw new ValidationError("One or more branches are invalid for this company.", { branchIds: ["Invalid branch ID."] });
    const existingBranches = await models.EmployeeBranchAccess.findAll({
      where: { companyId, employeeId, active: true },
      attributes: ["branchId"],
      transaction: t
    });
    const changed = !sameStringSet(existingBranches.map((row) => row.branchId), branchIdSet);
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
    if (changed) {
      await incrementEmployeeAuthorizationVersion({ companyId, employeeId, transaction: t });
    }
    return models.EmployeeBranchAccess.findAll({ where: { companyId, employeeId }, include: [{ model: models.Branch, as: "branch" }], transaction: t });
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

async function changeEmployeeCode({ companyId, employeeId, newCode, reason, actorUser, actorEmployeeId = null, transaction }) {
  await assertManagerPermission(actorUser, "employees.credentials.manage");
  if (!reason || !String(reason).trim()) throw new ValidationError("Reason is required.", { reason: ["Reason is required."] });
  const normalized = normalizeEmployeeCode(newCode);
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const existing = await models.Employee.findOne({
      where: { companyId, employeeCodeNormalized: normalized, id: { [Op.ne]: employeeId } },
      transaction: t
    });
    if (existing) throw new ValidationError("Employee Code is already used.", { employeeCode: ["Employee Code is already used."] });
    const oldCode = employee.employeeCode || null;
    await employee.update({
      employeeCode: String(newCode).trim(),
      employeeCodeNormalized: normalized,
      authorizationVersion: Number(employee.authorizationVersion || 1) + 1
    }, { transaction: t });
    await models.EmployeeCodeHistory.create({
      id: id("ECH"),
      companyId,
      employeeId,
      oldCode,
      newCode: String(newCode).trim(),
      changedByUserId: actorUser?.id || null,
      changedByEmployeeId: actorEmployeeId || null,
      reason: String(reason).trim()
    }, { transaction: t });
    await models.EmployeeOperationalSession.update({
      revokedAt: new Date(),
      revokedReason: "employee_code_changed"
    }, {
      where: { companyId, employeeId, revokedAt: null },
      transaction: t
    });
    await auditService.record(companyId, {
      action: "employee.code.changed",
      description: `Employee Code changed for ${employee.id}.`,
      user: actorName(actorUser),
      userId: actorUser?.id || null,
      technicalUserId: actorUser?.id || null,
      employeeId: actorEmployeeId || null,
      place: "Employees",
      sourceDocument: employee.id,
      severity: "critical",
      after: JSON.stringify({ employeeId, oldCode, newCode: String(newCode).trim(), reason: String(reason).trim() })
    }, { transaction: t });
    return employee;
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

async function changeOwnPin({ companyId, employeeId, currentPin, newPin, transaction }) {
  validatePin(currentPin);
  validatePin(newPin);
  if (currentPin === newPin) throw new ValidationError("New PIN must be different.", { pin: ["New PIN must be different."] });
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const credential = await models.EmployeeCredential.findOne({
      where: { companyId, employeeId, active: true },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!credential) throw verificationError("EMPLOYEE_VERIFICATION_FAILED", 403);
    const ok = await bcrypt.compare(currentPin, credential.pinHash);
    if (!ok) throw verificationError("EMPLOYEE_VERIFICATION_FAILED", 403);
    const now = new Date();
    await credential.update({
      pinHash: await bcrypt.hash(newPin, 10),
      credentialVersion: Number(credential.credentialVersion || 1) + 1,
      failedAttemptCount: 0,
      lockedUntil: null,
      lastFailedAt: null,
      pinChangedAt: now,
      resetRequired: false
    }, { transaction: t });
    await models.EmployeeOperationalSession.update({
      revokedAt: now,
      revokedReason: "pin_changed"
    }, {
      where: { companyId, employeeId, revokedAt: null },
      transaction: t
    });
    await auditService.record(companyId, {
      action: "employee.pin.changed",
      description: `Employee PIN changed for ${employee.employeeCode || employee.id}.`,
      user: employee.name,
      employeeId,
      employeeCodeSnapshot: employee.employeeCode || null,
      employeeNameSnapshot: employee.name || null,
      place: "Employees",
      sourceDocument: employee.id,
      severity: "warning",
      after: JSON.stringify({ employeeId, credentialVersion: credential.credentialVersion })
    }, { transaction: t });
    return { employee, credential };
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

async function unlockEmployeeCredential({ companyId, employeeId, actorUser, transaction }) {
  await assertManagerPermission(actorUser, "employees.credentials.manage");
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const credential = await models.EmployeeCredential.findOne({ where: { companyId, employeeId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!credential) throw new NotFoundError("Employee credential not found.");
    await credential.update({ failedAttemptCount: 0, lockedUntil: null, lastFailedAt: null }, { transaction: t });
    await auditService.record(companyId, {
      action: "employee.credential.unlocked",
      description: `Employee credential unlocked for ${employee.employeeCode || employee.id}.`,
      user: actorName(actorUser),
      userId: actorUser?.id || null,
      technicalUserId: actorUser?.id || null,
      place: "Employees",
      sourceDocument: employee.id,
      severity: "warning"
    }, { transaction: t });
    return { employee, credential };
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

async function revokeEmployeeOperatorSessions({ companyId, employeeId, actorUser, reason = "admin_revocation", transaction }) {
  await assertManagerPermission(actorUser, "employees.credentials.manage");
  const execute = async (t) => {
    const employee = await getEmployeeOrThrow(companyId, employeeId, t);
    const [count] = await models.EmployeeOperationalSession.update({
      revokedAt: new Date(),
      revokedReason: reason
    }, {
      where: { companyId, employeeId, revokedAt: null },
      transaction: t
    });
    await auditService.record(companyId, {
      action: "employee.operator_sessions.revoked",
      description: `Operator sessions revoked for ${employee.employeeCode || employee.id}.`,
      user: actorName(actorUser),
      userId: actorUser?.id || null,
      technicalUserId: actorUser?.id || null,
      place: "Employees",
      sourceDocument: employee.id,
      severity: "warning",
      after: JSON.stringify({ employeeId, count, reason })
    }, { transaction: t });
    return { employee, count };
  };
  return transaction ? execute(transaction) : models.sequelize.transaction(execute);
}

module.exports = {
  normalizeEmployeeCode,
  setEmployeePin,
  createEmployeeCredentialForNewEmployee,
  resetEmployeePin,
  verifyEmployeeCredential,
  assertEmployeeBranchAccess,
  resolveEmployeePermissions,
  employeeHasPermission,
  incrementEmployeeAuthorizationVersion,
  updateEmployeeAuthorization,
  updateEmployeeBranches,
  changeEmployeeCode,
  changeOwnPin,
  unlockEmployeeCredential,
  revokeEmployeeOperatorSessions,
  recordVerificationAttempt
};
