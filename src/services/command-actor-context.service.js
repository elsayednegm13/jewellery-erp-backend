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

function attachAuditActor(req, data = {}, extras = {}) {
  return auditService.attachDualAuditActor(data, fromRequest(req, extras));
}

module.exports = {
  fromRequest,
  attachAuditActor
};
