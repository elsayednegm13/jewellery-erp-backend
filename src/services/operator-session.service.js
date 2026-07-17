const { Op } = require("sequelize");
const models = require("../models");
const employeeAuth = require("./employee-authorization.service");
const auditService = require("./audit.service");
const { AppError, ValidationError } = require("../utils/errors");

const IDLE_TIMEOUT_MINUTES = 30;
const ABSOLUTE_TIMEOUT_HOURS = 8;
const TOUCH_THROTTLE_SECONDS = 60;
const DEVICE_SESSION_RE = /^[A-Za-z0-9._:-]{16,128}$/;

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function actorName(user) {
  return user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || user.id : "System";
}

function operatorError(code, statusCode = 403, message = "Operator authorization failed.") {
  return new AppError(message, statusCode, code);
}

function normalizeDeviceSessionId(value) {
  if (typeof value !== "string" || !DEVICE_SESSION_RE.test(value)) {
    throw new ValidationError("X-Device-Session-ID is required.", {
      deviceSessionId: ["Device session id must be 16-128 safe characters."]
    });
  }
  return value;
}

function nowPlus(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

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

function sessionSafe(session, state = "active", reason = null) {
  if (!session) {
    return {
      state,
      reason,
      sessionId: null,
      employee: null,
      verifiedAt: null,
      idleExpiresAt: null,
      absoluteExpiresAt: null
    };
  }
  return {
    state,
    reason,
    sessionId: session.id,
    employee: employeeSafe(session.employee),
    verifiedAt: session.verifiedAt,
    lastActivityAt: session.lastActivityAt,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    lockedAt: session.lockedAt,
    revokedAt: session.revokedAt
  };
}

function contextFromSession(session, req, extras = {}) {
  return {
    technicalUserId: req.user?.id || session.sessionUserId || null,
    technicalUserName: actorName(req.user),
    employeeId: session.employeeId,
    employeeCode: session.employeeCodeSnapshot,
    employeeName: session.employeeNameSnapshot,
    branchId: session.branchId,
    operatorSessionId: session.id,
    deviceSessionId: session.deviceSessionId,
    ...extras
  };
}

async function loadSession({ companyId, userId, deviceSessionId, transaction = null }) {
  return models.EmployeeOperationalSession.findOne({
    where: {
      companyId,
      sessionUserId: userId,
      deviceSessionId,
      revokedAt: null,
      lockedAt: null
    },
    include: [{ model: models.Employee, as: "employee" }],
    order: [["createdAt", "DESC"]],
    transaction
  });
}

async function revokeSession(session, reason, transaction = null) {
  if (!session || session.revokedAt) return session;
  await session.update({ revokedAt: new Date(), revokedReason: reason }, { transaction });
  return session;
}

async function assertLiveSession(session, req, options = {}) {
  const requestedPermission = options.requiredPermission || null;
  const requestedOperation = options.requestedOperation || null;
  if (!session) {
    return { active: false, reason: "OPERATOR_SESSION_REQUIRED", statusCode: 401, session: null };
  }
  const now = new Date();
  if (session.lockedAt) return { active: false, reason: "OPERATOR_SESSION_LOCKED", statusCode: 423, session };
  if (session.revokedAt) return { active: false, reason: "OPERATOR_SESSION_REVOKED", statusCode: 401, session };
  if (new Date(session.absoluteExpiresAt) <= now) {
    await revokeSession(session, "absolute_timeout");
    return { active: false, reason: "OPERATOR_SESSION_EXPIRED", statusCode: 401, session };
  }
  if (new Date(session.idleExpiresAt) <= now) {
    await revokeSession(session, "idle_timeout");
    return { active: false, reason: "OPERATOR_SESSION_EXPIRED", statusCode: 401, session };
  }
  const employee = session.employee || await models.Employee.findOne({ where: { id: session.employeeId, companyId: req.companyId } });
  if (!employee) {
    await revokeSession(session, "employee_missing");
    return { active: false, reason: "OPERATOR_EMPLOYEE_NOT_FOUND", statusCode: 403, session };
  }
  if (employee.status === "inactive") {
    await revokeSession(session, "employee_inactive");
    return { active: false, reason: "EMPLOYEE_INACTIVE", statusCode: 403, session };
  }
  const credential = await models.EmployeeCredential.findOne({
    where: { companyId: req.companyId, employeeId: employee.id, active: true }
  });
  if (!credential || Number(credential.credentialVersion || 0) !== Number(session.credentialVersion || 0)) {
    await revokeSession(session, "credential_version_changed");
    return { active: false, reason: "OPERATOR_SESSION_STALE_CREDENTIAL", statusCode: 403, session };
  }
  if (Number(employee.authorizationVersion || 1) !== Number(session.authorizationVersion || 1)) {
    await revokeSession(session, "authorization_version_changed");
    return { active: false, reason: "OPERATOR_SESSION_STALE_AUTHORIZATION", statusCode: 403, session };
  }
  const branchAllowed = await employeeAuth.assertEmployeeBranchAccess({
    companyId: req.companyId,
    employeeId: employee.id,
    branchId: req.branchId
  });
  if (!branchAllowed) {
    await revokeSession(session, "branch_access_changed");
    return { active: false, reason: "OPERATOR_SESSION_BRANCH_FORBIDDEN", statusCode: 403, session };
  }
  if (requestedPermission) {
    const resolved = await employeeAuth.resolveEmployeePermissions({
      companyId: req.companyId,
      employeeId: employee.id,
      branchId: req.branchId
    });
    if (!resolved.effectivePermissionNames.includes(requestedPermission)) {
      return { active: false, reason: "EMPLOYEE_PERMISSION_DENIED", statusCode: 403, session };
    }
  }
  session.employee = employee;
  const last = session.lastActivityAt ? new Date(session.lastActivityAt) : null;
  if (options.touch && (!last || now.getTime() - last.getTime() >= TOUCH_THROTTLE_SECONDS * 1000)) {
    await session.update({ lastActivityAt: now, idleExpiresAt: nowPlus(IDLE_TIMEOUT_MINUTES) });
  }
  return {
    active: true,
    reason: null,
    statusCode: 200,
    session,
    context: contextFromSession(session, req, {
      requiredPermission: requestedPermission,
      requestedOperation,
      authorizationResult: "allowed"
    })
  };
}

async function currentFromRequest(req, options = {}) {
  const header = req.headers["x-device-session-id"];
  if (!header) {
    return { active: false, reason: "DEVICE_SESSION_REQUIRED", statusCode: 401, session: null };
  }
  const deviceSessionId = normalizeDeviceSessionId(String(header));
  const session = await loadSession({
    companyId: req.companyId,
    userId: req.user?.id,
    deviceSessionId
  });
  return assertLiveSession(session, req, options);
}

async function verifyOperator({ req, body }) {
  const deviceSessionId = normalizeDeviceSessionId(String(req.headers["x-device-session-id"] || body.deviceSessionId || ""));
  const result = await employeeAuth.verifyEmployeeCredential({
    companyId: req.companyId,
    branchId: String(body.branchId || req.branchId),
    user: req.user,
    employeeCode: body.employeeCode,
    pin: body.pin,
    requestedLevel: 1,
    requestedPermission: body.requestedPermission || null,
    requestedOperation: body.requestedOperation || null,
    ipAddress: req.ip || req.connection?.remoteAddress || null,
    userAgent: req.headers["user-agent"] || null
  });
  const employee = result.employee;
  const credential = await models.EmployeeCredential.findOne({
    where: { companyId: req.companyId, employeeId: employee.id, active: true }
  });
  const now = new Date();
  const session = await models.sequelize.transaction(async (t) => {
    await models.EmployeeOperationalSession.update({
      revokedAt: now,
      revokedReason: "replaced_by_new_verification"
    }, {
      where: {
        companyId: req.companyId,
        sessionUserId: req.user?.id || null,
        deviceSessionId,
        revokedAt: null
      },
      transaction: t
    });
    const created = await models.EmployeeOperationalSession.create({
      id: id("EOS"),
      companyId: req.companyId,
      branchId: String(body.branchId || req.branchId),
      sessionUserId: req.user?.id || null,
      employeeId: employee.id,
      verificationLevel: 1,
      verifiedAt: now,
      level2VerifiedAt: null,
      lastActivityAt: now,
      idleExpiresAt: nowPlus(IDLE_TIMEOUT_MINUTES),
      absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000),
      credentialVersion: credential?.credentialVersion || 1,
      authorizationVersion: employee.authorizationVersion || 1,
      deviceSessionId,
      authSessionFingerprint: req.headers.authorization ? String(req.headers.authorization).slice(-32) : null,
      ipAddress: req.ip || req.connection?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
      employeeCodeSnapshot: employee.employeeCode || null,
      employeeNameSnapshot: employee.name || null
    }, { transaction: t });
    await auditService.record(req.companyId, auditService.attachDualAuditActor({
      action: "operator.session.verified",
      description: `Operator session verified for ${employee.employeeCode || employee.id}.`,
      place: req.branchId || "Operator",
      branch: req.branchId || null,
      sourceDocument: created.id,
      severity: "info",
      requestedPermission: body.requestedPermission || null,
      requestedOperation: body.requestedOperation || null,
      authorizationResult: "allowed",
      after: JSON.stringify({ employeeId: employee.id, state: "verified" })
    }, contextFromSession(created, req)), { transaction: t });
    return created;
  });
  session.employee = employee;
  return {
    employee,
    session,
    verification: {
      state: "verified",
      verifiedAt: session.verifiedAt,
      expiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      verificationAttemptId: result.attempt.id
    },
    authorization: result.authorization
  };
}

async function lockCurrent(req, reason = "manual_lock") {
  const current = await currentFromRequest(req, { touch: false });
  if (!current.session) throw operatorError(current.reason || "OPERATOR_SESSION_REQUIRED", current.statusCode || 401);
  await current.session.update({ lockedAt: new Date(), revokedReason: reason || "manual_lock" });
  await auditService.record(req.companyId, auditService.attachDualAuditActor({
    action: "operator.session.locked",
    description: "Operator session locked.",
    place: req.branchId || "Operator",
    branch: req.branchId || null,
    sourceDocument: current.session.id,
    severity: "info",
    authorizationResult: "allowed"
  }, contextFromSession(current.session, req)));
  return current.session;
}

async function endCurrent(req, reason = "operator_session_ended") {
  const current = await currentFromRequest(req, { touch: false });
  if (!current.session) throw operatorError(current.reason || "OPERATOR_SESSION_REQUIRED", current.statusCode || 401);
  await revokeSession(current.session, reason);
  await auditService.record(req.companyId, auditService.attachDualAuditActor({
    action: "operator.session.ended",
    description: "Operator session ended.",
    place: req.branchId || "Operator",
    branch: req.branchId || null,
    sourceDocument: current.session.id,
    severity: "info",
    authorizationResult: "allowed"
  }, contextFromSession(current.session, req)));
  return current.session;
}

module.exports = {
  normalizeDeviceSessionId,
  employeeSafe,
  sessionSafe,
  currentFromRequest,
  verifyOperator,
  lockCurrent,
  endCurrent,
  assertLiveSession,
  operatorError,
  contextFromSession
};
