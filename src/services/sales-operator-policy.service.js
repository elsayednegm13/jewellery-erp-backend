const models = require("../models");
const operatorSessionService = require("./operator-session.service");
const { AppError } = require("../utils/errors");

const MODES = new Set(["legacy_users", "shared_employee_operator"]);

const POLICIES = {
  "sales.list": { operatorRequired: false },
  "sales.detail": { operatorRequired: false },
  "pos.products.search": { operatorRequired: false },
  "customers.search": { operatorRequired: false },
  "sales.preview": { operatorRequired: false },

  "sales.draft.create": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create", level: 1 },
  "sales.draft.update": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create", level: 1 },
  "sales.draft.cancel": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create", level: 1 },
  "pos.draft.create": { operatorRequired: true, technicalPermission: "pos.sell", employeePermission: "pos.sell", level: 1 },
  "pos.draft.update": { operatorRequired: true, technicalPermission: "pos.sell", employeePermission: "pos.sell", level: 1 },
  "pos.draft.cancel": { operatorRequired: true, technicalPermission: "pos.sell", employeePermission: "pos.sell", level: 1 },

  "sales.post": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create", level: 2 },
  "pos.checkout": { operatorRequired: true, technicalPermission: "pos.sell", employeePermission: "pos.sell", level: 2 },
  "sales.legacy_immediate_post": { operatorRequired: true, technicalPermission: "sales.create", employeePermission: "sales.create", level: 2 },
  "sales.official_print": { operatorRequired: true, technicalPermission: "sales.print", employeePermission: "sales.print", level: 2 },
  "sales.reprint": { operatorRequired: true, technicalPermission: "sales.print", employeePermission: "sales.print", level: 2 },
  "pos.discount.override": { operatorRequired: true, technicalPermission: "pos.discount.approve", employeePermission: "pos.discount.approve", level: 2 }
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

function mapOperatorReason(reason) {
  if (reason === "DEVICE_SESSION_REQUIRED") return "OPERATOR_SESSION_REQUIRED";
  if (reason === "OPERATOR_SESSION_IDLE_TIMEOUT") return "OPERATOR_SESSION_EXPIRED";
  if (reason === "OPERATOR_SESSION_STALE_CREDENTIAL") return "OPERATOR_SESSION_STALE";
  if (reason === "OPERATOR_SESSION_STALE_AUTHORIZATION") return "OPERATOR_SESSION_STALE";
  if (reason === "OPERATOR_SESSION_BRANCH_FORBIDDEN") return "OPERATOR_BRANCH_MISMATCH";
  if (reason === "EMPLOYEE_PERMISSION_DENIED") return "OPERATOR_PERMISSION_DENIED";
  return reason || "OPERATOR_SESSION_REQUIRED";
}

async function assertSalesOperatorPolicy(req, operation, options = {}) {
  const policy = resolveSalesOperationPolicy(operation);
  const branchId = options.branchId || req.branchId || null;
  const mode = await resolveSalesOperatorMode({ companyId: req.companyId, branchId, transaction: options.transaction || null });
  req.salesOperatorMode = mode;
  req.salesOperatorPolicy = policy;
  if (mode !== "shared_employee_operator" || !policy.operatorRequired) {
    return { mode, policy, operatorContext: null };
  }

  const result = await operatorSessionService.currentFromRequest(req, {
    requiredPermission: policy.employeePermission,
    requiredLevel: policy.level,
    requestedOperation: operation,
    touch: true
  });
  if (!result.active) {
    const code = mapOperatorReason(result.reason);
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
  requireSalesOperator,
  MODES
};
