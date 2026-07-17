const express = require("express");
const { Op } = require("sequelize");
const models = require("../models");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const employeeAuth = require("../services/employee-authorization.service");
const operatorSessionService = require("../services/operator-session.service");
const systemAccounts = require("../services/system-account.service");
const { ValidationError, NotFoundError } = require("../utils/errors");

const router = express.Router();

function employeeSafe(employee) {
  if (!employee) return null;
  return {
    id: employee.id,
    employeeCode: employee.employeeCode || null,
    name: employee.name,
    status: employee.status,
    branchId: employee.branchId || null
  };
}

function branchAccessSafe(row) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    branchId: row.branchId,
    active: row.active,
    validFrom: row.validFrom,
    validTo: row.validTo,
    branch: row.branch ? { id: row.branch.id, name: row.branch.name, code: row.branch.code } : null
  };
}

function attemptSafe(row) {
  return {
    id: row.id,
    branchId: row.branchId,
    technicalUserId: row.technicalUserId,
    employeeId: row.employeeId,
    employeeCodeNormalized: row.employeeCodeNormalized,
    requestedPermission: row.requestedPermission,
    requestedOperation: row.requestedOperation,
    requestedLevel: row.requestedLevel,
    result: row.result,
    failureCode: row.failureCode,
    ipAddress: maskIp(row.ipAddress),
    userAgent: summarizeUserAgent(row.userAgent),
    createdAt: row.createdAt
  };
}

function maskIp(value) {
  if (!value) return null;
  const text = String(value);
  if (text.includes(":")) return `${text.slice(0, 6)}…`;
  const parts = text.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`;
  return "masked";
}

function summarizeUserAgent(value) {
  if (!value) return null;
  const text = String(value);
  if (/Chrome/i.test(text)) return "Chrome";
  if (/Firefox/i.test(text)) return "Firefox";
  if (/Safari/i.test(text)) return "Safari";
  if (/Edg/i.test(text)) return "Edge";
  return "Browser";
}

function maskedDeviceLabel(value) {
  const text = String(value || "");
  if (!text) return null;
  return `device-••••${text.slice(-6)}`;
}

function operationalSessionState(row) {
  const now = new Date();
  if (row.lockedAt) return "locked";
  if (row.revokedAt) return "revoked";
  if (row.absoluteExpiresAt && new Date(row.absoluteExpiresAt) <= now) return "absolute_expired";
  if (row.idleExpiresAt && new Date(row.idleExpiresAt) <= now) return "idle_expired";
  return "active";
}

function operationalSessionSafe(row) {
  return {
    id: row.id,
    state: operationalSessionState(row),
    maskedDeviceLabel: maskedDeviceLabel(row.deviceSessionId),
    branch: row.branch ? { id: row.branch.id, name: row.branch.name, code: row.branch.code } : { id: row.branchId },
    technicalUser: row.sessionUser ? {
      id: row.sessionUser.id,
      name: `${row.sessionUser.firstName || ""} ${row.sessionUser.lastName || ""}`.trim() || row.sessionUser.email,
      email: row.sessionUser.email
    } : null,
    verifiedAt: row.verifiedAt,
    lastActivityAt: row.lastActivityAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    lockedAt: row.lockedAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason
  };
}

function authorizationSafe(resolved) {
  return {
    rolePermissionNames: resolved.rolePermissionNames,
    directGrantNames: resolved.directGrantNames,
    directDenialNames: resolved.directDenialNames,
    effectivePermissionNames: resolved.effectivePermissionNames,
    authorizationVersion: resolved.employee?.authorizationVersion || 1
  };
}

async function assertEmployee(companyId, employeeId) {
  const employee = await models.Employee.findOne({ where: { id: employeeId, companyId } });
  if (!employee) throw new NotFoundError("Employee not found.");
  return employee;
}

function permissionSafe(permission) {
  if (!permission) return null;
  return {
    id: permission.id,
    name: permission.name,
    module: permission.module,
    action: permission.action,
    description: permission.description || null
  };
}

function permissionSourceFor(name, resolved) {
  const inRole = resolved.rolePermissionNames.includes(name);
  const inGrant = resolved.directGrantNames.includes(name);
  const inDenial = resolved.directDenialNames.includes(name);
  const isEffective = resolved.effectivePermissionNames.includes(name);
  let source = "NOT_GRANTED";
  if (inDenial) source = "DENIED";
  else if (inRole && inGrant) source = "ROLE_AND_DIRECT_GRANT";
  else if (inRole) source = "ROLE";
  else if (inGrant) source = "DIRECT_GRANT";
  return { name, source, effective: isEffective, denied: inDenial, role: inRole, directGrant: inGrant, directDenial: inDenial };
}

async function employeePermissionResponse(companyId, employeeId, resolvedOverride = null) {
  const [resolved, roles, grants, denials, catalog] = await Promise.all([
    resolvedOverride || employeeAuth.resolveEmployeePermissions({ companyId, employeeId }),
    models.EmployeeRoleAssignment.findAll({ where: { companyId, employeeId, active: true }, include: [{ model: models.Role, as: "role" }] }),
    models.EmployeePermissionGrant.findAll({ where: { companyId, employeeId, active: true }, include: [{ model: models.Permission, as: "permission" }] }),
    models.EmployeePermissionDenial.findAll({ where: { companyId, employeeId, active: true }, include: [{ model: models.Permission, as: "permission" }] }),
    models.Permission.findAll({ order: [["module", "ASC"], ["action", "ASC"], ["name", "ASC"]] })
  ]);
  const byName = new Map(catalog.map((permission) => [permission.name, permission]));
  const fromNames = (names) => names.map((name) => permissionSafe(byName.get(name) || { id: name, name, module: name.split(".")[0] || "general", action: name.split(".").slice(1).join(".") })).filter(Boolean);
  const effectiveSources = catalog.map((permission) => ({
    ...permissionSafe(permission),
    ...permissionSourceFor(permission.name, resolved)
  }));
  return {
    employeeId,
    assignableCatalog: catalog.map(permissionSafe).filter(Boolean),
    roles: roles.map((row) => row.role).filter(Boolean),
    rolePermissions: fromNames(resolved.rolePermissionNames),
    grants: grants.map((row) => permissionSafe(row.permission)).filter(Boolean),
    directGrants: grants.map((row) => permissionSafe(row.permission)).filter(Boolean),
    denials: denials.map((row) => permissionSafe(row.permission)).filter(Boolean),
    directDenials: denials.map((row) => permissionSafe(row.permission)).filter(Boolean),
    effectivePermissions: fromNames(resolved.effectivePermissionNames),
    effectiveSources,
    authorizationVersion: resolved.employee?.authorizationVersion || 1,
    authorization: authorizationSafe(resolved)
  };
}

router.post("/operator/verify", authMiddleware, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.employeeCode || !body.pin || !body.branchId) {
      throw new ValidationError("employeeCode, pin and branchId are required.");
    }
    const result = await operatorSessionService.verifyOperator({ req, body });
    return res.status(200).json({
      success: true,
      data: {
        employee: employeeSafe(result.employee),
        verification: {
          state: result.verification.state,
          verifiedAt: result.verification.verifiedAt,
          expiresAt: result.verification.expiresAt,
          absoluteExpiresAt: result.verification.absoluteExpiresAt,
          verificationAttemptId: result.verification.verificationAttemptId
        },
        operatorSession: operatorSessionService.sessionSafe(result.session),
        authorization: result.authorization
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/operator/current", authMiddleware, async (req, res, next) => {
  try {
    const result = await operatorSessionService.currentFromRequest(req, { touch: false });
    return res.status(200).json({
      success: true,
      data: {
        operatorSession: operatorSessionService.sessionSafe(result.session, result.active ? "active" : "inactive", result.reason),
        active: result.active,
        reason: result.reason,
        authorization: result.active ? result.authorization : null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/operator/lock", authMiddleware, async (req, res, next) => {
  try {
    const session = await operatorSessionService.lockCurrent(req, req.body?.reason || "manual_lock");
    return res.status(200).json({
      success: true,
      data: {
        operatorSession: operatorSessionService.sessionSafe(session, "locked", "OPERATOR_SESSION_LOCKED")
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/operator/end-session", authMiddleware, async (req, res, next) => {
  try {
    const session = await operatorSessionService.endCurrent(req, req.body?.reason || "operator_session_ended");
    return res.status(200).json({
      success: true,
      data: {
        operatorSession: operatorSessionService.sessionSafe(session, "inactive", "OPERATOR_SESSION_ENDED")
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/operator/change-pin", authMiddleware, async (req, res, next) => {
  try {
    const current = await operatorSessionService.currentFromRequest(req, {
      touch: false,
      requestedOperation: "employee.pin.self_change"
    });
    if (!current.active) throw operatorSessionService.operatorError(current.reason || "OPERATOR_SESSION_REQUIRED", current.statusCode || 401);
    if (req.body?.newPin !== req.body?.confirmation) {
      throw new ValidationError("PIN confirmation does not match.", { confirmation: ["PIN confirmation does not match."] });
    }
    const result = await employeeAuth.changeOwnPin({
      companyId: req.companyId,
      employeeId: current.session.employeeId,
      currentPin: req.body?.currentPin,
      newPin: req.body?.newPin
    });
    return res.status(200).json({
      success: true,
      data: {
        employee: employeeSafe(result.employee),
        credential: {
          credentialVersion: result.credential.credentialVersion,
          resetRequired: result.credential.resetRequired,
          pinChangedAt: result.credential.pinChangedAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/employees/:id/credential/reset", authMiddleware, requirePermission("employees.credentials.manage"), async (req, res, next) => {
  try {
    await systemAccounts.requireSensitiveAdminLevel2(req, { permissionName: "employees.credentials.manage", operation: "employee.pin.reset" });
    const result = await employeeAuth.resetEmployeePin({
      companyId: req.companyId,
      employeeId: req.params.id,
      pin: req.body?.pin,
      resetRequired: Boolean(req.body?.resetRequired),
      actorUser: req.user
    });
    return res.status(200).json({
      success: true,
      data: {
        employee: employeeSafe(result.employee),
        credential: {
          credentialVersion: result.credential.credentialVersion,
          resetRequired: result.credential.resetRequired,
          active: result.credential.active,
          pinChangedAt: result.credential.pinChangedAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/employees/:id/credential/unlock", authMiddleware, requirePermission("employees.credentials.manage"), async (req, res, next) => {
  try {
    await systemAccounts.requireSensitiveAdminLevel2(req, { permissionName: "employees.credentials.manage", operation: "employee.credential.unlock" });
    const result = await employeeAuth.unlockEmployeeCredential({
      companyId: req.companyId,
      employeeId: req.params.id,
      actorUser: req.user
    });
    return res.status(200).json({
      success: true,
      data: {
        employee: employeeSafe(result.employee),
        credential: {
          credentialVersion: result.credential.credentialVersion,
          failedAttemptCount: result.credential.failedAttemptCount,
          lockedUntil: result.credential.lockedUntil
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/employees/:id/credential/revoke-sessions", authMiddleware, requirePermission("employees.credentials.manage"), async (req, res, next) => {
  try {
    await systemAccounts.requireSensitiveAdminLevel2(req, { permissionName: "employees.credentials.manage", operation: "employee.operator-sessions.revoke" });
    const result = await employeeAuth.revokeEmployeeOperatorSessions({
      companyId: req.companyId,
      employeeId: req.params.id,
      actorUser: req.user,
      reason: req.body?.reason || "admin_revocation"
    });
    return res.status(200).json({ success: true, data: { employee: employeeSafe(result.employee), revoked: result.count } });
  } catch (error) {
    next(error);
  }
});

router.post("/employees/:id/change-code", authMiddleware, requirePermission("employees.credentials.manage"), async (req, res, next) => {
  try {
    const current = await systemAccounts.requireSensitiveAdminLevel2(req, { permissionName: "employees.credentials.manage", operation: "employee.code.change" });
    const employee = await employeeAuth.changeEmployeeCode({
      companyId: req.companyId,
      employeeId: req.params.id,
      newCode: req.body?.employeeCode,
      reason: req.body?.reason,
      actorUser: req.user,
      actorEmployeeId: current.session?.employeeId || null
    });
    return res.status(200).json({ success: true, data: { employee: employeeSafe(employee) } });
  } catch (error) {
    next(error);
  }
});

router.get("/employees/:id/code-history", authMiddleware, requirePermission("employees.credentials.manage"), async (req, res, next) => {
  try {
    await assertEmployee(req.companyId, req.params.id);
    const rows = await models.EmployeeCodeHistory.findAll({
      where: { companyId: req.companyId, employeeId: req.params.id },
      order: [["createdAt", "DESC"]]
    });
    return res.status(200).json({
      success: true,
      data: {
        items: rows.map((row) => ({
          id: row.id,
          oldCode: row.oldCode,
          newCode: row.newCode,
          changedByUserId: row.changedByUserId,
          changedByEmployeeId: row.changedByEmployeeId,
          reason: row.reason,
          createdAt: row.createdAt
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/employees/:id/branches", authMiddleware, requirePermission("employees.branches.manage"), async (req, res, next) => {
  try {
    await assertEmployee(req.companyId, req.params.id);
    const rows = await models.EmployeeBranchAccess.findAll({
      where: { companyId: req.companyId, employeeId: req.params.id },
      include: [{ model: models.Branch, as: "branch" }],
      order: [["createdAt", "ASC"]]
    });
    return res.status(200).json({ success: true, data: { items: rows.map(branchAccessSafe) }, items: rows.map(branchAccessSafe) });
  } catch (error) {
    next(error);
  }
});

router.put("/employees/:id/branches", authMiddleware, requirePermission("employees.branches.manage"), async (req, res, next) => {
  try {
    const branchIds = Array.isArray(req.body?.branchIds) ? req.body.branchIds.map(String) : [];
    const rows = await employeeAuth.updateEmployeeBranches({
      companyId: req.companyId,
      employeeId: req.params.id,
      actorUser: req.user,
      branchIds
    });
    return res.status(200).json({ success: true, data: { items: rows.map(branchAccessSafe) }, items: rows.map(branchAccessSafe) });
  } catch (error) {
    next(error);
  }
});

router.get("/employees/:id/permissions", authMiddleware, requirePermission("employees.permissions.manage"), async (req, res, next) => {
  try {
    await assertEmployee(req.companyId, req.params.id);
    return res.status(200).json({ success: true, data: await employeePermissionResponse(req.companyId, req.params.id) });
  } catch (error) {
    next(error);
  }
});

router.put("/employees/:id/permissions", authMiddleware, requirePermission("employees.permissions.manage"), async (req, res, next) => {
  try {
    const resolved = await employeeAuth.updateEmployeeAuthorization({
      companyId: req.companyId,
      employeeId: req.params.id,
      actorUser: req.user,
      roleIds: Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(String) : [],
      grantPermissionIds: Array.isArray(req.body?.grantPermissionIds) ? req.body.grantPermissionIds.map(String) : [],
      denialPermissionIds: Array.isArray(req.body?.denialPermissionIds) ? req.body.denialPermissionIds.map(String) : [],
      reason: req.body?.reason || null
    });
    return res.status(200).json({ success: true, data: await employeePermissionResponse(req.companyId, req.params.id, resolved) });
  } catch (error) {
    next(error);
  }
});

router.get("/employees/:id/verification-attempts", authMiddleware, requirePermission("employees.verification.view"), async (req, res, next) => {
  try {
    await assertEmployee(req.companyId, req.params.id);
    const page = Math.max(1, Number.parseInt(req.query.page || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize || req.query.limit || "25", 10) || 25));
    const where = { companyId: req.companyId, employeeId: req.params.id };
    if (req.query.result) where.result = String(req.query.result);
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt[Op.gte] = new Date(String(req.query.from));
      if (req.query.to) where.createdAt[Op.lte] = new Date(String(req.query.to));
    }
    const { rows, count } = await models.EmployeeVerificationAttempt.findAndCountAll({
      where,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    return res.status(200).json({
      success: true,
      data: {
        items: rows.map(attemptSafe),
        page,
        pageSize,
        total: count,
        totalPages: Math.ceil(count / pageSize)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/employees/:id/operator-sessions", authMiddleware, requirePermission("employees.verification.view"), async (req, res, next) => {
  try {
    await assertEmployee(req.companyId, req.params.id);
    const page = Math.max(1, Number.parseInt(req.query.page || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize || req.query.limit || "25", 10) || 25));
    const where = { companyId: req.companyId, employeeId: req.params.id };
    if (req.query.branchId) where.branchId = String(req.query.branchId);
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt[Op.gte] = new Date(String(req.query.from));
      if (req.query.to) where.createdAt[Op.lte] = new Date(String(req.query.to));
    }
    const { rows, count } = await models.EmployeeOperationalSession.findAndCountAll({
      where,
      include: [
        { model: models.Branch, as: "branch", attributes: ["id", "name", "code"] },
        { model: models.User, as: "sessionUser", attributes: ["id", "firstName", "lastName", "email"] }
      ],
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    const stateFilter = req.query.state ? String(req.query.state) : null;
    const mapped = rows.map(operationalSessionSafe).filter((row) => !stateFilter || row.state === stateFilter);
    return res.status(200).json({
      success: true,
      data: {
        items: mapped,
        page,
        pageSize,
        total: stateFilter ? mapped.length : count,
        totalPages: Math.ceil((stateFilter ? mapped.length : count) / pageSize)
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
