const models = require("../models");
const operatorSessionService = require("./operator-session.service");
const permissionService = require("./permission.service");
const { AppError, ForbiddenError } = require("../utils/errors");

const MODES = new Set(["legacy_users", "shared_employee_operator"]);

const POLICIES = {
  "sales.list": { operatorRequired: false },
  "sales.detail": { operatorRequired: false },
  "pos.products.search": { operatorRequired: false },
  "customers.search": { operatorRequired: false },
  "sales.preview": { operatorRequired: false },

  "sales.draft.create": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create" },
  "sales.draft.update": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create" },
  "sales.draft.cancel": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create" },
  "pos.draft.create": { operatorRequired: true, technicalPermission: "pos.sell", employeePermission: "pos.sell" },
  "pos.draft.update": { operatorRequired: true, technicalPermission: "pos.sell", employeePermission: "pos.sell" },
  "pos.draft.cancel": { operatorRequired: true, technicalPermission: "pos.sell", employeePermission: "pos.sell" },

  "sales.post": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create" },
  "pos.checkout": { operatorRequired: true, technicalPermission: "pos.sell", employeePermission: "pos.sell" },
  "sales.legacy_immediate_post": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create" },
  "sales.official_print": { operatorRequired: true, technicalPermission: "sales.print", employeePermission: "sales.print" },
  "sales.reprint": { operatorRequired: true, technicalPermission: "sales.print", employeePermission: "sales.print" },
  "pos.discount.override": { operatorRequired: true, technicalPermission: "pos.discount.approve", employeePermission: "pos.discount.approve" },

  "sales.return.preview": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create" },
  "sales.return.execute": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.returns.execute" },
  "sales.exchange.preview": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create" },
  "sales.exchange.execute": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.exchanges.execute" },
  "sales.installment.collect": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.installments.collect" }
};

function normalizeMode(value) {
  return MODES.has(value) ? value : "legacy_users";
}

async function resolveSalesOperatorMode({ companyId, branchId, transaction = null }) {
  const row = await models.Setting.findOne({
    where: { companyId, key: "salesOperatorMode" },
    transaction
  });
  const value = row ? row.value : null;
  if (typeof value === "string") return normalizeMode(value);
  if (value && typeof value === "object") {
    const branchOverrides = value.branchOverrides && typeof value.branchOverrides === "object" ? value.branchOverrides : {};
    if (branchId && Object.prototype.hasOwnProperty.call(branchOverrides, branchId)) {
      return normalizeMode(branchOverrides[branchId]);
    }
    return normalizeMode(value.companyDefault);
  }
  return "legacy_users";
}

async function isSharedEmployeeOperatorMode(args) {
  return (await resolveSalesOperatorMode(args)) === "shared_employee_operator";
}

function resolveSalesOperationPolicy(operation) {
  const policy = POLICIES[operation];
  if (!policy) throw new AppError(`Unknown sales operator operation: ${operation}`, 500, "SALES_OPERATOR_POLICY_MISSING");
  return { operation, ...policy };
}

function mapOperatorReason(reason, accountType = "legacy") {
  if (accountType === "branch_shell") {
    if (reason === "DEVICE_SESSION_REQUIRED" || reason === "OPERATOR_SESSION_REQUIRED") return "BRANCH_ACCOUNT_EMPLOYEE_REQUIRED";
    if (reason === "OPERATOR_SESSION_BRANCH_FORBIDDEN") return "EMPLOYEE_BRANCH_ACCESS_DENIED";
  }
  if (reason === "DEVICE_SESSION_REQUIRED") return "OPERATOR_SESSION_REQUIRED";
  if (reason === "OPERATOR_SESSION_IDLE_TIMEOUT") return "OPERATOR_SESSION_EXPIRED";
  if (reason === "OPERATOR_SESSION_BRANCH_FORBIDDEN") return "OPERATOR_BRANCH_MISMATCH";
  if (reason === "EMPLOYEE_PERMISSION_DENIED") return "OPERATOR_PERMISSION_DENIED";
  return reason || "OPERATOR_SESSION_REQUIRED";
}

async function assertSalesOperatorPolicy(req, operation, options = {}) {
  const policy = resolveSalesOperationPolicy(operation);
  const branchId = options.branchId || req.branchId || null;
  const mode = await resolveSalesOperatorMode({ companyId: req.companyId, branchId, transaction: options.transaction || null });
  const accountType = req.user?.accountType || "legacy";
  const accountTypeRequiresOperator = accountType === "branch_shell";
  req.salesOperatorMode = mode;
  req.salesOperatorPolicy = policy;
  if (accountType === "super_admin") {
    if (policy.operatorRequired && !branchId) {
      throw new AppError("A valid branch selection is required for this business operation.", 422, "BRANCH_SELECTION_REQUIRED");
    }
    req.operatorSessionState = null;
    req.operatorContext = null;
    return { mode, policy, operatorContext: null };
  }
  if (!policy.operatorRequired || (mode !== "shared_employee_operator" && !accountTypeRequiresOperator)) {
    return { mode, policy, operatorContext: null };
  }

  const result = await operatorSessionService.currentFromRequest(req, {
    requiredPermission: policy.employeePermission,
    requestedOperation: operation,
    touch: true
  });
  if (!result.active) {
    const code = mapOperatorReason(result.reason, accountType);
    throw new AppError("Operator authorization failed.", result.statusCode || 403, code);
  }
  const sessionBranchId = result.session?.branchId || result.context?.branchId || req.branchId;
  if (branchId && sessionBranchId && String(sessionBranchId) !== String(branchId)) {
    throw new AppError("Operator branch does not match the command branch.", 403, "OPERATOR_BRANCH_MISMATCH");
  }
  req.operatorSessionState = result;
  req.operatorContext = result.context;
  return { mode, policy, operatorContext: result.context };
}

function requireSalesCommandAccess(operation, options = {}) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new AppError("Authentication required.", 401, "UNAUTHORIZED");
      }

      const policy = resolveSalesOperationPolicy(operation);
      const accountType = req.user.accountType || "legacy";
      const branchId = typeof options.resolveBranchId === "function"
        ? await options.resolveBranchId(req)
        : options.branchId || req.branchId || null;

      if (accountType === "legacy") {
        const allowed = await permissionService.userHasPermission(req.user, policy.technicalPermission);
        if (!allowed) {
          throw new ForbiddenError("تم رفض الدخول. لا تملك الصلاحية المطلوبة.");
        }
      } else if (accountType !== "branch_shell" && accountType !== "super_admin") {
        throw new ForbiddenError("Unsupported account type for Sales/POS command access.");
      }

      await assertSalesOperatorPolicy(req, operation, { ...options, branchId });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireSalesOperator(operation, options = {}) {
  return async (req, res, next) => {
    try {
      const branchId = typeof options.resolveBranchId === "function"
        ? await options.resolveBranchId(req)
        : options.branchId || req.branchId || null;
      await assertSalesOperatorPolicy(req, operation, { ...options, branchId });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  resolveSalesOperatorMode,
  isSharedEmployeeOperatorMode,
  resolveSalesOperationPolicy,
  assertSalesOperatorPolicy,
  requireSalesCommandAccess,
  requireSalesOperator,
  MODES
};
