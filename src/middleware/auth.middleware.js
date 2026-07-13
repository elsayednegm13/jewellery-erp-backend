const jwt = require("jsonwebtoken");
const { UnauthorizedError, ForbiddenError } = require("../utils/errors");
const User = require("../models/user.model");
const logger = require("../utils/logger");
const permissionService = require("../services/permission.service");

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

    const user = await User.findByPk(decoded.userId);
    if (!user) {
      throw new UnauthorizedError("المستخدم غير موجود.");
    }

    req.user = user;
    req.companyId = req.headers["x-company-id"] || user.companyId || "CMP-DEMO";
    req.branchId = user.branchId || "Main Branch";

    const headerBranchId = req.headers["x-branch-id"];
    const COMPANY_LEVEL_PREFIXES = [
      "/settings",
      "/barcode-settings",
      "/branches",
      "/auth",
      "/health",
      "/notifications"
    ];
    const isCompanyLevel = COMPANY_LEVEL_PREFIXES.some(prefix => req.path.startsWith(prefix));

    if (headerBranchId && !isCompanyLevel) {
      const models = require("../models");
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
