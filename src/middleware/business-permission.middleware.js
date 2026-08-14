const { AppError, ForbiddenError, UnauthorizedError } = require("../utils/errors");
const permissionService = require("../services/permission.service");
const operatorSessionService = require("../services/operator-session.service");
const logger = require("../utils/logger");

function mapOperatorReason(reason) {
  if (reason === "DEVICE_SESSION_REQUIRED" || reason === "OPERATOR_SESSION_REQUIRED") return "BRANCH_ACCOUNT_EMPLOYEE_REQUIRED";
  if (reason === "OPERATOR_SESSION_BRANCH_FORBIDDEN") return "EMPLOYEE_BRANCH_ACCESS_DENIED";
  if (reason === "EMPLOYEE_PERMISSION_DENIED") return "EMPLOYEE_PERMISSION_DENIED";
  return reason || "OPERATOR_SESSION_REQUIRED";
}

async function assertBusinessPermission(req, permissionNames, options = {}) {
  if (!req.user) throw new UnauthorizedError();
  const names = Array.isArray(permissionNames) ? permissionNames : [permissionNames];
  const accountType = req.user.accountType || "legacy";

  if (accountType === "super_admin") return { mode: "technical", permission: names[0] || null };

  if (accountType !== "branch_shell") {
    const allowed = names.length === 1
      ? await permissionService.userHasPermission(req.user, names[0])
      : await permissionService.userHasAnyPermission(req.user, names);
    if (!allowed) throw new ForbiddenError("تم رفض الدخول. لا تملك الصلاحية المطلوبة.");
    return { mode: "technical", permission: names[0] || null };
  }

  for (const permissionName of names) {
    const result = await operatorSessionService.currentFromRequest(req, {
      requiredPermission: permissionName,
      requestedOperation: options.operation || permissionName,
      touch: Boolean(options.touch)
    });
    if (result.active) {
      req.operatorSessionState = result;
      req.operatorContext = result.context;
      req.operatorAuthorization = result.authorization || null;
      return { mode: "employee_operator", permission: permissionName };
    }
    if (result.reason !== "EMPLOYEE_PERMISSION_DENIED") {
      throw new AppError("Operator authorization failed.", result.statusCode || 403, mapOperatorReason(result.reason));
    }
  }

  logger.warn(`Branch Account ${req.user.id} denied Employee business permission [${names.join(", ")}] on ${req.path}`);
  throw new AppError("Employee permission denied.", 403, "EMPLOYEE_PERMISSION_DENIED");
}

function requireBusinessPermission(permissionName, options = {}) {
  return async (req, _res, next) => {
    try {
      await assertBusinessPermission(req, permissionName, options);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireAnyBusinessPermission(permissionNames, options = {}) {
  return async (req, _res, next) => {
    try {
      await assertBusinessPermission(req, permissionNames, options);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  assertBusinessPermission,
  requireBusinessPermission,
  requireAnyBusinessPermission
};
