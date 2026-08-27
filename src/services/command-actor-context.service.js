const auditService = require("./audit.service");

function fromRequest(req, extras = {}) {
  const operator = req.operatorContext || null;
  return {
    technicalUserId: req.user?.id || null,
    technicalUserName: req.user ? `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email || req.user.id : "System",
    employeeId: operator?.employeeId || null,
    employeeCode: operator?.employeeCode || null,
    employeeName: operator?.employeeName || null,
    branchId: operator?.branchId || req.branchId || null,
    operatorSessionId: operator?.operatorSessionId || null,
    deviceSessionId: operator?.deviceSessionId || null,
    ...extras
  };
}

/**
 * Stable cross-module attribution contract.
 *
 * This is deliberately separate from fromRequest() because request hashing
 * callers must not receive a time-varying occurredAt value. Consumers may use
 * this contract for projections/audit payloads while User/Auth/RBAC remains
 * the authorization authority and Employee remains the operator identity.
 */
function buildAttributionContract(req, { sourceOperation = null, sourceReference = null, occurredAt = null } = {}) {
  const actor = fromRequest(req);
  return {
    technicalUserId: actor.technicalUserId,
    employeeId: actor.employeeId,
    employeeCodeSnapshot: actor.employeeCode,
    employeeNameSnapshot: actor.employeeName,
    companyId: req.companyId || null,
    branchId: actor.branchId || null,
    operatorSessionId: actor.operatorSessionId,
    sourceOperation: sourceOperation || null,
    sourceReference: sourceReference || null,
    occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString()
  };
}

function attachAuditActor(req, data = {}, extras = {}) {
  return auditService.attachDualAuditActor(data, fromRequest(req, extras));
}

module.exports = {
  fromRequest,
  buildAttributionContract,
  attachAuditActor
};
