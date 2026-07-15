const jwt = require("jsonwebtoken");
const { AppError, UnauthorizedError, ForbiddenError } = require("../utils/errors");
const User = require("../models/user.model");
const logger = require("../utils/logger");
const permissionService = require("../services/permission.service");
const technicalSessions = require("../services/technical-session.service");
const models = require("../models");

const { JWT_SECRET } = require("../config/security");

/**
 * Authentication middleware to verify bearer tokens
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
    }

    const token = authHeader.split(" ")[1];
    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      throw new UnauthorizedError("انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
    }

    const { user, session } = await technicalSessions.assertAccessSession(decoded);

    req.user = user;
    req.technicalSession = session;
    req.accountScope = technicalSessions.safeScope(user);

    const accountType = user.accountType || "legacy";
    const headerCompanyId = req.headers["x-company-id"] ? String(req.headers["x-company-id"]) : null;
    const headerBranchId = req.headers["x-branch-id"] ? String(req.headers["x-branch-id"]) : null;
    req.companyId = user.companyId || "CMP-DEMO";
    req.branchId = user.branchId || null;

    const COMPANY_LEVEL_PREFIXES = [
      "/settings",
      "/barcode-settings",
      "/branches",
      "/auth",
      "/health",
      "/notifications"
    ];
    const isCompanyLevel = COMPANY_LEVEL_PREFIXES.some(prefix => req.path.startsWith(prefix));

    if (accountType === "super_admin") {
      if (headerCompanyId) {
        const company = await models.Company.findByPk(headerCompanyId);
        if (!company) {
          throw new AppError("Selected company is invalid.", 403, "COMPANY_SCOPE_INVALID");
        }
        req.companyId = headerCompanyId;
      }
    } else if (headerCompanyId && String(headerCompanyId) !== String(user.companyId)) {
      throw new AppError("Selected company is outside this account scope.", 403, "COMPANY_SCOPE_FORBIDDEN");
    }

    if (accountType === "branch_shell") {
      if (!user.branchId) {
        throw new ForbiddenError("Branch Shell account is missing its fixed branch.");
      }
      if (headerBranchId && String(headerBranchId) !== String(user.branchId)) {
        throw new AppError("Branch Shell accounts cannot switch branches.", 403, "OPERATOR_BRANCH_MISMATCH");
      }
      req.branchId = user.branchId;
    } else if (headerBranchId && !isCompanyLevel) {
      const branchRecord = await models.Branch.findOne({
        where: { id: headerBranchId, companyId: req.companyId, isActive: true }
      });
      if (!branchRecord) {
        throw new ForbiddenError("الفرع المحدد غير موجود، غير نشط، أو لا يتبع لشركتك");
      }

      if (user.branchId && user.branchId !== headerBranchId) {
        const hasCrossBranch = user.role === "admin" || user.role === "owner" || 
          await permissionService.userHasAnyPermission(user, ["pos.view", "branches.cross", "pos.sell"]);
        if (!hasCrossBranch) {
          throw new ForbiddenError("ليس لديك صلاحية للوصول إلى هذا الفرع");
        }
      }
      req.branchId = headerBranchId;
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role authorization guard
 * @param {Array<string>} roles Allowed roles
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (!roles.includes(req.user.role)) {
      logger.warn(`User ${req.user.id} with role ${req.user.role} attempted unauthorized access to role protected path: ${req.path}`);
      return next(new ForbiddenError("تم رفض الدخول. لا تملك الصلاحيات الكافية."));
    }

    next();
  };
};

const requirePermission = (permissionName) => {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(new UnauthorizedError());
      const allowed = await permissionService.userHasPermission(req.user, permissionName);
      if (!allowed) {
        logger.warn(`User ${req.user.id} denied permission ${permissionName} on ${req.path}`);
        return next(new ForbiddenError("تم رفض الدخول. لا تملك الصلاحية المطلوبة."));
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

const requireAnyPermission = (permissionNames) => {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(new UnauthorizedError());
      const allowed = await permissionService.userHasAnyPermission(req.user, permissionNames);
      if (!allowed) {
        logger.warn(`User ${req.user.id} denied permissions [${permissionNames.join(", ")}] on ${req.path}`);
        return next(new ForbiddenError("تم رفض الدخول. لا تملك أيًا من الصلاحيات المطلوبة."));
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = {
  authMiddleware,
  requireRole,
  requirePermission,
  requireAnyPermission
};
