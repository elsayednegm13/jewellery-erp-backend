const express = require("express");
const { Op } = require("sequelize");
const models = require("../models");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const employeeAuth = require("../services/employee-authorization.service");
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
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt
  };
}

function authorizationSafe(resolved) {
  return {
    rolePermissionNames: resolved.rolePermissionNames,
    directGrantNames: resolved.directGrantNames,
    directDenialNames: resolved.directDenialNames,
    effectivePermissionNames: resolved.effectivePermissionNames
  };
}

async function assertEmployee(companyId, employeeId) {
  const employee = await models.Employee.findOne({ where: { id: employeeId, companyId } });
  if (!employee) throw new NotFoundError("Employee not found.");
  return employee;
}

router.post("/operator/verify", authMiddleware, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.employeeCode || !body.pin || !body.branchId) {
      throw new ValidationError("employeeCode, pin and branchId are required.");
    }
    const result = await employeeAuth.verifyEmployeeCredential({
      companyId: req.companyId,
      branchId: String(body.branchId),
      user: req.user,
      employeeCode: body.employeeCode,
      pin: body.pin,
      requestedLevel: Number(body.requestedLevel || 1),
      requestedPermission: body.requestedPermission || null,
      requestedOperation: body.requestedOperation || null,
      ipAddress: req.ip || req.connection?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null
    });
    return res.status(200).json({
      success: true,
      data: {
        employee: employeeSafe(result.employee),
        verification: {
          level: Number(body.requestedLevel || 1),
          verifiedAt: result.verifiedAt,
          expiresAt: result.expiresAt,
          verificationAttemptId: result.attempt.id
        },
        authorization: result.authorization
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/employees/:id/credential/reset", authMiddleware, requirePermission("employees.credentials.manage"), async (req, res, next) => {
  try {
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
    const [resolved, roles, grants, denials] = await Promise.all([
      employeeAuth.resolveEmployeePermissions({ companyId: req.companyId, employeeId: req.params.id }),
      models.EmployeeRoleAssignment.findAll({ where: { companyId: req.companyId, employeeId: req.params.id, active: true }, include: [{ model: models.Role, as: "role" }] }),
      models.EmployeePermissionGrant.findAll({ where: { companyId: req.companyId, employeeId: req.params.id, active: true }, include: [{ model: models.Permission, as: "permission" }] }),
      models.EmployeePermissionDenial.findAll({ where: { companyId: req.companyId, employeeId: req.params.id, active: true }, include: [{ model: models.Permission, as: "permission" }] })
    ]);
    return res.status(200).json({
      success: true,
      data: {
        roles: roles.map((row) => row.role).filter(Boolean),
        grants: grants.map((row) => row.permission).filter(Boolean),
        denials: denials.map((row) => row.permission).filter(Boolean),
        authorization: authorizationSafe(resolved)
      }
    });
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
      denialPermissionIds: Array.isArray(req.body?.denialPermissionIds) ? req.body.denialPermissionIds.map(String) : []
    });
    return res.status(200).json({ success: true, data: { authorization: authorizationSafe(resolved) } });
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

module.exports = router;
