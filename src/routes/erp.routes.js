const express = require("express");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { authMiddleware, requirePermission, requireAnyPermission } = require("../middleware/auth.middleware");
const { requireBusinessPermission, requireAnyBusinessPermission } = require("../middleware/business-permission.middleware");
const ErpController = require("../controllers/erp.controller");
const models = require("../models");
const postingService = require("../services/posting.service");
const journalService = require("../services/journal.service");
const goldService = require("../services/gold.service");
const settingsService = require("../services/settings.service");
const salesService = require("../services/sales.service");
const exchangePolicyService = require("../services/exchange-policy.service");
const exchangeDisplayService = require("../services/exchange-display.service");
const goldCostService = require("../services/gold-cost.service");
const supplierPaymentState = require("../services/supplier-payment-state.service");
const auditService = require("../services/audit.service");
const { emitEntityChanged } = require("../services/realtime-helper.service");
const notificationService = require("../services/notification.service");
const idempotencyService = require("../services/idempotency.service");
const customerCreditService = require("../services/customer-credit.service");
const barcodeIdentityService = require("../services/barcode-identity.service");
const reservationService = require("../services/reservation.service");
const permissionService = require("../services/permission.service");
const employeeAuthorizationService = require("../services/employee-authorization.service");
const commandActorContext = require("../services/command-actor-context.service");
const salesOperatorPolicy = require("../services/sales-operator-policy.service");
const statementReconciliationService = require("../services/statement-reconciliation.service");
const sourceAwareStatementService = require("../services/source-aware-statement.service");
const accountingLockService = require("../services/accounting-lock.service");
const accountBalanceService = require("../services/account-balance.service");
const cashRegisterService = require("../services/cash-register.service");
const ledgerReportingService = require("../services/ledger-reporting.service");
const logger = require("../utils/logger");
const { AppError, ValidationError, NotFoundError, ConflictError, ForbiddenError } = require("../utils/errors");
const uploadMiddleware = require("../middleware/upload.middleware");
const { moveUploadedFileSafe } = require("../utils/file-move");

const router = express.Router();
const allowAuthenticated = (req, res, next) => next();

const reservationPerms = {
  view: ["reservations.view", "reservations.view_all", "reservations.view_branch", "reservations.view_own", "sales.view"],
  create: ["reservations.create", "sales.create"],
  recordPayment: ["reservations.record_payment", "sales.create"],
  completeSale: ["reservations.complete_sale", "sales.create"],
  cancel: ["reservations.cancel", "sales.approve"],
  amendItems: ["reservations.amend_items", "sales.approve"],
  extendExpiry: ["reservations.extend_expiry", "sales.approve"],
  renew: ["reservations.renew", "sales.approve"],
  refundRequest: ["reservations.refund_request", "sales.approve"],
  refundApprove: ["reservations.refund_approve", "approvals.manage"],
  refundReject: ["reservations.refund_reject", "approvals.manage"],
  refundExecute: ["reservations.refund_execute", "treasury.update"],
  auditView: ["reservations.audit_view", "audit.view"],
  reportsView: ["reservations.reports_view", "reports.view"],
  reportsExport: ["reservations.reports_export", "reports.export"],
  statementView: ["reservations.statement_view", "customers.view"],
};

// Restrict an invoice where-clause to POSTED invoices only — the single source
// of truth for every financial aggregate (sales totals, customer purchases,
// branch/customer KPIs). Drafts and cancelled drafts must never be counted.
const postedInvoiceWhere = (where = {}) => ({ ...where, postingStatus: "posted" });

// Compute the next sequential customer-facing invoice number for a company.
// Draws from the MAX of BOTH `id` and `invoice_number` matching the padded
// `${prefix}-NNNNNN` pattern, so POS checkout (id == invoiceNumber) and posted
// drafts (id = DRAFT-*, invoiceNumber = INV-*) share ONE sequence and never
// collide. Run inside the posting transaction.
async function nextInvoiceNumber(companyId, prefix, t) {
  const rows = await models.Invoice.findAll({
    where: {
      companyId,
      [Op.or]: [
        { id: { [Op.like]: `${prefix}-%` } },
        { invoiceNumber: { [Op.like]: `${prefix}-%` } },
      ],
    },
    attributes: ["id", "invoiceNumber"],
    paranoid: false,
    transaction: t,
  });
  let max = 0;
  const consider = (val) => {
    if (typeof val === "string" && val.startsWith(`${prefix}-`)) {
      const n = parseInt(val.slice(prefix.length + 1), 10);
      if (Number.isInteger(n) && n > max) max = n;
    }
  };
  for (const r of rows) { consider(r.id); consider(r.invoiceNumber); }
  return `${prefix}-${String(max + 1).padStart(6, "0")}`;
}

function getPurityFromKarat(karat) {
  const numericKarat = Number(karat);
  if (numericKarat === 24) return 1;
  if (numericKarat === 22) return 0.916;
  if (numericKarat === 21) return 0.875;
  if (numericKarat === 18) return 0.75;
  return null;
}

function isArabicRequest(req) {
  return String(req.headers["accept-language"] || req.headers["x-locale"] || "ar").toLowerCase().startsWith("ar");
}

function linkedDeleteMessage(req) {
  return isArabicRequest(req)
    ? "لا يمكن حذف هذا السجل لأنه مرتبط بحركات أو مستندات. يمكنك إلغاء تنشيطه بدلًا من الحذف."
    : "This record cannot be deleted because it is linked to transactions or documents. You can deactivate it instead.";
}

function lastActiveBranchDeactivateMessage(req) {
  return isArabicRequest(req)
    ? "لا يمكن إلغاء تنشيط آخر فرع نشط. يجب أن يكون هناك فرع نشط واحد على الأقل."
    : "You cannot deactivate the last active branch. At least one active branch is required.";
}

function lastActiveBranchDeleteMessage(req) {
  return isArabicRequest(req)
    ? "لا يمكن حذف آخر فرع نشط. يجب أن يكون هناك فرع نشط واحد على الأقل."
    : "You cannot delete the last active branch. At least one active branch is required.";
}

function linkedRecordsError(req, code, linked) {
  const err = new ValidationError(linkedDeleteMessage(req), linked);
  err.errorCode = code || "HAS_LINKED_RECORDS";
  err.linked = linked;
  return err;
}

function assertOperatorBranchForCommand(req, branchId) {
  if (req.salesOperatorMode !== "shared_employee_operator") return;
  const operatorBranchId = req.operatorContext?.branchId || req.operatorSessionState?.session?.branchId || req.branchId;
  if (branchId && operatorBranchId && String(operatorBranchId) !== String(branchId)) {
    throw new AppError("Operator branch does not match the command branch.", 403, "OPERATOR_BRANCH_MISMATCH");
  }
}

function idempotencyBodyWithActor(req, body = {}, commandActor = {}) {
  return {
    ...(body || {}),
    __serverOperatorActor: {
      technicalUserId: commandActor.technicalUserId || req.user?.id || null,
      employeeId: commandActor.employeeId || null
    }
  };
}

async function resolveAdjustmentInvoiceBranchId(req) {
  const body = req.body || {};
  const headerBranchId = req.headers["x-branch-id"];
  if (headerBranchId || body.branchId) return headerBranchId || body.branchId;
  if (!body.originalInvoiceId) return req.branchId || null;
  const invoice = await models.Invoice.findOne({
    where: { id: body.originalInvoiceId, companyId: req.companyId },
    attributes: ["branchId"]
  });
  return invoice?.branchId || req.branchId || null;
}

async function resolveInstallmentCollectionBranchId(req) {
  if (req.headers["x-branch-id"] || req.branchId) return req.headers["x-branch-id"] || req.branchId;
  const inst = await models.Installment.findOne({
    where: { id: req.params.id, companyId: req.companyId },
    attributes: ["invoiceId"]
  });
  if (!inst?.invoiceId) return null;
  const invoice = await models.Invoice.findOne({
    where: { id: inst.invoiceId, companyId: req.companyId },
    attributes: ["branchId"]
  });
  return invoice?.branchId || null;
}

// Phase 31.4-Fix — customer-facing invoice search uses a deliberately small,
// evidence-backed type map. Gift vouchers and customer-gold purchases live in
// separate domain tables today, so they are not presented as invoice records.
const SEARCH_PRINT_INVOICE_TYPES = Object.freeze({
  sale: "sale",
  return: "return",
  exchange: "exchange",
  installment: "installment",
  deposit: "deposit",
});

const SEARCH_PRINT_STATUSES = new Set(["draft", "posted", "closed", "cancelled", "returned"]);

function resolveSearchPrintStatus(invoice) {
  if (invoice.postingStatus === "cancelled" || invoice.status === "cancelled") return "cancelled";
  if (invoice.postingStatus === "draft") return "draft";
  if (invoice.type === "return" || invoice.status === "returned") return "returned";
  if (invoice.postingStatus === "posted" && invoice.status === "paid") return "closed";
  return "posted";
}

function searchPrintStatusWhere(status) {
  if (status === "draft") return { postingStatus: "draft" };
  if (status === "cancelled") {
    return { [Op.or]: [{ postingStatus: "cancelled" }, { status: "cancelled" }] };
  }
  if (status === "returned") {
    return {
      [Op.and]: [
        { postingStatus: { [Op.ne]: "cancelled" } },
        { status: { [Op.ne]: "cancelled" } },
        { [Op.or]: [{ type: "return" }, { status: "returned" }] },
      ],
    };
  }
  if (status === "closed") {
    return {
      postingStatus: "posted",
      status: "paid",
      type: { [Op.ne]: "return" },
    };
  }
  return {
    postingStatus: "posted",
    status: { [Op.notIn]: ["paid", "returned", "cancelled"] },
    type: { [Op.ne]: "return" },
  };
}

async function countLinkedRecords(checks) {
  const entries = await Promise.all(
    checks.map(async ([key, fn]) => [key, await fn()])
  );
  return Object.fromEntries(entries.filter(([, count]) => Number(count) > 0));
}

const CRUD_PERMISSIONS = {
  customers: "customers",
  suppliers: "suppliers",
  assets: "inventory",
  products: "inventory",
  "stock-movements": "inventory",
  invoices: "sales",
  reservations: "sales",
  "purchase-orders": "suppliers",
  "approval-requests": "approvals",
  "journal-entries": "accounting",
  accounts: "accounting",
  "cash-transactions": "treasury",
  branches: "branches",
};

// CRUD routes in this set are business surfaces. A Branch Account reaches them
// through the verified Employee operator; technical accounts retain their
// existing permission checks.
const EMPLOYEE_BUSINESS_CRUD_RESOURCES = new Set([
  "customers",
  "suppliers",
  "assets",
  "products",
  "stock-movements",
  "invoices",
  "reservations",
  "purchase-orders",
  "approval-requests",
  "journal-entries",
  "accounts",
  "cash-transactions",
]);

function guardFor(resourceName, action) {
  const permissionModule = CRUD_PERMISSIONS[resourceName];
  if (!permissionModule) return allowAuthenticated;
  const mappedAction = action === "list" || action === "get" ? "view" : action;
  const candidates = [
    `${permissionModule}.${mappedAction}`,
    mappedAction === "delete" ? `${permissionModule}.update` : null,
    mappedAction === "update" ? `${permissionModule}.adjust` : null,
    mappedAction === "create" ? `${permissionModule}.update` : null,
    permissionModule === "approvals" && mappedAction !== "view" ? "approvals.manage" : null,
    permissionModule === "accounting" && mappedAction !== "view" ? "accounting.post" : null,
    permissionModule === "treasury" && mappedAction !== "view" ? "treasury.update" : null,
  ].filter(Boolean);
  const one = EMPLOYEE_BUSINESS_CRUD_RESOURCES.has(resourceName)
    ? requireBusinessPermission
    : requirePermission;
  const any = EMPLOYEE_BUSINESS_CRUD_RESOURCES.has(resourceName)
    ? requireAnyBusinessPermission
    : requireAnyPermission;
  return candidates.length === 1 ? one(candidates[0]) : any(candidates);
}

const employeeViewPermissions = [
  "payroll.view",
  "employees.credentials.manage",
  "employees.permissions.manage",
  "employees.branches.manage",
  "employees.verification.view",
];

const employeeCoreManagePermissions = [
  "payroll.manage",
  "employees.credentials.manage",
];

const LIFECYCLE_GENERIC_MUTATION_BLOCKS = {
  assets: {
    code: "GENERIC_INVENTORY_MUTATION_FORBIDDEN",
    message: "Inventory asset mutations must use dedicated inventory lifecycle endpoints."
  },
  products: {
    code: "GENERIC_INVENTORY_MUTATION_FORBIDDEN",
    message: "Product stock mutations must use dedicated inventory lifecycle endpoints."
  },
  "stock-movements": {
    code: "GENERIC_STOCK_MOVEMENT_MUTATION_FORBIDDEN",
    message: "Stock movement truth is read-only through generic CRUD."
  },
  transfers: {
    code: "GENERIC_TRANSFER_MUTATION_FORBIDDEN",
    message: "Inventory transfers must use the dedicated transfer endpoints."
  },
  "purchase-orders": {
    code: "GENERIC_PURCHASE_MUTATION_FORBIDDEN",
    message: "Purchase lifecycle mutations must use the dedicated purchase receive/payment endpoints."
  },
  "cash-transactions": {
    code: "GENERIC_TREASURY_MUTATION_FORBIDDEN",
    message: "Treasury movements must use the dedicated treasury endpoints."
  }
};

function stableForbidden(res, code, message) {
  return res.status(403).json({
    success: false,
    message,
    code,
    errorCode: code
  });
}

function normalizeBranchInput(value) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  return String(value);
}

async function resolveAuthorizedBranchId(req, value, options = {}) {
  const requested = normalizeBranchInput(value);
  const fixedBranchId = normalizeBranchInput(req.branchId);
  if (!requested) {
    if (fixedBranchId) return fixedBranchId;
    if (options.required) throw new ValidationError("A valid branch selection is required.");
    return null;
  }
  if (fixedBranchId && String(requested) !== String(fixedBranchId)) {
    throw new AppError("Selected branch is outside this account scope.", 403, "BRANCH_SCOPE_FORBIDDEN");
  }
  const branch = await models.Branch.findOne({
    where: { id: requested, companyId: req.companyId, isActive: true },
    transaction: options.transaction || undefined
  });
  if (!branch) {
    throw new AppError("Selected branch is invalid or inactive.", 403, "BRANCH_SCOPE_INVALID");
  }
  return branch.id;
}

async function resolveAuthorizedBranch(req, value, options = {}) {
  const branchId = await resolveAuthorizedBranchId(req, value, options);
  if (!branchId) return null;
  return models.Branch.findOne({
    where: { id: branchId, companyId: req.companyId, isActive: true },
    transaction: options.transaction || undefined
  });
}

function normalizeTreasuryAccount(value, field = "account") {
  const account = String(value || "").trim().toLowerCase();
  if (account !== "cash" && account !== "bank") {
    throw new ValidationError(`${field} must be 'cash' or 'bank'.`);
  }
  return account;
}

async function assertActiveAccountCode(companyId, code, options = {}) {
  const normalized = String(code || "").trim();
  if (!normalized) throw new ValidationError("counterAccountCode is required for manual treasury cash movements.");
  const account = await models.Account.findOne({
    where: { companyId, code: normalized, isActive: true },
    transaction: options.transaction || undefined
  });
  if (!account) throw new ValidationError(`Account ${normalized} is inactive, missing, or outside this company.`);
  return account;
}

async function assertTreasuryAccountKey(companyId, key, options = {}) {
  const code = TREASURY_GL[key];
  const account = await assertActiveAccountCode(companyId, code, options);
  if (account.type !== "asset" || account.nature !== "debit") {
    throw new ValidationError(`Treasury account ${code} must be an active debit asset account.`);
  }
  return account;
}

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function boolQuery(value) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return null;
}

function employeeCredentialState(credential) {
  if (!credential) return "not_configured";
  if (!credential.active) return "inactive";
  if (credential.lockedUntil && new Date(credential.lockedUntil) > new Date()) return "locked";
  if (credential.resetRequired) return "reset_required";
  return "active";
}

function assertEmployeeCreatePin(body) {
  const status = body.status || "present";
  const pin = body.pin ?? body.employeePin ?? null;
  const confirmation = body.pinConfirm ?? body.confirmPin ?? body.confirmation ?? null;
  const requiresPin = status !== "inactive";
  if (!requiresPin && !pin && !confirmation) return null;
  if (pin !== confirmation) {
    throw new ValidationError("PIN confirmation does not match.", { pinConfirm: ["PIN confirmation does not match."] });
  }
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    throw new ValidationError("PIN must be exactly 6 numeric digits.", { pin: ["PIN must be exactly 6 numeric digits."] });
  }
  return pin;
}

async function employeeHasConfiguredCredential(companyId, employeeId, transaction = null) {
  const credential = await models.EmployeeCredential.findOne({
    where: { companyId, employeeId, active: true, resetRequired: false },
    transaction
  });
  return Boolean(credential);
}

function maskEmployeeSessionDevice(value) {
  const text = String(value || "");
  if (!text) return null;
  const suffix = text.slice(-6);
  return `device-••••${suffix}`;
}

function employeeSessionState(row) {
  const now = new Date();
  if (row.lockedAt) return "locked";
  if (row.revokedAt) return "revoked";
  if (row.absoluteExpiresAt && new Date(row.absoluteExpiresAt) <= now) return "absolute_expired";
  if (row.idleExpiresAt && new Date(row.idleExpiresAt) <= now) return "idle_expired";
  return "active";
}

/**
 * Utility to define standard CRUD routes for any Sequelize model
 */
function setupCrud(resourceName, model, searchFields = ["name"]) {
  const controller = new ErpController(model, searchFields);

  router.get(`/${resourceName}`, authMiddleware, guardFor(resourceName, "list"), controller.list);
  router.get(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "get"), controller.getById);
  if (resourceName === "invoices") {
    const blockInvoiceMutation = (req, res) => res.status(403).json({
      success: false,
      message: "Invoice lifecycle mutations must use the dedicated Sales/POS endpoints",
      code: "GENERIC_INVOICE_MUTATION_FORBIDDEN",
      errorCode: "GENERIC_INVOICE_MUTATION_FORBIDDEN"
    });
    router.post(`/${resourceName}`, authMiddleware, guardFor(resourceName, "create"), blockInvoiceMutation);
    router.put(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), blockInvoiceMutation);
    router.patch(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), blockInvoiceMutation);
    router.post(`/${resourceName}/:id/deactivate`, authMiddleware, guardFor(resourceName, "update"), blockInvoiceMutation);
    router.post(`/${resourceName}/:id/reactivate`, authMiddleware, guardFor(resourceName, "update"), blockInvoiceMutation);
    router.delete(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "delete"), blockInvoiceMutation);
    return controller;
  }
  if (LIFECYCLE_GENERIC_MUTATION_BLOCKS[resourceName]) {
    const { code, message } = LIFECYCLE_GENERIC_MUTATION_BLOCKS[resourceName];
    const blockGenericMutation = (req, res) => stableForbidden(res, code, message);
    router.post(`/${resourceName}`, authMiddleware, guardFor(resourceName, "create"), blockGenericMutation);
    router.put(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), blockGenericMutation);
    router.patch(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), blockGenericMutation);
    router.post(`/${resourceName}/:id/deactivate`, authMiddleware, guardFor(resourceName, "update"), blockGenericMutation);
    router.post(`/${resourceName}/:id/reactivate`, authMiddleware, guardFor(resourceName, "update"), blockGenericMutation);
    router.delete(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "delete"), blockGenericMutation);
    return controller;
  }
  if (resourceName === "accounts") {
    const blockBalanceMutation = (req, res, next) => {
      const body = req.body || {};
      if (
        Object.prototype.hasOwnProperty.call(body, "balance") ||
        Object.prototype.hasOwnProperty.call(body, "storedBalance") ||
        Object.prototype.hasOwnProperty.call(body, "calculatedBalance")
      ) {
        return stableForbidden(
          res,
          "ACCOUNT_BALANCE_DIRECT_MUTATION_FORBIDDEN",
          "Account balances are derived from posted journal lines; direct balance mutation is disabled."
        );
      }
      return next();
    };
    router.post(`/${resourceName}`, authMiddleware, guardFor(resourceName, "create"), blockBalanceMutation, controller.create);
    router.put(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), blockBalanceMutation, controller.update);
    router.patch(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), blockBalanceMutation, controller.update);
    router.post(`/${resourceName}/:id/deactivate`, authMiddleware, guardFor(resourceName, "update"), controller.deactivate);
    router.post(`/${resourceName}/:id/reactivate`, authMiddleware, guardFor(resourceName, "update"), controller.reactivate);
    router.delete(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "delete"), controller.delete);
    return controller;
  }
  router.post(`/${resourceName}`, authMiddleware, guardFor(resourceName, "create"), controller.create);
  // Support both PUT (full) and PATCH (partial) — the generic update merges
  // only the fields present in the body, so both are safe.
  router.put(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), controller.update);
  router.patch(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), controller.update);
  router.post(`/${resourceName}/:id/deactivate`, authMiddleware, guardFor(resourceName, "update"), controller.deactivate);
  router.post(`/${resourceName}/:id/reactivate`, authMiddleware, guardFor(resourceName, "update"), controller.reactivate);
  router.delete(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "delete"), controller.delete);

  return controller;
}

// ─── Custom POS Checkout Endpoint ───────────────────────────────────────────
router.post("/pos/checkout",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("pos.checkout", {
    resolveBranchId: (req) => (req.body && req.body.branchId) || req.headers["x-branch-id"] || req.branchId
  }),
  async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission: "pos.sell",
      requestedOperation: "pos.checkout",
      authorizationResult: "allowed"
    });
    const actor = commandActor.employeeName || commandActor.technicalUserName || "System";
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
    await salesOperatorPolicy.assertSalesOperatorPolicy(req, "pos.checkout", {
      branchId: (body.branchId || req.headers["x-branch-id"] || req.branchId),
      transaction: t
    });

    // 1. Idempotency Check — Phase 21.3 central race-safe (unique company_id+scope+key).
    if (!idempotencyKey) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لإتمام البيع" });
    }
    const idemScope = "pos.checkout";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, body);
    const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
    if (!idemClaim.claimed) {
      try { await t.rollback(); } catch (_) { /* transaction already aborted by the unique violation */ }
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const idemRequest = idemClaim.request;

    // 2. Extract active branch
    const branchId = req.headers["x-branch-id"] || body.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب");
    }

    // Validate Branch belongs to same company, is active
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    // Branch authorization check
    if (req.user && req.user.branchId && req.user.branchId !== branchId) {
      const hasCrossBranch = req.user.permissions && (req.user.permissions.includes("pos.view") || req.user.isAdmin);
      if (!hasCrossBranch) {
        throw new ValidationError("ليس لديك صلاحية على هذا الفرع");
      }
    }

    // 3. Customer validation
    const customerId = body.customerId;
    if (!customerId) {
      throw new ValidationError("العميل مطلوب لإتمام عملية البيع");
    }
    const customer = await models.Customer.findOne({
      where: { id: customerId, companyId: req.companyId },
      transaction: t
    });
    if (!customer) {
      throw new ValidationError("العميل المحدد غير موجود");
    }

    // 4. Products/assets validation
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      throw new ValidationError("لا يمكن البيع بدون منتجات في السلة");
    }

    const validatedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const itemId = item.assetId || item.id;
      if (!itemId) continue;

      // 1. Try Product first
      const product = await models.Product.findOne({
        where: { id: itemId, companyId: req.companyId },
        lock: true,
        transaction: t
      });

      if (product) {
        const qty = Number(item.quantity) || 1;
        if (Number(product.quantityAvailable) < qty) {
          throw new ValidationError(`الكمية المطلوبة غير متاحة في المخزون للمنتج ${product.productName}. المتاح: ${product.quantityAvailable}`);
        }
        if (product.branchId !== branchId) {
          throw new ValidationError(`المنتج ${product.productName} تابع لفرع آخر وليس للفرع النشط`);
        }

        const itemWeight = Number(item.totalWeight) || (Number(product.averageUnitWeight || 0) * qty);
        const itemPrice = Number(item.price) || Number(product.salePrice) || 0;

        validatedItems.push({
          isProduct: true,
          product,
          quantity: qty,
          price: itemPrice,
          weight: itemWeight,
          cost: Number(product.unitCost) || 0,
          discount: Number(item.discount) || 0,
          makingCharge: Number(item.makingCharge) || 0,
          stoneValue: Number(item.stoneValue) || 0
        });

        subtotal += itemPrice * qty;
      } else {
        // 2. Try Asset
        const asset = await models.Asset.findOne({
          where: { id: itemId, companyId: req.companyId },
          lock: true,
          transaction: t
        });

        if (!asset) {
          throw new ValidationError(`المنتج ذو الرمز ${itemId} غير موجود في المخزون`);
        }
        if (asset.status !== "available") {
          throw new ValidationError(`المنتج ${asset.name} (${asset.id}) غير متاح للبيع حالياً، حالته: ${asset.status}`);
        }
        if (asset.branchId !== branchId) {
          throw new ValidationError(`المنتج ${asset.name} (${asset.id}) تابع لفرع آخر وليس للفرع النشط`);
        }

        validatedItems.push({
          isProduct: false,
          asset,
          quantity: 1,
          price: Number(item.price) || Number(asset.price) || 0,
          weight: Number(asset.grossWeight) || 0,
          cost: Number(asset.cost) || 0,
          discount: Number(item.discount) || 0,
          makingCharge: Number(item.makingCharge) || 0,
          stoneValue: Number(item.stoneValue) || 0
        });

        subtotal += Number(item.price) || Number(asset.price) || 0;
      }
    }
    const discount = Number(body.discount) || 0;
    const makingCharge = Number(body.makingCharge) || 0;
    const stoneValue = Number(body.stoneValue) || 0;

    if (discount > (subtotal + makingCharge + stoneValue)) {
      const hasDiscountApprove = req.user && await permissionService.userHasPermission(req.user, "pos.discount.approve");
      if (!hasDiscountApprove) {
        throw new AppError("قيمة الخصم تتجاوز إجمالي الفاتورة وتتطلب صلاحية اعتماد الخصم", 403, "POS_DISCOUNT_APPROVAL_REQUIRED");
      }
      await salesOperatorPolicy.assertSalesOperatorPolicy(req, "pos.discount.override", { branchId, transaction: t });
      await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
        action: "pos.discount.override",
        description: `POS discount override authorized at ${branchRecord.name}`,
        place: branchRecord.name,
        branch: branchRecord.name,
        severity: "warning",
        before: null,
        after: JSON.stringify({ subtotal, makingCharge, stoneValue, discount, branchId })
      }, {
        requiredPermission: "pos.discount.approve",
        requestedOperation: "pos.discount.override",
        authorizationResult: "allowed"
      }), { transaction: t });
    }

    // 6. Settings + totals via the shared sales service (single source of truth)
    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const totals = salesService.computeTotals({ subtotal, makingCharge, stoneValue, discount, vatRatePercent: settings.vatRate });
    const vatRatePercent = totals.vatRate;
    const computedTax = totals.tax;
    const total = totals.total;

    // 7. Resolve payment outcome + installment schedule (shared rules/validation)
    const paymentMethod = body.paymentMethod || "cash";
    const payment = salesService.resolvePayment({
      paymentMethod,
      total,
      body,
      installmentRules: settings.installment,
      user: req.user,
    });
    const { paidAmount, remainingAmount, status, installmentsToCreate } = payment;

    // 8. Generate safe sequence invoice ID. Shared generator considers posted-
    // draft invoice_numbers too so POS and post-draft never reuse a number.
    // (Same INV-prefix-NNNNNN result as before; just collision-safe.)
    const prefix = settings.invoicePrefix || "INV-2026";
    // Phase 16D — separate the customer-facing number (company-scoped, human)
    // from the technical primary key (globally unique). Previously the PK reused
    // the company-scoped number, so a second company's first POS sale collided on
    // invoices_pkey. invoiceNumber keeps its existing format/value.
    const invoiceNumber = await nextInvoiceNumber(req.companyId, prefix, t);
    const invoiceId = `INV-ID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 8. Create Invoice
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const invoice = await models.Invoice.create({
      id: invoiceId,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      customerId,
      customerName: customer.name,
      type: paymentMethod === "installment" ? "installment" : (paymentMethod === "deposit" ? "deposit" : "sale"),
      date: body.date || nowStr.slice(0, 10),
      // Stored subtotal is the net-of-VAT base (= total - tax) so the journal
      // entry balances and it matches the convention used by existing invoices.
      subtotal: totals.taxBase,
      tax: computedTax,
      vatRate: vatRatePercent,
      discount,
      makingCharge,
      stoneValue,
      total,
      paidAmount,
      remainingAmount,
      status,
      paymentMethod,
      paymentSplits: body.paymentSplits || [],
      downPayment: body.downPayment || 0,
      installmentCount: body.installmentCount || 0,
      guarantorName: body.guarantorName || "",
      guarantorPhone: body.guarantorPhone || "",
      installmentFrequency: body.installmentFrequency || "monthly",
      notes: body.notes || "",
      idempotencyKey: idempotencyKey || null,
      postingStatus: "posted", // immediate-post path (POS checkout)
      invoiceNumber, // customer-facing, company-scoped human number (≠ technical id)
      postedAt: nowStr,
      finalizedByEmployeeId: commandActor.employeeId || null
    }, { transaction: t });

    // 9. Create Invoice Items & Update Stock Status (Products & Assets)
    const invoiceItems = [];
    for (const vItem of validatedItems) {
      if (vItem.isProduct) {
        const product = vItem.product;
        const qty = vItem.quantity;
        
        // Decrement available and physical stock, increment sold count
        product.quantityAvailable = Math.round((Number(product.quantityAvailable) - qty) * 100) / 100;
        product.quantityOnHand = Math.round((Number(product.quantityOnHand) - qty) * 100) / 100;
        product.quantitySold = Math.round((Number(product.quantitySold) + qty) * 100) / 100;
        product.totalWeight = Math.round((Number(product.totalWeight) - vItem.weight) * 10000) / 10000;
        
        await product.save({ transaction: t, skipAdjustmentHook: true });

        // Log Stock Movement
        await models.StockMovement.create({
          id: `SM-SALE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          companyId: req.companyId,
          productId: product.id,
          productCode: product.productCode,
          type: "sale",
          quantityIn: 0,
          quantityOut: qty,
          weightIn: 0,
          weightOut: vItem.weight,
          unitCost: vItem.cost,
          totalCost: vItem.cost * qty,
          referenceType: "Invoice",
          referenceId: invoiceId,
          customerId,
          branchId,
          createdBy: actor
        }, { transaction: t });

        // Create Invoice Item
        const invoiceItem = await models.InvoiceItem.create({
          invoiceId,
          assetId: product.id, // Store product.id inside assetId column
          name: product.productName,
          quantity: qty,
          price: vItem.price,
          cost: vItem.cost,
          weight: vItem.weight,
          karat: product.karat || null,
          discount: vItem.discount || 0,
          makingCharge: vItem.makingCharge || 0,
          stoneValue: vItem.stoneValue || 0
        }, { transaction: t });
        invoiceItems.push(invoiceItem.toJSON());
      } else {
        const asset = vItem.asset;
        // Create Invoice Item
        const invoiceItem = await models.InvoiceItem.create({
          invoiceId,
          assetId: asset.id,
          name: asset.name,
          quantity: 1,
          price: vItem.price,
          cost: vItem.cost,
          weight: vItem.weight,
          karat: asset.karat || null,
          discount: vItem.discount || 0,
          makingCharge: vItem.makingCharge || 0,
          stoneValue: vItem.stoneValue || 0
        }, { transaction: t });
        invoiceItems.push(invoiceItem.toJSON());

        // Update asset status to sold
        await asset.update({ status: "sold" }, { transaction: t });

        // Create Asset Event in timeline
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id,
          action: "SALE",
          date: nowStr.slice(0, 10),
          user: actor,
          branch: branchRecord.name,
          note: `تم البيع بموجب الفاتورة رقم ${invoiceNumber}`,
          sourceDocument: invoiceId,
          beforeState: "status:available",
          afterState: "status:sold"
        }, { transaction: t });
      }
    }

    // 10. Create Real Payment Records in `payments` table
    const paymentsCreated = [];
    if (paymentMethod === "split") {
      const splits = Array.isArray(body.paymentSplits) ? body.paymentSplits : [];
      for (const split of splits) {
        const payment = await models.Payment.create({
          id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          branchId,
          invoiceId,
          paymentMethod: split.method,
          amount: split.amount,
          reference: split.reference || "",
          date: body.date || nowStr.slice(0, 10),
          notes: `دفع مجزأ للفاتورة ${invoiceNumber}`,
          receivedByEmployeeId: commandActor.employeeId || null
        }, { transaction: t });
        paymentsCreated.push(payment.toJSON());
      }
    } else if (paymentMethod === "installment") {
      const downPayment = Number(body.downPayment) || 0;
      if (downPayment > 0) {
        const payment = await models.Payment.create({
          id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          branchId,
          invoiceId,
          paymentMethod: "cash",
          amount: downPayment,
          reference: "",
          date: body.date || nowStr.slice(0, 10),
          notes: `دفعة أولى للفاتورة ${invoiceNumber}`,
          receivedByEmployeeId: commandActor.employeeId || null
        }, { transaction: t });
        paymentsCreated.push(payment.toJSON());
      }
    } else {
      const payment = await models.Payment.create({
        id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        invoiceId,
        paymentMethod,
        amount: paidAmount,
        reference: body.reference || "",
        date: body.date || nowStr.slice(0, 10),
        notes: paymentMethod === "deposit" ? `عربون للفاتورة ${invoiceNumber}` : `سداد كامل للفاتورة ${invoiceNumber}`,
        receivedByEmployeeId: commandActor.employeeId || null
      }, { transaction: t });
      paymentsCreated.push(payment.toJSON());
    }

    // 11. Create Installments in installments table
    const createdInstallmentRecords = [];
    if (installmentsToCreate.length > 0) {
      for (const inst of installmentsToCreate) {
        const installmentRecord = await models.Installment.create({
          id: `INST-${invoiceId}-${inst.sequence}`,
          companyId: req.companyId,
          invoiceId,
          customerId,
          customerName: customer.name,
          sequence: inst.sequence,
          dueDate: inst.dueDate,
          amount: inst.amount,
          paidAmount: 0,
          status: "pending",
          branch: branchRecord.name
        }, { transaction: t });
        createdInstallmentRecords.push(installmentRecord.toJSON());
      }
    }

    // 12. Create Cash Transactions & Post to Accounting Ledger
    const invPlain = invoice.toJSON();
    invPlain.downPayment = Number(body.downPayment) || 0;

    let journalEntry = null;
    try {
      if (invoice.type === "deposit") {
        journalEntry = await postingService.postDepositEntry(invPlain, actor, {
          transaction: t,
          receivedAmount: paidAmount,
        });
      } else {
        journalEntry = await postingService.postInvoiceEntry(invPlain, invoiceItems, actor, { transaction: t });
      }
    } catch (postErr) {
      logger.error(`[Posting] Failed to post journal entry: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي: ${postErr.message}`);
    }

    // Now record the treasury cash transactions
    for (const pay of paymentsCreated) {
      const methodLower = pay.paymentMethod.toLowerCase();
      const account = (methodLower.includes("card") || methodLower.includes("bank") || methodLower.includes("transfer") || methodLower.includes("شبكة") || methodLower.includes("تحويل")) ? "bank" : "cash";

      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        type: "cash_in",
        account,
        amount: pay.amount,
        category: paymentMethod === "deposit" ? "عربون عميل" : "مبيعات مجوهرات",
        description: `مقبوضات فاتورة مبيعات رقم ${invoiceNumber} - طريقة الدفع: ${pay.paymentMethod}`,
        reference: invoiceId,
        date: body.date || nowStr.slice(0, 10),
        status: "posted",
        createdBy: req.user ? req.user.id : "System",
        journalEntryId: journalEntry ? journalEntry.id : null
      }, { transaction: t });
    }

    // 13. Award loyalty points + update the customer's outstanding balance.
    //     Both run INSIDE the sale transaction so they roll back with the sale
    //     (no orphan loyalty / balance drift if checkout fails).
    let loyalty = null;
    if (customerId) {
      loyalty = await awardLoyaltyForSale(req.companyId, customer, total, invoiceId, { transaction: t });
      // Credit/installment/deposit sales increase what the customer owes.
      if (remainingAmount > 0) {
        await customer.update(
          { balance: Math.round((Number(customer.balance || 0) + remainingAmount) * 100) / 100 },
          { transaction: t }
        );
      }
    }

    // 14. Record Audit Log — transaction MUST be the 3rd arg (opts), not in the
    // data object, so the audit row is part of `t` and rolls back if checkout fails.
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "pos.checkout",
      description: `تم إتمام عملية بيع فاتورة رقم ${invoiceNumber} بمبلغ ${total} بفرع ${branchRecord.name}`,
      user: actor,
      place: branchRecord.name,
      branch: branchRecord.name,
      sourceDocument: "invoice",
      severity: "info",
      before: null,
      after: JSON.stringify({ invoiceId, total, paymentMethod })
    }, commandActor), { transaction: t });

    // Recalculate customer net purchases
    const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
    await recalculateCustomerNetPurchases(models, req.companyId, customerId, { transaction: t });

    // Build the success response up front and persist it for idempotent replay
    // BEFORE commit (same transaction as the claimed idempotency row).
    const out = invoice.toJSON();
    out.journalEntry = journalEntry;
    out.installments = createdInstallmentRecords;
    out.payments = paymentsCreated;
    out.loyalty = loyalty;
    out.items = invoiceItems;
    const idemResponseBody = { success: true, ...out, data: out };
    await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });

    // Commit Transaction
    await t.commit();

    // 15. Create notification and emit events
    const notificationCurrency = settings.currency || "AED";
    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "create",
      id: invoiceId,
      branchId,
      related: {
        customerId: customer.id,
        assetIds: invoiceItems.map(i => i.assetId).filter(Boolean)
      }
    });
    await notificationService.createNotification(req.companyId, {
      title: "عملية بيع جديدة",
      message: `تم إنشاء الفاتورة ${invoiceNumber} للعميل ${customer.name} بقيمة ${total} ${notificationCurrency}.`,
      type: "success",
      entityType: "Invoice",
      entityId: invoiceId
    });

    return res.status(201).json(idemResponseBody);
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Sales Returns Endpoint ──────────────────────────────────────────
router.post(
  "/sales/returns",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.return.execute", {
    resolveBranchId: resolveAdjustmentInvoiceBranchId
  }),
  async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const { originalInvoiceId, returnedAssetIds = [], reason = "" } = body;
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission: "sales.returns.execute",
      requestedOperation: "sales.return.execute",
      authorizationResult: "allowed"
    });

    // Phase 21.3 — central race-safe idempotency (unique company_id+scope+key).
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
    if (!idempotencyKey) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لعملية المرتجع" });
    }
    const idemScope = "sales.return";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, idempotencyBodyWithActor(req, body, commandActor));
    const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
    if (!idemClaim.claimed) {
      try { await t.rollback(); } catch (_) { /* transaction already aborted by the unique violation */ }
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const idemRequest = idemClaim.request;

    if (!originalInvoiceId) {
      throw new ValidationError("رقم الفاتورة الأصلية مطلوب");
    }
    // Items to return come via the new optional `returnedInvoiceItemIds` (exact
    // lines by InvoiceItem.id) or the legacy `returnedAssetIds`. Require one here.
    if (!Array.isArray(body.returnedInvoiceItemIds) && returnedAssetIds.length === 0) {
      throw new ValidationError("يجب اختيار عنصر واحد على الأقل للإرجاع");
    }

    // 1. Validate original invoice
    const originalInvoice = await models.Invoice.findOne({
      where: { id: originalInvoiceId, companyId: req.companyId },
      include: [{ model: models.InvoiceItem, as: "items" }],
      // Lock only the invoices row, not the LEFT-JOINed items: Postgres rejects
      // FOR UPDATE on the nullable side of an outer join. (Phase 18E)
      lock: { level: t.LOCK.UPDATE, of: models.Invoice },
      transaction: t
    });
    if (!originalInvoice) {
      throw new ValidationError("لم يتم العثور على الفاتورة الأصلية");
    }
    if (originalInvoice.status === "returned") {
      throw new ValidationError("هذه الفاتورة تم إرجاعها بالكامل مسبقاً");
    }

    // 2. Validate returnable items and classify each as Asset or Product.
    //    InvoiceItem.assetId carries either an Asset id or a Product id (PRD-ID),
    //    so resolve each returned id against both. Asset lines return the unit;
    //    Product lines do a FULL return of the original line quantity (Phase 18I).
    //    Reject any id already returned by an earlier credit note (no double/over-return).
    const priorReturns = await models.Invoice.findAll({
      // Block re-return of a line already returned OR exchanged off this invoice
      // (symmetric with /sales/exchanges; Phase 18K).
      where: postedInvoiceWhere({ relatedInvoiceId: originalInvoiceId, type: ["return", "exchange"], companyId: req.companyId }),
      include: [{ model: models.InvoiceItem, as: "items" }],
      transaction: t
    });
    const priorReturnedIds = new Set();
    for (const ret of priorReturns) {
      for (const it of ret.items) priorReturnedIds.add(it.assetId);
    }

    // Resolve which original lines are being returned. New optional payload
    // `returnedInvoiceItemIds` targets exact lines by InvoiceItem.id (needed when
    // the same product appears on more than one line); the legacy `returnedAssetIds`
    // (by assetId, first matching line) remains the fallback (Phase 18S).
    let selectedOriginalItems;
    if (Array.isArray(body.returnedInvoiceItemIds)) {
      if (body.returnedInvoiceItemIds.length === 0) {
        throw new ValidationError("يجب اختيار عنصر واحد على الأقل للإرجاع");
      }
      const seenLineIds = new Set();
      selectedOriginalItems = body.returnedInvoiceItemIds.map((rawId) => {
        const lineId = Number(rawId);
        if (!Number.isInteger(lineId) || lineId <= 0) {
          throw new ValidationError("بند الفاتورة المحدد غير موجود");
        }
        if (seenLineIds.has(lineId)) {
          throw new ValidationError("لا يمكن تكرار نفس البند في الإرجاع");
        }
        seenLineIds.add(lineId);
        const item = originalInvoice.items.find((i) => Number(i.id) === lineId);
        if (!item) {
          throw new ValidationError("بند الفاتورة المحدد غير موجود");
        }
        return item;
      });
    } else {
      selectedOriginalItems = returnedAssetIds.map((rid) => {
        const item = originalInvoice.items.find((i) => i.assetId === rid);
        if (!item) {
          throw new ValidationError(`البند (${rid}) ليس جزءاً من الفاتورة الأصلية المحدد إرجاعها`);
        }
        return item;
      });
    }

    const returnLines = [];
    for (const originalItem of selectedOriginalItems) {
      const rid = originalItem.assetId;
      // Double-return guard stays product-level (by assetId): credit-note lines do
      // not persist the original line id, so line-level history needs a future
      // migration. Conservative — never over-returns. (Phase 18S)
      if (priorReturnedIds.has(rid)) {
        throw new ValidationError("تم إرجاع هذا البند مسبقاً");
      }

      // Try Asset first (unit return, unchanged behaviour)
      const asset = await models.Asset.findOne({ where: { id: rid, companyId: req.companyId }, lock: true, transaction: t });
      if (asset) {
        if (asset.status !== "sold") {
          throw new ValidationError(`المنتج ${asset.name} (${asset.id}) غير مباع حالياً، حالته: ${asset.status}`);
        }
        returnLines.push({ kind: "asset", id: rid, asset, originalItem, quantity: 1 });
        continue;
      }

      // Otherwise a Product (quantity-based full return)
      const product = await models.Product.findOne({ where: { id: rid, companyId: req.companyId }, lock: true, transaction: t });
      if (product) {
        const qty = Number(originalItem.quantity) || 1;
        if (qty <= 0) {
          throw new ValidationError(`كمية البند (${rid}) غير صالحة للإرجاع`);
        }
        returnLines.push({ kind: "product", id: rid, product, originalItem, quantity: qty });
        continue;
      }

      throw new ValidationError("بعض الأصول المحددة غير موجودة في النظام");
    }

    // 3. Extract branch and settings
    const branchId = req.headers["x-branch-id"] || req.body.branchId || originalInvoice.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب لتسجيل المرتجع");
    }
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }
    await salesOperatorPolicy.assertSalesOperatorPolicy(req, "sales.return.execute", { branchId, transaction: t });

    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const vatRatePercent = Number(originalInvoice.vatRate ?? settings.vatRate ?? 0);

    // 4. Calculate return totals
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    let returnedSubtotal = 0;
    let returnedCost = 0;
    for (const line of returnLines) {
      const item = line.originalItem;
      // Asset lines are qty 1; product full-return uses the original line qty.
      // InvoiceItem.price/cost are per-unit, so multiply by the line quantity.
      returnedSubtotal += Number(item.price || 0) * line.quantity;
      returnedCost += Number(item.cost || 0) * line.quantity;
    }
    const returnedTax = roundVal(returnedSubtotal * (vatRatePercent / 100));
    const returnedTotal = roundVal(returnedSubtotal + returnedTax);

    // 5. Create credit note invoice ID
    const returnInvoiceId = `CN-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    // 6. Create Return Invoice (Negative total representing credit note)
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const returnInvoice = await models.Invoice.create({
      id: returnInvoiceId,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      customerId: originalInvoice.customerId,
      customerName: originalInvoice.customerName,
      type: "return",
      date: nowStr.slice(0, 10),
      subtotal: -returnedSubtotal,
      tax: -returnedTax,
      vatRate: vatRatePercent,
      total: -returnedTotal,
      status: "returned",
      paymentMethod: originalInvoice.paymentMethod,
      relatedInvoiceId: originalInvoice.id,
      notes: reason || "مرتجع مبيعات",
      idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey || null,
      postingStatus: "posted", // immediate-post path (sales return)
      invoiceNumber: returnInvoiceId,
      postedAt: nowStr,
      createdByEmployeeId: commandActor.employeeId || null,
      finalizedByEmployeeId: commandActor.employeeId || null
    }, { transaction: t });

    // 7. Create Return Invoice Items and restore asset status
    const returnItems = [];
    for (const line of returnLines) {
      const origItem = line.originalItem;
      const qty = line.quantity;
      const lineWeight = Number(origItem.weight || 0); // stored weight is the line total
      const returnItem = await models.InvoiceItem.create({
        invoiceId: returnInvoiceId,
        assetId: line.id,
        name: line.kind === "asset" ? line.asset.name : line.product.productName,
        quantity: qty,
        price: -Number(origItem.price || 0),
        cost: Number(origItem.cost || 0),
        weight: lineWeight,
        karat: origItem.karat,
        discount: -Number(origItem.discount || 0),
        makingCharge: -Number(origItem.makingCharge || 0),
        stoneValue: -Number(origItem.stoneValue || 0)
      }, { transaction: t });
      returnItems.push(returnItem);

      if (line.kind === "asset") {
        // Restore status to returned (not available blindly)
        await line.asset.update({ status: "returned" }, { transaction: t });

        // Create Asset Event
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: line.asset.id,
          action: "RETURNED",
          date: nowStr.slice(0, 10),
          user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
          branch: branchRecord.name,
          note: `تم الإرجاع للفاتورة: ${originalInvoice.id}. السبب: ${reason || "غير محدد"}`,
          sourceDocument: originalInvoice.id,
          beforeState: "status:sold",
          afterState: "status:returned",
          severity: "info"
        }, { transaction: t });
      } else {
        // Product full return: restock quantities/weight (mirror of the POS sale).
        const product = line.product;
        product.quantityAvailable = roundVal(Number(product.quantityAvailable || 0) + qty);
        product.quantityOnHand = roundVal(Number(product.quantityOnHand || 0) + qty);
        product.quantitySold = Math.max(0, roundVal(Number(product.quantitySold || 0) - qty));
        product.totalWeight = Math.round((Number(product.totalWeight || 0) + lineWeight) * 10000) / 10000;
        await product.save({ transaction: t, skipAdjustmentHook: true });

        // Log Stock Movement (return = stock in)
        await models.StockMovement.create({
          id: `SM-RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          companyId: req.companyId,
          productId: product.id,
          productCode: product.productCode,
          type: "return",
          quantityIn: qty,
          quantityOut: 0,
          weightIn: lineWeight,
          weightOut: 0,
          unitCost: Number(origItem.cost || 0),
          totalCost: Number(origItem.cost || 0) * qty,
          referenceType: "Invoice",
          referenceId: returnInvoiceId,
          customerId: originalInvoice.customerId,
          branchId,
          createdBy: req.user ? req.user.id : "System"
        }, { transaction: t });
      }
    }

    // 8. Update original invoice status (fully returned or partial)
    const originalItemIds = originalInvoice.items.map(i => i.assetId);
    const otherReturns = await models.Invoice.findAll({
      where: postedInvoiceWhere({ relatedInvoiceId: originalInvoice.id, type: "return", companyId: req.companyId }),
      include: [{ model: models.InvoiceItem, as: "items" }],
      transaction: t
    });

    const previouslyReturnedAssetIds = new Set();
    for (const ret of otherReturns) {
      for (const item of ret.items) {
        previouslyReturnedAssetIds.add(item.assetId);
      }
    }
    for (const id of returnedAssetIds) {
      previouslyReturnedAssetIds.add(id);
    }

    const allItemsReturned = originalItemIds.every(id => previouslyReturnedAssetIds.has(id));
    await originalInvoice.update({
      status: allItemsReturned ? "returned" : "partial"
    }, { transaction: t });

    // Phase 21.2 — receivable-first settlement. Apply the return value to the
    // original invoice's outstanding receivable FIRST; only the excess becomes a
    // real cash refund. Prevents refunding cash for money never collected and
    // keeps the GL money leg, treasury, and customer balance consistent.
    const outstandingBefore = roundVal(Number(originalInvoice.remainingAmount || 0));
    const receivableReliefAmount = roundVal(Math.min(returnedTotal, outstandingBefore));
    const excessAmount = roundVal(returnedTotal - receivableReliefAmount);
    const refundMethodLower = originalInvoice.paymentMethod.toLowerCase();
    const originalIsBank = refundMethodLower.includes("card") || refundMethodLower.includes("bank") || refundMethodLower.includes("transfer") || refundMethodLower.includes("شبكة") || refundMethodLower.includes("تحويل");

    // Phase 30 — operator-selectable settlement of the excess AFTER AR relief.
    // Absent settlement preserves the legacy default (full excess refunded to
    // cash/bank on the original invoice's payment-method account); customer credit
    // is never created unless explicitly requested. Parts must sum to the excess.
    const settlementInput = salesService.resolveExcessSettlement({
      excessAmount,
      settlement: body.settlement,
      hasCustomer: !!originalInvoice.customerId,
    });
    let cashRefundPortion = 0, bankRefundPortion = 0, creditPortion = 0;
    if (excessAmount > 0.01) {
      if (settlementInput.provided) {
        cashRefundPortion = settlementInput.cashAmount;
        bankRefundPortion = settlementInput.bankAmount;
        creditPortion = settlementInput.creditAmount;
      } else if (originalIsBank) {
        bankRefundPortion = excessAmount;
      } else {
        cashRefundPortion = excessAmount;
      }
    }

    // 9. Post GL Journal Entry (posting service expects positive absolute figures).
    // The return journal is the sole GL owner: AR relief (Cr 1300) + cash (Cr 1110)
    // + bank (Cr 1120) + customer credit (Cr 2300) all in one balanced entry.
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    let journalEntry = null;
    try {
      const returnInvoiceForPosting = {
        ...returnInvoice.toJSON(),
        total: returnedTotal,
        tax: returnedTax,
        subtotal: returnedSubtotal
      };
      journalEntry = await postingService.postReturnEntry(returnInvoiceForPosting, returnItems, actor, {
        transaction: t,
        receivableReliefAmount,
        cashRefundAmount: cashRefundPortion,
        bankRefundAmount: bankRefundPortion,
        customerCreditAmount: creditPortion,
        cashAccountCode: "1110",
        bankAccountCode: "1120"
      });
    } catch (postErr) {
      logger.error(`[Posting] Failed to post return journal entry: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي للمرتجع: ${postErr.message}`);
    }

    // 10. Record Treasury Cash Transaction logs — ONLY for the real cash/bank
    // refund portions (one row per non-zero part). Pure receivable relief and the
    // customer-credit portion move no cash, so they create no CashTransaction and
    // no postCashEntry is called (the return journal above already owns the GL).
    const makeRefundCashTx = async (amount, account) => {
      if (amount <= 0) return;
      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        type: "cash_out",
        account,
        amount,
        category: "مرتجع مبيعات",
        description: `مرتجع مبيعات (استرداد ${account === "bank" ? "بنكي" : "نقدي"}) للفاتورة رقم ${originalInvoice.id} - مستند دائن ${returnInvoiceId}`,
        reference: returnInvoiceId,
        date: nowStr.slice(0, 10),
        status: "posted",
        createdBy: req.user ? req.user.id : "System",
        journalEntryId: journalEntry ? journalEntry.id : null
      }, { transaction: t });
    };
    await makeRefundCashTx(cashRefundPortion, "cash");
    await makeRefundCashTx(bankRefundPortion, "bank");

    // Phase 30 — customer credit portion: record a credit_in linked to the SAME
    // return journal (its Cr 2300 line was posted above). Explicit journalEntryId,
    // NO glPosting → no second journal; keeps the 2300 bridge reconcilable.
    if (creditPortion > 0) {
      await customerCreditService.recordCreditIn({
        models,
        companyId: req.companyId,
        customerId: originalInvoice.customerId,
        branchId,
        amount: creditPortion,
        currency: settings.currency || "AED",
        sourceType: "return_credit",
        sourceId: returnInvoiceId,
        invoiceId: originalInvoiceId,
        description: settlementInput.description || `رصيد دائن من مرتجع الفاتورة ${originalInvoiceId}`,
        metadata: {
          originalInvoiceId,
          reference: settlementInput.reference || null,
          settlement: { cashAmount: cashRefundPortion, bankAmount: bankRefundPortion, creditAmount: creditPortion }
        },
        journalEntryId: journalEntry ? journalEntry.id : null,
        createdBy: req.user ? req.user.id : "System",
        transaction: t
      });
    }

    // 11. Apply the receivable relief ONCE — customer balance + invoice
    // remainingAmount both reduced by the AR portion only (never below zero).
    if (receivableReliefAmount > 0) {
      const customer = await models.Customer.findOne({
        where: { id: originalInvoice.customerId, companyId: req.companyId },
        transaction: t
      });
      if (customer) {
        await customer.update({
          balance: Math.max(0, roundVal(Number(customer.balance || 0) - receivableReliefAmount))
        }, { transaction: t });
      }
      await originalInvoice.update({
        remainingAmount: Math.max(0, roundVal(outstandingBefore - receivableReliefAmount))
      }, { transaction: t });
    }

    // 12. Write Audit Log
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "sales.return",
      description: `تم تسجيل مرتجع للفاتورة رقم ${originalInvoice.id} بمبلغ ${returnedTotal} - سند دائن رقم ${returnInvoiceId}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branchRecord.name,
      sourceDocument: "invoice",
      severity: "info",
      after: JSON.stringify({ returnInvoiceId, originalInvoiceId, returnedTotal })
    }, commandActor), { transaction: t });

    // Recalculate customer net purchases
    const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
    await recalculateCustomerNetPurchases(models, req.companyId, originalInvoice.customerId, { transaction: t });

    // Build the success response up front and persist it for idempotent replay
    // BEFORE commit (same transaction as the claimed idempotency row).
    const responseData = returnInvoice.toJSON();
    responseData.items = returnItems;
    responseData.journalEntry = journalEntry;
    const idemResponseBody = { success: true, ...responseData, data: responseData };
    await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });

    // Commit Transaction
    await t.commit();

    // 13. Emit Notifications & SSE Events
    const notificationCurrency = settings.currency || "AED";
    await notificationService.createNotification(req.companyId, {
      title: "عملية مرتجع مبيعات جديدة",
      message: `تم تسجيل مرتجع للفاتورة ${originalInvoice.id} بقيمة ${returnedTotal} ${notificationCurrency}.`,
      type: "warning",
      entityType: "Invoice",
      entityId: returnInvoiceId
    });
    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "cancel",
      id: returnInvoiceId,
      branchId,
      related: {
        invoiceId: originalInvoiceId,
        customerId: originalInvoice.customerId,
        assetIds: returnedAssetIds
      }
    });

    return res.status(201).json(idemResponseBody);
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Exchange Preview Endpoint (read-only target policy) ─────────────────────
router.post(
  "/sales/exchanges/preview",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.exchange.preview", {
    resolveBranchId: resolveAdjustmentInvoiceBranchId
  }),
  async (req, res, next) => {
  try {
    const body = req.body || {};
    const { originalInvoiceId } = body;
    if (!originalInvoiceId) throw new ValidationError("رقم الفاتورة الأصلية مطلوب");

    const originalInvoice = await models.Invoice.findOne({
      where: { id: originalInvoiceId, companyId: req.companyId },
      attributes: ["id", "companyId", "branchId", "customerId", "customerName", "remainingAmount", "postingStatus", "status", "type"],
      include: [{ model: models.InvoiceItem, as: "items", attributes: ["id", "invoiceId", "assetId", "name", "quantity", "price", "cost", "weight", "karat"] }],
    });
    if (!originalInvoice) throw new ValidationError("لم يتم العثور على الفاتورة الأصلية");
    if (originalInvoice.companyId !== req.companyId) throw new ForbiddenError("الفاتورة لا تتبع الشركة الحالية");
    if (originalInvoice.postingStatus && originalInvoice.postingStatus !== "posted") throw new ValidationError("يمكن معاينة استبدال الفواتير المرحلة فقط");
    if (["return", "exchange"].includes(String(originalInvoice.type || "").toLowerCase())) throw new ValidationError("لا تدعم المعاينة استبدال فواتير المرتجع أو الاستبدال");
    if (String(originalInvoice.status || "").toLowerCase() === "cancelled") throw new ValidationError("لا يمكن معاينة استبدال فاتورة ملغاة");

    const returnedItems = Array.isArray(body.returnedItems) ? body.returnedItems : [];
    if (returnedItems.length > 1) throw new ValidationError("معاينة الاستبدال الحالية تدعم بنداً مرتجعاً واحداً فقط");
    const returnedInput = returnedItems[0] || {};
    const returnedInvoiceItemId = body.returnedInvoiceItemId ?? returnedInput.returnedInvoiceItemId ?? returnedInput.invoiceItemId;
    const returnedAssetId = body.returnedAssetId ?? returnedInput.returnedAssetId ?? returnedInput.assetId;
    if (!returnedAssetId && returnedInvoiceItemId == null) throw new ValidationError("رقم القطعة المرتجعة مطلوب للاستبدال");

    let originalItem;
    if (returnedInvoiceItemId != null) {
      const lineId = Number(returnedInvoiceItemId);
      if (!Number.isInteger(lineId) || lineId <= 0) throw new ValidationError("بند الفاتورة المحدد غير موجود");
      originalItem = originalInvoice.items.find((i) => Number(i.id) === lineId);
      if (!originalItem) throw new ValidationError("بند الفاتورة المحدد غير موجود");
      if (returnedAssetId && originalItem.assetId !== returnedAssetId) throw new ValidationError("بند الفاتورة المحدد لا يطابق العنصر المرتجع");
    } else {
      originalItem = originalInvoice.items.find((i) => i.assetId === returnedAssetId);
      if (!originalItem) throw new ValidationError("البند المرتجع ليس جزءاً من الفاتورة الأصلية المحددة");
    }

    const effectiveReturnedId = originalItem.assetId;
    const priorCredits = await models.Invoice.findAll({
      where: postedInvoiceWhere({ relatedInvoiceId: originalInvoiceId, type: ["return", "exchange"], companyId: req.companyId }),
      attributes: ["id", "type", "relatedInvoiceId"],
      include: [{ model: models.InvoiceItem, as: "items", attributes: ["assetId"] }],
    });
    for (const credit of priorCredits) {
      if (credit.items.some((it) => it.assetId === effectiveReturnedId)) {
        throw new ValidationError("تم إرجاع هذا البند مسبقاً");
      }
    }

    const returnedAsset = await models.Asset.findOne({
      where: { id: effectiveReturnedId, companyId: req.companyId },
      attributes: ["id", "companyId", "name", "status", "branchId", "price", "cost"],
    });
    let returnQuantity = 1;
    if (returnedAsset) {
      if (returnedAsset.status !== "sold") throw new ValidationError(`الأصل المراد إرجاعه غير مباع حالياً، حالته: ${returnedAsset.status}`);
    } else {
      const returnedProduct = await models.Product.findOne({
        where: { id: effectiveReturnedId, companyId: req.companyId },
        attributes: ["id", "companyId", "productName", "branchId", "quantityAvailable", "salePrice", "unitCost"],
      });
      if (!returnedProduct) throw new ValidationError("البند المراد إرجاعه غير موجود");
      returnQuantity = Number(originalItem.quantity) || 1;
      if (returnQuantity <= 0) throw new ValidationError("كمية البند المراد إرجاعه غير صالحة");
    }

    const branchId = req.headers["x-branch-id"] || body.branchId || originalInvoice.branchId;
    if (!branchId) throw new ValidationError("الفرع النشط مطلوب لمعاينة الاستبدال");
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      attributes: ["id", "companyId", "name", "isActive"],
    });
    if (!branchRecord) throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");

    let normalizedNew;
    if (Array.isArray(body.newItems)) {
      if (body.newItems.length === 0) throw new ValidationError("يجب اختيار عنصر بديل واحد على الأقل للاستبدال");
      normalizedNew = body.newItems.map((it) => ({ type: it && it.type, id: it && it.id, quantity: it && it.quantity }));
    } else {
      const newAssetIds = Array.isArray(body.newAssetIds) ? body.newAssetIds : [];
      if (newAssetIds.length === 0) throw new ValidationError("يجب اختيار قطعة واحدة جديدة على الأقل للشراء");
      normalizedNew = newAssetIds.map((id) => ({ type: "asset", id, quantity: 1 }));
    }

    const seenNewIds = new Set();
    const newItems = [];
    for (const it of normalizedNew) {
      if (!it.id) throw new ValidationError("عنصر بديل بدون معرف غير صالح");
      if (it.type !== "asset" && it.type !== "product") throw new ValidationError(`نوع العنصر البديل غير صالح: ${it.type}`);
      const key = `${it.type}:${it.id}`;
      if (seenNewIds.has(key)) throw new ValidationError("لا يمكن تكرار نفس العنصر في الاستبدال");
      seenNewIds.add(key);

      if (it.type === "asset") {
        const asset = await models.Asset.findOne({
          where: { id: it.id, companyId: req.companyId },
          attributes: ["id", "companyId", "name", "status", "branchId", "price", "cost"],
        });
        if (!asset) throw new ValidationError("بعض الأصول البديلة الجديدة غير موجودة في النظام");
        if (asset.status !== "available") throw new ValidationError(`المنتج البديل ${asset.name} (${asset.id}) غير متاح للبيع حالياً، حالته: ${asset.status}`);
        if (asset.branchId !== branchId) throw new ValidationError(`المنتج البديل ${asset.name} (${asset.id}) تابع لفرع آخر وليس للفرع النشط`);
        const unitPrice = Number(asset.price || 0);
        newItems.push({ type: "asset", id: asset.id, name: asset.name, quantity: 1, unitPrice, lineValue: unitPrice });
      } else {
        const qty = Number(it.quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError("كمية المنتج البديل يجب أن تكون عدداً صحيحاً أكبر من صفر");
        const product = await models.Product.findOne({
          where: { id: it.id, companyId: req.companyId },
          attributes: ["id", "companyId", "productName", "branchId", "quantityAvailable", "salePrice", "unitCost"],
        });
        if (!product) throw new ValidationError("بعض المنتجات البديلة الجديدة غير موجودة في النظام");
        if (product.branchId !== branchId) throw new ValidationError(`المنتج البديل ${product.productName} (${product.id}) تابع لفرع آخر وليس للفرع النشط`);
        if (Number(product.quantityAvailable || 0) < qty) throw new ValidationError(`الكمية المطلوبة غير متاحة للمنتج البديل ${product.productName}. المتاح: ${product.quantityAvailable}`);
        const unitPrice = Number(product.salePrice || 0);
        newItems.push({ type: "product", id: product.id, name: product.productName, quantity: qty, unitPrice, lineValue: unitPrice * qty });
      }
    }

    const settings = await settingsService.getCompanySettings(req.companyId);
    const vatRatePercent = Number(settings.vatRate ?? 0);
    const returnedValue = salesService.roundMoney(Number(originalItem.price || 0) * returnQuantity);
    const newSubtotal = salesService.roundMoney(newItems.reduce((sum, it) => sum + Number(it.lineValue || 0), 0));
    const preview = exchangePolicyService.computeExchangePolicyPreview({
      originalInvoiceId: originalInvoice.id,
      customerId: originalInvoice.customerId,
      currency: settings.currency || body.currency || "AED",
      vatRate: vatRatePercent,
      returnedValue,
      newSubtotal,
      outstandingAR: Number(originalInvoice.remainingAmount || 0),
      settlement: body.settlement,
    });

    return res.json({
      success: true,
      data: {
        ...preview,
        returnedValue: preview.returnedValue,
        newSubtotal: preview.newSubtotal,
        newTax: preview.newTax,
        newGross: preview.newGross,
        difference: preview.difference,
        amountDueFromCustomer: preview.amountDueFromCustomer,
        arRelief: preview.arRelief,
        excessDueToCustomer: preview.excessDueToCustomer,
        taxPolicy: preview.taxPolicy,
        settlementPreview: preview.settlementPreview,
        customerFacing: preview.customerFacing,
        originalInvoice: {
          id: originalInvoice.id,
          customerId: originalInvoice.customerId,
          customerName: originalInvoice.customerName,
          remainingAmount: Number(originalInvoice.remainingAmount || 0),
        },
        returnedItem: {
          invoiceItemId: originalItem.id,
          assetId: effectiveReturnedId,
          name: originalItem.name,
          quantity: returnQuantity,
          value: returnedValue,
        },
        newItems,
      },
      readOnly: true,
    });
  } catch (error) {
    next(error);
  }
});

// Read-only customer-facing exchange display enrichment. Target-policy status
// requires the explicit policy marker saved in the successful idempotency
// response; unmarked historical rows remain legacy/unknown and are never
// recalculated under the current tax policy.
router.get("/invoices/:id/exchange-display", authMiddleware, requireBusinessPermission("sales.view"), async (req, res, next) => {
  try {
    const invoice = await models.Invoice.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      attributes: [
        "id", "companyId", "customerId", "type", "relatedInvoiceId",
        "subtotal", "tax", "total", "idempotencyKey",
      ],
      include: [{
        model: models.InvoiceItem,
        as: "items",
        attributes: ["id", "invoiceId", "assetId", "name", "quantity", "price"],
      }],
    });
    if (!invoice) throw new NotFoundError("Exchange invoice not found.");
    if (invoice.type !== "exchange") throw new ValidationError("Invoice is not an exchange invoice.");

    const idempotencyRequest = invoice.idempotencyKey
      ? await models.IdempotencyRequest.findOne({
          where: {
            companyId: req.companyId,
            scope: "sales.exchange",
            key: invoice.idempotencyKey,
            status: "succeeded",
          },
          attributes: ["id", "companyId", "scope", "key", "status", "responseBody"],
        })
      : null;
    const savedPolicy = exchangeDisplayService.extractSavedExchangePolicy(idempotencyRequest, invoice.id);
    const companySettings = await settingsService.getCompanySettings(req.companyId);
    const currency = companySettings.currency || "AED";

    if (!savedPolicy) {
      const fallback = exchangeDisplayService.buildLegacyDisplay({
        invoice,
        currency,
      });
      return res.status(200).json({ success: true, data: fallback, readOnly: true });
    }

    const journalEntry = await models.JournalEntry.findOne({
      where: { companyId: req.companyId, sourceType: "exchange", sourceId: invoice.id, status: "posted" },
      attributes: ["id", "companyId", "sourceType", "sourceId", "status"],
    });
    const cashTransactions = journalEntry
      ? await models.CashTransaction.findAll({
          where: {
            companyId: req.companyId,
            journalEntryId: journalEntry.id,
            reference: invoice.id,
            type: "cash_out",
            status: "posted",
          },
          attributes: ["id", "companyId", "type", "account", "amount", "reference", "journalEntryId", "status"],
        })
      : [];
    const creditTransactions = journalEntry
      ? await models.CustomerCreditTransaction.findAll({
          where: {
            companyId: req.companyId,
            sourceType: "exchange_credit",
            sourceId: invoice.id,
            journalEntryId: journalEntry.id,
            status: "active",
          },
          attributes: ["id", "companyId", "direction", "amount", "status", "sourceType", "sourceId", "journalEntryId"],
        })
      : [];
    const settlementSummary = exchangeDisplayService.buildSettlementSummary({
      expectedExcess: savedPolicy.excessDueToCustomer,
      cashTransactions,
      creditTransactions,
      journalEntry,
    });
    const display = exchangeDisplayService.buildTargetPolicyDisplay({
      invoice,
      savedPolicy,
      currency,
      settlementSummary,
    });

    return res.status(200).json({ success: true, data: display, readOnly: true });
  } catch (error) {
    next(error);
  }
});

// ─── Custom Sales Exchanges Endpoint ─────────────────────────────────────────
router.post(
  "/sales/exchanges",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.exchange.execute", {
    resolveBranchId: resolveAdjustmentInvoiceBranchId
  }),
  async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const { originalInvoiceId, returnedAssetId, newAssetIds = [], paymentMethod = "Exchange", notes = "" } = body;
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission: "sales.exchanges.execute",
      requestedOperation: "sales.exchange.execute",
      authorizationResult: "allowed"
    });

    // Phase 21.3 — central race-safe idempotency (unique company_id+scope+key).
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
    if (!idempotencyKey) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لعملية الاستبدال" });
    }
    const idemScope = "sales.exchange";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, idempotencyBodyWithActor(req, body, commandActor));
    const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
    if (!idemClaim.claimed) {
      try { await t.rollback(); } catch (_) { /* transaction already aborted by the unique violation */ }
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const idemRequest = idemClaim.request;

    if (!originalInvoiceId) {
      throw new ValidationError("رقم الفاتورة الأصلية مطلوب");
    }
    // The returned line is identified by the new optional `returnedInvoiceItemId`
    // (exact line by InvoiceItem.id) or the legacy `returnedAssetId`. Require one.
    if (!returnedAssetId && body.returnedInvoiceItemId == null) {
      throw new ValidationError("رقم القطعة المرتجعة مطلوب للاستبدال");
    }
    // New items may come via the new `newItems` payload (asset+product mix) or
    // the legacy `newAssetIds` (assets only). Require at least one source here;
    // detailed validation (incl. empty newItems) happens in section 3 (Phase 18M).
    if (!Array.isArray(body.newItems) && newAssetIds.length === 0) {
      throw new ValidationError("يجب اختيار قطعة واحدة جديدة على الأقل للشراء");
    }

    // 1. Validate original invoice
    const originalInvoice = await models.Invoice.findOne({
      where: { id: originalInvoiceId, companyId: req.companyId },
      include: [{ model: models.InvoiceItem, as: "items" }],
      // Lock only the invoices row, not the LEFT-JOINed items: Postgres rejects
      // FOR UPDATE on the nullable side of an outer join. (Phase 18E)
      lock: { level: t.LOCK.UPDATE, of: models.Invoice },
      transaction: t
    });
    if (!originalInvoice) {
      throw new ValidationError("لم يتم العثور على الفاتورة الأصلية");
    }

    // 2. Validate the returned item — it may be an Asset OR a Product (its id is
    //    stored in InvoiceItem.assetId). Asset returns the unit; a product does a
    //    FULL return of the original line quantity (Phase 18K). New items below
    //    remain assets-only.
    // Resolve the returned line. New optional `returnedInvoiceItemId` targets the
    // exact line by InvoiceItem.id (needed when the same product is on >1 line);
    // legacy `returnedAssetId` (first matching line) remains the fallback (18S).
    let originalItem;
    if (body.returnedInvoiceItemId != null) {
      const lineId = Number(body.returnedInvoiceItemId);
      if (!Number.isInteger(lineId) || lineId <= 0) {
        throw new ValidationError("بند الفاتورة المحدد غير موجود");
      }
      originalItem = originalInvoice.items.find(i => Number(i.id) === lineId);
      if (!originalItem) {
        throw new ValidationError("بند الفاتورة المحدد غير موجود");
      }
      if (returnedAssetId && originalItem.assetId !== returnedAssetId) {
        throw new ValidationError("بند الفاتورة المحدد لا يطابق العنصر المرتجع");
      }
    } else {
      originalItem = originalInvoice.items.find(i => i.assetId === returnedAssetId);
      if (!originalItem) {
        throw new ValidationError("البند المرتجع ليس جزءاً من الفاتورة الأصلية المحددة");
      }
    }
    // Effective id of the returned line (an Asset id or a Product id). Used for the
    // guard, asset/product lookup and the credit line below, so a line-id-only
    // request (no returnedAssetId) still resolves correctly.
    const effectiveReturnedId = originalItem.assetId;

    // Reject if this line was already returned/exchanged off the same invoice
    // (covers both /sales/returns credit notes and prior exchanges).
    const priorCredits = await models.Invoice.findAll({
      where: postedInvoiceWhere({ relatedInvoiceId: originalInvoiceId, type: ["return", "exchange"], companyId: req.companyId }),
      include: [{ model: models.InvoiceItem, as: "items" }],
      transaction: t
    });
    for (const credit of priorCredits) {
      if (credit.items.some(it => it.assetId === effectiveReturnedId)) {
        throw new ValidationError("تم إرجاع هذا البند مسبقاً");
      }
    }

    let returnedAsset = null;
    let returnedProduct = null;
    let returnQuantity = 1;
    const returnedAssetCandidate = await models.Asset.findOne({
      where: { id: effectiveReturnedId, companyId: req.companyId },
      lock: true,
      transaction: t
    });
    if (returnedAssetCandidate) {
      if (returnedAssetCandidate.status !== "sold") {
        throw new ValidationError(`الأصل المراد إرجاعه غير مباع حالياً، حالته: ${returnedAssetCandidate.status}`);
      }
      returnedAsset = returnedAssetCandidate;
    } else {
      const product = await models.Product.findOne({
        where: { id: effectiveReturnedId, companyId: req.companyId },
        lock: true,
        transaction: t
      });
      if (!product) {
        throw new ValidationError("البند المراد إرجاعه غير موجود");
      }
      returnedProduct = product;
      returnQuantity = Number(originalItem.quantity) || 1;
      if (returnQuantity <= 0) {
        throw new ValidationError("كمية البند المراد إرجاعه غير صالحة");
      }
    }

    // 4. Extract active branch & settings (extracted early for validation)
    const branchId = req.headers["x-branch-id"] || req.body.branchId || originalInvoice.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب لتسجيل الاستبدال");
    }
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }
    await salesOperatorPolicy.assertSalesOperatorPolicy(req, "sales.exchange.execute", { branchId, transaction: t });

    // 3. Resolve the new (replacement) items. The new `newItems` payload supports
    //    a mix of assets and products; the legacy `newAssetIds` (assets only) is
    //    the fallback when `newItems` is absent. When `newItems` is present it
    //    takes priority and `newAssetIds` is ignored. ALL validation happens here,
    //    before any write (Phase 18M).
    let normalizedNew;
    if (Array.isArray(body.newItems)) {
      if (body.newItems.length === 0) {
        throw new ValidationError("يجب اختيار عنصر بديل واحد على الأقل للاستبدال");
      }
      normalizedNew = body.newItems.map((it) => ({ type: it && it.type, id: it && it.id, quantity: it && it.quantity }));
    } else {
      normalizedNew = (newAssetIds || []).map((id) => ({ type: "asset", id, quantity: 1 }));
    }

    // Reject malformed entries + duplicate ids up-front (no quantity merging).
    const seenNewIds = new Set();
    for (const it of normalizedNew) {
      if (!it.id) throw new ValidationError("عنصر بديل بدون معرف غير صالح");
      if (it.type !== "asset" && it.type !== "product") {
        throw new ValidationError(`نوع العنصر البديل غير صالح: ${it.type}`);
      }
      if (seenNewIds.has(it.id)) {
        throw new ValidationError("لا يمكن تكرار نفس العنصر في الاستبدال");
      }
      seenNewIds.add(it.id);
    }

    const newResolvedItems = [];
    for (const it of normalizedNew) {
      if (it.type === "asset") {
        const asset = await models.Asset.findOne({ where: { id: it.id, companyId: req.companyId }, lock: true, transaction: t });
        if (!asset) throw new ValidationError("بعض الأصول البديلة الجديدة غير موجودة في النظام");
        if (asset.status !== "available") throw new ValidationError(`المنتج البديل ${asset.name} (${asset.id}) غير متاح للبيع حالياً، حالته: ${asset.status}`);
        if (asset.branchId !== branchId) throw new ValidationError(`المنتج البديل ${asset.name} (${asset.id}) تابع لفرع آخر وليس للفرع النشط`);
        const unitPrice = Number(asset.price || 0);
        const unitCost = Number(asset.cost || 0);
        newResolvedItems.push({ itemType: "asset", id: asset.id, name: asset.name, quantity: 1, unitPrice, unitCost, lineValue: unitPrice, lineCost: unitCost, weight: Number(asset.grossWeight || asset.weight || 0), karat: asset.karat, makingCharge: Number(asset.makingCharge || 0), stoneValue: Number(asset.stoneValue || 0), asset });
      } else {
        const qty = Number(it.quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError("كمية المنتج البديل يجب أن تكون عددًا صحيحًا أكبر من صفر");
        const product = await models.Product.findOne({ where: { id: it.id, companyId: req.companyId }, lock: true, transaction: t });
        if (!product) throw new ValidationError("بعض الأصول البديلة الجديدة غير موجودة في النظام");
        if (product.branchId !== branchId) throw new ValidationError(`المنتج البديل ${product.productName} (${product.id}) تابع لفرع آخر وليس للفرع النشط`);
        if (Number(product.quantityAvailable || 0) < qty) throw new ValidationError(`الكمية المطلوبة غير متاحة للمنتج البديل ${product.productName}. المتاح: ${product.quantityAvailable}`);
        const unitPrice = Number(product.salePrice || 0);
        const unitCost = Number(product.unitCost || 0);
        const lineWeight = Number(product.averageUnitWeight || 0) * qty;
        newResolvedItems.push({ itemType: "product", id: product.id, name: product.productName, quantity: qty, unitPrice, unitCost, lineValue: unitPrice * qty, lineCost: unitCost * qty, weight: lineWeight, karat: product.karat, makingCharge: 0, stoneValue: 0, product });
      }
    }

    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const vatRatePercent = Number(settings.vatRate ?? 0);

    // 5. Calculate target-policy exchange values.
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    // Asset: qty 1. Product full-return: original line qty. price/cost are per-unit.
    const returnedValue = roundVal(Number(originalItem.price || 0) * returnQuantity);
    const returnedCost = roundVal(Number(originalItem.cost || 0) * returnQuantity);
    const returnedWeight = Number(originalItem.weight || 0); // stored weight is the line total

    // Names kept for the inline GL below; now summed over resolved asset+product lines.
    const newSubtotal = roundVal(newResolvedItems.reduce((sum, it) => sum + it.lineValue, 0));
    const newAssetsValue = newSubtotal;
    const newAssetsCost = newResolvedItems.reduce((sum, it) => sum + it.lineCost, 0);

    const outstandingBefore = roundVal(Number(originalInvoice.remainingAmount || 0));
    const exchangePolicy = exchangePolicyService.computeExchangePolicyPreview({
      originalInvoiceId,
      customerId: originalInvoice.customerId,
      currency: settings.currency || "AED",
      vatRate: vatRatePercent,
      returnedValue,
      newSubtotal,
      outstandingAR: outstandingBefore,
      settlement: body.settlement,
    });
    const newTax = roundVal(exchangePolicy.newTax);
    const newGross = roundVal(exchangePolicy.newGross);
    const difference = roundVal(exchangePolicy.difference);
    const amountDueFromCustomer = roundVal(exchangePolicy.amountDueFromCustomer);
    const arRelief = roundVal(exchangePolicy.arRelief);
    const excessDueToCustomer = roundVal(exchangePolicy.excessDueToCustomer);
    const exchangeSubtotal = roundVal(newSubtotal - returnedValue);

    // Phase 21.2/30.3 — receivable-first settlement of the target-policy exchange difference.
    // Customer owed: relieve the outstanding receivable first, settle only the excess.
    // Customer owes: raise the receivable (credit) OR collect cash now (paid_now). The UI
    // hardcodes paymentMethod:"Exchange", so an unconfirmed positive diff defaults to
    // CREDIT to avoid recording a cash_in that never actually happened.
    const paidNowMethods = ["cash", "bank", "card", "transfer", "شبكة", "تحويل"];
    const pmLower = String(paymentMethod || "").toLowerCase();
    const settlementMode = (body.settlementMode === "paid_now" || body.settlementMode === "credit")
      ? body.settlementMode
      : ((amountDueFromCustomer > 0 && paidNowMethods.some((m) => pmLower.includes(m))) ? "paid_now" : "credit");
    let receivableReliefAmount = 0;   // diff < 0 → reduce AR
    let cashRefundAmount = 0;         // diff < 0 → refund the excess as cash
    let receivableIncreaseAmount = 0; // diff > 0 credit → raise AR
    let cashInAmount = 0;             // diff > 0 paid_now → collect cash now
    if (difference < 0) {
      receivableReliefAmount = arRelief;
      cashRefundAmount = excessDueToCustomer;
    } else if (amountDueFromCustomer > 0) {
      if (settlementMode === "paid_now") cashInAmount = amountDueFromCustomer;
      else receivableIncreaseAmount = amountDueFromCustomer;
    }

    // 6. Generate Exchange Invoice ID
    const exchangeInvoiceId = `EX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    // 7. Create Exchange Invoice record
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const exchangeInvoice = await models.Invoice.create({
      id: exchangeInvoiceId,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      customerId: originalInvoice.customerId,
      customerName: originalInvoice.customerName,
      type: "exchange",
      date: nowStr.slice(0, 10),
      subtotal: exchangeSubtotal,
      tax: newTax,
      vatRate: vatRatePercent,
      total: difference,
      status: "paid",
      paymentMethod: amountDueFromCustomer > 0 ? paymentMethod : "Exchange",
      relatedInvoiceId: originalInvoice.id,
      notes: notes || "استبدال أصول بموجب الفاتورة",
      idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey || null,
      postingStatus: "posted", // immediate-post path (exchange)
      invoiceNumber: exchangeInvoiceId,
      postedAt: nowStr,
      createdByEmployeeId: commandActor.employeeId || null,
      finalizedByEmployeeId: commandActor.employeeId || null
    }, { transaction: t });

    // 8. Create exchange invoice item lines
    // Negative return line
    const returnedName = returnedAsset ? returnedAsset.name : returnedProduct.productName;
    const returnItem = await models.InvoiceItem.create({
      invoiceId: exchangeInvoiceId,
      assetId: effectiveReturnedId,
      name: `مرتجع استبدال: ${returnedName}`,
      quantity: returnQuantity,
      price: -Number(originalItem.price || 0), // per-unit (negated); line total via quantity
      cost: Number(originalItem.cost || 0),    // per-unit
      weight: returnedWeight,
      karat: originalItem.karat,
      discount: 0,
      makingCharge: 0,
      stoneValue: 0
    }, { transaction: t });

    // Positive new item lines (asset and/or product)
    const exchangeItems = [returnItem];
    for (const it of newResolvedItems) {
      const item = await models.InvoiceItem.create({
        invoiceId: exchangeInvoiceId,
        assetId: it.id, // assetId column carries an Asset or Product id (existing convention)
        name: it.name,
        quantity: it.quantity,
        price: it.unitPrice, // per-unit; line total via quantity
        cost: it.unitCost,   // per-unit
        weight: it.weight,
        karat: it.karat,
        discount: 0,
        makingCharge: it.makingCharge,
        stoneValue: it.stoneValue
      }, { transaction: t });
      exchangeItems.push(item);

      if (it.itemType === "product") {
        // Product new item: decrement stock (mirror of the POS sale) + stock movement
        const product = it.product;
        product.quantityAvailable = roundVal(Number(product.quantityAvailable || 0) - it.quantity);
        product.quantityOnHand = roundVal(Number(product.quantityOnHand || 0) - it.quantity);
        product.quantitySold = roundVal(Number(product.quantitySold || 0) + it.quantity);
        product.totalWeight = Math.round((Number(product.totalWeight || 0) - it.weight) * 10000) / 10000;
        await product.save({ transaction: t, skipAdjustmentHook: true });

        await models.StockMovement.create({
          id: `SM-EXO-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          companyId: req.companyId,
          productId: product.id,
          productCode: product.productCode,
          type: "exchange_out",
          quantityIn: 0,
          quantityOut: it.quantity,
          weightIn: 0,
          weightOut: it.weight,
          unitCost: it.unitCost,
          totalCost: it.unitCost * it.quantity,
          referenceType: "Invoice",
          referenceId: exchangeInvoiceId,
          customerId: originalInvoice.customerId,
          branchId,
          createdBy: req.user ? req.user.id : "System"
        }, { transaction: t });
      }
    }

    // 9. Update returned-item state + new asset statuses
    if (returnedAsset) {
      await returnedAsset.update({ status: "returned" }, { transaction: t });
      // 10a. Asset event for the returned asset
      await models.AssetEvent.create({
        id: `ASE-${Date.now()}-EX-OUT`,
        assetId: returnedAsset.id,
        action: "EXCHANGED_OUT",
        date: nowStr.slice(0, 10),
        user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
        branch: branchRecord.name,
        note: `تم إرجاعه بالاستبدال للفاتورة: ${originalInvoice.id} بموجب سند الاستبدال ${exchangeInvoiceId}`,
        sourceDocument: originalInvoice.id,
        beforeState: "status:sold",
        afterState: "status:returned",
        severity: "info"
      }, { transaction: t });
    } else {
      // 10a. Product full return: restock + stock movement (mirror of the POS sale)
      const product = returnedProduct;
      product.quantityAvailable = roundVal(Number(product.quantityAvailable || 0) + returnQuantity);
      product.quantityOnHand = roundVal(Number(product.quantityOnHand || 0) + returnQuantity);
      product.quantitySold = Math.max(0, roundVal(Number(product.quantitySold || 0) - returnQuantity));
      product.totalWeight = Math.round((Number(product.totalWeight || 0) + returnedWeight) * 10000) / 10000;
      await product.save({ transaction: t, skipAdjustmentHook: true });

      await models.StockMovement.create({
        id: `SM-RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        companyId: req.companyId,
        productId: product.id,
        productCode: product.productCode,
        type: "return",
        quantityIn: returnQuantity,
        quantityOut: 0,
        weightIn: returnedWeight,
        weightOut: 0,
        unitCost: Number(originalItem.cost || 0),
        totalCost: Number(originalItem.cost || 0) * returnQuantity,
        referenceType: "Invoice",
        referenceId: exchangeInvoiceId,
        customerId: originalInvoice.customerId,
        branchId,
        createdBy: req.user ? req.user.id : "System"
      }, { transaction: t });
    }

    const newAssetItems = newResolvedItems.filter((it) => it.itemType === "asset");
    for (const it of newAssetItems) {
      await it.asset.update({ status: "sold" }, { transaction: t });
    }

    // 10. Record Asset Events for new assets (product movements are logged above)
    for (const it of newAssetItems) {
      await models.AssetEvent.create({
        id: `ASE-${Date.now()}-EX-IN-${it.asset.id}`,
        assetId: it.asset.id,
        action: "EXCHANGED_IN",
        date: nowStr.slice(0, 10),
        user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
        branch: branchRecord.name,
        note: `تم شراؤه بالاستبدال بموجب سند الاستبدال ${exchangeInvoiceId}`,
        sourceDocument: exchangeInvoiceId,
        beforeState: "status:available",
        afterState: "status:sold",
        severity: "info"
      }, { transaction: t });
    }

    // 11. Create balanced Accounting Entry
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const payAcc = paymentMethod.toLowerCase();
    const isBank = payAcc.includes("card") || payAcc.includes("bank") || payAcc.includes("transfer") || payAcc.includes("شبكة") || payAcc.includes("تحويل");
    const accountCode = isBank ? "1120" : "1110";

    // Phase 30.3 — operator-selectable settlement of the target-policy excess due to customer.
    // Absent settlement preserves the legacy default (full excess refunded to
    // cash/bank on the exchange payment-method account); customer credit is never
    // created unless explicitly requested. A positive/zero difference has no refund
    // excess, so any non-zero settlement is rejected by the helper.
    const refundExcess = excessDueToCustomer;
    const exchangeSettlement = exchangePolicy.settlementPreview && exchangePolicy.settlementPreview.provided
      ? exchangePolicy.settlementPreview
      : salesService.resolveExcessSettlement({
          excessAmount: refundExcess,
          settlement: body.settlement,
          hasCustomer: !!originalInvoice.customerId,
        });
    let refundCashPortion = 0, refundBankPortion = 0, refundCreditPortion = 0;
    if (refundExcess > 0.01) {
      if (exchangeSettlement.provided) {
        refundCashPortion = exchangeSettlement.cashAmount;
        refundBankPortion = exchangeSettlement.bankAmount;
        refundCreditPortion = exchangeSettlement.creditAmount;
      } else if (isBank) {
        refundBankPortion = refundExcess;
      } else {
        refundCashPortion = refundExcess;
      }
    }

    const lines = [];
    // Money leg (Phase 21.2 + Phase 30): split between Cash 1110 / Bank 1120 /
    // Customer Deposits 2300 (credit) and Accounts Receivable 1300. One journal.
    if (amountDueFromCustomer > 0) {
      if (cashInAmount > 0) lines.push({ accountCode, debit: cashInAmount, credit: 0, description: "دفع فارق استبدال نقداً" });
      if (receivableIncreaseAmount > 0) lines.push({ accountCode: "1300", debit: receivableIncreaseAmount, credit: 0, description: "زيادة ذمم العميل — فارق استبدال" });
    } else if (excessDueToCustomer > 0 || receivableReliefAmount > 0) {
      if (receivableReliefAmount > 0) lines.push({ accountCode: "1300", debit: 0, credit: receivableReliefAmount, description: "تخفيض ذمم العميل — فارق استبدال" });
      if (refundCashPortion > 0) lines.push({ accountCode: "1110", debit: 0, credit: refundCashPortion, description: "إرجاع فارق استبدال نقداً" });
      if (refundBankPortion > 0) lines.push({ accountCode: "1120", debit: 0, credit: refundBankPortion, description: "إرجاع فارق استبدال بنكياً" });
      if (refundCreditPortion > 0) lines.push({ accountCode: "2300", debit: 0, credit: refundCreditPortion, description: "رصيد دائن للعميل — فارق استبدال" });
    }

    if (returnedValue > 0) {
      lines.push({ accountCode: "4100", debit: returnedValue, credit: 0, description: "عكس إيراد مبيعات أصل قديم" });
    }
    if (newAssetsValue > 0) {
      lines.push({ accountCode: "4100", debit: 0, credit: newAssetsValue, description: "إيراد بيع أصل بديل" });
    }

    if (newTax > 0) {
      lines.push({ accountCode: "2200", debit: 0, credit: newTax, description: "ضريبة عناصر الاستبدال الجديدة" });
    }

    if (newAssetsCost > 0) {
      lines.push({ accountCode: "5000", debit: newAssetsCost, credit: 0, description: "تكلفة مبيعات بديلة" });
      lines.push({ accountCode: "1200", debit: 0, credit: newAssetsCost, description: "تخفيض مخزون بديل" });
    }
    if (returnedCost > 0) {
      lines.push({ accountCode: "1200", debit: returnedCost, credit: 0, description: "إرجاع أصل قديم للمخزن" });
      lines.push({ accountCode: "5000", debit: 0, credit: returnedCost, description: "عكس تكلفة أصل قديم" });
    }

    let journalEntry = null;
    try {
      journalEntry = await postingService.postEntry(req.companyId, {
        description: `قيد استبدال أصول — فاتورة ${exchangeInvoiceId}`,
        date: nowStr.slice(0, 10),
        sourceType: "exchange",
        sourceId: exchangeInvoiceId,
        postedBy: actor,
        transaction: t,
        branchId
      }, lines);
    } catch (postErr) {
      logger.error(`[Posting] Failed to post exchange journal entry: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي للاستبدال: ${postErr.message}`);
    }

    // 12. Record Treasury Cash Transaction logs — ONLY for real money movement:
    // cash collected now on a positive diff (paid_now), or the cash/bank refund
    // portions on a negative diff (one row per non-zero part). Pure receivable
    // (credit/relief) and the customer-credit portion move no cash. No
    // postCashEntry is called — the exchange journal above owns the GL.
    const makeExchangeCashTx = async (amount, account, txType, label) => {
      if (amount <= 0) return;
      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        type: txType,
        account,
        amount,
        category: "استبدال أصول",
        description: `${label} - فاتورة استبدال رقم ${exchangeInvoiceId}`,
        reference: exchangeInvoiceId,
        date: nowStr.slice(0, 10),
        status: "posted",
        createdBy: req.user ? req.user.id : "System",
        journalEntryId: journalEntry ? journalEntry.id : null
      }, { transaction: t });
    };
    if (amountDueFromCustomer > 0) {
      await makeExchangeCashTx(cashInAmount, isBank ? "bank" : "cash", "cash_in", "دفع فارق استبدال");
    } else if (excessDueToCustomer > 0) {
      await makeExchangeCashTx(refundCashPortion, "cash", "cash_out", "إرجاع فارق استبدال نقداً");
      await makeExchangeCashTx(refundBankPortion, "bank", "cash_out", "إرجاع فارق استبدال بنكياً");
    }

    // Phase 30 — customer credit portion of the refund excess: record a credit_in
    // linked to the SAME exchange journal (its Cr 2300 line was posted above).
    // Explicit journalEntryId, NO glPosting → no second journal.
    if (refundCreditPortion > 0) {
      await customerCreditService.recordCreditIn({
        models,
        companyId: req.companyId,
        customerId: originalInvoice.customerId,
        branchId,
        amount: refundCreditPortion,
        currency: settings.currency || "AED",
        sourceType: "exchange_credit",
        sourceId: exchangeInvoiceId,
        invoiceId: originalInvoice.id,
        description: exchangeSettlement.description || `رصيد دائن من استبدال الفاتورة ${originalInvoice.id}`,
        metadata: {
          originalInvoiceId: originalInvoice.id,
          reference: exchangeSettlement.reference || null,
          settlement: { cashAmount: refundCashPortion, bankAmount: refundBankPortion, creditAmount: refundCreditPortion }
        },
        journalEntryId: journalEntry ? journalEntry.id : null,
        createdBy: req.user ? req.user.id : "System",
        transaction: t
      });
    }

    // 13. Apply the receivable movement ONCE — raise AR for a credit purchase of
    // the difference, or relieve AR first for a refund. Cash never touches AR.
    const exchangeArDelta = roundVal(receivableIncreaseAmount - receivableReliefAmount);
    if (exchangeArDelta !== 0) {
      const customer = await models.Customer.findOne({
        where: { id: originalInvoice.customerId, companyId: req.companyId },
        transaction: t
      });
      if (customer) {
        await customer.update({
          balance: Math.max(0, roundVal(Number(customer.balance || 0) + exchangeArDelta))
        }, { transaction: t });
      }
      await originalInvoice.update({
        remainingAmount: Math.max(0, roundVal(outstandingBefore + exchangeArDelta))
      }, { transaction: t });
    }

    // 14. Write Audit Log
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "sales.exchange",
      description: `تم إتمام عملية استبدال للفاتورة رقم ${originalInvoice.id}. فارق الاستبدال: ${difference} - فاتورة جديدة ${exchangeInvoiceId}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branchRecord.name,
      sourceDocument: "invoice",
      severity: "info",
      after: JSON.stringify({
        exchangeInvoiceId,
        originalInvoiceId,
        difference,
        newSubtotal,
        newTax,
        newGross,
        returnedValue,
        amountDueFromCustomer,
        arRelief,
        excessDueToCustomer
      })
    }, commandActor), { transaction: t });

    // Recalculate customer net purchases
    const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
    await recalculateCustomerNetPurchases(models, req.companyId, originalInvoice.customerId, { transaction: t });

    // Build the success response up front and persist it for idempotent replay
    // BEFORE commit (same transaction as the claimed idempotency row).
    const responseData = exchangeInvoice.toJSON();
    responseData.items = exchangeItems;
    responseData.journalEntry = journalEntry;
    responseData.exchangePolicy = {
      vatRate: exchangePolicy.vatRate,
      returnedValue,
      newSubtotal,
      newTax,
      newGross,
      difference,
      amountDueFromCustomer,
      arRelief,
      excessDueToCustomer,
      settlementPreview: exchangePolicy.settlementPreview,
      taxPolicy: exchangePolicy.taxPolicy,
      readOnly: false
    };
    const idemResponseBody = { success: true, ...responseData, data: responseData };
    await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });

    // Commit Transaction
    await t.commit();

    // 15. Create Notifications & SSE
    await notificationService.createNotification(req.companyId, {
      title: "عملية استبدال أصول",
      message: `تم استبدال قطع للفاتورة ${originalInvoice.id} بفارق بقيمة ${difference} ${settings.currency || "AED"}.`,
      type: "info",
      entityType: "Invoice",
      entityId: exchangeInvoiceId
    });
    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "cancel",
      id: exchangeInvoiceId,
      branchId,
      related: {
        invoiceId: originalInvoiceId,
        customerId: originalInvoice.customerId,
        assetIds: [returnedAssetId, ...newAssetIds].filter(Boolean)
      }
    });

    return res.status(201).json(idemResponseBody);
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Customer Gold Deposit Endpoint ──────────────────────────────────────────
router.post("/customers/:id/gold/deposit", authMiddleware, async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customerId = req.params.id;
    const { description = "", karat = 21, weight, ratePerGram, payout = false, payMethod = "cash" } = req.body || {};

    const weightNum = Number(weight) || 0;
    const rateNum = Number(ratePerGram) || 0;
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const calculatedValue = roundVal(weightNum * rateNum);

    if (weightNum <= 0 || rateNum <= 0) {
      throw new ValidationError("الوزن وسعر الغرام يجب أن يكونا أكبر من الصفر");
    }

    const customer = await models.Customer.findOne({
      where: { id: customerId, companyId: req.companyId },
      transaction: t
    });
    if (!customer) {
      throw new NotFoundError("العميل غير موجود");
    }

    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });

    const branchId = req.headers["x-branch-id"] || req.body.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب");
    }
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const timestamp = Date.now();
    const cgpId = `CGP-${timestamp.toString().slice(-6)}`;

    // 1. Create CustomerGoldPool entry
    const purity = getPurityFromKarat(karat) || 0.875;
    const cgp = await models.CustomerGoldPool.create({
      id: cgpId,
      companyId: req.companyId,
      customerId,
      customerName: customer.name,
      status: "approved",
      grossWeight: weightNum,
      purity,
      fineWeight: roundVal(weightNum * purity),
      notes: description,
      receivedAt: nowStr.slice(0, 16),
      approvedAt: nowStr.slice(0, 16),
      approvedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
    }, { transaction: t });

    // 2. Create scrap gold asset in inventory
    const assetId = `AST-SCRAP-${timestamp.toString().slice(-6)}`;
    const scrapAsset = await models.Asset.create({
      id: assetId,
      companyId: req.companyId,
      name: `ذهب كسر عميل - ${description}`,
      type: "gold-weight",
      category: "ذهب مستعمل كسر",
      karat: Number(karat),
      purity,
      grossWeight: weightNum,
      netWeight: weightNum,
      cost: calculatedValue,
      price: calculatedValue,
      branch: branchRecord.name,
      branchId,
      location: "Melt Room",
      status: "available",
      barcode: String(timestamp).slice(-13).padStart(13, "6"),
      source: `شراء مستعمل من العميل ${customer.name}`
    }, { transaction: t });

    // 3. Asset event
    await models.AssetEvent.create({
      id: `ASE-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
      assetId,
      action: "SCRAP_PURCHASED",
      date: nowStr.slice(0, 10),
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      branch: branchRecord.name,
      note: `شراء ذهب مستعمل بمعدل سعر ${rateNum} /g بموجب المستند ${cgpId}`
    }, { transaction: t });

    // 4. Deposit Journal Entry: Dr Inventory (1200) / Cr Customer Deposits (2300)
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const depositJournal = await postingService.postEntry(req.companyId, {
      description: `إيداع ذهب كسر عميل — ${customer.name} (أصل ${assetId})`,
      date: nowStr.slice(0, 10),
      sourceType: "customer_gold_pool",
      sourceId: cgpId,
      postedBy: actor,
      transaction: t,
      branchId
    }, [
      { accountCode: "1200", debit: calculatedValue, credit: 0, description: "استلام ذهب كسر عميل" },
      { accountCode: "2300", debit: 0, credit: calculatedValue, description: "رصيد أمانات ذهب عملاء" }
    ]);

    // 5. Generate payout receipt if payout requested (immediate scrap gold purchase/cashout)
    let payoutInvoice = null;
    let payoutJournal = null;
    if (payout) {
      const payoutId = `PAY-${10000 + Math.floor(Math.random() * 9000)}`;
      payoutInvoice = await models.Invoice.create({
        id: payoutId,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        customerId,
        customerName: customer.name,
        type: "return", // negative total acts as payout
        date: nowStr.slice(0, 10),
        subtotal: -calculatedValue,
        tax: 0,
        vatRate: 0,
        total: -calculatedValue,
        status: "paid",
        paymentMethod: payMethod.toUpperCase(),
        notes: `صرف قيمة ذهب مستعمل - ${description}`,
        postingStatus: "posted", // immediate-post path (customer gold settlement)
        invoiceNumber: payoutId,
        postedAt: nowStr
      }, { transaction: t });

      await models.InvoiceItem.create({
        invoiceId: payoutId,
        assetId: scrapAsset.id,
        name: scrapAsset.name,
        quantity: 1,
        price: -calculatedValue,
        cost: calculatedValue,
        weight: weightNum,
        karat: Number(karat)
      }, { transaction: t });

      // Payout Journal: Dr Customer Deposits (2300) / Cr Cash/Bank (1110/1120)
      const payMethodLower = payMethod.toLowerCase();
      const cashAccountCode = (payMethodLower.includes("bank") || payMethodLower.includes("transfer")) ? "1120" : "1110";

      payoutJournal = await postingService.postEntry(req.companyId, {
        description: `صرف نقدي مقابل ذهب مستعمل — ${customer.name} (${payoutId})`,
        date: nowStr.slice(0, 10),
        sourceType: "invoice",
        sourceId: payoutId,
        postedBy: actor,
        transaction: t,
        branchId
      }, [
        { accountCode: "2300", debit: calculatedValue, credit: 0, description: "تسوية التزام ذهب عميل" },
        { accountCode: cashAccountCode, debit: 0, credit: calculatedValue, description: "صرف نقدي للعميل" }
      ]);

      // Create Treasury Cash Transaction
      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        type: "cash_out",
        account: cashAccountCode === "1120" ? "bank" : "cash",
        amount: calculatedValue,
        category: "شراء ذهب مستعمل",
        description: `صرف نقدي مقابل شراء ذهب مستعمل رقم ${payoutId}`,
        reference: payoutId,
        date: nowStr.slice(0, 10),
        status: "posted",
        createdBy: req.user ? req.user.id : "System",
        journalEntryId: payoutJournal ? payoutJournal.id : null
      }, { transaction: t });
    }

    // 6. Write Audit Log
    await auditService.record(req.companyId, {
      action: "customers.gold.deposit",
      description: `تم إيداع ذهب كسر للعميل ${customer.name} بوزن ${weightNum} جم وقيمة ${calculatedValue}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branchRecord.name,
      sourceDocument: "customer_gold_pool",
      severity: "info",
      after: JSON.stringify({ cgpId, assetId, calculatedValue })
    }, { transaction: t });

    // Commit Transaction
    await t.commit();

    // 7. Notification & SSE
    await notificationService.createNotification(req.companyId, {
      title: "إيداع ذهب كسر عميل",
      message: `تم تسجيل إيداع ذهب كسر للعميل ${customer.name} بوزن ${weightNum} جم بقيمة ${calculatedValue} ${settings.currency || "AED"}.`,
      type: "success",
      entityType: "CustomerGoldPool",
      entityId: cgpId
    });
    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "create",
      id: payoutInvoice ? payoutInvoice.id : cgpId,
      branchId,
      related: {
        customerId: customer.id,
        assetIds: scrapAsset ? [scrapAsset.id] : []
      }
    });

    return res.status(201).json({
      success: true,
      cgp,
      scrapAsset,
      payoutInvoice,
      depositJournal,
      payoutJournal
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Customer Gold Payout Endpoint ───────────────────────────────────────────
router.post("/customers/:id/gold/payout", authMiddleware, async (req, res, next) => {
  // Phase 21.5 — central race-safe idempotency (unique company_id+scope+key). The
  // key is REQUIRED and req.params (the customer id) is folded into the request
  // hash so one key cannot pay out a different customer. This endpoint has no UI
  // caller yet, so requiring a key makes any future/API caller safe-by-default.
  const idempotencyKey = req.headers["idempotency-key"] || (req.body && req.body.idempotencyKey);
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لصرف رصيد الذهب" });
  }
  const idemScope = "customer.gold_payout";
  const idemRequestHash = idempotencyService.hashRequest(idemScope, req.body || {}, req.params);

  const t = await models.sequelize.transaction();
  try {
    // Claim the idempotency key FIRST inside the write transaction; a concurrent
    // duplicate fails the unique insert → rollback and replay/conflict.
    const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
    if (!idemClaim.claimed) {
      try { await t.rollback(); } catch (_) { /* aborted by the unique violation */ }
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const idemRequest = idemClaim.request;

    const customerId = req.params.id;
    const { weight, ratePerGram, payMethod = "cash" } = req.body || {};

    const weightNum = Number(weight) || 0;
    const rateNum = Number(ratePerGram) || 0;
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const calculatedValue = roundVal(weightNum * rateNum);

    if (weightNum <= 0) {
      throw new ValidationError("الوزن المطلوب صرفه غير صحيح");
    }

    const customer = await models.Customer.findOne({
      where: { id: customerId, companyId: req.companyId },
      transaction: t
    });
    if (!customer) {
      throw new NotFoundError("العميل غير موجود");
    }

    // Verify customer has enough gold balance
    const activePools = await models.CustomerGoldPool.findAll({
      where: { customerId, companyId: req.companyId, status: "approved" },
      transaction: t
    });
    const totalGoldBalance = activePools.reduce((sum, p) => sum + Number(p.grossWeight || 0), 0);
    if (weightNum > totalGoldBalance) {
      throw new ValidationError(`الوزن المطلوب صرفه (${weightNum} جم) يتجاوز رصيد العميل المتوفر (${totalGoldBalance} جم)`);
    }

    // Deduct from pool
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const timestamp = Date.now();
    const cgpId = `CGP-OUT-${timestamp.toString().slice(-6)}`;

    const cgp = await models.CustomerGoldPool.create({
      id: cgpId,
      companyId: req.companyId,
      customerId,
      customerName: customer.name,
      status: "approved",
      grossWeight: -weightNum,
      purity: 1.0,
      fineWeight: -weightNum,
      notes: "صرف رصيد ذهب عميل",
      receivedAt: nowStr.slice(0, 16),
      approvedAt: nowStr.slice(0, 16),
      approvedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
    }, { transaction: t });

    // Dr Customer Deposits (2300) / Cr Cash/Bank (1110/1120)
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const payMethodLower = payMethod.toLowerCase();
    const cashAccountCode = (payMethodLower.includes("bank") || payMethodLower.includes("transfer")) ? "1120" : "1110";

    const journalEntry = await postingService.postEntry(req.companyId, {
      description: `صرف رصيد ذهب عميل — ${customer.name} (سند ${cgpId})`,
      date: nowStr.slice(0, 10),
      sourceType: "customer_gold_pool",
      sourceId: cgpId,
      postedBy: actor,
      transaction: t
    }, [
      { accountCode: "2300", debit: calculatedValue, credit: 0, description: "سحب أمانات عملاء" },
      { accountCode: cashAccountCode, debit: 0, credit: calculatedValue, description: "صرف نقدي للعميل" }
    ]);

    // Persist the success response for idempotent replay BEFORE commit.
    const idemResponseBody = { success: true, cgp, journalEntry };
    await idempotencyService.succeed({ request: idemRequest, statusCode: 200, responseBody: idemResponseBody, transaction: t });

    await t.commit();

    return res.status(200).json(idemResponseBody);
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Customer Gold Use in Sale Endpoint ──────────────────────────────────────
router.post("/customers/:id/gold/use-in-sale", authMiddleware, async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customerId = req.params.id;
    const { invoiceId, weightUsed, ratePerGram } = req.body || {};

    const weightNum = Number(weightUsed) || 0;
    const rateNum = Number(ratePerGram) || 0;
    const roundVal = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const calculatedValue = roundVal(weightNum * rateNum);

    if (weightNum <= 0 || rateNum <= 0) {
      throw new ValidationError("الوزن وسعر الغرام يجب أن يكونا أكبر من الصفر");
    }

    const customer = await models.Customer.findOne({
      where: { id: customerId, companyId: req.companyId },
      transaction: t
    });
    if (!customer) {
      throw new NotFoundError("العميل غير موجود");
    }

    const invoice = await models.Invoice.findOne({
      where: { id: invoiceId, companyId: req.companyId },
      transaction: t
    });
    if (!invoice) {
      throw new NotFoundError("الفاتورة غير موجودة");
    }

    if (Number(invoice.remainingAmount || 0) <= 0.01) {
      throw new ValidationError("الفاتورة مدفوعة بالكامل بالفعل");
    }

    // Verify customer has enough gold balance
    const activePools = await models.CustomerGoldPool.findAll({
      where: { customerId, companyId: req.companyId, status: "approved" },
      transaction: t
    });
    const totalGoldBalance = activePools.reduce((sum, p) => sum + Number(p.grossWeight || 0), 0);
    if (weightNum > totalGoldBalance) {
      throw new ValidationError(`الوزن المطلوب استخدامه (${weightNum} جم) يتجاوز رصيد العميل المتوفر (${totalGoldBalance} جم)`);
    }

    const remainingToPay = Number(invoice.remainingAmount) || 0;
    if (calculatedValue > remainingToPay + 0.01) {
      throw new ValidationError(`القيمة المحتسبة للذهب (${calculatedValue}) تتجاوز المبلغ المتبقي في الفاتورة (${remainingToPay})`);
    }

    // Update invoice state
    const newPaidAmount = roundVal(Number(invoice.paidAmount || 0) + calculatedValue);
    const newRemainingAmount = roundVal(Math.max(0, Number(invoice.remainingAmount || 0) - calculatedValue));
    const newStatus = newRemainingAmount <= 0.01 ? "paid" : "partial";

    await invoice.update({
      paidAmount: newPaidAmount,
      remainingAmount: newRemainingAmount,
      status: newStatus
    }, { transaction: t });

    // Decrement customer outstanding receivable balance
    await customer.update({
      balance: roundVal(Math.max(0, Number(customer.balance || 0) - calculatedValue))
    }, { transaction: t });

    const cgpId = `CGP-USE-${Date.now().toString().slice(-6)}`;
    const cgp = await models.CustomerGoldPool.create({
      id: cgpId,
      companyId: req.companyId,
      customerId,
      customerName: invoice.customerName,
      status: "approved",
      grossWeight: -weightNum,
      purity: 1.0,
      fineWeight: -weightNum,
      notes: `استخدام رصيد الذهب لتسوية الفاتورة رقم ${invoiceId}`,
      receivedAt: new Date().toISOString().slice(0, 16),
      approvedAt: new Date().toISOString().slice(0, 16),
      approvedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
    }, { transaction: t });

    // Dr Customer Deposits (2300) / Cr Accounts Receivable (1300)
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const journalEntry = await postingService.postEntry(req.companyId, {
      description: `استخدام رصيد ذهب عميل للفاتورة ${invoiceId}`,
      date: new Date().toISOString().slice(0, 10),
      sourceType: "customer_gold_pool",
      sourceId: cgpId,
      postedBy: actor,
      transaction: t
    }, [
      { accountCode: "2300", debit: calculatedValue, credit: 0, description: "تخفيض التزام ذهب عميل" },
      { accountCode: "1300", debit: 0, credit: calculatedValue, description: "تسوية ذمم فاتورة العميل" }
    ]);

    // Record Audit Log
    await auditService.record(req.companyId, {
      action: "customers.gold.use-in-sale",
      description: `تم استخدام رصيد ذهب للعميل ${customer.name} بوزن ${weightNum} جم بقيمة ${calculatedValue} لتسوية الفاتورة ${invoiceId}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: invoice.branch || "Showroom",
      sourceDocument: "customer_gold_pool",
      severity: "info",
      after: JSON.stringify({ cgpId, invoiceId, calculatedValue })
    }, { transaction: t });

    await t.commit();

    const settings = await settingsService.getCompanySettings(req.companyId);

    // Create Notification
    await notificationService.createNotification(req.companyId, {
      title: "استخدام رصيد ذهب",
      message: `تم استخدام رصيد ذهب للعميل ${customer.name} بوزن ${weightNum} جم بقيمة ${calculatedValue} ${settings.currency || "AED"} لتسوية الفاتورة ${invoiceId}.`,
      type: "success",
      entityType: "CustomerGoldPool",
      entityId: cgpId
    });

    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "update",
      id: invoiceId,
      related: {
        customerId: customer.id
      }
    });

    return res.status(200).json({ success: true, cgp, journalEntry });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Manufacturing Process Endpoint ──────────────────────────────────
router.post("/manufacturing-orders/process", authMiddleware, requirePermission("inventory.adjust"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const {
      inputAssetId,
      inputWeight,
      outputName,
      outputType = "gold-piece",
      outputKarat = "21",
      outputWeight,
      laborCost = 0,
      notes = ""
    } = req.body || {};

    const inW = Number(inputWeight) || 0;
    const outW = Number(outputWeight) || 0;
    const labor = Number(laborCost) || 0;

    if (!inputAssetId) {
      throw new ValidationError("أصل الذهب الخام مدخل مطلوب");
    }
    if (inW <= 0 || outW <= 0) {
      throw new ValidationError("الوزن المدخل والوزن الناتج يجب أن يكونا أكبر من الصفر");
    }

    // 1. Validate raw asset input
    const parentAsset = await models.Asset.findOne({
      where: { id: inputAssetId, companyId: req.companyId },
      lock: true,
      transaction: t
    });
    if (!parentAsset) {
      throw new ValidationError("لم يتم العثور على أصل الذهب الخام المدخل");
    }
    if (parentAsset.status !== "available") {
      throw new ValidationError(`أصل الذهب الخام غير متاح حالياً، حالته: ${parentAsset.status}`);
    }
    if (inW > Number(parentAsset.grossWeight)) {
      throw new ValidationError(`الوزن المطلوب تصنيعه (${inW} جم) أكبر من الوزن المتوفر في الأصل (${parentAsset.grossWeight} جم)`);
    }

    // 2. Validate branch scoping
    const branchId = req.headers["x-branch-id"] || req.body.branchId || parentAsset.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب");
    }
    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const timestamp = Date.now();
    const moId = `MO-${timestamp.toString().slice(-6)}`;

    // 3. Consume raw input asset
    const remainingWeight = Math.round((Number(parentAsset.grossWeight) - inW) * 100) / 100;
    const isMelted = remainingWeight <= 0.01;
    const newParentStatus = isMelted ? "melted" : parentAsset.status;

    await parentAsset.update({
      grossWeight: remainingWeight,
      netWeight: remainingWeight,
      status: newParentStatus
    }, { transaction: t });

    // Create parent asset event
    await models.AssetEvent.create({
      id: `ASE-${timestamp}-MFG-OUT`,
      assetId: parentAsset.id,
      action: "MELTED_WEIGHT_DEDUCTION",
      date: nowStr.slice(0, 10),
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      branch: branchRecord.name,
      note: `سحب وزن للتصنيع: ${inW}g بموجب أمر تصنيع رقم ${moId}`,
      sourceDocument: moId,
      beforeState: `grossWeight:${parentAsset.grossWeight}`,
      afterState: `grossWeight:${remainingWeight}`,
      severity: isMelted ? "warning" : "info"
    }, { transaction: t });

    // 4. Calculate finished asset cost and price
    const rawGoldCost = Math.round(inW * (Number(parentAsset.cost) / Number(parentAsset.grossWeight || 1 || parentAsset.cost)) * 100) / 100;
    const manufacturingCost = Math.round((rawGoldCost + labor) * 100) / 100;
    const retailPrice = Math.round(manufacturingCost * 1.35 * 100) / 100;

    // 5. Create produced asset
    const finishedAssetId = `AST-MFG-${timestamp.toString().slice(-6)}`;
    const finishedAsset = await models.Asset.create({
      id: finishedAssetId,
      companyId: req.companyId,
      name: outputName.trim(),
      type: outputType,
      category: "تصنيع محلي",
      karat: Number(outputKarat) || null,
      purity: getPurityFromKarat(Number(outputKarat)) || 0.875,
      grossWeight: outW,
      netWeight: outW,
      cost: manufacturingCost,
      price: retailPrice,
      branch: branchRecord.name,
      branchId,
      location: "Showroom",
      status: "available",
      barcode: String(timestamp).slice(-13).padStart(13, "6"),
      source: `تصنيع محلي من أصل ${parentAsset.id}`,
      parentAssetId: parentAsset.id
    }, { transaction: t });

    // Create produced asset event
    const lossWeight = Math.round((inW - outW) * 100) / 100;
    const processLossPct = Math.round(((inW - outW) / inW) * 10000) / 100;

    await models.AssetEvent.create({
      id: `ASE-${timestamp}-MFG-IN`,
      assetId: finishedAsset.id,
      action: "MANUFACTURED",
      date: nowStr.slice(0, 10),
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      branch: branchRecord.name,
      note: `إنتاج قطعة مصنعة من أصل أب ${parentAsset.id}. فاقد الوزن: ${processLossPct}% (${lossWeight} جم)`,
      sourceDocument: moId,
      beforeState: "status:none",
      afterState: "status:available",
      severity: "info"
    }, { transaction: t });

    // 6. Create manufacturing order in database
    const mo = await models.ManufacturingOrder.create({
      id: moId,
      companyId: req.companyId,
      status: "completed",
      type: "manufacturing",
      inputAssets: [{ id: parentAsset.id, name: parentAsset.name, weight: inW, karat: parentAsset.karat }],
      outputAssets: [{ id: finishedAsset.id, name: finishedAsset.name, weight: outW, karat: finishedAsset.karat }],
      expectedOutputWeight: inW,
      actualOutputWeight: outW,
      processLoss: lossWeight,
      wastage: lossWeight > 0 ? lossWeight : 0,
      branch: branchRecord.name,
      notes: notes || `تصنيع محلي لأصل ${finishedAsset.name}`,
      startedAt: nowStr.slice(0, 16),
      completedAt: nowStr.slice(0, 16),
      createdBy: actor,
      approvedBy: actor
    }, { transaction: t });

    // 7. Create accounting journal entry
    const glLines = [
      { accountCode: "1200", debit: manufacturingCost, credit: 0, description: `إدخال منتج مصنع ${finishedAssetId}` },
      { accountCode: "1200", debit: 0, credit: rawGoldCost, description: `استهلاك خام ذهب ${parentAsset.id}` }
    ];
    if (labor > 0) {
      glLines.push({ accountCode: "1110", debit: 0, credit: labor, description: `أجور صياغة مدفوعة نقداً` });
    }

    let journalEntry = null;
    try {
      journalEntry = await postingService.postEntry(req.companyId, {
        description: `أمر تصنيع محلي رقم ${moId} — أصل ${finishedAssetId}`,
        date: nowStr.slice(0, 10),
        sourceType: "manufacturing_order",
        sourceId: moId,
        postedBy: actor,
        transaction: t,
        branchId
      }, glLines);
    } catch (postErr) {
      logger.error(`[Posting] Failed to post manufacturing journal entry: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي للتصنيع: ${postErr.message}`);
    }

    // 8. Record audit log
    await auditService.record(req.companyId, {
      action: "inventory.manufacturing",
      description: `تم إتمام أمر تصنيع رقم ${moId} وإنتاج أصل ${finishedAssetId} بفاقد ${lossWeight} جم وبأجور صياغة ${labor}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: branchRecord.name,
      sourceDocument: "manufacturing_order",
      severity: "info",
      after: JSON.stringify({ moId, finishedAssetId, lossWeight, labor })
    }, { transaction: t });

    // Commit transaction
    await t.commit();

    // 9. Emit notifications and SSE
    await notificationService.createNotification(req.companyId, {
      title: "أمر تصنيع مكتمل",
      message: `تم إنتاج أصل جديد ${finishedAsset.name} بفرع ${branchRecord.name} فاقد الوزن ${processLossPct}%`,
      type: "success",
      entityType: "ManufacturingOrder",
      entityId: moId
    });
    emitEntityChanged(req.companyId, {
      entity: "Asset",
      action: "update",
      id: finishedAssetId,
      branchId,
      related: {
        assetIds: [finishedAssetId, parentAssetId].filter(Boolean)
      }
    });

    return res.status(201).json({
      success: true,
      mo,
      finishedAsset,
      parentAsset,
      journalEntry
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Stock Audit Endpoints ───────────────────────────────────────────

// 1. List stock audits
router.get("/stock-audits", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.branchId) where.branchId = req.query.branchId;
    if (req.query.status) where.status = req.query.status;

    const rows = await models.StockAudit.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: parseInt(req.query.pageSize) || 100
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// 2. Create stock audit session
router.post("/stock-audits", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const branchId = req.headers["x-branch-id"] || req.body.branchId;
    if (!branchId) {
      throw new ValidationError("الفرع النشط مطلوب لبدء الجرد");
    }

    const branchRecord = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branchRecord) {
      throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
    }

    // Check if there is already an in-progress audit for this branch
    const existing = await models.StockAudit.findOne({
      where: { companyId: req.companyId, branchId, status: "in-progress" },
      transaction: t
    });
    if (existing) {
      await t.rollback();
      return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
    }

    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const auditId = `AUD-RFID-${Date.now()}`;
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // Create stock audit session
    const audit = await models.StockAudit.create({
      id: auditId,
      companyId: req.companyId,
      branchId,
      status: "in-progress",
      createdBy: actor,
      notes: req.body.notes || `جرد RFID لفرع ${branchRecord.name}`
    }, { transaction: t });

    // Fetch all available assets in this branch
    const expectedAssets = await models.Asset.findAll({
      where: {
        companyId: req.companyId,
        branchId,
        status: { [Op.notIn]: ["sold", "archived"] }
      },
      transaction: t
    });

    // Bulk create stock audit items
    const itemsToCreate = expectedAssets.map(asset => ({
      id: `AUD-ITEM-${asset.id}-${Date.now()}`,
      stockAuditId: auditId,
      assetId: asset.id,
      expectedBranchId: branchId,
      status: "missing"
    }));

    if (itemsToCreate.length > 0) {
      await models.StockAuditItem.bulkCreate(itemsToCreate, { transaction: t });
    }

    await t.commit();

    const result = audit.toJSON();
    result.itemsCount = itemsToCreate.length;

    return res.status(201).json({ success: true, ...result, data: result });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 3. Get stock audit session details
router.get("/stock-audits/:id", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const audit = await models.StockAudit.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      include: [
        {
          model: models.StockAuditItem,
          as: "items",
          include: [{ model: models.Asset, as: "asset" }]
        }
      ]
    });
    if (!audit) {
      throw new NotFoundError("جلسة الجرد غير موجودة");
    }
    return res.status(200).json({ success: true, ...audit.toJSON(), data: audit.toJSON() });
  } catch (error) {
    next(error);
  }
});

// 4. Store scanned items in the session (update statuses)
router.post("/stock-audits/:id/items", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const { scannedAssetIds = [] } = req.body || {};
    const audit = await models.StockAudit.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!audit) {
      throw new NotFoundError("جلسة الجرد غير موجودة");
    }
    if (audit.status !== "in-progress") {
      throw new ValidationError("جلسة الجرد هذه ليست قيد العمل");
    }

    const branchId = audit.branchId;

    // Fetch existing expected audit items
    const expectedItems = await models.StockAuditItem.findAll({
      where: { stockAuditId: audit.id },
      transaction: t
    });

    const expectedAssetIds = new Set(expectedItems.map(i => i.assetId));
    const scannedSet = new Set(scannedAssetIds);

    // 1. Process expected items (matched vs missing)
    for (const item of expectedItems) {
      const isScanned = scannedSet.has(item.assetId);
      await item.update({
        status: isScanned ? "matched" : "missing",
        scannedBranchId: isScanned ? branchId : null
      }, { transaction: t });
    }

    // 2. Process unexpected items (scanned but expected in another branch or not expected)
    const unexpectedAssetIds = scannedAssetIds.filter(id => !expectedAssetIds.has(id));
    if (unexpectedAssetIds.length > 0) {
      const unexpectedAssets = await models.Asset.findAll({
        where: { id: unexpectedAssetIds, companyId: req.companyId },
        transaction: t
      });

      for (const asset of unexpectedAssets) {
        // Check if there is already an unexpected record in this audit
        const existingUnexpected = await models.StockAuditItem.findOne({
          where: { stockAuditId: audit.id, assetId: asset.id },
          transaction: t
        });

        if (!existingUnexpected) {
          await models.StockAuditItem.create({
            id: `AUD-ITEM-UNEXP-${asset.id}-${Date.now()}`,
            stockAuditId: audit.id,
            assetId: asset.id,
            expectedBranchId: asset.branchId || branchId,
            scannedBranchId: branchId,
            status: "unexpected"
          }, { transaction: t });
        }
      }
    }

    await t.commit();

    const updated = await models.StockAudit.findOne({
      where: { id: audit.id },
      include: [
        {
          model: models.StockAuditItem,
          as: "items",
          include: [{ model: models.Asset, as: "asset" }]
        }
      ]
    });

    return res.status(200).json({ success: true, ...updated.toJSON(), data: updated.toJSON() });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 5. Complete stock audit session (apply inventory adjustments)
router.post("/stock-audits/:id/complete", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const audit = await models.StockAudit.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      include: [{ model: models.StockAuditItem, as: "items", include: [{ model: models.Asset, as: "asset" }] }],
      transaction: t
    });

    if (!audit) {
      throw new NotFoundError("جلسة الجرد غير موجودة");
    }
    if (audit.status !== "in-progress") {
      throw new ValidationError("جلسة الجرد مغلقة بالفعل أو ملغاة");
    }

    const branchRecord = await models.Branch.findOne({
      where: { id: audit.branchId, companyId: req.companyId },
      transaction: t
    });

    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // Update audit status to completed
    await audit.update({
      status: "completed",
      completedAt: nowStr
    }, { transaction: t });

    let missingCount = 0;
    let unexpectedCount = 0;

    // Apply adjustments
    for (const item of audit.items) {
      const asset = item.asset;
      if (!asset) continue;

      if (item.status === "missing") {
        missingCount++;
        // Archive missing asset
        const beforeState = `status:${asset.status}`;
        await asset.update({ status: "archived" }, { transaction: t });

        // Create Asset Event
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-LOST-${asset.id}`,
          assetId: asset.id,
          action: "LOST_RFID_AUDIT",
          date: nowStr.slice(0, 10),
          user: actor,
          branch: branchRecord.name,
          note: `تم اعتبار الأصل مفقوداً وضائعاً بناءً على تقرير جرد RFID رقم ${audit.id}`,
          sourceDocument: audit.id,
          beforeState,
          afterState: "status:archived",
          severity: "critical"
        }, { transaction: t });

        // Record Audit Log
        await auditService.record(req.companyId, {
          action: "adjustment",
          description: `تم تحديث حالة الأصل المفقود في جرد RFID رقم ${audit.id} للأصل ${asset.id}`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: branchRecord.name,
          sourceDocument: "stock_audit",
          severity: "critical",
          before: beforeState,
          after: "status:archived"
        }, { transaction: t });

      } else if (item.status === "unexpected") {
        unexpectedCount++;
        // Re-assign branch
        const beforeState = `branch:${asset.branch || "unknown"} (branchId:${asset.branchId || "unknown"})`;
        await asset.update({
          branchId: audit.branchId,
          branch: branchRecord.name
        }, { transaction: t });

        // Create Asset Event
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-LOC-${asset.id}`,
          assetId: asset.id,
          action: "LOCATION_RFID_AUDIT",
          date: nowStr.slice(0, 10),
          user: actor,
          branch: branchRecord.name,
          note: `تحديث موقع الفرع بعد فحص جرد RFID رقم ${audit.id}`,
          sourceDocument: audit.id,
          beforeState,
          afterState: `branch:${branchRecord.name} (branchId:${audit.branchId})`,
          severity: "warning"
        }, { transaction: t });

        // Record Audit Log
        await auditService.record(req.companyId, {
          action: "adjustment",
          description: `تم تحديث فرع الأصل بعد فحص جرد RFID رقم ${audit.id} للأصل ${asset.id}`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: branchRecord.name,
          sourceDocument: "stock_audit",
          severity: "warning",
          before: beforeState,
          after: `branch:${branchRecord.name}`
        }, { transaction: t });
      }
    }

    await t.commit();

    // Emit notification and SSE event
    await notificationService.createNotification(req.companyId, {
      title: "اكتمل جرد RFID للفرع",
      message: `تم إنهاء جلسة الجرد رقم ${audit.id} بنجاح. المفقودات: ${missingCount}، القطع غير المتوقعة المسواة: ${unexpectedCount}`,
      type: "warning",
      entityType: "StockAudit",
      entityId: audit.id
    });
    emitEntityChanged(req.companyId, {
      entity: "Asset",
      action: "update",
      id: audit.id,
      branchId: audit.branchId
    });

    return res.status(200).json({
      success: true,
      audit,
      missingCount,
      unexpectedCount
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Asset Attachments Endpoints ─────────────────────────────────────

const fs = require("fs");
const path = require("path");

const CUSTOMER_ATTACHMENT_TYPES = new Map([
  [".pdf", { mime: "application/pdf", category: "pdf" }],
  [".jpg", { mime: "image/jpeg", category: "image" }],
  [".jpeg", { mime: "image/jpeg", category: "image" }],
  [".png", { mime: "image/png", category: "image" }],
  [".webp", { mime: "image/webp", category: "image" }],
  [".xlsx", { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", category: "spreadsheet" }],
  [".csv", { mime: "text/csv", category: "spreadsheet" }],
  [".doc", { mime: "application/msword", category: "document" }],
  [".docx", { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "document" }]
]);

function validateCustomerAttachmentFile(file) {
  if (!file) throw new ValidationError("الملف مطلوب");
  const ext = path.extname(file.originalname || "").toLowerCase();
  const rule = CUSTOMER_ATTACHMENT_TYPES.get(ext);
  if (!rule || rule.mime !== file.mimetype) {
    throw new ValidationError("نوع الملف غير مدعوم. المسموح به: PDF, JPG, JPEG, PNG, WEBP, XLSX, CSV, DOC, DOCX");
  }
  return { ext, category: rule.category };
}

function safeUploadFileName(ext) {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
}

function serializeAssetAttachment(attachment) {
  const raw = attachment?.toJSON ? attachment.toJSON() : attachment;
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name || raw.originalFileName || raw.fileName || "Attachment",
    type: raw.type || raw.mimeType || "application/octet-stream",
    url: raw.url || raw.fileUrl || "",
    uploadedAt: raw.uploadedAt,
    uploadedBy: raw.uploadedBy || "System"
  };
}

// ─── Custom Customer Attachments & KYC Endpoints ────────────────────────────

router.get("/customers/:id/attachments", authMiddleware, requireBusinessPermission("customers.view"), async (req, res, next) => {
  try {
    const customer = await models.Customer.findOne({
      where: { id: req.params.id, companyId: req.companyId }
    });
    if (!customer) throw new NotFoundError("Customer record not found.");

    const attachments = await models.CustomerAttachment.findAll({
      where: { customerId: customer.id, companyId: req.companyId },
      order: [["uploadedAt", "DESC"], ["createdAt", "DESC"]]
    });
    const serialized = attachments.map(serializeAssetAttachment).filter(Boolean);
    return res.status(200).json({ success: true, items: serialized, data: { items: serialized } });
  } catch (error) {
    next(error);
  }
});

router.post("/customers/:id/attachments", authMiddleware, requireAnyBusinessPermission(["customers.update", "customers.attachments.manage"], { touch: true }), uploadMiddleware.single("file"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  let targetPath = "";
  try {
    const { ext, category } = validateCustomerAttachmentFile(req.file);
    const customer = await models.Customer.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!customer) throw new NotFoundError("Customer record not found.");

    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const uploadDir = path.join(baseUploadDir, "customer-attachments");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const fileName = safeUploadFileName(ext);
    targetPath = path.join(uploadDir, fileName);
    moveUploadedFileSafe(req.file.path, targetPath);

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const attachmentId = `CATT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const attachment = await models.CustomerAttachment.create({
      id: attachmentId,
      companyId: req.companyId,
      customerId: customer.id,
      fileName,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      fileUrl: `/uploads/customer-attachments/${fileName}`,
      category,
      uploadedBy: actor,
      uploadedAt: new Date()
    }, { transaction: t });

    await auditService.record(req.companyId, {
      action: "customer.attachment.upload",
      description: `Uploaded customer attachment ${req.file.originalname} for ${customer.name}`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customer Profile",
      sourceDocument: customer.id,
      severity: "info",
      after: JSON.stringify({ attachmentId, originalFileName: req.file.originalname, mimeType: req.file.mimetype })
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "upload",
      id: attachmentId,
      related: { customerId: customer.id }
    });
    return res.status(201).json({ success: true, data: attachment.toJSON() });
  } catch (error) {
    await t.rollback();
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) { }
    }
    if (targetPath && fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch (_) { }
    }
    next(error);
  }
});

router.delete("/customers/:id/attachments/:attachmentId", authMiddleware, requireAnyBusinessPermission(["customers.update", "customers.attachments.manage"], { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!customer) throw new NotFoundError("Customer record not found.");

    const attachment = await models.CustomerAttachment.findOne({
      where: { id: req.params.attachmentId, customerId: customer.id, companyId: req.companyId },
      transaction: t
    });
    if (!attachment) throw new NotFoundError("Attachment not found.");

    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const relativePath = attachment.fileUrl.replace(/^\/uploads\//, "");
    const filePath = path.join(baseUploadDir, relativePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await attachment.destroy({ transaction: t });
    await auditService.record(req.companyId, {
      action: "customer.attachment.delete",
      description: `Deleted customer attachment ${attachment.originalFileName} for ${customer.name}`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customer Profile",
      sourceDocument: customer.id,
      severity: "info",
      before: JSON.stringify(attachment.toJSON())
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "delete",
      id: req.params.attachmentId,
      related: { customerId: customer.id }
    });
    return res.status(200).json({ success: true, data: { message: "Attachment deleted." } });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.patch("/customers/:id/kyc", authMiddleware, requireAnyBusinessPermission(["customers.update", "customers.kyc.manage"], { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!customer) throw new NotFoundError("Customer record not found.");

    const allowedIdentityTypes = new Set(["national_id", "passport", "driving_license", "residency_id", "other", ""]);
    const allowedKyc = new Set(["not-started", "pending", "verified", "flagged"]);
    const allowedAml = new Set(["clear", "review", "flagged"]);
    const body = req.body || {};

    const identityType = String(body.identityType ?? body.idType ?? "").trim();
    const identityNumber = String(body.identityNumber ?? body.idNumber ?? "").trim();
    const identityExpiryDate = String(body.identityExpiryDate ?? body.idExpiry ?? "").trim();
    const kycStatus = String(body.kycStatus ?? body.status ?? customer.kycStatus ?? "not-started");
    const amlStatus = String(body.amlStatus ?? customer.amlStatus ?? "clear");

    if (!allowedIdentityTypes.has(identityType)) throw new ValidationError("نوع الهوية غير صحيح");
    if (!allowedKyc.has(kycStatus)) throw new ValidationError("حالة KYC غير صحيحة");
    if (!allowedAml.has(amlStatus)) throw new ValidationError("حالة AML غير صحيحة");
    if (identityExpiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(identityExpiryDate)) {
      throw new ValidationError("تاريخ انتهاء الهوية يجب أن يكون بصيغة YYYY-MM-DD");
    }

    const before = customer.toJSON();
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const meaningfulStatusChange = before.kycStatus !== kycStatus || before.amlStatus !== amlStatus;
    const now = new Date();
    const kycDetails = {
      ...(customer.kycDetails || {}),
      identityType,
      identityNumber,
      identityExpiryDate,
      idType: identityType,
      idNumber: identityNumber,
      idExpiry: identityExpiryDate,
      status: kycStatus,
      amlStatus,
      lastCheckedAt: now.toISOString().slice(0, 10)
    };

    await customer.update({
      idType: identityType || null,
      idNumber: identityNumber || null,
      idExpiry: identityExpiryDate || null,
      kycStatus,
      amlStatus,
      kycDetails
    }, { transaction: t });

    await auditService.record(req.companyId, {
      action: "customer.kyc.update",
      description: `Updated KYC data for customer ${customer.name}`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customer Profile",
      sourceDocument: customer.id,
      severity: meaningfulStatusChange ? "warning" : "info",
      before: JSON.stringify({
        idType: before.idType,
        idNumber: before.idNumber,
        idExpiry: before.idExpiry,
        kycStatus: before.kycStatus,
        amlStatus: before.amlStatus
      }),
      after: JSON.stringify({ identityType, identityNumber, identityExpiryDate, kycStatus, amlStatus })
    }, { transaction: t });

    let notification = null;
    if (meaningfulStatusChange) {
      notification = await notificationService.createNotification(req.companyId, {
        title: "Customer KYC updated",
        message: `KYC/AML status changed for customer ${customer.name}.`,
        type: amlStatus === "flagged" || kycStatus === "flagged" ? "warning" : "info",
        entityType: "Customer",
        entityId: customer.id
      }, { transaction: t });
    }

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "KYC",
      action: "update",
      id: customer.id,
      related: { customerId: customer.id }
    });
    return res.status(200).json({
      success: true,
      data: customer.toJSON(),
      notification: notification ? notification.toJSON() : null
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 1. Get attachments list for an asset
router.get("/assets/:id/attachments", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const asset = await models.Asset.findOne({
      where: { id: req.params.id, companyId: req.companyId }
    });
    if (!asset) {
      throw new NotFoundError("الأصل غير موجود أو لا ينتمي لشركتك");
    }

    const attachments = await models.AssetAttachment.findAll({
      where: { assetId: req.params.id },
      order: [["createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: attachments, data: { items: attachments } });
  } catch (error) {
    next(error);
  }
});

// 2. Upload an attachment for an asset
router.post("/assets/:id/attachments", authMiddleware, requireAnyBusinessPermission(["inventory.attachments.manage", "inventory.adjust"], { touch: true }), uploadMiddleware.single("file"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    if (!req.file) {
      throw new ValidationError("الملف مطلوب");
    }

    const asset = await models.Asset.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!asset) {
      throw new NotFoundError("الأصل غير موجود أو لا ينتمي لشركتك");
    }

    // Save file to backend/uploads/attachments (respecting UPLOAD_DIR)
    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const uploadDir = path.join(baseUploadDir, "attachments");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const fileExt = path.extname(req.file.originalname);
    const fileName = `${Date.now()}-${Math.floor(Math.random() * 1000)}${fileExt}`;
    const targetPath = path.join(uploadDir, fileName);

    moveUploadedFileSafe(req.file.path, targetPath);

    const fileUrl = `/uploads/attachments/${fileName}`;
    const attachmentId = `ATT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");

    const attachment = await models.AssetAttachment.create({
      id: attachmentId,
      assetId: asset.id,
      name: req.file.originalname,
      type: req.file.mimetype,
      url: fileUrl,
      uploadedAt: nowStr,
      uploadedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
    }, { transaction: t });

    // Record Audit Log
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "adjustment",
      description: `تم رفع مرفق جديد للأصل ${asset.id}: ${req.file.originalname}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: asset.branch || "Showroom",
      sourceDocument: "asset",
      severity: "info",
      after: JSON.stringify({ attachmentId, name: req.file.originalname })
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "upload",
      id: attachmentId,
      branchId: asset.branchId,
      related: {
        assetIds: [asset.id]
      }
    });
    const serialized = serializeAssetAttachment(attachment);
    return res.status(201).json({ success: true, ...serialized, data: serialized });
  } catch (error) {
    await t.rollback();
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) { }
    }
    next(error);
  }
});

// 3. Delete an attachment for an asset
router.delete("/assets/:id/attachments/:attachmentId", authMiddleware, requireAnyBusinessPermission(["inventory.attachments.manage", "inventory.adjust"], { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const asset = await models.Asset.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!asset) {
      throw new NotFoundError("الأصل غير موجود أو لا ينتمي لشركتك");
    }

    const attachment = await models.AssetAttachment.findOne({
      where: { id: req.params.attachmentId, assetId: req.params.id },
      transaction: t
    });
    if (!attachment) {
      throw new NotFoundError("المرفق غير موجود");
    }

    // Delete the file from the disk (respecting UPLOAD_DIR)
    const relativePath = attachment.url.replace(/^\/uploads\//, "");
    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const filePath = path.join(baseUploadDir, relativePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await attachment.destroy({ transaction: t });

    // Record Audit Log
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "adjustment",
      description: `تم حذف مرفق للأصل ${req.params.id}: ${attachment.name}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: "Showroom",
      sourceDocument: "asset",
      severity: "info",
      after: JSON.stringify({ id: attachment.id, name: attachment.name })
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "delete",
      id: req.params.attachmentId,
      branchId: asset.branchId,
      related: {
        assetIds: [asset.id]
      }
    });
    return res.status(200).json({ success: true, message: "تم حذف المرفق بنجاح" });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Custom Transfers Logic ──────────────────────────────────────────────────
router.post("/transfers", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const { assetIds = [], fromBranchId, toBranchId, notes = "" } = req.body || {};

    if (fromBranchId === toBranchId) {
      throw new ValidationError("لا يمكن التحويل من وإلى نفس الفرع");
    }

    const fromBranchRecord = await models.Branch.findOne({ where: { id: fromBranchId, companyId: req.companyId, isActive: true }, transaction: t });
    const toBranchRecord = await models.Branch.findOne({ where: { id: toBranchId, companyId: req.companyId, isActive: true }, transaction: t });

    if (!fromBranchRecord || !toBranchRecord) {
      throw new ValidationError("الفرع المرسل أو المستقبل غير موجود أو غير نشط");
    }

    if (assetIds.length === 0) {
      throw new ValidationError("يجب اختيار أصل واحد على الأقل للتحويل");
    }

    const assets = await models.Asset.findAll({
      where: { id: assetIds, companyId: req.companyId },
      lock: true,
      transaction: t
    });

    if (assets.length !== assetIds.length) {
      throw new ValidationError("بعض الأصول المحددة غير موجودة");
    }

    for (const asset of assets) {
      if (asset.branchId !== fromBranchId) {
        throw new ValidationError(`الأصل ${asset.name} (${asset.id}) ليس موجوداً في فرع المصدر`);
      }
      if (asset.status !== "available") {
        const canBypass = req.user && (req.user.isAdmin || (req.user.permissions && req.user.permissions.includes("transfers.bypassStatus")));
        if (!canBypass) {
          throw new ValidationError(`الأصل ${asset.name} (${asset.id}) حالته ليست متاحة للتحويل: ${asset.status}`);
        }
      }
    }

    const transferId = `TR-${Date.now()}`;
    const transfer = await models.Transfer.create({
      id: transferId,
      companyId: req.companyId,
      assetIds,
      fromBranch: fromBranchRecord.name,
      fromBranchId,
      toBranch: toBranchRecord.name,
      toBranchId,
      requestedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      requestedAt: new Date().toISOString(),
      status: "pending",
      notes
    }, { transaction: t });

    // Mark assets as reserved during the transfer request
    for (const asset of assets) {
      await asset.update({ status: "reserved" }, { transaction: t });
      await models.AssetEvent.create({
        id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        assetId: asset.id,
        companyId: req.companyId,
        type: "transfer_request",
        description: `طلب تحويل إلى ${toBranchRecord.name} بموجب مستند رقم ${transferId}`,
        date: new Date().toISOString().slice(0, 10),
        user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System"
      }, { transaction: t });
    }

    await t.commit();

    emitEntityChanged(req.companyId, {
      entity: "Transfer",
      action: "create",
      id: transferId,
      branchId: fromBranchId,
      related: { transferId, assetIds }
    });
    await notificationService.createNotification(req.companyId, {
      title: "طلب تحويل مخزني جديد",
      message: `تم إنشاء طلب تحويل ${assetIds.length} أصول من ${fromBranchRecord.name} إلى ${toBranchRecord.name}.`,
      type: "info",
      entityType: "Transfer",
      entityId: transferId
    });

    return res.status(201).json({ success: true, ...transfer.toJSON(), data: transfer.toJSON() });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.patch("/transfers/:id", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const { id } = req.params;
    const { status, cancelReason } = req.body;

    const transfer = await models.Transfer.findOne({
      where: { id, companyId: req.companyId },
      transaction: t
    });

    if (!transfer) {
      throw new NotFoundError("طلب التحويل غير موجود");
    }

    const assets = await models.Asset.findAll({
      where: { id: transfer.assetIds, companyId: req.companyId },
      lock: true,
      transaction: t
    });

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const nowStr = new Date().toISOString();

    if (status === "in-transit" || status === "approved") {
      if (transfer.status !== "pending") {
        throw new ValidationError("يمكن فقط قبول الطلبات المعلقة");
      }
      await transfer.update({
        status: "in-transit",
        approvedBy: actor,
        approvedAt: nowStr
      }, { transaction: t });

      for (const asset of assets) {
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id,
          companyId: req.companyId,
          type: "transfer_approved",
          description: `تمت الموافقة على التحويل إلى ${transfer.toBranch} (شحنة قيد النقل)`,
          date: nowStr.slice(0, 10),
          user: actor
        }, { transaction: t });
      }
    } else if (status === "received") {
      if (transfer.status !== "in-transit" && transfer.status !== "approved" && transfer.status !== "pending") {
        throw new ValidationError("لا يمكن استلام شحنة ليست قيد النقل أو معلقة");
      }
      await transfer.update({
        status: "received",
        receivedBy: actor,
        receivedAt: nowStr
      }, { transaction: t });

      for (const asset of assets) {
        await asset.update({
          branchId: transfer.toBranchId,
          branch: transfer.toBranch,
          status: "available"
        }, { transaction: t });

        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id,
          companyId: req.companyId,
          type: "transfer_received",
          description: `تم استلام الأصل في فرع ${transfer.toBranch}`,
          date: nowStr.slice(0, 10),
          user: actor
        }, { transaction: t });
      }
    } else if (status === "cancelled") {
      if (transfer.status === "received" || transfer.status === "cancelled") {
        throw new ValidationError("لا يمكن إلغاء شحنة تم استلامها أو إلغاؤها بالفعل");
      }
      await transfer.update({
        status: "cancelled",
        cancelReason: cancelReason || "إلغاء من قبل المستخدم"
      }, { transaction: t });

      for (const asset of assets) {
        await asset.update({ status: "available" }, { transaction: t });

        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id,
          companyId: req.companyId,
          type: "transfer_cancelled",
          description: `تم إلغاء التحويل: ${cancelReason || "إلغاء"}`,
          date: nowStr.slice(0, 10),
          user: actor
        }, { transaction: t });
      }
    } else {
      await transfer.update(req.body, { transaction: t });
    }

    await t.commit();

    emitEntityChanged(req.companyId, {
      entity: "Transfer",
      action: status || "update",
      id,
      branchId: transfer.fromBranchId,
      related: { transferId: id, assetIds: transfer.assetIds || [] }
    });
    await notificationService.createNotification(req.companyId, {
      title: `تحديث حالة التحويل رقم ${id}`,
      message: `تم تغيير حالة التحويل المخزني إلى: ${status}`,
      type: "info",
      entityType: "Transfer",
      entityId: id
    });

    return res.status(200).json({ success: true, ...transfer.toJSON(), data: transfer.toJSON() });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Safe Customer/Supplier/Branch Delete & Activation Actions ──────────────

router.post("/customers/:id/deactivate", authMiddleware, requireBusinessPermission("customers.deactivate", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("Customer record not found.");
    const before = customer.toJSON();
    await customer.update({ status: "inactive" }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "customer.deactivate",
      description: `Customer ${customer.name} deactivated.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customers",
      sourceDocument: customer.id,
      severity: "warning",
      before: JSON.stringify(before),
      after: JSON.stringify(customer.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Customer", action: "deactivate", id: customer.id, related: { customerId: customer.id } });
    return res.status(200).json({ success: true, data: customer });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.post("/customers/:id/reactivate", authMiddleware, requireBusinessPermission("customers.reactivate", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("Customer record not found.");
    const before = customer.toJSON();
    await customer.update({ status: "active" }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "customer.reactivate",
      description: `Customer ${customer.name} reactivated.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customers",
      sourceDocument: customer.id,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify(customer.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Customer", action: "reactivate", id: customer.id, related: { customerId: customer.id } });
    return res.status(200).json({ success: true, data: customer });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.delete("/customers/:id", authMiddleware, requireBusinessPermission("customers.delete", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("Customer record not found.");
    const linked = await countLinkedRecords([
      ["invoices", () => models.Invoice.count({ where: postedInvoiceWhere({ customerId: customer.id, companyId: req.companyId }), transaction: t })],
      ["reservations", () => models.Reservation.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["installments", () => models.Installment.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["customerGoldPools", () => models.CustomerGoldPool.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["attachments", () => models.CustomerAttachment.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["giftVouchers", () => models.GiftVoucher.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["goldFixings", () => models.GoldFixing.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })],
      ["loyaltyTransactions", () => models.LoyaltyTransaction.count({ where: { customerId: customer.id, companyId: req.companyId }, transaction: t })]
    ]);
    if (Object.keys(linked).length) throw linkedRecordsError(req, "CUSTOMER_HAS_LINKED_RECORDS", linked);

    const before = customer.toJSON();
    await customer.destroy({ force: true, transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "customer.delete",
      description: `Customer ${customer.name} permanently deleted.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Customers",
      sourceDocument: customer.id,
      severity: "critical",
      before: JSON.stringify(before)
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Customer", action: "delete", id: customer.id, related: { customerId: customer.id } });
    return res.status(200).json({ success: true, data: { id: customer.id, action: "deleted" } });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.post("/suppliers/:id/deactivate", authMiddleware, requireBusinessPermission("suppliers.deactivate", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const supplier = await models.Supplier.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!supplier) throw new NotFoundError("Supplier record not found.");
    const before = supplier.toJSON();
    await supplier.update({ status: "inactive" }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "supplier.deactivate",
      description: `Supplier ${supplier.name} deactivated.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Suppliers",
      sourceDocument: supplier.id,
      severity: "warning",
      before: JSON.stringify(before),
      after: JSON.stringify(supplier.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Supplier", action: "deactivate", id: supplier.id, related: { supplierId: supplier.id } });
    return res.status(200).json({ success: true, data: supplier });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.post("/suppliers/:id/reactivate", authMiddleware, requireBusinessPermission("suppliers.reactivate", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const supplier = await models.Supplier.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!supplier) throw new NotFoundError("Supplier record not found.");
    const before = supplier.toJSON();
    await supplier.update({ status: "active" }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "supplier.reactivate",
      description: `Supplier ${supplier.name} reactivated.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Suppliers",
      sourceDocument: supplier.id,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify(supplier.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Supplier", action: "reactivate", id: supplier.id, related: { supplierId: supplier.id } });
    return res.status(200).json({ success: true, data: supplier });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.delete("/suppliers/:id", authMiddleware, requireBusinessPermission("suppliers.delete", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const supplier = await models.Supplier.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!supplier) throw new NotFoundError("Supplier record not found.");
    const linked = await countLinkedRecords([
      ["purchaseOrders", () => models.PurchaseOrder.count({ where: { supplierId: supplier.id, companyId: req.companyId }, transaction: t })],
      ["documents", () => models.SupplierDocument.count({ where: { supplierId: supplier.id }, transaction: t })],
      ["consignments", () => models.SupplierConsignment.count({ where: { supplierId: supplier.id }, transaction: t })],
      ["assets", () => models.Asset.count({ where: { companyId: req.companyId, source: { [Op.iLike]: `%${supplier.id}%` } }, transaction: t })]
    ]);
    if (Object.keys(linked).length) throw linkedRecordsError(req, "SUPPLIER_HAS_LINKED_RECORDS", linked);

    const before = supplier.toJSON();
    await supplier.destroy({ force: true, transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "supplier.delete",
      description: `Supplier ${supplier.name} permanently deleted.`,
      user: actor,
      userId: req.user?.id,
      place: req.branchId || "Suppliers",
      sourceDocument: supplier.id,
      severity: "critical",
      before: JSON.stringify(before)
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Supplier", action: "delete", id: supplier.id, related: { supplierId: supplier.id } });
    return res.status(200).json({ success: true, data: { id: supplier.id, action: "deleted" } });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// Phase 34.2 — Employee Code is backend-authoritative. These routes intentionally
// shadow the generic Employee create/update handlers while leaving list/get and
// activation behavior on the existing generic CRUD surface.
router.get("/employees", authMiddleware, requireAnyPermission(employeeViewPermissions), async (req, res, next) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const pageSize = parsePositiveInt(req.query.pageSize || req.query.limit, 25, 100);
    const offset = (page - 1) * pageSize;
    const search = String(req.query.search || "").trim();
    let parsedFilters = {};
    if (req.query.filters) {
      try {
        parsedFilters = typeof req.query.filters === "string" ? JSON.parse(req.query.filters) : req.query.filters;
      } catch (_) {
        parsedFilters = {};
      }
    }
    const queryValue = (key) => req.query[key] !== undefined ? req.query[key] : parsedFilters[key];
    const where = { companyId: req.companyId };

    if (queryValue("status") && queryValue("status") !== "all") where.status = String(queryValue("status"));
    if (queryValue("role") && queryValue("role") !== "all") where.role = String(queryValue("role"));
    if (queryValue("primaryBranchId") && queryValue("primaryBranchId") !== "all") where.branchId = String(queryValue("primaryBranchId"));
    if (search) {
      const normalizedSearch = employeeAuthorizationService.normalizeEmployeeCode(search);
      where[Op.or] = [
        { employeeCodeNormalized: { [Op.iLike]: `%${normalizedSearch}%` } },
        { name: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const idFilters = [];
    if (queryValue("branchAccessId") && queryValue("branchAccessId") !== "all") {
      const rows = await models.EmployeeBranchAccess.findAll({
        where: { companyId: req.companyId, branchId: String(queryValue("branchAccessId")), active: true },
        attributes: ["employeeId"],
        raw: true,
      });
      idFilters.push(new Set(rows.map((row) => row.employeeId)));
    }
    if (queryValue("roleId") && queryValue("roleId") !== "all") {
      const rows = await models.EmployeeRoleAssignment.findAll({
        where: { companyId: req.companyId, roleId: String(queryValue("roleId")), active: true },
        attributes: ["employeeId"],
        raw: true,
      });
      idFilters.push(new Set(rows.map((row) => row.employeeId)));
    }
    if (queryValue("credentialState") && queryValue("credentialState") !== "all") {
      const credentials = await models.EmployeeCredential.findAll({
        where: { companyId: req.companyId },
        attributes: ["employeeId", "active", "resetRequired", "lockedUntil"],
        raw: true,
      });
      const wanted = String(queryValue("credentialState"));
      idFilters.push(new Set(credentials.filter((row) => employeeCredentialState(row) === wanted).map((row) => row.employeeId)));
      if (wanted === "not_configured") {
        const withCredential = new Set(credentials.map((row) => row.employeeId));
        const allIds = await models.Employee.findAll({ where: { companyId: req.companyId }, attributes: ["id"], raw: true });
        idFilters[idFilters.length - 1] = new Set(allIds.filter((row) => !withCredential.has(row.id)).map((row) => row.id));
      }
    }
    const lockedFilter = boolQuery(queryValue("locked"));
    if (lockedFilter !== null) {
      const credentials = await models.EmployeeCredential.findAll({
        where: { companyId: req.companyId },
        attributes: ["employeeId", "lockedUntil"],
        raw: true,
      });
      const now = new Date();
      idFilters.push(new Set(credentials.filter((row) => Boolean(row.lockedUntil && new Date(row.lockedUntil) > now) === lockedFilter).map((row) => row.employeeId)));
    }
    const activeSessionFilter = boolQuery(queryValue("activeOperatorSession"));
    if (activeSessionFilter !== null) {
      const sessions = await models.EmployeeOperationalSession.findAll({
        where: {
          companyId: req.companyId,
          revokedAt: null,
          lockedAt: null,
          idleExpiresAt: { [Op.gt]: new Date() },
          absoluteExpiresAt: { [Op.gt]: new Date() },
        },
        attributes: ["employeeId"],
        raw: true,
      });
      const withActive = new Set(sessions.map((row) => row.employeeId));
      const allIds = await models.Employee.findAll({ where: { companyId: req.companyId }, attributes: ["id"], raw: true });
      idFilters.push(new Set(allIds.filter((row) => withActive.has(row.id) === activeSessionFilter).map((row) => row.id)));
    }
    if (idFilters.length) {
      const intersection = idFilters.reduce((acc, set) => new Set([...acc].filter((id) => set.has(id))));
      where.id = intersection.size ? { [Op.in]: [...intersection] } : { [Op.in]: ["__NO_MATCH__"] };
    }

    const { count, rows } = await models.Employee.findAndCountAll({
      where,
      order: [["createdAt", "DESC"], ["id", "ASC"]],
      limit: pageSize,
      offset,
      raw: true,
    });
    const employeeIds = rows.map((row) => row.id);

    const [credentials, branchCounts, roleCounts, activeSessionCounts, lastAttempts, statusRows] = await Promise.all([
      employeeIds.length ? models.EmployeeCredential.findAll({ where: { companyId: req.companyId, employeeId: employeeIds }, raw: true }) : [],
      employeeIds.length ? models.EmployeeBranchAccess.findAll({ where: { companyId: req.companyId, employeeId: employeeIds, active: true }, attributes: ["employeeId", [models.sequelize.fn("COUNT", models.sequelize.col("id")), "count"]], group: ["employeeId"], raw: true }) : [],
      employeeIds.length ? models.EmployeeRoleAssignment.findAll({ where: { companyId: req.companyId, employeeId: employeeIds, active: true }, attributes: ["employeeId", [models.sequelize.fn("COUNT", models.sequelize.col("id")), "count"]], group: ["employeeId"], raw: true }) : [],
      employeeIds.length ? models.EmployeeOperationalSession.findAll({ where: { companyId: req.companyId, employeeId: employeeIds, revokedAt: null, lockedAt: null, idleExpiresAt: { [Op.gt]: new Date() }, absoluteExpiresAt: { [Op.gt]: new Date() } }, attributes: ["employeeId", [models.sequelize.fn("COUNT", models.sequelize.col("id")), "count"]], group: ["employeeId"], raw: true }) : [],
      employeeIds.length ? models.EmployeeVerificationAttempt.findAll({ where: { companyId: req.companyId, employeeId: employeeIds, result: "success" }, attributes: ["employeeId", [models.sequelize.fn("MAX", models.sequelize.col("created_at")), "lastVerifiedAt"]], group: ["employeeId"], raw: true }) : [],
      models.Employee.findAll({ where: { companyId: req.companyId }, attributes: ["status", [models.sequelize.fn("COUNT", models.sequelize.col("id")), "count"]], group: ["status"], raw: true }),
    ]);

    const byEmployee = (records, valueKey = "count") => Object.fromEntries(records.map((row) => [row.employeeId, Number(row[valueKey] || 0)]));
    const credentialByEmployee = Object.fromEntries(credentials.map((row) => [row.employeeId, row]));
    const lastVerifiedByEmployee = Object.fromEntries(lastAttempts.map((row) => [row.employeeId, row.lastVerifiedAt]));
    const branchCountByEmployee = byEmployee(branchCounts);
    const roleCountByEmployee = byEmployee(roleCounts);
    const activeSessionCountByEmployee = byEmployee(activeSessionCounts);
    const canSeeCredentialDetails = await permissionService.userHasPermission(req.user, "employees.credentials.manage");

    const items = rows.map((employee) => {
      const credential = credentialByEmployee[employee.id];
      const summary = {
        credentialState: employeeCredentialState(credential),
        branchAccessCount: branchCountByEmployee[employee.id] || 0,
        roleTemplateCount: roleCountByEmployee[employee.id] || 0,
        activeOperatorSessionCount: activeSessionCountByEmployee[employee.id] || 0,
        lastVerifiedAt: lastVerifiedByEmployee[employee.id] || null,
        primaryBranch: employee.branchId ? { id: employee.branchId, name: employee.branch } : null,
      };
      if (canSeeCredentialDetails && credential?.lockedUntil) summary.lockedUntil = credential.lockedUntil;
      return { ...employee, authorizationSummary: summary };
    });

    const statusCounts = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count || 0)]));
    const totalPages = Math.ceil(count / pageSize);
    return res.status(200).json({
      success: true,
      items,
      page,
      pageSize,
      total: count,
      totalPages,
      data: {
        items,
        page,
        pageSize,
        total: count,
        totalPages,
        stats: {
          totalEmployees: Object.values(statusCounts).reduce((sum, value) => sum + value, 0),
          statusCounts,
          pageActiveOperatorSessions: items.reduce((sum, item) => sum + Number(item.authorizationSummary.activeOperatorSessionCount || 0), 0),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/employees/:id", authMiddleware, requireAnyPermission(employeeViewPermissions), async (req, res, next) => {
  try {
    const employee = await models.Employee.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!employee) throw new NotFoundError("Employee not found.");
    const [credential, branchAccessCount, roleTemplateCount, activeOperatorSessionCount, lastVerifiedAt] = await Promise.all([
      models.EmployeeCredential.findOne({
        where: { companyId: req.companyId, employeeId: employee.id },
        raw: true
      }),
      models.EmployeeBranchAccess.count({
        where: { companyId: req.companyId, employeeId: employee.id, active: true }
      }),
      models.EmployeeRoleAssignment.count({
        where: { companyId: req.companyId, employeeId: employee.id, active: true }
      }),
      models.EmployeeOperationalSession.count({
        where: {
          companyId: req.companyId,
          employeeId: employee.id,
          revokedAt: null,
          lockedAt: null,
          idleExpiresAt: { [Op.gt]: new Date() },
          absoluteExpiresAt: { [Op.gt]: new Date() }
        }
      }),
      models.EmployeeVerificationAttempt.max("created_at", {
        where: { companyId: req.companyId, employeeId: employee.id, result: "success" }
      })
    ]);
    const authorizationSummary = {
      credentialState: employeeCredentialState(credential),
      branchAccessCount,
      roleTemplateCount,
      activeOperatorSessionCount,
      lastVerifiedAt: lastVerifiedAt || null,
      primaryBranch: employee.branchId ? { id: employee.branchId, name: employee.branch } : null
    };
    const canSeeCredentialDetails = await permissionService.userHasPermission(req.user, "employees.credentials.manage");
    if (canSeeCredentialDetails && credential?.lockedUntil) authorizationSummary.lockedUntil = credential.lockedUntil;
    return res.status(200).json({ success: true, data: { ...employee.toJSON(), authorizationSummary } });
  } catch (error) {
    next(error);
  }
});

router.post("/employees", authMiddleware, requireAnyPermission(employeeCoreManagePermissions), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    if (!body.name || !body.role || !body.branch || !body.employeeCode) {
      throw new ValidationError("name, role, branch and employeeCode are required.");
    }
    const createPin = assertEmployeeCreatePin(body);
    const normalized = employeeAuthorizationService.normalizeEmployeeCode(body.employeeCode);
    const existing = await models.Employee.findOne({
      where: { companyId: req.companyId, employeeCodeNormalized: normalized },
      transaction: t
    });
    if (existing) throw new ConflictError("Employee Code already exists.");
    const employee = await models.Employee.create({
      id: body.id || `EMP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId: req.companyId,
      name: String(body.name).trim(),
      employeeCode: String(body.employeeCode).trim().normalize("NFKC"),
      employeeCodeNormalized: normalized,
      role: String(body.role).trim(),
      systemRole: body.systemRole || "sales",
      branch: String(body.branch).trim(),
      branchId: body.branchId || null,
      status: body.status || "present",
      email: body.email || "",
      phone: body.phone || "",
      joinDate: body.joinDate || null,
      jobTitle: body.jobTitle || "",
      approvalLimit: body.approvalLimit || 0,
      assignedDevice: body.assignedDevice || "",
      notes: body.notes || "",
      approvalLimitsDetail: body.approvalLimitsDetail || null
    }, { transaction: t });
    if (createPin) {
      await employeeAuthorizationService.createEmployeeCredentialForNewEmployee({
        companyId: req.companyId,
        employeeId: employee.id,
        pin: createPin,
        actorUser: req.user,
        transaction: t
      });
    }
    if (employee.branchId) {
      const branch = await models.Branch.findOne({ where: { id: employee.branchId, companyId: req.companyId, isActive: true }, transaction: t });
      if (!branch) throw new ValidationError("branchId is invalid for this company.", { branchId: ["Invalid branch."] });
      await models.EmployeeBranchAccess.findOrCreate({
        where: { companyId: req.companyId, employeeId: employee.id, branchId: employee.branchId },
        defaults: { id: `EBA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, active: true, validFrom: new Date(), createdByUserId: req.user?.id || null },
        transaction: t
      });
    }
    await auditService.record(req.companyId, {
      action: "employee.created",
      description: `Employee ${employee.name} created.`,
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      userId: req.user?.id,
      place: req.branchId || "Employees",
      sourceDocument: employee.id,
      after: JSON.stringify({ employeeId: employee.id, employeeCode: employee.employeeCode })
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Employee", action: "create", id: employee.id });
    return res.status(201).json({ success: true, data: employee });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

async function updateEmployeeAuthoritative(req, res, next) {
  const t = await models.sequelize.transaction();
  try {
    const employee = await models.Employee.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!employee) throw new NotFoundError("Employee not found.");
    const updates = {};
    for (const key of ["name", "role", "systemRole", "branch", "branchId", "status", "email", "phone", "joinDate", "jobTitle", "approvalLimit", "assignedDevice", "notes", "approvalLimitsDetail", "deactivateReason"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.employeeCode !== undefined) {
      const normalized = employeeAuthorizationService.normalizeEmployeeCode(req.body.employeeCode);
      if (normalized !== employee.employeeCodeNormalized) {
        throw new ValidationError("Employee Code must be changed through the dedicated credential endpoint.", {
          employeeCode: ["Use POST /employees/:id/change-code with reason and current Employee authorization."]
        });
      }
    }
    if (updates.status === "present" && !(await employeeHasConfiguredCredential(req.companyId, employee.id, t))) {
      throw new ValidationError("Employee PIN must be configured before activation.", { pin: ["Set a six-digit Employee PIN before activating this Employee."] });
    }
    const before = employee.toJSON();
    await employee.update(updates, { transaction: t });
    const authorizationFields = ["employeeCode", "employeeCodeNormalized", "role", "systemRole", "branchId", "status"];
    const authorizationChanged = authorizationFields.some((field) => String(before[field] ?? "") !== String(employee[field] ?? ""));
    if (authorizationChanged) {
      await employeeAuthorizationService.incrementEmployeeAuthorizationVersion({
        companyId: req.companyId,
        employeeId: employee.id,
        transaction: t
      });
    }
    await auditService.record(req.companyId, {
      action: "employee.updated",
      description: `Employee ${employee.name} updated.`,
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      userId: req.user?.id,
      place: req.branchId || "Employees",
      sourceDocument: employee.id,
      before: JSON.stringify({ employeeCode: before.employeeCode, role: before.role, branchId: before.branchId }),
      after: JSON.stringify({ employeeCode: employee.employeeCode, role: employee.role, branchId: employee.branchId })
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Employee", action: "update", id: employee.id });
    return res.status(200).json({ success: true, data: employee });
  } catch (error) {
    await t.rollback();
    next(error);
  }
}

router.put("/employees/:id", authMiddleware, requireAnyPermission(employeeCoreManagePermissions), updateEmployeeAuthoritative);
router.patch("/employees/:id", authMiddleware, requireAnyPermission(employeeCoreManagePermissions), updateEmployeeAuthoritative);
router.post("/employees/:id/deactivate", authMiddleware, requireAnyPermission(employeeCoreManagePermissions), async (req, res, next) => {
  try {
    const employee = await models.Employee.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!employee) throw new NotFoundError("Employee not found.");
    await employee.update({ status: "inactive", deactivateReason: req.body?.reason || employee.deactivateReason || "" });
    emitEntityChanged(req.companyId, { entity: "Employee", action: "update", id: employee.id });
    return res.status(200).json({ success: true, data: employee });
  } catch (error) {
    next(error);
  }
});
router.post("/employees/:id/reactivate", authMiddleware, requireAnyPermission(employeeCoreManagePermissions), async (req, res, next) => {
  try {
    const employee = await models.Employee.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!employee) throw new NotFoundError("Employee not found.");
    if (!(await employeeHasConfiguredCredential(req.companyId, employee.id))) {
      throw new ValidationError("Employee PIN must be configured before activation.", { pin: ["Set a six-digit Employee PIN before activating this Employee."] });
    }
    await employee.update({ status: "present", deactivateReason: null });
    emitEntityChanged(req.companyId, { entity: "Employee", action: "update", id: employee.id });
    return res.status(200).json({ success: true, data: employee });
  } catch (error) {
    next(error);
  }
});

// 1. Initialize Standard CRUD Endpoints
setupCrud("customers", models.Customer, ["name", "phone", "email"]);
setupCrud("suppliers", models.Supplier, ["name", "phone", "email", "category"]);
setupCrud("employees", models.Employee, ["name", "phone", "email", "role"]);
setupCrud("assets", models.Asset, ["name", "barcode", "rfid", "category", "location"]);
setupCrud("companies", models.Company, ["businessName", "workspace"]);
setupCrud("products", models.Product, ["productName", "productCode", "description"]);
setupCrud("stock-movements", models.StockMovement, ["productCode", "type", "referenceId"]);

router.post("/branches/:id/deactivate", authMiddleware, requirePermission("branches.deactivate"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const branch = await models.Branch.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!branch) throw new NotFoundError("Branch record not found.");
    if (branch.isActive) {
      const activeCount = await models.Branch.count({ where: { companyId: req.companyId, isActive: true }, transaction: t });
      if (activeCount <= 1) throw new ValidationError(lastActiveBranchDeactivateMessage(req));
    }
    const before = branch.toJSON();
    await branch.update({ isActive: false }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "branch.deactivate",
      description: `Branch ${branch.name} deactivated.`,
      user: actor,
      userId: req.user?.id,
      place: branch.name,
      sourceDocument: branch.id,
      severity: "warning",
      before: JSON.stringify(before),
      after: JSON.stringify(branch.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Branch", action: "deactivate", id: branch.id, related: { branchId: branch.id } });
    return res.status(200).json({ success: true, data: branch });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.post("/branches/:id/reactivate", authMiddleware, requirePermission("branches.reactivate"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const branch = await models.Branch.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!branch) throw new NotFoundError("Branch record not found.");
    const before = branch.toJSON();
    await branch.update({ isActive: true }, { transaction: t });
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    await auditService.record(req.companyId, {
      action: "branch.reactivate",
      description: `Branch ${branch.name} reactivated.`,
      user: actor,
      userId: req.user?.id,
      place: branch.name,
      sourceDocument: branch.id,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify(branch.toJSON())
    }, { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Branch", action: "reactivate", id: branch.id, related: { branchId: branch.id } });
    return res.status(200).json({ success: true, data: branch });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

router.delete("/branches/:id", authMiddleware, requirePermission("branches.delete"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const branch = await models.Branch.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      transaction: t
    });
    if (!branch) throw new NotFoundError("Branch record not found.");

    if (branch.isActive) {
      const activeCount = await models.Branch.count({ where: { companyId: req.companyId, isActive: true }, transaction: t });
      if (activeCount <= 1) throw new ValidationError(lastActiveBranchDeleteMessage(req));
    }

    const linked = await countLinkedRecords([
      ["assets", () => models.Asset.count({ where: { branchId: branch.id, companyId: req.companyId }, transaction: t })],
      ["invoices", () => models.Invoice.count({ where: postedInvoiceWhere({ branchId: branch.id, companyId: req.companyId }), transaction: t })],
      ["transfers", () => models.Transfer.count({ where: { companyId: req.companyId, [Op.or]: [{ fromBranchId: branch.id }, { toBranchId: branch.id }] }, transaction: t })],
      ["payments", () => models.Payment.count({ where: { branchId: branch.id, companyId: req.companyId }, transaction: t })],
      ["treasuryTransactions", () => models.CashTransaction.count({ where: { branchId: branch.id, companyId: req.companyId }, transaction: t })],
      ["journalEntries", () => models.JournalEntry.count({ where: { branchId: branch.id, companyId: req.companyId }, transaction: t })],
      ["employees", () => models.Employee.count({ where: { companyId: req.companyId, [Op.or]: [{ branchId: branch.id }, { branch: branch.name }] }, transaction: t })],
      ["purchaseOrders", () => models.PurchaseOrder.count({ where: { companyId: req.companyId, branch: branch.name }, transaction: t })]
    ]);
    if (Object.keys(linked).length) throw linkedRecordsError(req, "BRANCH_HAS_LINKED_RECORDS", linked);

    const before = branch.toJSON();
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    await branch.destroy({ force: true, transaction: t });
    await auditService.record(req.companyId, {
      action: "branch.delete",
      description: `Branch ${branch.name} was deleted.`,
      user: actor,
      userId: req.user?.id,
      place: branch.name,
      sourceDocument: branch.id,
      severity: "critical",
      before: JSON.stringify(before)
    }, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, {
      entity: "Branch",
      action: "delete",
      id: branch.id,
      related: { branchId: branch.id }
    });
    return res.status(200).json({
      success: true,
      data: {
        id: branch.id,
        action: "deleted"
      }
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

setupCrud("branches", models.Branch, ["name", "code", "type"]);
setupCrud("transfers", models.Transfer, ["fromBranch", "toBranch", "status"]);
setupCrud("manufacturing-orders", models.ManufacturingOrder, ["status", "type", "branch"]);
setupCrud("customer-gold-pools", models.CustomerGoldPool, ["customerName", "status"]);
setupCrud("inventory-gold-pools", models.InventoryGoldPool, ["source", "status"]);
setupCrud("purchase-orders", models.PurchaseOrder, ["supplierName", "status", "branch"]);

// Phase 31.4-Fix — Unified Invoices Search & Print (read-only GET).
// This route is intentionally registered before generic /invoices/:id.
router.get("/invoices/search-print", authMiddleware, requireBusinessPermission("sales.view"), async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 25, 1), 100);
    const search = String(req.query.search || "").trim();
    const customer = String(req.query.customer || "").trim();
    const customerId = String(req.query.customerId || "").trim();
    const branch = String(req.query.branch || "").trim();
    const requestedType = String(req.query.type || "all").trim();
    const requestedStatus = String(req.query.status || "all").trim();
    const dateFrom = String(req.query.dateFrom || "").trim();
    const dateTo = String(req.query.dateTo || "").trim();
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (dateFrom && !isoDatePattern.test(dateFrom)) {
      throw new ValidationError("dateFrom must use YYYY-MM-DD format.");
    }
    if (dateTo && !isoDatePattern.test(dateTo)) {
      throw new ValidationError("dateTo must use YYYY-MM-DD format.");
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new ValidationError("dateFrom cannot be after dateTo.");
    }
    if (requestedType !== "all" && !SEARCH_PRINT_INVOICE_TYPES[requestedType]) {
      throw new ValidationError("Unsupported invoice type for Search & Print.");
    }
    if (requestedStatus !== "all" && !SEARCH_PRINT_STATUSES.has(requestedStatus)) {
      throw new ValidationError("Unsupported invoice status for Search & Print.");
    }

    const where = {
      companyId: req.companyId,
      type: { [Op.in]: Object.values(SEARCH_PRINT_INVOICE_TYPES) },
    };
    const conditions = [];

    if (search) {
      conditions.push({
        [Op.or]: [
          { id: { [Op.iLike]: `%${search}%` } },
          { invoiceNumber: { [Op.iLike]: `%${search}%` } },
        ],
      });
    }
    if (customer) conditions.push({ customerName: { [Op.iLike]: `%${customer}%` } });
    if (customerId) conditions.push({ customerId: { [Op.iLike]: `%${customerId}%` } });
    if (branch && branch !== "all") conditions.push({ branch });
    if (requestedType !== "all") conditions.push({ type: SEARCH_PRINT_INVOICE_TYPES[requestedType] });
    if (requestedStatus !== "all") conditions.push(searchPrintStatusWhere(requestedStatus));
    if (dateFrom || dateTo) {
      const dateRange = {};
      if (dateFrom) dateRange[Op.gte] = dateFrom;
      // `Invoice.date` is a legacy string that may contain either YYYY-MM-DD
      // or YYYY-MM-DD HH:mm. Use an end-of-day upper bound so both formats are
      // included without parsing or rewriting stored values.
      if (dateTo) dateRange[Op.lte] = `${dateTo} 23:59:59.999`;
      conditions.push({ date: dateRange });
    }
    if (conditions.length) where[Op.and] = conditions;

    const total = await models.Invoice.count({ where });
    const rows = await models.Invoice.findAll({
      where,
      include: [{ model: models.InvoiceItem, as: "items" }],
      order: [["createdAt", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const items = rows.map((row) => {
      const invoice = row.toJSON();
      return {
        ...invoice,
        type: invoice.type || "sale",
        searchPrintStatus: resolveSearchPrintStatus(invoice),
        employeeName: null,
      };
    });
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);

    return res.status(200).json({
      success: true,
      items,
      page,
      pageSize,
      total,
      totalPages,
      capabilities: {
        employeeFilter: false,
        supportedTypes: Object.keys(SEARCH_PRINT_INVOICE_TYPES),
      },
      data: {
        items,
        page,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
});
// End Phase 31.4-Fix — Unified Invoices Search & Print.

router.post(
  "/invoices/:id/print-events",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.official_print", {
    resolveBranchId: (req) => req.headers["x-branch-id"] || req.branchId
  }),
  async (req, res, next) => {
    const t = await models.sequelize.transaction();
    try {
      const body = req.body || {};
      const requestedType = String(body.type || "").trim();
      if (!["official", "reprint"].includes(requestedType)) {
        throw new ValidationError("نوع حدث الطباعة غير صالح", { type: ["Must be official or reprint"] });
      }
      if (requestedType === "reprint") {
        const reason = String(body.reason || "").trim();
        if (!reason) throw new AppError("Reprint reason is required.", 422, "REPRINT_REASON_REQUIRED");
        await salesOperatorPolicy.assertSalesOperatorPolicy(req, "sales.reprint", { branchId: req.branchId, transaction: t });
      }

      const invoice = await models.Invoice.findOne({
        where: { id: req.params.id, companyId: req.companyId },
        lock: true,
        transaction: t
      });
      if (!invoice) throw new NotFoundError("الفاتورة غير موجودة");
      if (invoice.postingStatus !== "posted") {
        throw new AppError("Invoice must be finalized before official print.", 409, "INVOICE_NOT_FINALIZED");
      }
      await salesOperatorPolicy.assertSalesOperatorPolicy(req, requestedType === "reprint" ? "sales.reprint" : "sales.official_print", {
        branchId: invoice.branchId || req.branchId,
        transaction: t
      });
      assertOperatorBranchForCommand(req, invoice.branchId);

      const commandActor = commandActorContext.fromRequest(req, {
        requiredPermission: "sales.print",
        requestedOperation: requestedType === "reprint" ? "sales.reprint" : "sales.official_print",
        authorizationResult: "allowed"
      });
      const official = await models.InvoicePrintEvent.findOne({
        where: { invoiceId: invoice.id, eventType: "official_print_authorized" },
        transaction: t
      });
      if (requestedType === "official" && official) {
        throw new AppError("Official print has already been authorized for this invoice.", 409, "OFFICIAL_PRINT_ALREADY_AUTHORIZED");
      }
      if (requestedType === "reprint" && !official) {
        throw new AppError("Official print must be authorized before reprint.", 409, "OFFICIAL_PRINT_REQUIRED");
      }

      let copyNumber = 1;
      if (requestedType === "reprint") {
        const latest = await models.InvoicePrintEvent.findOne({
          where: { invoiceId: invoice.id },
          order: [["copyNumber", "DESC"]],
          lock: true,
          transaction: t
        });
        copyNumber = Number(latest?.copyNumber || 1) + 1;
      }
      const eventType = requestedType === "official" ? "official_print_authorized" : "reprint_authorized";
      const event = await models.InvoicePrintEvent.create({
        id: `IPE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        companyId: req.companyId,
        branchId: invoice.branchId || req.branchId,
        invoiceId: invoice.id,
        technicalUserId: req.user.id,
        employeeId: commandActor.employeeId || null,
        operatorSessionId: commandActor.operatorSessionId || null,
        eventType,
        copyNumber,
        reason: requestedType === "reprint" ? String(body.reason || "").trim() : null
      }, { transaction: t });

      await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
        action: `invoice.${eventType}`,
        description: `Invoice ${invoice.invoiceNumber || invoice.id} ${eventType} copy ${copyNumber}`,
        place: invoice.branch || req.branchId,
        branch: invoice.branch || req.branchId,
        sourceDocument: invoice.id,
        severity: "info",
        before: null,
        after: JSON.stringify({ invoiceId: invoice.id, eventType, copyNumber })
      }, commandActor), { transaction: t });

      await t.commit();
      const out = event.toJSON();
      return res.status(201).json({ success: true, ...out, data: out });
    } catch (error) {
      await t.rollback();
      next(error);
    }
  }
);

// Search fields must be text columns — `status` is an ENUM and ILIKE cannot be
// applied to it (Postgres: "operator does not exist: enum_invoices_status ~~*"),
// which silently broke invoice search. Search by id / invoiceNumber / customer.
setupCrud("invoices", models.Invoice, ["customerName", "paymentMethod", "invoiceNumber", "id"]);
router.get("/reservations", authMiddleware, requireAnyBusinessPermission(reservationPerms.view), async (req, res, next) => {
  try {
    const result = await reservationService.list({ companyId: req.companyId, query: req.query, user: req.user, branchId: req.branchId });
    return res.status(200).json({ success: true, ...result, data: result.items });
  } catch (error) {
    next(error);
  }
});

router.get("/reservations/:id", authMiddleware, requireAnyBusinessPermission(reservationPerms.view), async (req, res, next) => {
  try {
    const reservation = await reservationService.getById({ companyId: req.companyId, id: req.params.id, user: req.user, branchId: req.branchId });
    return res.status(200).json({ success: true, data: reservation });
  } catch (error) {
    next(error);
  }
});

router.get("/reservations/:id/audit-timeline", authMiddleware, requireAnyPermission(reservationPerms.auditView), async (req, res, next) => {
  try {
    const reservation = await reservationService.getById({ companyId: req.companyId, id: req.params.id, user: req.user, branchId: req.branchId });
    const logs = await models.AuditLog.findAll({
      where: {
        companyId: req.companyId,
        sourceDocument: reservation.id,
        action: { [Op.like]: "reservation.%" },
      },
      order: [["date", "ASC"], ["createdAt", "ASC"]],
      limit: Math.min(Number(req.query.limit) || 200, 500),
    });
    const items = logs.map((log) => ({
      id: log.id,
      action: log.action,
      description: log.description,
      user: log.user,
      userId: log.userId,
      date: log.date,
      severity: log.severity,
      before: safeJson(log.before),
      after: safeJson(log.after),
    }));
    return res.status(200).json({ success: true, data: items, items });
  } catch (error) {
    next(error);
  }
});

router.post("/reservations", authMiddleware, requireAnyBusinessPermission(reservationPerms.create, { touch: true }), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const result = await reservationService.createReservation({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      body: req.body || {},
      idempotencyKey
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "create", id: result.responseBody?.data?.reservation?.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservations/:id/payments", authMiddleware, requireAnyBusinessPermission(reservationPerms.recordPayment, { touch: true }), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const result = await reservationService.addPayment({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      reservationId: req.params.id,
      body: req.body || {},
      idempotencyKey
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "update", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservations/:id/complete-sale", authMiddleware, requireAnyBusinessPermission(reservationPerms.completeSale, { touch: true }), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const result = await reservationService.completeSale({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      reservationId: req.params.id,
      body: req.body || {},
      idempotencyKey
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "complete", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservations/:id/cancel", authMiddleware, requireAnyBusinessPermission(reservationPerms.cancel, { touch: true }), async (req, res, next) => {
  try {
    const result = await reservationService.cancelReservation({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      reservationId: req.params.id,
      body: req.body || {}
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "cancel", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservations/:id/refunds", authMiddleware, requireAnyBusinessPermission(reservationPerms.refundRequest, { touch: true }), async (req, res, next) => {
  try {
    const result = await reservationService.requestRefund({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      reservationId: req.params.id,
      body: req.body || {}
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "refund-request", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservation-refunds/:id/approve", authMiddleware, requireAnyPermission(reservationPerms.refundApprove), async (req, res, next) => {
  try {
    const result = await reservationService.approveRefund({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      refundId: req.params.id,
      body: req.body || {}
    });
    emitEntityChanged(req.companyId, { entity: "ReservationRefund", action: "approve", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservation-refunds/:id/reject", authMiddleware, requireAnyPermission(reservationPerms.refundReject), async (req, res, next) => {
  try {
    const result = await reservationService.rejectRefund({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      refundId: req.params.id,
      body: req.body || {}
    });
    emitEntityChanged(req.companyId, { entity: "ReservationRefund", action: "reject", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservation-refunds/:id/execute", authMiddleware, requireAnyPermission(reservationPerms.refundExecute), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const result = await reservationService.executeRefund({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      refundId: req.params.id,
      body: req.body || {},
      idempotencyKey
    });
    emitEntityChanged(req.companyId, { entity: "ReservationRefund", action: "execute", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

// ─── Phase 32.6-Fix C — Item amendments, expiry extension, renewal ──────────
const authorizeReservationAmendment = async (req, _res, next) => {
  try {
    const body = req.body || {};
    const hasValues = (value) => Array.isArray(value) && value.length > 0;
    const hasRepricing = hasValues(body.repriceItemIds);
    const hasOrdinaryAmendment = hasValues(body.addAssetIds)
      || hasValues(body.removeItemIds)
      || hasValues(body.replacements);
    const requiresOrdinaryAmendment = hasOrdinaryAmendment || !hasRepricing;

    if (requiresOrdinaryAmendment) {
      const canAmend = await permissionService.userHasAnyPermission(req.user, reservationPerms.amendItems);
      if (!canAmend) return next(new ForbiddenError("Ordinary reservation amendments require amendment permission."));
    }
    if (hasRepricing) {
      const canReprice = await permissionService.userHasPermission(req.user, "reservations.reprice_items");
      if (!canReprice) return next(new ForbiddenError("Reservation item repricing requires repricing permission."));
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

router.post("/reservations/:id/amend-items", authMiddleware, authorizeReservationAmendment, async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const result = await reservationService.amendItems({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      reservationId: req.params.id,
      body: req.body || {},
      idempotencyKey
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "amend", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservations/:id/extend-expiry", authMiddleware, requireAnyPermission(reservationPerms.extendExpiry), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const result = await reservationService.extendExpiry({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      reservationId: req.params.id,
      body: req.body || {},
      idempotencyKey
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "extend-expiry", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservations/:id/renew", authMiddleware, requireAnyPermission(reservationPerms.renew), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const result = await reservationService.renewReservation({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      reservationId: req.params.id,
      body: req.body || {},
      idempotencyKey
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "renew", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.get("/reservations/:id/amendments", authMiddleware, requireAnyPermission(reservationPerms.view), async (req, res, next) => {
  try {
    const amendments = await models.ReservationAmendment.findAll({
      where: { reservationId: req.params.id, companyId: req.companyId },
      include: [{ model: models.ReservationAmendmentItem, as: "items", required: false }],
      order: [["createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, data: amendments });
  } catch (error) {
    next(error);
  }
});

router.get("/reservations/:id/extensions", authMiddleware, requireAnyPermission(reservationPerms.view), async (req, res, next) => {
  try {
    const extensions = await models.ReservationExpiryExtension.findAll({
      where: { reservationId: req.params.id, companyId: req.companyId },
      order: [["extendedAt", "DESC"]]
    });
    return res.status(200).json({ success: true, data: extensions });
  } catch (error) {
    next(error);
  }
});

router.get("/reservations/:id/renewal", authMiddleware, requireAnyPermission(reservationPerms.view), async (req, res, next) => {
  try {
    const renewals = await models.ReservationRenewal.findAll({
      where: { companyId: req.companyId, [Op.or]: [{ sourceReservationId: req.params.id }, { successorReservationId: req.params.id }] },
      include: [{ model: models.ReservationPaymentTransfer, as: "transfers", required: false }],
      order: [["requestedAt", "DESC"]]
    });
    return res.status(200).json({ success: true, data: renewals });
  } catch (error) {
    next(error);
  }
});

router.post("/reservation-renewal-refunds/:id/approve", authMiddleware, requireAnyPermission(reservationPerms.refundApprove), async (req, res, next) => {
  try {
    const result = await reservationService.approveRenewalExcessRefund({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      refundId: req.params.id,
      body: req.body || {}
    });
    emitEntityChanged(req.companyId, { entity: "ReservationRefund", action: "renewal-excess-approve", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservation-renewal-refunds/:id/execute", authMiddleware, requireAnyPermission(reservationPerms.refundExecute), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const result = await reservationService.executeRenewalExcessRefund({
      companyId: req.companyId,
      branchId: req.branchId || req.body?.branchId || null,
      user: req.user,
      refundId: req.params.id,
      body: req.body || {},
      idempotencyKey
    });
    emitEntityChanged(req.companyId, { entity: "ReservationRefund", action: "renewal-excess-execute", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.patch("/reservations/:id", authMiddleware, guardFor("reservations", "update"), async (req, res, next) => {
  const allowed = new Set(["notes"]);
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.some((key) => !allowed.has(key))) {
    return next(new ForbiddenError("Reservation financial, item, status, asset, and invoice fields are immutable through generic update"));
  }
  try {
    const reservation = await models.Reservation.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!reservation) throw new NotFoundError("Reservation not found");
    const before = { notes: reservation.notes };
    await reservation.update({ notes: body.notes ?? null, updatedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System" });
    await auditService.record(req.companyId, {
      action: "reservation.notes_updated",
      description: `Reservation ${reservation.id} notes updated`,
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      userId: req.user ? req.user.id : null,
      place: req.branchId || reservation.branchId || "Reservation",
      sourceDocument: reservation.id,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify({ notes: reservation.notes })
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "update", id: reservation.id });
    return res.status(200).json({ success: true, data: reservation });
  } catch (error) {
    next(error);
  }
});

router.put("/reservations/:id", authMiddleware, guardFor("reservations", "update"), (req, res, next) => {
  next(new ForbiddenError("Reservation full replacement is disabled; use dedicated reservation workflows"));
});
router.delete("/reservations/:id", authMiddleware, guardFor("reservations", "delete"), (req, res, next) => {
  next(new ForbiddenError("Reservation deletion is disabled; cancellation/refund workflows are deferred"));
});
setupCrud("approval-requests", models.ApprovalRequest, ["description", "status", "requestedBy"]);

// ─── Manual Balanced Journal Draft (Phase 8D3) ──────────────────────────────
// Safe replacement for the rejected generic POST /journal-entries (Phase 8D1).
// Creates a manual journal entry as a DRAFT ONLY, with balanced debit/credit
// lines. It NEVER posts, NEVER stamps postedAt/postedBy, and NEVER touches
// Account.balance — posting/approval/reversal are separate future phases. The
// validation + creation core lives in journal.service (transaction-driven) and
// does NOT use postingService.postEntry (which posts + moves balances).
// Registered BEFORE setupCrud("journal-entries") so the generic create stays
// rejected and this dedicated path is the only way to create an entry.
router.post(
  "/journal-entries/manual-draft",
  authMiddleware,
  requireBusinessPermission("accounting.post", { touch: true }),
  async (req, res, next) => {
    try {
      // companyId ALWAYS from the authenticated request — never the body. Only a
      // real BR-* scope from the validated request context is attached.
      const companyId = req.companyId;
      const branchId =
        typeof req.branchId === "string" && req.branchId.startsWith("BR-") ? req.branchId : null;

      const result = await models.sequelize.transaction((t) =>
        journalService.createManualDraft({
          companyId,
          actor: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
          actorId: req.user ? req.user.id : null,
          branchId,
          input: req.body || {},
          transaction: t,
        })
      );

      emitEntityChanged(companyId, { entity: "JournalEntry", action: "create", id: result.id });
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Post a Manual Journal Draft (Phase 8D5) ────────────────────────────────
// Transition an EXISTING manual draft (Phase 8D3) to posted, updating
// Account.balance atomically. Delegates to journal.service.postManualDraft,
// which locks the entry row, re-validates, applies the double-entry deltas, and
// flips the same entry to posted — it NEVER creates a new entry and NEVER calls
// postingService.postEntry. Registered before setupCrud so the generic route
// (and its rejected create) never shadows it.
router.post(
  "/journal-entries/:id/post",
  authMiddleware,
  requireBusinessPermission("accounting.post", { touch: true }),
  async (req, res, next) => {
    try {
      const result = await models.sequelize.transaction((t) =>
        journalService.postManualDraft({
          id: req.params.id,
          companyId: req.companyId, // always from auth — never the body
          actor: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
          actorId: req.user ? req.user.id : null,
          transaction: t,
        })
      );

      emitEntityChanged(req.companyId, { entity: "JournalEntry", action: "update", id: result.id });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Reverse a Posted Manual Journal Entry (Phase 8D7) ──────────────────────
// Create an accounting-correct reversal: a NEW posted entry with swapped
// debit/credit lines that undoes the original's balance effect, and flip the
// original to "reversed". Delegates to journal.service.reverseManualEntry, which
// locks the original row, validates, never deletes/edits the original lines, and
// never calls postingService.postEntry. Registered before setupCrud.
router.post(
  "/journal-entries/:id/reverse",
  authMiddleware,
  requireBusinessPermission("accounting.post", { touch: true }),
  async (req, res, next) => {
    try {
      const result = await models.sequelize.transaction((t) =>
        journalService.reverseManualEntry({
          id: req.params.id,
          companyId: req.companyId, // always from auth — never the body
          actor: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
          actorId: req.user ? req.user.id : null,
          transaction: t,
        })
      );

      // Both the new reversal entry and the now-reversed original changed.
      emitEntityChanged(req.companyId, { entity: "JournalEntry", action: "create", id: result.id });
      emitEntityChanged(req.companyId, { entity: "JournalEntry", action: "update", id: result.originalId });
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Cancel a Manual Journal Draft (Phase 8D9) ──────────────────────────────
// Hard-delete an UNPOSTED manual draft (status draft, sourceType manual). Safe
// because a draft never moved any Account.balance. Delegates to
// journal.service.cancelManualDraft (locks the row, validates, deletes lines +
// entry, audits) — no balance change, no posting/reversal. Registered before
// setupCrud so it is the only deletion path for journal entries.
router.post(
  "/journal-entries/:id/cancel",
  authMiddleware,
  requireBusinessPermission("accounting.post", { touch: true }),
  async (req, res, next) => {
    try {
      const result = await models.sequelize.transaction((t) =>
        journalService.cancelManualDraft({
          id: req.params.id,
          companyId: req.companyId, // always from auth — never the body
          actor: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
          actorId: req.user ? req.user.id : null,
          transaction: t,
        })
      );

      emitEntityChanged(req.companyId, { entity: "JournalEntry", action: "delete", id: result.id });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/accounting/lock",
  authMiddleware,
  requireBusinessPermission("accounting.view"),
  async (req, res, next) => {
    try {
      const row = await accountingLockService.getLock(req.companyId);
      const data = row
        ? row.toJSON()
        : { companyId: req.companyId, lockedThroughDate: null, reason: null };
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  "/accounting/lock",
  authMiddleware,
  requirePermission("accounting.lock.manage"),
  async (req, res, next) => {
    try {
      const result = await models.sequelize.transaction((transaction) =>
        accountingLockService.setLock({
          companyId: req.companyId,
          lockedThroughDate: req.body?.lockedThroughDate ?? null,
          reason: req.body?.reason || null,
          user: req.user,
          transaction,
        })
      );
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/reports/account-balances/reconciliation",
  authMiddleware,
  requireAnyBusinessPermission(["accounting.reconciliation.view", "accounting.view"]),
  async (req, res, next) => {
    try {
      const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.query.branch);
      const data = await accountBalanceService.reconciliationReport({
        companyId: req.companyId,
        branchId,
      });
      return res.status(200).json({ success: true, ...data, data: { ...data, branchId } });
    } catch (error) {
      next(error);
    }
  }
);

// Read-only accounting landing-page summary. All financial values are derived
// from reportable journal lines; Account.balance is deliberately not a source here.
router.get(
  "/accounting/dashboard-summary",
  authMiddleware,
  requireBusinessPermission("accounting.view"),
  async (req, res, next) => {
    try {
      const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.query.branch);
      const [summary, settings] = await Promise.all([
        accountBalanceService.calculateTreasuryLedgerSummary({ companyId: req.companyId, branchId }),
        settingsService.getCompanySettings(req.companyId),
      ]);

      res.set("Cache-Control", "private, no-store");
      return res.status(200).json({
        success: true,
        data: {
          currency: settings.currency,
          scope: { companyId: req.companyId, branchId },
          period: { mode: "all_time", from: null, to: null },
          balances: { cash: summary.cash, bank: summary.bank },
          activity: { receipts: summary.receipts, payments: summary.payments, semantics: summary.activitySemantics },
          source: "reportable_ledger_journal_lines",
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

setupCrud("journal-entries", models.JournalEntry, ["id", "description", "date"]);
setupCrud("accounts", models.Account, ["name", "nameAr", "code"]);
// NOTE: audit-logs is intentionally NOT a full CRUD resource — it is
// append-only and immutable. Its read/append/verify routes are defined in the
// "IMMUTABLE AUDIT" custom section below.

// 2. Custom Sub-Resource Route Handlers

router.get("/inventory/products", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    req.query.pageSize = req.query.pageSize || 10000;
    const controller = new ErpController(models.Product, ["productName", "productCode", "description"]);
    return controller.list(req, res, next);
  } catch (error) {
    next(error);
  }
});

router.get("/pos/products", authMiddleware, requireAnyBusinessPermission(["pos.view", "pos.sell"]), async (req, res, next) => {
  try {
    req.query.pageSize = req.query.pageSize || 10000;
    req.query.filters = JSON.stringify({ isActive: true });
    const controller = new ErpController(models.Product, ["productName", "productCode", "description"]);
    return controller.list(req, res, next);
  } catch (error) {
    next(error);
  }
});

router.get("/products/:id/movements", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const movements = await models.StockMovement.findAll({
      where: { productId: req.params.id, companyId: req.companyId },
      order: [["createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: movements, data: { items: movements } });
  } catch (error) {
    next(error);
  }
});

router.get("/products/:id/sales", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const sales = await models.InvoiceItem.findAll({
      where: { assetId: req.params.id },
      include: [{
        model: models.Invoice,
        as: "invoice",
        where: { companyId: req.companyId }
      }],
      order: [[{ model: models.Invoice, as: "invoice" }, "createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: sales, data: { items: sales } });
  } catch (error) {
    next(error);
  }
});

router.get("/products/:id/purchases", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const purchases = await models.PurchaseOrderItem.findAll({
      where: { assetId: req.params.id },
      include: [{
        model: models.PurchaseOrder,
        as: "purchaseOrder",
        where: { companyId: req.companyId }
      }],
      order: [[{ model: models.PurchaseOrder, as: "purchaseOrder" }, "createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: purchases, data: { items: purchases } });
  } catch (error) {
    next(error);
  }
});

// ─── Supplier Purchase Receiving ───────────────────────────────────────────

router.post(["/purchase-orders/receive", "/supplier-purchases/receive"], authMiddleware, requireBusinessPermission("suppliers.create", { touch: true }), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const supplierId = body.supplierId;
    const branchId = body.warehouseId || body.branchId || req.headers["x-branch-id"] || req.branchId;
    const items = Array.isArray(body.items) && body.items.length ? body.items : [{
      name: body.itemName || body.assetName,
      description: body.description,
      type: body.stockType || body.assetType,
      category: body.category,
      karat: body.karat,
      quantity: body.quantity,
      weightPerUnit: body.weightPerUnit,
      unitCost: body.unitCost,
      grossWeight: body.grossWeight,
      cost: body.cost,
      price: body.price,
      notes: body.notes
    }];
    const paymentMethod = body.paymentMethod || "credit";
    const paidAmount = Number(body.paidAmount) || 0;
    const now = new Date();
    const dateStr = (body.purchaseDate || body.date || now.toISOString().slice(0, 10));
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // Idempotency: a retried/double-clicked receive returns the original PO
    // (and its stock) instead of receiving the goods twice.
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
    // Phase 21.3 — central race-safe idempotency (unique company_id+scope+key).
    if (!idempotencyKey) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لاستلام المشتريات" });
    }
    const idemScope = "purchase.receive";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, body);
    const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
    if (!idemClaim.claimed) {
      try { await t.rollback(); } catch (_) { /* transaction already aborted by the unique violation */ }
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const idemRequest = idemClaim.request;

    if (!supplierId) throw new ValidationError("المورد مطلوب لاستلام أمر الشراء");
    if (!branchId) throw new ValidationError("الفرع أو المستودع مطلوب لاستلام المشتريات");
    if (!items.length) throw new ValidationError("يجب إضافة بند واحد على الأقل للاستلام");
    if (paidAmount < 0) throw new ValidationError("المبلغ المدفوع لا يمكن أن يكون أقل من صفر");

    const supplier = await models.Supplier.findOne({
      where: { id: supplierId, companyId: req.companyId },
      transaction: t
    });
    if (!supplier) throw new NotFoundError("Supplier record not found.");

    const branch = await models.Branch.findOne({
      where: { id: branchId, companyId: req.companyId, isActive: true },
      transaction: t
    });
    if (!branch) throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");

    const normalizedItems = items.map((item, index) => {
      const quantity = Number(item.quantity);
      const weightPerUnit = Number(item.weightPerUnit ?? item.grossWeight ?? item.weight);
      const unitCost = Number(item.unitCost ?? item.cost ?? item.unitPrice);
      const karat = item.karat == null || item.karat === "" ? null : Number(item.karat);
      const validKarats = new Set([18, 21, 22, 24]);

      if (!item.name) throw new ValidationError(`اسم البند رقم ${index + 1} مطلوب`);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError(`كمية البند رقم ${index + 1} غير صحيحة`);
      if (!Number.isInteger(quantity)) throw new ValidationError(`كمية البند رقم ${index + 1} يجب أن تكون رقمًا صحيحًا`);
      if (!Number.isFinite(weightPerUnit) || weightPerUnit <= 0) throw new ValidationError(`وزن الوحدة للبند رقم ${index + 1} غير صحيح`);
      if (!Number.isFinite(unitCost) || unitCost < 0) throw new ValidationError(`سعر التكلفة للبند رقم ${index + 1} غير صحيح`);
      if (karat !== null && !validKarats.has(karat)) throw new ValidationError(`عيار البند رقم ${index + 1} غير صحيح`);
      if (unitCost === 0) {
        throw new ValidationError(`بيانات البند رقم ${index + 1} غير صحيحة`);
      }

      const totalWeight = Math.round(quantity * weightPerUnit * 10000) / 10000;
      const totalCost = Math.round(quantity * unitCost * 100) / 100;
      const purity = item.purity ?? getPurityFromKarat(karat);

      return {
        ...item,
        quantity,
        weightPerUnit,
        totalWeight,
        unitCost,
        totalCost,
        cost: unitCost,
        grossWeight: weightPerUnit,
        netWeight: Number(item.netWeight) || weightPerUnit,
        goldWeight: Number(item.goldWeight) || Number(item.netWeight) || weightPerUnit,
        price: Number(item.price) || Math.round(unitCost * 1.32),
        type: item.type || "gold-piece",
        category: item.category || "Received purchase",
        location: item.location || "Showroom",
        karat,
        purity
      };
    });

    const goodsTotal = Math.round(normalizedItems.reduce((sum, item) => sum + item.totalCost, 0) * 100) / 100;
    const totalWeight = Math.round(normalizedItems.reduce((sum, item) => sum + item.totalWeight, 0) * 10000) / 10000;

    // Phase 12I — compute the purchase VAT / RCM snapshot in the BACKEND at
    // receive time. VAT applies ONLY when explicitly requested (applyVat flag or
    // a DRC/RCM flag) AND vatEnabled in settings; otherwise the default path is
    // byte-identical to before (no VAT, Case A). Settings supply the defaults for
    // the requested values. `goodsTotal` (sum of item costs) is the pre-VAT base.
    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const rcmRequested = Boolean(body.isRcm || body.isDRC || body.reverseVat || body.useReverseCharge);
    const vatRequested = (rcmRequested || body.applyVat === true) && settings.vatEnabled !== false;

    let taxBaseSnap = 0, vatRateSnap = 0, inputVatSnap = 0, taxIncludedSnap = false;
    let isRecoverableSnap = true, isRcmSnap = false, rcmVatSnap = 0, rcmRateSnap = 0;
    let total = goodsTotal; // amount payable to the supplier (gross for normal VAT; taxBase for RCM/no-VAT)

    if (vatRequested && rcmRequested) {
      // Case D — RCM/DRC: supplier price carries NO VAT; buyer self-accounts (net-zero).
      const rcmRate = Number(body.rcmRate ?? body.vatRate ?? settings.purchaseVatRate ?? settings.vatRate ?? 0);
      if (!Number.isFinite(rcmRate) || rcmRate <= 0 || rcmRate > 100) throw new ValidationError("RCM purchase requires a valid rcmRate between 0 and 100");
      if (body.isRecoverable === false) throw new ValidationError("RCM purchase cannot be non-recoverable");
      if (Number(body.inputVatAmount) > 0) throw new ValidationError("RCM purchase must not carry ordinary input VAT");
      isRcmSnap = true;
      isRecoverableSnap = true;
      taxBaseSnap = goodsTotal;
      rcmRateSnap = rcmRate;
      vatRateSnap = rcmRate;
      rcmVatSnap = r2(taxBaseSnap * rcmRate / 100);
      inputVatSnap = 0;
      total = taxBaseSnap; // PO.total = taxBase (no VAT paid to supplier under RCM)
    } else if (vatRequested) {
      // Case B/C — ordinary purchase VAT.
      const vatRate = Number(body.vatRate ?? settings.purchaseVatRate ?? settings.vatRate ?? 0);
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) throw new ValidationError("Purchase vatRate must be a finite number between 0 and 100");
      if (vatRate > 0) {
        vatRateSnap = vatRate;
        taxIncludedSnap = Boolean(body.taxIncluded ?? settings.purchaseTaxIncludedDefault ?? false);
        isRecoverableSnap = Boolean(body.isRecoverable ?? settings.purchaseVatRecoverableDefault ?? true);
        if (taxIncludedSnap) {
          // inclusive: goodsTotal is the GROSS; back out the base.
          taxBaseSnap = r2(goodsTotal / (1 + vatRate / 100));
          inputVatSnap = r2(goodsTotal - taxBaseSnap);
          total = goodsTotal;
        } else {
          // exclusive: goodsTotal is the genuine pre-VAT base; VAT added on top.
          taxBaseSnap = goodsTotal;
          inputVatSnap = r2(taxBaseSnap * vatRate / 100);
          total = r2(taxBaseSnap + inputVatSnap);
        }
      }
      // vatRate == 0 → leave defaults (Case A); total stays goodsTotal.
    }
    // else: no VAT requested → defaults; total = goodsTotal (Case A unchanged).

    const remainingAmount = Math.round((total - paidAmount) * 100) / 100;
    const paymentStatus = remainingAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid";

    if (total <= 0) throw new ValidationError("إجمالي أمر الشراء يجب أن يكون أكبر من صفر");
    if (paidAmount > total) throw new ValidationError("المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الشراء");

    const purchaseOrderId = body.id || `PO-${Date.now()}`;
    const existingPurchaseOrder = await models.PurchaseOrder.findOne({
      where: { id: purchaseOrderId, companyId: req.companyId },
      paranoid: false,
      transaction: t
    });
    if (existingPurchaseOrder?.status === "received") {
      throw new ValidationError("Purchase already received.");
    }
    if (existingPurchaseOrder) {
      throw new ValidationError("Purchase order already exists.");
    }

    const drcNote = body.isDRC || body.reverseVat || body.useReverseCharge
      ? "DRC reverse VAT applied."
      : "DRC reverse VAT not applied.";
    const purchaseOrder = await models.PurchaseOrder.create({
      id: purchaseOrderId,
      companyId: req.companyId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: "received",
      date: dateStr,
      expectedDate: body.expectedDate || null,
      receivedDate: body.receivedDate || dateStr,
      total,
      // Phase 12I — purchase VAT / RCM snapshot (source of truth for posting +
      // VAT report). Defaults when no VAT was requested → Case A.
      taxBase: taxBaseSnap,
      vatRate: vatRateSnap,
      inputVatAmount: inputVatSnap,
      taxIncluded: taxIncludedSnap,
      isRecoverable: isRecoverableSnap,
      isRcm: isRcmSnap,
      rcmVatAmount: rcmVatSnap,
      rcmRate: rcmRateSnap,
      branch: branch.name,
      notes: [body.notes, drcNote, `Payment: ${paymentStatus}`, `Total weight: ${totalWeight}g`].filter(Boolean).join(" | "),
      isConsignment: Boolean(body.isConsignment ?? supplier.isConsignment),
      idempotencyKey: idempotencyKey || null
    }, { transaction: t });

    const createdAssets = [];
    const createdItems = [];
    let hasProducts = false;

    // Phase 15E — gold cost snapshot wiring. Records a Gold-Center snapshot +
    // metadata alongside the UNCHANGED legacy cost (book cost / posting are not
    // touched here). `manual` mode never needs a price; hybrid/gold_center try to
    // compute and degrade gracefully when price/karat/weight are missing
    // (strict enforcement is deferred). Prices are cached per karat.
    const goldCostSource = settings.goldCostSource || "hybrid";
    const goldWeightBasis = settings.goldCostWeightBasis || "net";
    const karatPriceCache = new Map();
    const perGramFor = async (karat) => {
      if (goldCostSource === "manual" || karat == null || karat === "") return null;
      const key = String(karat);
      if (karatPriceCache.has(key)) return karatPriceCache.get(key);
      let val = null;
      try {
        const p = await effectiveKaratPrice(req.companyId, settings.currency, karat);
        if (p != null && Number.isFinite(Number(p)) && Number(p) > 0) val = Number(p);
      } catch { val = null; }
      karatPriceCache.set(key, val);
      return val;
    };

    // Phase 15F — controlled override governance. An override is an EXPLICIT
    // request action (body/item.goldCostOverride). Without it the 15E snapshot is
    // recorded as-is (no governance). A genuine divergence from the computed
    // reference requires: allowGoldCostOverride + the override permission + a
    // reason, and is audited (gold_cost.override). Adopting the computed value is
    // NOT an override. NOTHING legacy (Asset.cost/averageCost/posting) changes.
    const permissionService = require("../services/permission.service");
    const overridePermName = settings.goldCostOverridePermission || "goldCost.override";
    let _permChecked = false, _permVal = false;
    const hasOverridePerm = async () => {
      if (!_permChecked) { _permVal = await permissionService.userHasPermission(req.user, overridePermName); _permChecked = true; }
      return _permVal;
    };
    const overrideAudited = new Set();
    const governSnapshot = async (builtSnap, item, itemIndex) => {
      if (goldCostSource === "manual") return builtSnap;
      const overrideInput = item.goldCostOverride ?? (normalizedItems.length === 1 ? body.goldCostOverride : undefined);
      const cls = goldCostService.classifyOverride({ overrideInput, computedGoldCost: builtSnap.computedGoldCost });
      if (!cls.provided) return builtSnap;
      if (cls.invalid) throw new ValidationError("Gold cost override must be a non-negative number");
      if (!cls.isOverride) return goldCostService.applyOverride(builtSnap, { value: cls.value, isOverride: false });
      // genuine override → governance
      if (settings.allowGoldCostOverride === false) throw new ForbiddenError("Gold cost override is disabled for this company");
      if (!(await hasOverridePerm())) throw new ForbiddenError("You do not have permission to override gold cost");
      const reason = item.overrideReason ?? body.goldCostOverrideReason;
      if (!reason || !String(reason).trim()) throw new ValidationError("Override reason is required to change the gold cost");
      if (!overrideAudited.has(itemIndex)) {
        overrideAudited.add(itemIndex);
        await auditService.record(req.companyId, {
          action: "gold_cost.override",
          description: `Gold cost override on PO ${purchaseOrderId} item ${itemIndex + 1}`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: branch.name,
          branch: branch.name,
          sourceDocument: purchaseOrderId,
          severity: "warning",
          before: JSON.stringify({ computedGoldCost: builtSnap.computedGoldCost, finalBefore: builtSnap.finalPurchaseCost }),
          after: JSON.stringify({ finalPurchaseCost: cls.value, reason: String(reason).trim() }),
        }, { transaction: t });
      }
      return goldCostService.applyOverride(builtSnap, { value: cls.value, isOverride: true, reason: String(reason).trim(), by: req.user ? req.user.id : "System" });
    };

    // Phase 15G — non-recoverable VAT capitalisation (forward-only). When VAT is
    // non-recoverable & exclusive, the legacy unit cost is net while GL inventory
    // is gross — so we add the allocated VAT into the BOOK cost (Asset.cost /
    // Product.averageCost input / StockMovement cost) to reconcile with GL.
    // Inclusive VAT is already gross in the entered cost (no change). Recoverable
    // / RCM / no-VAT keep the legacy cost. computedGoldCost stays reference-only.
    const capitalizeNrVat = vatRequested && !isRcmSnap && isRecoverableSnap === false
      && !taxIncludedSnap && Number(inputVatSnap) > 0 && settings.nonRecoverableVatCapitalization !== false;
    const nrVatPerLine = capitalizeNrVat
      ? goldCostService.allocateNonRecoverableVat({ lineNetCosts: normalizedItems.map((it) => it.totalCost), inputVatAmount: inputVatSnap })
      : normalizedItems.map(() => 0);

    for (let itemIndex = 0; itemIndex < normalizedItems.length; itemIndex++) {
      const item = normalizedItems[itemIndex];
      // Phase 15G — capitalised cost (= legacy + allocated non-recoverable VAT;
      // equals legacy when capitalisation does not apply).
      const allocVatLine = nrVatPerLine[itemIndex] || 0;
      const allocVatPerUnit = item.quantity > 0 ? allocVatLine / item.quantity : 0;
      const capUnitCost = goldCostService.round4(item.unitCost + allocVatPerUnit);
      const capLineCost = goldCostService.round4(item.totalCost + allocVatLine);
      // Per-unit gold weight by the configured basis (net default).
      const perUnitGoldWeight = goldWeightBasis === "gross"
        ? (Number(item.weightPerUnit ?? item.netWeight) || 0)
        : (Number(item.goldWeight ?? item.netWeight ?? item.weightPerUnit) || 0);
      const itemKarat = item.karat == null || item.karat === "" ? null : item.karat;
      const itemPerGram = await perGramFor(itemKarat);
      if (item.productCode) {
        hasProducts = true;
        const productCode = String(item.productCode).trim();
        let product = await models.Product.findOne({
          where: { companyId: req.companyId, productCode },
          lock: true,
          transaction: t
        });

        const currentQty = product ? Number(product.quantityOnHand) : 0;
        const currentAvgCost = product ? Number(product.averageCost) : 0;
        const newQty = currentQty + item.quantity;
        // Phase 15G — weighted-average input uses the capitalised unit cost
        // (= legacy unit cost unless non-recoverable VAT capitalisation applies).
        const newAvgCost = newQty > 0 ? ((currentAvgCost * currentQty) + (capUnitCost * item.quantity)) / newQty : capUnitCost;
        const totalWeight = product ? Number(product.totalWeight) : 0;
        const newWeight = totalWeight + item.totalWeight;

        if (product) {
          await product.update({
            quantityOnHand: Number(product.quantityOnHand) + item.quantity,
            quantityAvailable: Number(product.quantityAvailable) + item.quantity,
            totalWeight: newWeight,
            averageCost: newAvgCost,
            averageUnitWeight: newQty > 0 ? (newWeight / newQty) : item.weightPerUnit,
            unitCost: capUnitCost,
            salePrice: item.price || product.salePrice
          }, { transaction: t, skipAdjustmentHook: true });
        } else {
          const productId = `PRD-ID-${Date.now()}-${itemIndex}-${Math.random().toString(36).slice(2, 6)}`;
          product = await models.Product.create({
            id: productId,
            companyId: req.companyId,
            productCode,
            productName: item.name,
            description: item.description || `Created via PO ${purchaseOrderId}`,
            karat: item.karat,
            stockType: item.type,
            branchId: branch.id,
            branchName: branch.name,
            quantityOnHand: item.quantity,
            quantityAvailable: item.quantity,
            quantitySold: 0,
            quantityReserved: 0,
            totalWeight: item.totalWeight,
            averageUnitWeight: item.weightPerUnit,
            unitCost: capUnitCost,
            averageCost: capUnitCost,
            salePrice: item.price,
            isActive: true
          }, { transaction: t });
        }

        // Create Stock Movement
        await models.StockMovement.create({
          id: `SM-${Date.now()}-${itemIndex}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          productId: product.id,
          productCode: product.productCode,
          type: "purchase_receive",
          quantityIn: item.quantity,
          quantityOut: 0,
          weightIn: item.totalWeight,
          weightOut: 0,
          // Phase 15G — capitalised cost (legacy unless non-recoverable VAT).
          unitCost: capUnitCost,
          totalCost: capLineCost,
          referenceType: "PurchaseOrder",
          referenceId: purchaseOrderId,
          supplierId,
          branchId: branch.id,
          createdBy: actor
        }, { transaction: t });

        // Create PurchaseOrderItem — link to the PRODUCT (not assets). Putting a
        // product id into asset_id violated purchase_order_items_asset_id_fkey.
        const poItem = await models.PurchaseOrderItem.create({
          id: `POI-${Date.now()}-${itemIndex + 1}-1`,
          purchaseOrderId,
          assetId: null,
          productId: product.id,
          description: item.name,
          quantity: item.quantity,
          unit: item.unit || "قطعة",
          unitPrice: item.unitCost,
          total: item.totalCost,
          receivedQuantity: item.quantity,
          // Phase 15E snapshot + 15F governed override + 15G capitalised book cost
          // (legacy unitPrice/total unchanged; finalPurchaseCost = capitalised).
          ...(await governSnapshot(goldCostService.buildGoldCostSnapshot({
            goldCostSource, weight: perUnitGoldWeight * item.quantity, karat: itemKarat,
            perGram: itemPerGram, currentCost: capLineCost,
          }), item, itemIndex))
        }, { transaction: t });

        createdAssets.push(product.toJSON());
        createdItems.push(poItem.toJSON());
      } else {
        // Phase 15F — one governed snapshot per item (item.cost === item.unitCost
        // for the asset path, so it applies to both the Asset and its poItem).
        // Phase 15G — currentCost = capitalised per-piece cost (legacy unless
        // non-recoverable VAT capitalisation applies).
        const assetSnap = await governSnapshot(goldCostService.buildGoldCostSnapshot({
          goldCostSource, weight: perUnitGoldWeight, karat: itemKarat,
          perGram: itemPerGram, currentCost: capUnitCost,
        }), item, itemIndex);
        for (let qtyIndex = 0; qtyIndex < item.quantity; qtyIndex++) {
          const sequence = item.quantity > 1 ? `-${qtyIndex + 1}` : "";
          const assetId = item.quantity === 1 && item.assetId
            ? item.assetId
            : `AST-PUR-${Date.now()}-${itemIndex + 1}-${qtyIndex + 1}-${Math.random().toString(36).slice(2, 6)}`;
          const barcodeIdentity = await barcodeIdentityService.generateBarcodeForAsset({
            companyId: req.companyId,
            assetType: item.type,
            inventoryCode: item.inventoryCode,
            itemCode: item.itemCode,
            karat: item.karat,
            inventorySubtype: item.inventorySubtype,
            transaction: t,
          });
          const asset = await models.Asset.create({
            id: assetId,
            companyId: req.companyId,
            name: item.quantity > 1 ? `${item.name} ${qtyIndex + 1}` : item.name,
            type: item.type,
            category: item.category,
            karat: item.karat || null,
            purity: item.purity || null,
            grossWeight: item.weightPerUnit,
            netWeight: item.netWeight,
            goldWeight: item.goldWeight || item.netWeight,
            price: item.price,
            // Phase 15G — capitalised book cost (legacy unless non-recoverable VAT).
            cost: capUnitCost,
            branch: branch.name,
            branchId: branch.id,
            location: item.location,
            status: "available",
            ...barcodeIdentity,
            inventorySubtype: item.inventorySubtype || null,
            metadataSchemaVersion: item.metadataSchemaVersion || 1,
            metadata: item.metadata || {},
            source: "supplier_purchase",
            notes: [item.notes, body.notes, `Supplier: ${supplier.name}`, `Purchase: ${purchaseOrderId}`, drcNote].filter(Boolean).join(" | "),
            // Phase 15E snapshot + Phase 15F governed override (legacy Asset.cost
            // unchanged).
            ...assetSnap
          }, { transaction: t });
          createdAssets.push(asset.toJSON());

          await models.AssetEvent.create({
            id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            assetId,
            action: "PURCHASE_RECEIVED",
            date: dateStr,
            user: actor,
            branch: branch.name,
            note: `تم استلام الأصل من المورد ${supplier.name} بموجب أمر الشراء ${purchaseOrderId}`,
            sourceDocument: purchaseOrderId,
            severity: "info"
          }, { transaction: t });

          const poItem = await models.PurchaseOrderItem.create({
            id: `POI-${Date.now()}-${itemIndex + 1}-${qtyIndex + 1}`,
            purchaseOrderId,
            assetId, // a real assets.id created just above
            productId: null,
            description: item.name,
            quantity: 1,
            unit: item.unit || "قطعة",
            unitPrice: item.unitCost,
            total: item.unitCost,
            receivedQuantity: 1,
            // Phase 15E snapshot + Phase 15F governed override (same governed
            // snapshot as the asset; item.cost === item.unitCost here).
            ...assetSnap
          }, { transaction: t });
          createdItems.push(poItem.toJSON());
        }
      }
    }

    // Phase 10M: Supplier.due is FROZEN. It is no longer incremented on receive —
    // it was an unreliable running figure (increment-only, never reduced). The
    // supplier sub-ledger statement (received POs minus supplier_purchase
    // payments) is now the source of truth for the payable balance, so we leave
    // `due` untouched here as a legacy/reference field. `remainingAmount` and the
    // accounting posting below are unchanged.
    await supplier.update({ lastOrder: dateStr }, { transaction: t });

    const journalEntry = await postingService.postPurchaseEntry(
      purchaseOrder.toJSON(),
      paidAmount,
      paymentMethod,
      actor,
      // Pass the normalized items (karat + totalCost) so the inventory debit can
      // split by karat when accountingByKarat is on (no-op when off). Phase 12I:
      // pass the settings account codes so Input VAT / RCM post to the configured
      // accounts (defaults 1400/2210 when settings are absent).
      {
        transaction: t,
        branchId: branch.id,
        items: normalizedItems,
        inputVatAccountCode: settings.inputVatAccountCode,
        rcmOutputAccountCode: settings.rcmOutputAccountCode,
      }
    );

    let treasuryTransaction = null;
    if (paidAmount > 0) {
      const account = String(paymentMethod).toLowerCase().includes("card") ||
        String(paymentMethod).toLowerCase().includes("bank") ||
        String(paymentMethod).toLowerCase().includes("transfer") ||
        String(paymentMethod).toLowerCase().includes("تحويل")
        ? "bank"
        : "cash";
      const tx = await models.CashTransaction.create({
        id: `TX-PO-${Date.now()}`,
        companyId: req.companyId,
        type: "cash_out",
        account,
        amount: paidAmount,
        category: "supplier_purchase",
        counterAccountCode: "1200",
        description: `دفع للمورد ${supplier.name} عن أمر الشراء ${purchaseOrderId}`,
        reference: purchaseOrderId,
        branch: branch.name,
        branchId: branch.id,
        date: dateStr,
        createdBy: actor,
        status: "posted",
        journalEntryId: journalEntry.id
      }, { transaction: t });
      treasuryTransaction = tx.toJSON();
    }

    await auditService.record(req.companyId, {
      action: "purchase.receive",
      description: `Received purchase order ${purchaseOrderId} from supplier ${supplier.name}`,
      user: actor,
      userId: req.user?.id,
      place: branch.name,
      branch: branch.name,
      sourceDocument: purchaseOrderId,
      severity: "info",
      after: JSON.stringify({
        purchaseOrderId,
        assetIds: createdAssets.map((asset) => asset.id),
        total,
        paidAmount,
        remainingAmount,
        paymentStatus,
        totalWeight,
        isDRC: Boolean(body.isDRC || body.reverseVat || body.useReverseCharge),
        // Phase 12I — tax snapshot persisted on the PO (source of truth).
        tax: { taxBase: taxBaseSnap, vatRate: vatRateSnap, inputVatAmount: inputVatSnap, taxIncluded: taxIncludedSnap, isRecoverable: isRecoverableSnap, isRcm: isRcmSnap, rcmVatAmount: rcmVatSnap, rcmRate: rcmRateSnap }
      })
    }, { transaction: t });

    const notification = await notificationService.createNotification(req.companyId, {
      title: "Supplier purchase received",
      message: `Purchase order ${purchaseOrderId} was received from ${supplier.name}.`,
      type: "success",
      entityType: "PurchaseOrder",
      entityId: purchaseOrderId
    }, { transaction: t });

    const updatedSupplier = await models.Supplier.findByPk(supplier.id, { transaction: t });

    // Build the success response up front and persist it for idempotent replay
    // BEFORE commit (same transaction as the claimed idempotency row).
    const output = {
      purchaseOrder: {
        ...purchaseOrder.toJSON(),
        items: createdItems,
        totalWeight,
        paidAmount,
        remainingAmount,
        paymentStatus
      },
      supplier: updatedSupplier?.toJSON(),
      assets: createdAssets,
      journalEntry,
      treasuryTransaction,
      notification: notification.toJSON()
    };
    const idemResponseBody = { success: true, ...output, data: output };
    await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });

    await t.commit();

    emitEntityChanged(req.companyId, {
      entity: "PurchaseOrder",
      action: "receive",
      id: purchaseOrderId,
      branchId: branch.id,
      related: {
        supplierId: supplier.id,
        purchaseOrderId,
        assetIds: hasProducts ? [] : createdAssets.map((asset) => asset.id),
        productIds: hasProducts ? createdAssets.map((asset) => asset.id) : [],
        warehouseId: body.warehouseId || null
      }
    });
    emitEntityChanged(req.companyId, {
      entity: "Supplier",
      action: "update",
      id: supplier.id,
      branchId: branch.id,
      related: { supplierId: supplier.id, purchaseOrderId }
    });
    if (hasProducts) {
      emitEntityChanged(req.companyId, {
        entity: "Product",
        action: "create",
        id: createdAssets[0]?.id || null,
        branchId: branch.id,
        related: {
          supplierId: supplier.id,
          purchaseOrderId,
          productIds: createdAssets.map((asset) => asset.id)
        }
      });
      emitEntityChanged(req.companyId, {
        entity: "StockMovement",
        action: "create",
        id: purchaseOrderId,
        branchId: branch.id,
        related: { supplierId: supplier.id, purchaseOrderId }
      });
    } else {
      emitEntityChanged(req.companyId, {
        entity: "Asset",
        action: "create",
        id: createdAssets[0]?.id || null,
        branchId: branch.id,
        related: {
          supplierId: supplier.id,
          purchaseOrderId,
          assetIds: createdAssets.map((asset) => asset.id)
        }
      });
    }
    emitEntityChanged(req.companyId, {
      entity: "Accounting",
      action: "create",
      id: journalEntry.id,
      branchId: branch.id,
      related: { supplierId: supplier.id, purchaseOrderId }
    });
    if (treasuryTransaction) {
      emitEntityChanged(req.companyId, {
        entity: "Treasury",
        action: "create",
        id: treasuryTransaction.id,
        branchId: branch.id,
        related: { supplierId: supplier.id, purchaseOrderId }
      });
    }
    emitEntityChanged(req.companyId, {
      entity: "Notification",
      action: "create",
      id: notification.id,
      related: { supplierId: supplier.id, purchaseOrderId }
    });
    emitEntityChanged(req.companyId, {
      entity: "AuditLog",
      action: "create",
      id: purchaseOrderId,
      related: { supplierId: supplier.id, purchaseOrderId }
    });

    return res.status(201).json(idemResponseBody);
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIER PURCHASE PAYMENT (سداد مورد ضد أمر شراء) — Phase 10J.
// Pay a received purchase order: records a cash_out CashTransaction
// (category "supplier_purchase", reference = PO id, counterAccountCode "2100")
// and posts the journal Dr Accounts Payable (2100) / Cr Cash|Bank via the
// posting engine — all in ONE transaction with a full rollback on any error.
// paidSoFar is computed from existing supplier_purchase cash-outs for the PO to
// block overpayment; Idempotency-Key blocks double payment. Supplier.due is
// NEVER touched (it stays reference-only; the supplier statement / closing
// balance is the source of truth and picks up this payment automatically).
// ─────────────────────────────────────────────────────────────────────────────
router.post("/purchase-orders/:id/pay", authMiddleware, requireBusinessPermission("treasury.update", { touch: true }), async (req, res, next) => {
  const b = req.body || {};
  const idempotencyKey = req.headers["idempotency-key"] || b.idempotencyKey;
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    return next(new ValidationError("Idempotency-Key header is required for supplier payments."));
  }

  // Phase 21.4 — central race-safe idempotency (unique company_id+scope+key),
  // replacing the CashTransaction lookup/sameOperation check. The PO id is folded
  // into the request hash so one key cannot pay a different purchase order.
  const idemScope = "purchase.payment";
  const idemRequestHash = idempotencyService.hashRequest(idemScope, b, req.params);

  const t = await models.sequelize.transaction();
  try {
    // Claim the idempotency key FIRST inside the write transaction; a concurrent
    // duplicate fails the unique insert → rollback and replay/conflict.
    const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
    if (!idemClaim.claimed) {
      try { await t.rollback(); } catch (_) { /* aborted by the unique violation */ }
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const idemRequest = idemClaim.request;

    // 1. Lock the PO row inside the transaction (serializes concurrent payments).
    const po = await models.PurchaseOrder.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!po) throw new NotFoundError("Purchase order not found.");

    // 2. Eligibility — only a fully received, non-consignment PO can be paid.
    if (po.status !== "received") {
      throw new ValidationError(`Only received purchase orders can be paid; PO ${po.id} is "${po.status}".`);
    }
    if (po.isConsignment === true) {
      throw new ValidationError("Consignment purchase orders cannot be paid here.");
    }

    // 3. Amount + account validation.
    const amount = round4(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError("Payment amount must be a finite number greater than zero.");
    }
    const account = normalizeTreasuryAccount(b.account, "account");
    await assertTreasuryAccountKey(req.companyId, account, { transaction: t });
    const date = b.date && isValidYmd(String(b.date)) ? String(b.date) : new Date().toISOString().slice(0, 10);
    if (b.date && !isValidYmd(String(b.date))) {
      throw new ValidationError("Invalid 'date' (expected YYYY-MM-DD).");
    }

    // 4. paidSoFar from existing supplier-payment cash-outs for THIS PO.
    const paidAgg = await models.CashTransaction.findOne({
      attributes: [[models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("amount")), 0), "paid"]],
      where: { companyId: req.companyId, type: "cash_out", category: "supplier_purchase", reference: po.id },
      transaction: t,
      raw: true,
    });
    const paidSoFarBefore = round4(paidAgg ? paidAgg.paid : 0);
    const total = round4(po.total);
    const remainingBefore = round4(total - paidSoFarBefore);

    // 5. Overpayment / nothing-due guards.
    if (remainingBefore <= 0.01) {
      throw new ValidationError(`Purchase order ${po.id} is already fully paid (paid ${paidSoFarBefore} of ${total}).`);
    }
    if (amount > remainingBefore + 0.01) {
      throw new ValidationError(`Overpayment rejected: amount ${amount} exceeds remaining ${remainingBefore} for PO ${po.id}.`);
    }

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // 6. Create the cash-out (AP counter) and post Dr 2100 / Cr cash|bank.
    const cashTxId = `TX-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cashTx = await models.CashTransaction.create({
      id: cashTxId,
      companyId: req.companyId,
      type: "cash_out",
      account,
      amount,
      category: "supplier_purchase",
      counterAccountCode: "2100", // Accounts Payable — Dr AP / Cr cash|bank
      description: b.note ? String(b.note) : `سداد للمورّد عن أمر الشراء ${po.id}`,
      reference: po.id,
      branch: po.branch || req.branchId || "Main Branch",
      branchId: req.branchId && String(req.branchId).startsWith("BR-") ? req.branchId : null,
      date,
      createdBy: actor,
      status: "posted",
      idempotencyKey: String(idempotencyKey),
    }, { transaction: t });

    const journalEntry = await postingService.postCashEntry(cashTx.toJSON(), actor, { transaction: t });
    await cashTx.update({ journalEntryId: journalEntry.id }, { transaction: t });

    const paidSoFarAfter = round4(paidSoFarBefore + amount);
    const remainingAfter = round4(total - paidSoFarAfter);

    // 7. Audit inside the same transaction. Supplier.due is NOT modified.
    await auditService.record(req.companyId, {
      action: "supplier.payment",
      description: `Supplier payment ${amount} for PO ${po.id} (${po.supplierName || po.supplierId})`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: po.branch,
      branch: po.branch,
      sourceDocument: po.id,
      severity: "info",
      before: JSON.stringify({ purchaseOrderId: po.id, supplierId: po.supplierId, total, paidSoFarBefore, remainingBefore }),
      after: JSON.stringify({ purchaseOrderId: po.id, supplierId: po.supplierId, amount, paidSoFarAfter, remainingAfter, cashTransactionId: cashTx.id, journalEntryId: journalEntry.id }),
    }, { transaction: t });

    // Reference-only supplier due (never used for the computation, never written).
    const supplierRow = await models.Supplier.findByPk(po.supplierId, { transaction: t });

    const output = {
      purchaseOrder: { id: po.id, supplierId: po.supplierId, total },
      payment: {
        id: cashTx.id,
        amount,
        account,
        category: "supplier_purchase",
        reference: po.id,
        journalEntryId: journalEntry.id,
        idempotencyKey: String(idempotencyKey),
      },
      paidSoFarBefore,
      paidSoFarAfter,
      remainingAfter,
      supplierDueReference: supplierRow ? round4(supplierRow.due) : null,
    };
    const idemResponseBody = {
      success: true,
      data: output,
      meta: { readBySupplierStatement: true, supplierDueUpdated: false },
    };
    // Persist the success response for idempotent replay BEFORE commit.
    await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });

    await t.commit();

    emitEntityChanged(req.companyId, { entity: "Treasury", action: "create", id: cashTx.id, related: { supplierId: po.supplierId, purchaseOrderId: po.id } });
    emitEntityChanged(req.companyId, { entity: "Accounting", action: "create", id: journalEntry.id, related: { supplierId: po.supplierId, purchaseOrderId: po.id } });

    return res.status(201).json(idemResponseBody);
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── Company Settings ───────────────────────────────────────────────────────

// ─── Phase 32.1-Fix — Editable Barcode Taxonomy Settings ───────────────────

const barcodeSettingsReadGuard = requireAnyBusinessPermission(["settings.view", "inventory.view"]);
const barcodeSettingsWriteGuard = requireAnyBusinessPermission(["settings.update", "inventory.adjust"], { touch: true });
const BARCODE_CODE_MUTABLE_WHEN_USED = new Set([
  "displayName", "description", "sortOrder", "isActive", "isClientApproved", "isProvisional",
]);
const BARCODE_ASSET_TYPES = new Set(["gold-piece", "gold-weight", "diamond", "gemstone", "pearl", "watch"]);

function actorName(req) {
  return req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
}

function normalizeAllowedInventoryCodes(value) {
  if (!Array.isArray(value)) throw new ValidationError("allowedInventoryCodes must be an array.");
  return [...new Set(value.map((code) => barcodeIdentityService.validateInventoryCode(code)))];
}

async function assertInventoryCodesExist(companyId, codes, transaction) {
  if (!codes.length) return;
  const count = await models.BarcodeInventoryCode.count({ where: { companyId, code: { [Op.in]: codes } }, transaction });
  if (count !== codes.length) throw new ValidationError("One or more allowed inventory codes do not exist for this company.");
}

async function assertItemCodeExists(companyId, code, transaction) {
  if (!code) return;
  const count = await models.BarcodeItemCode.count({ where: { companyId, code }, transaction });
  if (!count) throw new ValidationError(`Default item code ${code} does not exist for this company.`);
}

async function auditBarcodeSetting(req, action, record, before, transaction) {
  await auditService.record(req.companyId, {
    action,
    description: `${record.constructor.name} ${record.code} ${before ? "updated" : "created"}`,
    user: actorName(req),
    userId: req.user?.id,
    place: req.branchId || "System Settings",
    sourceDocument: record.id,
    severity: "info",
    before: before ? JSON.stringify(before) : null,
    after: JSON.stringify(record.toJSON()),
  }, { transaction });
}

router.get("/barcode-settings", authMiddleware, barcodeSettingsReadGuard, async (req, res, next) => {
  try {
    const settings = await barcodeIdentityService.getEffectiveBarcodeSettings(req.companyId);
    const usage = await barcodeIdentityService.getCodeUsageSummary(req.companyId);
    return res.status(200).json({
      success: true,
      data: {
        inventoryCodes: settings.inventoryCodes,
        itemCodes: settings.itemCodes,
        usage,
        source: settings.source,
        policy: { format: "INVENTORY_CODE+ITEM_CODE+KT+SERIAL", serialLength: 6, separators: false },
      },
    });
  } catch (error) { next(error); }
});

router.get("/barcode-settings/usage/:code", authMiddleware, barcodeSettingsReadGuard, async (req, res, next) => {
  try {
    const requestedType = req.query.type;
    const types = requestedType === "inventory" || requestedType === "item" ? [requestedType] : ["inventory", "item"];
    const usage = {};
    for (const type of types) {
      usage[type] = await barcodeIdentityService.isCodeUsed({ companyId: req.companyId, type, code: req.params.code });
    }
    return res.status(200).json({ success: true, data: usage });
  } catch (error) { next(error); }
});

router.post("/barcode-settings/inventory-codes", authMiddleware, barcodeSettingsWriteGuard, async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const code = barcodeIdentityService.validateInventoryCode(body.code);
    const displayName = String(body.displayName || "").trim();
    if (!displayName) throw new ValidationError("displayName is required.");
    if (!BARCODE_ASSET_TYPES.has(body.assetType)) throw new ValidationError("assetType is not a supported Asset type.");
    const duplicate = await models.BarcodeInventoryCode.findOne({ where: { companyId: req.companyId, code }, transaction: t });
    if (duplicate) throw new ConflictError(`Inventory code ${code} already exists.`);
    const defaultKaratCode = body.defaultKaratCode === null || body.defaultKaratCode === "" || body.defaultKaratCode === undefined
      ? null
      : barcodeIdentityService.normalizeKaratCode(null, body.defaultKaratCode);
    const defaultItemCode = body.defaultItemCode ? barcodeIdentityService.validateItemCode(body.defaultItemCode) : null;
    await assertItemCodeExists(req.companyId, defaultItemCode, t);
    const row = await models.BarcodeInventoryCode.create({
      id: `BCI-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      companyId: req.companyId,
      code,
      displayName,
      assetType: body.assetType,
      description: body.description || null,
      isActive: body.isActive !== false,
      isClientApproved: body.isClientApproved === true,
      isProvisional: body.isProvisional === true,
      requiresKarat: body.requiresKarat !== false,
      defaultKaratCode,
      defaultItemCode,
      sortOrder: Number(body.sortOrder) || 0,
      createdBy: req.user?.id,
      updatedBy: req.user?.id,
    }, { transaction: t });
    await auditBarcodeSetting(req, "barcode.inventory_code.create", row, null, t);
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "BarcodeSettings", action: "create", id: row.id });
    return res.status(201).json({ success: true, data: row });
  } catch (error) { await t.rollback(); next(error); }
});

router.patch("/barcode-settings/inventory-codes/:id", authMiddleware, barcodeSettingsWriteGuard, async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const row = await models.BarcodeInventoryCode.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!row) throw new NotFoundError("Inventory barcode code not found.");
    const before = row.toJSON();
    const usage = await barcodeIdentityService.isCodeUsed({ companyId: req.companyId, type: "inventory", code: row.code, transaction: t });
    if (usage.used) {
      const forbidden = Object.keys(req.body || {}).filter((key) => !BARCODE_CODE_MUTABLE_WHEN_USED.has(key));
      if (forbidden.length) throw new ConflictError("Used codes are locked to protect historical barcodes and printed tags.");
    }
    const updates = {};
    for (const key of BARCODE_CODE_MUTABLE_WHEN_USED) if (req.body[key] !== undefined) updates[key] = req.body[key];
    if (updates.displayName !== undefined) {
      updates.displayName = String(updates.displayName).trim();
      if (!updates.displayName) throw new ValidationError("displayName is required.");
    }
    if (!usage.used) {
      if (req.body.code !== undefined) updates.code = barcodeIdentityService.validateInventoryCode(req.body.code);
      if (req.body.assetType !== undefined) {
        if (!BARCODE_ASSET_TYPES.has(req.body.assetType)) throw new ValidationError("assetType is not a supported Asset type.");
        updates.assetType = req.body.assetType;
      }
      if (req.body.requiresKarat !== undefined) updates.requiresKarat = !!req.body.requiresKarat;
      if (req.body.defaultKaratCode !== undefined) updates.defaultKaratCode = req.body.defaultKaratCode ? barcodeIdentityService.normalizeKaratCode(null, req.body.defaultKaratCode) : null;
      if (req.body.defaultItemCode !== undefined) {
        updates.defaultItemCode = req.body.defaultItemCode ? barcodeIdentityService.validateItemCode(req.body.defaultItemCode) : null;
        await assertItemCodeExists(req.companyId, updates.defaultItemCode, t);
      }
    }
    updates.updatedBy = req.user?.id;
    await row.update(updates, { transaction: t });
    await auditBarcodeSetting(req, "barcode.inventory_code.update", row, before, t);
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "BarcodeSettings", action: "update", id: row.id });
    return res.status(200).json({ success: true, data: row, usage });
  } catch (error) { await t.rollback(); next(error); }
});

router.post("/barcode-settings/item-codes", authMiddleware, barcodeSettingsWriteGuard, async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const code = barcodeIdentityService.validateItemCode(body.code);
    const displayName = String(body.displayName || "").trim();
    if (!displayName) throw new ValidationError("displayName is required.");
    const duplicate = await models.BarcodeItemCode.findOne({ where: { companyId: req.companyId, code }, transaction: t });
    if (duplicate) throw new ConflictError(`Item code ${code} already exists.`);
    const allowedInventoryCodes = normalizeAllowedInventoryCodes(body.allowedInventoryCodes || []);
    await assertInventoryCodesExist(req.companyId, allowedInventoryCodes, t);
    const row = await models.BarcodeItemCode.create({
      id: `BCM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      companyId: req.companyId,
      code,
      displayName,
      description: body.description || null,
      isActive: body.isActive !== false,
      isClientApproved: body.isClientApproved === true,
      isProvisional: body.isProvisional === true,
      allowedInventoryCodes,
      sortOrder: Number(body.sortOrder) || 0,
      createdBy: req.user?.id,
      updatedBy: req.user?.id,
    }, { transaction: t });
    await auditBarcodeSetting(req, "barcode.item_code.create", row, null, t);
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "BarcodeSettings", action: "create", id: row.id });
    return res.status(201).json({ success: true, data: row });
  } catch (error) { await t.rollback(); next(error); }
});

router.patch("/barcode-settings/item-codes/:id", authMiddleware, barcodeSettingsWriteGuard, async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const row = await models.BarcodeItemCode.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!row) throw new NotFoundError("Item barcode code not found.");
    const before = row.toJSON();
    const usage = await barcodeIdentityService.isCodeUsed({ companyId: req.companyId, type: "item", code: row.code, transaction: t });
    if (usage.used) {
      const forbidden = Object.keys(req.body || {}).filter((key) => !BARCODE_CODE_MUTABLE_WHEN_USED.has(key));
      if (forbidden.length) throw new ConflictError("Used codes are locked to protect historical barcodes and printed tags.");
    }
    const updates = {};
    for (const key of BARCODE_CODE_MUTABLE_WHEN_USED) if (req.body[key] !== undefined) updates[key] = req.body[key];
    if (updates.displayName !== undefined) {
      updates.displayName = String(updates.displayName).trim();
      if (!updates.displayName) throw new ValidationError("displayName is required.");
    }
    if (!usage.used) {
      if (req.body.code !== undefined) updates.code = barcodeIdentityService.validateItemCode(req.body.code);
      if (req.body.allowedInventoryCodes !== undefined) {
        updates.allowedInventoryCodes = normalizeAllowedInventoryCodes(req.body.allowedInventoryCodes);
        await assertInventoryCodesExist(req.companyId, updates.allowedInventoryCodes, t);
      }
    }
    updates.updatedBy = req.user?.id;
    await row.update(updates, { transaction: t });
    await auditBarcodeSetting(req, "barcode.item_code.update", row, before, t);
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "BarcodeSettings", action: "update", id: row.id });
    return res.status(200).json({ success: true, data: row, usage });
  } catch (error) { await t.rollback(); next(error); }
});

// ─── End Phase 32.1-Fix — Editable Barcode Taxonomy Settings ────────────────

router.get("/settings", authMiddleware, requirePermission("settings.view"), async (req, res, next) => {
  try {
    const normalized = await settingsService.getCompanySettings(req.companyId);
    return res.status(200).json({
      success: true,
      data: {
        company: normalized.company,
        settings: normalized._raw, // raw key/value map (frontend parses this)
        currency: normalized.currency,
        receipt: normalized.receipt,
        vatRate: normalized.vatRate,
        // Phase 12E foundation — purchase VAT / RCM config (read-only; no posting
        // consumes these yet).
        vatEnabled: normalized.vatEnabled,
        purchaseVatRate: normalized.purchaseVatRate,
        purchaseTaxIncludedDefault: normalized.purchaseTaxIncludedDefault,
        purchaseVatRecoverableDefault: normalized.purchaseVatRecoverableDefault,
        inputVatAccountCode: normalized.inputVatAccountCode,
        rcmOutputAccountCode: normalized.rcmOutputAccountCode,
        // Phase 15C foundation — gold cost config (read-only; no consumer yet).
        goldCostSource: normalized.goldCostSource,
        goldCostWeightBasis: normalized.goldCostWeightBasis,
        allowGoldCostOverride: normalized.allowGoldCostOverride,
        goldCostOverridePermission: normalized.goldCostOverridePermission,
        nonRecoverableVatCapitalization: normalized.nonRecoverableVatCapitalization,
        lowStockThreshold: normalized.lowStockThreshold,
        decimalPrecision: normalized.decimalPrecision,
        installment: normalized.installment,
        reservationExpiryWarningHours: normalized.reservationExpiryWarningHours
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/settings/reservation-advances-account",
  authMiddleware,
  requireAnyPermission(["settings.update", "reservations.configure_account"]),
  async (req, res, next) => {
    try {
      const [setting, childAccounts, accounts] = await Promise.all([
        models.Setting.findOne({ where: { companyId: req.companyId, key: "reservationAdvancesAccountId" } }),
        models.Account.findAll({ where: { companyId: req.companyId, parentId: { [Op.ne]: null } }, attributes: ["parentId"] }),
        models.Account.findAll({
          where: { companyId: req.companyId, type: "liability", nature: "credit", isActive: true },
          attributes: ["id", "code", "name", "nameAr"],
          order: [["code", "ASC"]]
        })
      ]);
      const parentAccountIds = new Set(childAccounts.map((account) => account.parentId).filter(Boolean));
      return res.status(200).json({
        success: true,
        data: {
          reservationAdvancesAccountId: setting ? String(setting.value || "") : "",
          accounts: accounts.filter((account) => !parentAccountIds.has(account.id))
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

const authorizeSettingsUpdate = async (req, _res, next) => {
  try {
    const canUpdateAllSettings = await permissionService.userHasPermission(req.user, "settings.update");
    if (canUpdateAllSettings) return next();

    const canConfigureReservationAccount = await permissionService.userHasPermission(req.user, "reservations.configure_account");
    const submittedKeys = Object.keys(req.body || {});
    const isReservationAccountOnly = submittedKeys.length === 1 && submittedKeys[0] === "reservationAdvancesAccountId";

    if (canConfigureReservationAccount && isReservationAccountOnly) return next();
    return next(new ForbiddenError("Reservation account permission may update only reservationAdvancesAccountId."));
  } catch (error) {
    return next(error);
  }
};

const validateReservationAdvancesAccountSetting = async (body, companyId) => {
  if (!Object.prototype.hasOwnProperty.call(body, "reservationAdvancesAccountId")) return;

  const submitted = body.reservationAdvancesAccountId;
  if (submitted === null || (typeof submitted === "string" && submitted.trim() === "")) {
    body.reservationAdvancesAccountId = "";
    return;
  }

  const invalid = () => new ValidationError(
    "The selected reservation advances account is invalid or unavailable.",
    { reservationAdvancesAccountId: ["INVALID_RESERVATION_ADVANCES_ACCOUNT"] }
  );
  if (typeof submitted !== "string") throw invalid();

  const accountId = submitted.trim();
  const account = await models.Account.findOne({ where: { id: accountId } });
  if (!account || account.companyId !== companyId || !account.isActive) throw invalid();

  const childCount = await models.Account.count({ where: { companyId, parentId: account.id } });
  if (childCount > 0 || account.type !== "liability" || account.nature !== "credit") throw invalid();

  body.reservationAdvancesAccountId = account.id;
};

router.patch("/settings", authMiddleware, authorizeSettingsUpdate, async (req, res, next) => {
  try {
    const body = req.body || {};
    await validateReservationAdvancesAccountSetting(body, req.companyId);

    // Phase 12E: validate the purchase-VAT / RCM foundation keys when present.
    // Scoped to these keys only — no general settings refactor. These are a
    // read-only foundation (no posting consumes them yet), but we still reject
    // obviously bad values so 12F can trust them.
    const isBoolVal = (v) => typeof v === "boolean";
    const isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
    const reject = (msg) => res.status(422).json({ success: false, message: msg });
    for (const k of ["vatEnabled", "purchaseTaxIncludedDefault", "purchaseVatRecoverableDefault"]) {
      if (body[k] !== undefined && !isBoolVal(body[k])) return reject(`${k} must be a boolean`);
    }
    if (body.purchaseVatRate !== undefined) {
      const n = Number(body.purchaseVatRate);
      if (body.purchaseVatRate === "" || body.purchaseVatRate === null || !Number.isFinite(n) || n < 0 || n > 100) {
        return reject("purchaseVatRate must be a finite number between 0 and 100");
      }
    }
    for (const k of ["inputVatAccountCode", "rcmOutputAccountCode"]) {
      if (body[k] !== undefined && !isNonEmptyStr(body[k])) return reject(`${k} must be a non-empty string`);
    }

    // Phase 15C: validate the gold-cost foundation keys when present (scoped;
    // read-only foundation — no calculation consumes them yet).
    if (body.goldCostSource !== undefined && !["manual", "gold_center", "hybrid"].includes(body.goldCostSource)) {
      return reject("goldCostSource must be one of: manual, gold_center, hybrid");
    }
    if (body.goldCostWeightBasis !== undefined && !["net", "gross"].includes(body.goldCostWeightBasis)) {
      return reject("goldCostWeightBasis must be one of: net, gross");
    }
    for (const k of ["allowGoldCostOverride", "nonRecoverableVatCapitalization"]) {
      if (body[k] !== undefined && !isBoolVal(body[k])) return reject(`${k} must be a boolean`);
    }
    if (body.goldCostOverridePermission !== undefined && !isNonEmptyStr(body.goldCostOverridePermission)) {
      return reject("goldCostOverridePermission must be a non-empty string");
    }

    if (body.reservationExpiryWarningHours !== undefined) {
      const n = Number(body.reservationExpiryWarningHours);
      if (body.reservationExpiryWarningHours === "" || body.reservationExpiryWarningHours === null || !Number.isInteger(n) || n <= 0 || n > 8760) {
        return reject("reservationExpiryWarningHours must be a positive integer not exceeding 8760");
      }
    }

    const companyUpdates = {};
    for (const key of ["businessName", "logo", "currency", "branchName", "taxNumber", "phone", "email", "website", "country", "city", "region", "address1", "address2", "postalCode", "commercialRegister"]) {
      if (body[key] !== undefined) companyUpdates[key] = body[key];
    }
    if (companyUpdates.currency !== undefined) {
      const { normalizeCurrencyCode } = require("../utils/currency");
      companyUpdates.currency = normalizeCurrencyCode(companyUpdates.currency);
    }
    if (Object.keys(companyUpdates).length) {
      await models.Company.update(companyUpdates, { where: { id: req.companyId } });
    }

    const settingKeys = ["language", "theme", "vatRate", "goldKaratDefaults", "goldPricingMode", "accountingByKarat", "invoicePrefix", "invoiceNumbering", "dateFormat", "decimalPrecision", "print", "notifications", "lowStockThreshold", "receipt", "allowZeroDownPayment", "paymentMethods", "installmentEnabled", "installmentDefaultFrequency", "installmentMaxCount", "installmentMinDownPaymentPercent", "barcode", "reservationAdvancesAccountId", "vatEnabled", "purchaseVatRate", "purchaseTaxIncludedDefault", "purchaseVatRecoverableDefault", "inputVatAccountCode", "rcmOutputAccountCode", "goldCostSource", "goldCostWeightBasis", "allowGoldCostOverride", "goldCostOverridePermission", "nonRecoverableVatCapitalization", "reservationExpiryWarningHours"];
    for (const key of settingKeys) {
      if (body[key] === undefined) continue;
      const [row, created] = await models.Setting.findOrCreate({
        where: { companyId: req.companyId, key },
        defaults: { companyId: req.companyId, key, value: body[key] }
      });
      if (!created) await row.update({ value: body[key] });
    }

    await auditService.record(req.companyId, {
      action: "settings.update",
      description: "Settings updated",
      user: `${req.user.firstName} ${req.user.lastName}`,
      userId: req.user.id,
      place: req.branchId || "System",
      sourceDocument: "settings",
      severity: "info",
      before: null,
      after: JSON.stringify(body)
    });

    emitEntityChanged(req.companyId, { entity: "Settings", action: "update", id: "settings" });
    return res.status(200).json({ success: true, data: { message: "Settings updated." } });
  } catch (error) {
    next(error);
  }
});

// ─── Notifications ──────────────────────────────────────────────────────────

router.get("/notifications", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    const notifications = await models.Notification.findAll({
      where: { companyId: req.companyId },
      order: [["createdAt", "DESC"]],
      limit: Math.min(Number(req.query.limit) || 30, 100)
    });
    return res.status(200).json({ success: true, items: notifications, data: notifications });
  } catch (error) {
    next(error);
  }
});

router.get("/notifications/unread-count", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    const count = await models.Notification.count({ where: { companyId: req.companyId, isRead: false } });
    return res.status(200).json({ success: true, count, data: { count } });
  } catch (error) {
    next(error);
  }
});

router.post("/notifications/:id/read", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    const notification = await models.Notification.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!notification) throw new NotFoundError("Notification not found.");
    await notification.update({ isRead: true, readAt: new Date() });
    emitEntityChanged(req.companyId, { entity: "Notification", action: "update", id: req.params.id });
    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    next(error);
  }
});

router.post("/notifications/read-all", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    await models.Notification.update({ isRead: true, readAt: new Date() }, { where: { companyId: req.companyId, isRead: false } });
    emitEntityChanged(req.companyId, { entity: "Notification", action: "update", id: "all" });
    return res.status(200).json({ success: true, data: { message: "Notifications marked as read." } });
  } catch (error) {
    next(error);
  }
});

router.delete("/notifications/:id", authMiddleware, requirePermission("notifications.view"), async (req, res, next) => {
  try {
    const notification = await models.Notification.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!notification) throw new NotFoundError("Notification not found.");
    await notification.destroy();
    emitEntityChanged(req.companyId, { entity: "Notification", action: "delete", id: req.params.id });
    return res.status(200).json({ success: true, data: { message: "Notification deleted." } });
  } catch (error) {
    next(error);
  }
});

// ─── Users / Roles / Permissions Administration ─────────────────────────────

router.get("/permissions", authMiddleware, requireAnyPermission(["roles.manage", "permissions.manage", "users.view"]), async (req, res, next) => {
  try {
    const permissions = await models.Permission.findAll({ order: [["module", "ASC"], ["action", "ASC"]] });
    return res.status(200).json({ success: true, items: permissions, data: permissions });
  } catch (error) {
    next(error);
  }
});

router.get("/roles", authMiddleware, requireAnyPermission(["roles.manage", "users.view"]), async (req, res, next) => {
  try {
    const roles = await models.Role.findAll({
      where: { companyId: req.companyId },
      include: [{ model: models.Permission, as: "permissions", through: { attributes: [] } }],
      order: [["name", "ASC"]]
    });
    return res.status(200).json({ success: true, items: roles, data: roles });
  } catch (error) {
    next(error);
  }
});

router.post("/roles", authMiddleware, requirePermission("roles.manage"), async (req, res, next) => {
  try {
    const slug = String(req.body.slug || req.body.name || "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-");
    if (!slug || !req.body.name) throw new ValidationError("Role name is required.");
    const role = await models.Role.create({
      id: `ROLE-${req.companyId}-${slug}-${Date.now()}`,
      companyId: req.companyId,
      name: String(req.body.name).trim(),
      slug,
      description: req.body.description || "",
      isSystem: false,
      isAdmin: false
    });
    emitEntityChanged(req.companyId, { entity: "Role", action: "create", id: role.id });
    return res.status(201).json({ success: true, data: role });
  } catch (error) {
    next(error);
  }
});

router.put("/roles/:id/permissions", authMiddleware, requirePermission("roles.manage"), async (req, res, next) => {
  try {
    const role = await models.Role.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!role) throw new NotFoundError("Role not found.");
    const permissionNames = Array.isArray(req.body.permissions) ? req.body.permissions : [];
    const permissions = await models.Permission.findAll({ where: { name: permissionNames } });
    await models.RolePermission.destroy({ where: { roleId: role.id } });
    await models.RolePermission.bulkCreate(permissions.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id
    })));
    emitEntityChanged(req.companyId, { entity: "Permission", action: "update", id: role.id });
    return res.status(200).json({ success: true, data: { roleId: role.id, permissions: permissions.map((p) => p.name) } });
  } catch (error) {
    next(error);
  }
});

router.get("/users", authMiddleware, requirePermission("users.view"), async (req, res, next) => {
  try {
    const users = await models.User.findAll({
      where: { companyId: req.companyId },
      attributes: { exclude: ["password"] },
      include: [{ model: models.Role, as: "roles", through: { attributes: [] }, include: [{ model: models.Permission, as: "permissions", through: { attributes: [] } }] }],
      order: [["createdAt", "DESC"]]
    });
    return res.status(200).json({ success: true, items: users, data: users });
  } catch (error) {
    next(error);
  }
});

router.post("/users", authMiddleware, requirePermission("users.create"), async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email || !req.body.password || !req.body.firstName || !req.body.lastName) {
      throw new ValidationError("firstName, lastName, email and password are required.");
    }
    const existing = await models.User.findOne({ where: { email } });
    if (existing) throw new ValidationError("Email is already registered.", { email: ["Email is already registered."] });
    const user = await models.User.create({
      id: `USR-${Date.now()}`,
      companyId: req.companyId,
      firstName: String(req.body.firstName).trim(),
      lastName: String(req.body.lastName).trim(),
      email,
      phone: req.body.phone || "",
      jobTitle: req.body.jobTitle || "",
      role: req.body.legacyRole || "sales",
      password: bcrypt.hashSync(String(req.body.password), 10)
    });
    const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];
    const roles = await models.Role.findAll({ where: { id: roleIds, companyId: req.companyId } });
    if (!roles.length) {
      const fallback = await models.Role.findOne({ where: { companyId: req.companyId, slug: user.role } });
      if (fallback) roles.push(fallback);
    }
    await models.UserRole.bulkCreate(roles.map((role) => ({ userId: user.id, roleId: role.id })));
    emitEntityChanged(req.companyId, { entity: "User", action: "create", id: user.id });
    await notificationService.createNotification(req.companyId, {
      title: "User created",
      message: `${user.firstName} ${user.lastName} was added to the system.`,
      type: "system",
      entityType: "User",
      entityId: user.id
    });
    const plain = user.toJSON();
    delete plain.password;
    return res.status(201).json({ success: true, data: { ...plain, roles } });
  } catch (error) {
    next(error);
  }
});

router.put("/users/:id", authMiddleware, requirePermission("users.update"), async (req, res, next) => {
  try {
    const user = await models.User.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!user) throw new NotFoundError("User not found.");
    const updates = {};
    for (const key of ["firstName", "lastName", "phone", "jobTitle", "role"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.email) updates.email = String(req.body.email).trim().toLowerCase();
    if (req.body.password) updates.password = bcrypt.hashSync(String(req.body.password), 10);
    await user.update(updates);
    if (Array.isArray(req.body.roleIds)) {
      const roles = await models.Role.findAll({ where: { id: req.body.roleIds, companyId: req.companyId } });
      await models.UserRole.destroy({ where: { userId: user.id } });
      await models.UserRole.bulkCreate(roles.map((role) => ({ userId: user.id, roleId: role.id })));
    }
    emitEntityChanged(req.companyId, { entity: "User", action: "update", id: user.id });
    const plain = user.toJSON();
    delete plain.password;
    return res.status(200).json({ success: true, data: plain });
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", authMiddleware, requirePermission("users.delete"), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw new ValidationError("You cannot delete your own account.");
    const user = await models.User.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!user) throw new NotFoundError("User not found.");
    await user.destroy();
    emitEntityChanged(req.companyId, { entity: "User", action: "delete", id: req.params.id });
    return res.status(200).json({ success: true, data: { message: "User deleted." } });
  } catch (error) {
    next(error);
  }
});

// Customer Invoices
router.get("/customers/:id/invoices", authMiddleware, async (req, res, next) => {
  try {
    const customerId = req.params.id;
    const customer = await models.Customer.findOne({ where: { id: customerId, companyId: req.companyId } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "العميل غير موجود" });
    }

    const invoices = await models.Invoice.findAll({
      where: postedInvoiceWhere({ customerId, companyId: req.companyId }),
      include: [
        { model: models.InvoiceItem, as: "items" },
        { model: models.Payment, as: "payments" },
        { model: models.Installment, as: "installments" }
      ],
      order: [["date", "DESC"], ["createdAt", "DESC"]]
    });

    return res.status(200).json({
      success: true,
      items: invoices,
      data: invoices
    });
  } catch (error) {
    next(error);
  }
});

// Customer Statement Calculations
router.get("/customers/:id/statement", authMiddleware, async (req, res, next) => {
  try {
    const customerId = req.params.id;
    const customer = await models.Customer.findOne({ where: { id: customerId, companyId: req.companyId } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "العميل غير موجود" });
    }

    const invoices = await models.Invoice.findAll({
      where: postedInvoiceWhere({ customerId, companyId: req.companyId }),
      order: [["date", "DESC"]]
    });

    return res.status(200).json({
      success: true,
      data: {
        openingBalance: 0,
        closingBalance: parseFloat(customer.balance || 0),
        invoices: invoices.map((i) => ({
          id: i.id,
          date: i.date,
          total: parseFloat(i.total || 0),
          amount: parseFloat(i.total || 0),
          status: i.status,
          branch: i.branch,
          paymentMethod: i.paymentMethod
        })),
        receipts: [],
        vatDue: invoices.reduce((acc, curr) => acc + parseFloat(curr.tax || 0), 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER SUB-LEDGER STATEMENT (كشف حساب عميل) — Phase 10B. READ-ONLY.
// A real running-balance statement built from SOURCE DOCUMENTS, not the GL:
// JournalLine has no customerId, so a per-customer ledger cannot come from the
// GL. Sources (confirmed): posted Invoices (debit; type="return" → credit) and
// Payments (credit, linked to the customer via their posted invoices).
// Installments are intentionally EXCLUDED — their collections are stored only as
// a cumulative paidAmount (no per-collection dated record) and post GL entries
// with no customer dimension, so they cannot be turned into accurate dated
// credit rows here; a later phase will add them. customer.balance is shown for
// REFERENCE only (with a non-destructive `difference`); it is never written, and
// opening/closing are computed from a full document scan, never from a page.
// Kept as a NEW route so the legacy GET /customers/:id/statement is untouched.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/customers/:id/statement-v2", authMiddleware, requireAnyPermission(reservationPerms.statementView), async (req, res, next) => {
  try {
    // 1. Customer must exist within the tenant. Never modified.
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!customer) throw new NotFoundError("Customer not found.");

    // 2. Validate the optional date window.
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

    // 3. Pagination (rows only; capped).
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);

    // 4. Source 1 — posted invoices for this customer (full scan, not paged).
    const invoices = await models.Invoice.findAll({
      where: postedInvoiceWhere({ customerId: customer.id, companyId: req.companyId }),
      attributes: ["id", "invoiceNumber", "type", "total", "date", "createdAt"],
      raw: true,
    });

    // 5. Source 2 — payments, linked to the customer ONLY via their posted
    //    invoices (Payment carries invoiceId, not customerId).
    const invoiceIds = invoices.map((i) => i.id);
    let payments = [];
    if (invoiceIds.length) {
      payments = await models.Payment.findAll({
        where: { companyId: req.companyId, invoiceId: { [Op.in]: invoiceIds } },
        attributes: ["id", "invoiceId", "amount", "reference", "date", "createdAt"],
        raw: true,
      });
    }

    // 6. Unify into ledger rows. Customer-AR convention: a charge raises what the
    //    customer owes (debit); a receipt/return lowers it (credit).
    const rowsAll = [];
    for (const inv of invoices) {
      const amount = round4(inv.total);
      const isReturn = inv.type === "return";
      rowsAll.push({
        id: `INV-${inv.id}`,
        type: isReturn ? "return" : "invoice",
        sourceId: inv.id,
        sourceNumber: inv.invoiceNumber || inv.id,
        date: (inv.date || "").slice(0, 10),
        createdAt: inv.createdAt,
        description: isReturn ? `مرتجع ${inv.invoiceNumber || inv.id}` : `فاتورة ${inv.invoiceNumber || inv.id}`,
        debit: isReturn ? 0 : amount,
        credit: isReturn ? amount : 0,
        sortType: isReturn ? "1_return" : "0_invoice",
      });
    }
    for (const p of payments) {
      const amount = round4(p.amount);
      rowsAll.push({
        id: `PAY-${p.id}`,
        type: "payment",
        sourceId: p.id,
        sourceNumber: p.reference || p.id,
        date: (p.date || "").slice(0, 10),
        createdAt: p.createdAt,
        description: `دفعة ${p.reference || p.id}`,
        debit: 0,
        credit: amount,
        sortType: "2_payment",
      });
    }

    const reservations = await models.Reservation.findAll({
      where: { companyId: req.companyId, customerId: customer.id },
      raw: true
    });
    const reservationPayments = await models.ReservationPayment.findAll({
      where: { companyId: req.companyId, customerId: customer.id },
      attributes: ["id", "reservationId", "amount", "paymentMethod", "receiptNumber", "status", "receivedAt", "createdAt"],
      raw: true,
    });
    const reservationRefunds = await models.ReservationRefund.findAll({
      where: { companyId: req.companyId, customerId: customer.id },
      attributes: ["id", "reservationId", "amount", "status", "refundType", "requestedRefundMethod", "executedAt", "createdAt"],
      raw: true,
    });
    const renewals = await models.ReservationRenewal.findAll({
      where: { companyId: req.companyId, customerId: customer.id, status: "activated" },
      raw: true
    });

    const reservationAdvanceRows = [
      // 1. Created
      ...reservations.map((r) => ({
        id: `RES-CRE-${r.id}`,
        type: "reservation_created",
        sourceId: r.id,
        reservationId: r.id,
        sourceNumber: r.id,
        date: String(r.createdAt || "").slice(0, 10),
        description: `إنشاء حجز ${r.id} بمبلغ إجمالي ${round4(r.agreedTotal)}`,
        debit: 0,
        credit: 0,
        status: r.status,
        paymentMethod: null,
      })),

      // 2. Payments (normal)
      ...reservationPayments.filter((p) => p.paymentMethod !== "reservation_transfer" && p.status === "posted").map((p) => ({
        id: `RSP-${p.id}`,
        type: "reservation_payment",
        sourceId: p.id,
        reservationId: p.reservationId,
        sourceNumber: p.receiptNumber || p.id,
        date: String(p.receivedAt || p.createdAt || "").slice(0, 10),
        description: `دفعة حجز ${p.reservationId} (${p.paymentMethod})`,
        debit: 0,
        credit: round4(p.amount),
        status: p.status,
        paymentMethod: p.paymentMethod,
      })),

      // 3. Renewal Transfer In
      ...reservationPayments.filter((p) => p.paymentMethod === "reservation_transfer" && p.status === "posted").map((p) => ({
        id: `RSP-XIN-${p.id}`,
        type: "reservation_renewal_transfer_in",
        sourceId: p.id,
        reservationId: p.reservationId,
        sourceNumber: p.receiptNumber || p.id,
        date: String(p.receivedAt || p.createdAt || "").slice(0, 10),
        description: `تحويل دفعات تجديد حجز وارد إلى ${p.reservationId}`,
        debit: 0,
        credit: round4(p.amount),
        status: p.status,
        paymentMethod: p.paymentMethod,
      })),

      // 4. Renewal Transfer Out
      ...renewals.map((ren) => ({
        id: `RRN-OUT-${ren.id}`,
        type: "reservation_renewal_transfer_out",
        sourceId: ren.id,
        reservationId: ren.sourceReservationId,
        sourceNumber: ren.id,
        date: String(ren.activatedAt || ren.updatedAt || "").slice(0, 10),
        description: `تحويل دفعات تجديد حجز صادر من ${ren.sourceReservationId} إلى ${ren.successorReservationId}`,
        debit: round4(ren.transferAmount),
        credit: 0,
        status: ren.status,
        paymentMethod: null,
      })),

      // 5. Completion Application
      ...reservations.filter((r) => r.status === "completed" || r.finalInvoiceId).map((r) => ({
        id: `RES-COMP-${r.id}`,
        type: "reservation_completion_application",
        sourceId: r.finalInvoiceId || r.id,
        reservationId: r.id,
        sourceNumber: r.finalInvoiceId || r.id,
        date: String(r.completedAt || r.updatedAt || "").slice(0, 10),
        description: `تطبيق دفعات حجز مكتمل ${r.id} على الفاتورة ${r.finalInvoiceId || ""}`,
        debit: round4(r.paidTotal),
        credit: 0,
        status: r.status,
        paymentMethod: null,
      })),

      // 6. Normal Expiry / Cancellation Refund
      ...reservationRefunds.filter((r) => r.refundType !== "renewal_excess" && r.status === "executed").map((r) => ({
        id: `RRF-${r.id}`,
        type: "reservation_refund",
        sourceId: r.id,
        reservationId: r.reservationId,
        sourceNumber: r.id,
        date: String(r.executedAt || r.createdAt || "").slice(0, 10),
        description: `استرداد حجز ملغى ${r.reservationId}`,
        debit: round4(r.amount),
        credit: 0,
        status: r.status,
        paymentMethod: r.requestedRefundMethod,
      })),

      // 7. Renewal Excess Refund
      ...reservationRefunds.filter((r) => r.refundType === "renewal_excess" && r.status === "executed").map((r) => ({
        id: `RRF-XS-${r.id}`,
        type: "reservation_renewal_excess_refund",
        sourceId: r.id,
        reservationId: r.reservationId,
        sourceNumber: r.id,
        date: String(r.executedAt || r.createdAt || "").slice(0, 10),
        description: `استرداد فائض تجديد حجز ${r.reservationId}`,
        debit: round4(r.amount),
        credit: 0,
        status: r.status,
        paymentMethod: r.requestedRefundMethod,
      })),

      // 8. Final Status
      ...reservations.filter((r) => ["completed", "cancelled", "renewed", "expired"].includes(r.status)).map((r) => {
        const dateStr = r.completedAt || r.cancelledAt || r.renewedAt || r.expiredAt || r.updatedAt;
        let desc = `الحالة النهائية للحجز ${r.id}: `;
        if (r.status === "completed") desc += `مكتمل (فاتورة ${r.finalInvoiceId || ""})`;
        else if (r.status === "cancelled") desc += `ملغى`;
        else if (r.status === "renewed") desc += `مجدد إلى ${r.successorReservationId || ""}`;
        else if (r.status === "expired") desc += `منتهي الصلاحية`;
        return {
          id: `RES-STAT-${r.id}-${r.status}`,
          type: "reservation_final_status",
          sourceId: r.id,
          reservationId: r.id,
          sourceNumber: r.id,
          date: String(dateStr || "").slice(0, 10),
          description: desc,
          debit: 0,
          credit: 0,
          status: r.status,
          paymentMethod: null,
        };
      })
    ].filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
    const reservationAdvanceTotals = reservationAdvanceRows.reduce((acc, row) => {
      acc.received = round4(acc.received + row.credit);
      acc.refunded = round4(acc.refunded + row.debit);
      acc.net = round4(acc.received - acc.refunded);
      return acc;
    }, { received: 0, refunded: 0, net: 0 });

    // 7. Deterministic order so the running balance is stable.
    rowsAll.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ca !== cb) return ca - cb;
      if (a.sortType !== b.sortType) return a.sortType < b.sortType ? -1 : 1;
      return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
    });

    // 8. Opening = full aggregate of rows BEFORE `from` (0 when no `from`).
    //    Period = rows within [from,to]. Running computed across the WHOLE
    //    period set, then the page is sliced (page 2 continues after page 1).
    let openingBalance = 0;
    const periodRows = [];
    for (const r of rowsAll) {
      const delta = round4(r.debit - r.credit);
      if (from && r.date < from) {
        openingBalance = round4(openingBalance + delta);
        continue;
      }
      if (to && r.date > to) continue;
      periodRows.push({ ...r, delta });
    }

    let running = openingBalance;
    const withRunning = periodRows.map((r) => {
      running = round4(running + r.delta);
      return {
        id: r.id,
        type: r.type,
        sourceId: r.sourceId,
        sourceNumber: r.sourceNumber,
        date: r.date,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        delta: r.delta,
        runningBalance: running,
      };
    });

    const total = withRunning.length;
    const totalPages = Math.ceil(total / pageSize);
    const closingBalance = total ? withRunning[total - 1].runningBalance : openingBalance;
    const start = (page - 1) * pageSize;
    const items = withRunning.slice(start, start + pageSize);

    // 9. customer.balance is reference-only; difference is reported, never fixed.
    const customerBalanceReference = round4(customer.balance);
    const difference = round4(customerBalanceReference - closingBalance);

    return res.status(200).json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          code: customer.code ?? null,
          name: customer.name,
          phone: customer.phone,
          balance: customerBalanceReference,
        },
        from,
        to,
        openingBalance,
        closingBalance,
        customerBalanceReference,
        difference,
        page,
        pageSize,
        total,
        totalPages,
        items,
        reservationAdvances: {
          sectionName: "دفعات الحجوزات",
          arIntegrated: false,
          totals: reservationAdvanceTotals,
          items: reservationAdvanceRows,
          note: "Reservation advances are shown separately from Accounts Receivable until final sale completion.",
        },
        meta: { source: "source_documents", ledgerBased: false, readOnly: true, reservationAdvancesSection: true },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER CREDIT LEDGER (رصيد العميل الدائن).
// Returns the customer's available credit (SUM active credit_in − credit_out)
// plus recent/paged ledger rows from customer_credit_transactions. Manual
// deposits can create credit through POST /customers/:id/credit/deposit. This
// still never mutates Customer.balance or Invoice.remainingAmount.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/customers/:id/credit", authMiddleware, requireBusinessPermission("customers.view"), async (req, res, next) => {
  try {
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!customer) throw new NotFoundError("Customer not found.");

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);

    const summary = await customerCreditService.getCustomerCreditSummary({
      models, companyId: req.companyId, customerId: customer.id
    });
    const transactions = await customerCreditService.getCustomerCreditTransactions({
      models, companyId: req.companyId, customerId: customer.id, limit: pageSize, offset: (page - 1) * pageSize
    });

    return res.status(200).json({
      success: true,
      data: {
        customerId: customer.id,
        availableCredit: summary.availableCredit,
        totalCreditIn: summary.totalCreditIn,
        totalCreditOut: summary.totalCreditOut,
        currency: summary.currency,
        page,
        pageSize,
        transactions,
        meta: { source: "customer_credit_ledger", readOnly: true, glBridge: "deferred" },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER CREDIT / 2300 RECONCILIATION (تسوية) — Phase 30.9-Fix. READ-ONLY.
// Exposes the Phase 30.8 diagnostic against real data: recomputes statement-v2's
// document-based closing balance, reads the AR mirror (Customer.balance) and the
// customer-credit ledger (2300 cash-credit portion only), and categorizes the
// divergence. It NEVER writes and NEVER changes statement-v2 or any balance.
// Uncertain settlement (best_effort/unavailable) and legacy/unknown policy are
// flagged non-authoritative and are never auto-corrected.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/customers/:id/credit/reconciliation", authMiddleware, requireBusinessPermission("customers.view"), async (req, res, next) => {
  try {
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!customer) throw new NotFoundError("Customer not found.");

    // Source documents (READ-ONLY) — same sources statement-v2 uses, plus the
    // settlement/credit records statement-v2 ignores (for diagnosis only).
    const invoices = await models.Invoice.findAll({
      where: postedInvoiceWhere({ customerId: customer.id, companyId: req.companyId }),
      attributes: ["id", "invoiceNumber", "type", "total", "date", "idempotencyKey"],
      raw: true,
    });
    const invoiceIds = invoices.map((i) => i.id);
    const payments = invoiceIds.length
      ? await models.Payment.findAll({
          where: { companyId: req.companyId, invoiceId: { [Op.in]: invoiceIds } },
          attributes: ["id", "invoiceId", "amount", "date"],
          raw: true,
        })
      : [];
    const creditTransactions = await models.CustomerCreditTransaction.findAll({
      where: { companyId: req.companyId, customerId: customer.id },
      attributes: ["id", "direction", "amount", "status", "sourceType", "sourceId", "journalEntryId", "invoiceId"],
      raw: true,
    });

    const companySettings = await settingsService.getCompanySettings(req.companyId);
    const currency = companySettings.currency || "AED";

    // Per-exchange settlement meta (READ-ONLY; mirrors the exchange-display gather).
    const exchangeMeta = {};
    for (const inv of invoices) {
      if (inv.type !== "exchange") continue;
      const idempotencyRequest = inv.idempotencyKey
        ? await models.IdempotencyRequest.findOne({
            where: { companyId: req.companyId, scope: "sales.exchange", key: inv.idempotencyKey, status: "succeeded" },
            attributes: ["id", "companyId", "scope", "key", "status", "responseBody"],
          })
        : null;
      const savedPolicy = exchangeDisplayService.extractSavedExchangePolicy(idempotencyRequest, inv.id);
      if (!savedPolicy) {
        // No trusted saved policy → historical/unknown; never auto-corrected.
        exchangeMeta[inv.id] = { policyStatus: "legacy_or_unknown", settlementSource: "unavailable" };
        continue;
      }
      const journalEntry = await models.JournalEntry.findOne({
        where: { companyId: req.companyId, sourceType: "exchange", sourceId: inv.id, status: "posted" },
        attributes: ["id"],
      });
      const cashOut = journalEntry
        ? await models.CashTransaction.findAll({
            where: { companyId: req.companyId, journalEntryId: journalEntry.id, reference: inv.id, type: "cash_out", status: "posted" },
            attributes: ["id", "amount"],
          })
        : [];
      const cashIn = journalEntry
        ? await models.CashTransaction.findAll({
            where: { companyId: req.companyId, journalEntryId: journalEntry.id, reference: inv.id, type: "cash_in", status: "posted" },
            attributes: ["id", "amount"],
          })
        : [];
      const creditTx = journalEntry
        ? await models.CustomerCreditTransaction.findAll({
            where: { companyId: req.companyId, sourceType: "exchange_credit", sourceId: inv.id, journalEntryId: journalEntry.id, status: "active" },
            attributes: ["id", "direction", "amount"],
          })
        : [];
      const settlementSummary = exchangeDisplayService.buildSettlementSummary({
        expectedExcess: savedPolicy.excessDueToCustomer,
        cashTransactions: cashOut,
        creditTransactions: creditTx,
        journalEntry,
      });
      const amountDue = Number(savedPolicy.amountDueFromCustomer || 0);
      exchangeMeta[inv.id] = {
        policyStatus: "target_policy",
        settlementSource: settlementSummary.source,
        // paid_now only when a real cash_in for this exchange exists; else on-account.
        settlementMode: amountDue > 0 ? (cashIn.length > 0 ? "paid_now" : "credit") : undefined,
        amountDueFromCustomer: amountDue,
        excessDueToCustomer: Number(savedPolicy.excessDueToCustomer || 0),
        creditAmount: Number(settlementSummary.creditAmount || 0),
      };
    }

    // Per-return meta: the cash-refunded excess = cash_out referencing the return
    // (Phase 21.2 refunds only the portion beyond the outstanding AR relief).
    const returnMeta = {};
    for (const inv of invoices) {
      if (inv.type !== "return") continue;
      const refunds = await models.CashTransaction.findAll({
        where: { companyId: req.companyId, reference: inv.id, type: "cash_out", status: "posted" },
        attributes: ["amount"],
      });
      const cashRefundExcess = refunds.reduce((s, r) => s + Number(r.amount || 0), 0);
      if (cashRefundExcess > 0) returnMeta[inv.id] = { cashRefundExcess };
    }

    const report = statementReconciliationService.reconcileCustomer({
      customerId: customer.id,
      invoices,
      payments,
      creditTransactions,
      customerBalance: Number(customer.balance || 0),
      exchangeMeta,
      returnMeta,
    });
    report.currency = currency;

    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-AWARE CUSTOMER STATEMENT V3 — Phase 30.11-Fix. READ-ONLY.
// Exposes the opt-in source-aware customer statement model (dual-ledger).
// Never mutates and never changes statement-v2 or any balances.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/customers/:id/statement-v3", authMiddleware, requireBusinessPermission("customers.view"), async (req, res, next) => {
  try {
    const customer = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!customer) throw new NotFoundError("Customer not found.");

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

    const invoices = await models.Invoice.findAll({
      where: postedInvoiceWhere({ customerId: customer.id, companyId: req.companyId }),
      attributes: ["id", "invoiceNumber", "type", "total", "date", "createdAt", "idempotencyKey"],
      raw: true,
    });
    const invoiceIds = invoices.map((i) => i.id);
    const payments = invoiceIds.length
      ? await models.Payment.findAll({
          where: { companyId: req.companyId, invoiceId: { [Op.in]: invoiceIds } },
          attributes: ["id", "invoiceId", "amount", "reference", "date", "createdAt"],
          raw: true,
        })
      : [];
    const creditTransactions = await models.CustomerCreditTransaction.findAll({
      where: { companyId: req.companyId, customerId: customer.id },
      attributes: ["id", "direction", "amount", "status", "sourceType", "sourceId", "journalEntryId", "invoiceId", "createdAt", "description"],
      raw: true,
    });
    const cashTransactions = invoiceIds.length
      ? await models.CashTransaction.findAll({
          where: { companyId: req.companyId, status: "posted", reference: { [Op.in]: invoiceIds } },
          attributes: ["id", "amount", "type", "reference", "date", "createdAt"],
          raw: true,
        })
      : [];

    const companySettings = await settingsService.getCompanySettings(req.companyId);
    const currency = companySettings.currency || "AED";

    // Gather exchange metadata (identical to reconciliation endpoint)
    const exchangeMeta = {};
    for (const inv of invoices) {
      if (inv.type !== "exchange") continue;
      const idempotencyRequest = inv.idempotencyKey
        ? await models.IdempotencyRequest.findOne({
            where: { companyId: req.companyId, scope: "sales.exchange", key: inv.idempotencyKey, status: "succeeded" },
            attributes: ["id", "companyId", "scope", "key", "status", "responseBody"],
          })
        : null;
      const savedPolicy = exchangeDisplayService.extractSavedExchangePolicy(idempotencyRequest, inv.id);
      if (!savedPolicy) {
        exchangeMeta[inv.id] = { policyStatus: "legacy_or_unknown", settlementSource: "unavailable" };
        continue;
      }
      const journalEntry = await models.JournalEntry.findOne({
        where: { companyId: req.companyId, sourceType: "exchange", sourceId: inv.id, status: "posted" },
        attributes: ["id"],
      });
      const cashOut = journalEntry
        ? cashTransactions.filter(tx => tx.reference === inv.id && tx.type === "cash_out")
        : [];
      const cashIn = journalEntry
        ? cashTransactions.filter(tx => tx.reference === inv.id && tx.type === "cash_in")
        : [];
      const creditTx = journalEntry
        ? creditTransactions.filter(tx => tx.sourceId === inv.id && tx.sourceType === "exchange_credit" && tx.status === "active")
        : [];
      const settlementSummary = exchangeDisplayService.buildSettlementSummary({
        expectedExcess: savedPolicy.excessDueToCustomer,
        cashTransactions: cashOut,
        creditTransactions: creditTx,
        journalEntry,
      });
      const amountDue = Number(savedPolicy.amountDueFromCustomer || 0);
      exchangeMeta[inv.id] = {
        policyStatus: "target_policy",
        settlementSource: settlementSummary.source,
        settlementMode: amountDue > 0 ? (cashIn.length > 0 ? "paid_now" : "credit") : undefined,
        amountDueFromCustomer: amountDue,
        excessDueToCustomer: Number(savedPolicy.excessDueToCustomer || 0),
        creditAmount: Number(settlementSummary.creditAmount || 0),
      };
    }

    // Gather return metadata
    const returnMeta = {};
    for (const inv of invoices) {
      if (inv.type !== "return") continue;
      const refunds = cashTransactions.filter(tx => tx.reference === inv.id && tx.type === "cash_out");
      const cashRefundExcess = refunds.reduce((s, r) => s + Number(r.amount || 0), 0);
      if (cashRefundExcess > 0) returnMeta[inv.id] = { cashRefundExcess };
    }

    // Calculate legacyStatementV2ClosingBalance
    let legacyClosing = 0;
    for (const inv of invoices) {
      const amt = round4(inv.total);
      if (from && inv.date < from) {
        if (inv.type === "return") legacyClosing -= amt;
        else legacyClosing += amt;
        continue;
      }
      if (to && inv.date > to) continue;
      if (inv.type === "return") legacyClosing -= amt;
      else legacyClosing += amt;
    }
    for (const p of payments) {
      const amt = round4(p.amount);
      if (from && p.date < from) {
        legacyClosing -= amt;
        continue;
      }
      if (to && p.date > to) continue;
      legacyClosing -= amt;
    }
    legacyClosing = round4(legacyClosing);

    const report = sourceAwareStatementService.buildSourceAwareStatement({
      customerId: customer.id,
      customerName: customer.name,
      currency,
      from,
      to,
      invoices,
      payments,
      cashTransactions,
      creditTransactions,
      customerBalance: Number(customer.balance || 0),
      exchangeMeta,
      returnMeta,
      legacyStatementV2ClosingBalance: legacyClosing,
    });

    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
});

function normalizeCustomerDepositPayload(req, defaultCurrency = "AED") {
  const body = req.body || {};
  const amount = Math.round(Number(body.amount) * 10000) / 10000;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("مبلغ الإيداع يجب أن يكون أكبر من صفر");
  }

  const paymentMethod = String(body.paymentMethod || "cash").trim().toLowerCase();
  if (!["cash", "bank"].includes(paymentMethod)) {
    throw new ValidationError("طريقة الدفع يجب أن تكون cash أو bank");
  }

  const accountCode = String(body.accountCode || (paymentMethod === "bank" ? "1120" : "1110")).trim();
  if (!["1110", "1120"].includes(accountCode)) {
    throw new ValidationError("حساب الإيداع يجب أن يكون 1110 للنقد أو 1120 للبنك");
  }
  if (paymentMethod === "cash" && accountCode !== "1110") {
    throw new ValidationError("الإيداع النقدي يجب أن يستخدم الحساب 1110");
  }
  if (paymentMethod === "bank" && accountCode !== "1120") {
    throw new ValidationError("الإيداع البنكي يجب أن يستخدم الحساب 1120");
  }

  const currency = String(body.currency || defaultCurrency || "AED").trim().toUpperCase().slice(0, 8) || "AED";
  const date = body.date ? String(body.date).trim() : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new ValidationError("تاريخ الإيداع يجب أن يكون بصيغة YYYY-MM-DD");
  }

  const description = String(body.description || "Customer deposit").trim().slice(0, 255);
  const reference = body.reference == null ? null : String(body.reference).trim().slice(0, 120) || null;
  const branchCandidate = body.branchId || req.headers["x-branch-id"] || req.branchId;
  const branchId = typeof branchCandidate === "string" && branchCandidate.startsWith("BR-") ? branchCandidate : null;

  return {
    amount,
    currency,
    paymentMethod,
    accountCode,
    branchId,
    date,
    description,
    reference,
  };
}

function normalizeCustomerRefundPayload(req, defaultCurrency = "AED") {
  const body = req.body || {};
  const amount = Math.round(Number(body.amount) * 10000) / 10000;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("مبلغ رد الرصيد يجب أن يكون أكبر من صفر");
  }

  const paymentMethod = String(body.paymentMethod || "cash").trim().toLowerCase();
  if (!["cash", "bank"].includes(paymentMethod)) {
    throw new ValidationError("طريقة رد الرصيد يجب أن تكون cash أو bank");
  }

  const accountCode = String(body.accountCode || (paymentMethod === "bank" ? "1120" : "1110")).trim();
  if (!["1110", "1120"].includes(accountCode)) {
    throw new ValidationError("حساب رد الرصيد يجب أن يكون 1110 للنقد أو 1120 للبنك");
  }
  if (paymentMethod === "cash" && accountCode !== "1110") {
    throw new ValidationError("رد الرصيد النقدي يجب أن يستخدم الحساب 1110");
  }
  if (paymentMethod === "bank" && accountCode !== "1120") {
    throw new ValidationError("رد الرصيد البنكي يجب أن يستخدم الحساب 1120");
  }

  const currency = String(body.currency || defaultCurrency || "AED").trim().toUpperCase().slice(0, 8) || "AED";
  const date = body.date ? String(body.date).trim() : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new ValidationError("تاريخ رد الرصيد يجب أن يكون بصيغة YYYY-MM-DD");
  }

  const description = String(body.description || "Customer credit refund").trim().slice(0, 255);
  const reference = body.reference == null ? null : String(body.reference).trim().slice(0, 120) || null;
  const branchCandidate = body.branchId || req.headers["x-branch-id"] || req.branchId;
  const branchId = typeof branchCandidate === "string" && branchCandidate.startsWith("BR-") ? branchCandidate : null;

  return {
    amount,
    currency,
    paymentMethod,
    accountCode,
    branchId,
    date,
    description,
    reference,
  };
}

function normalizeCustomerCreditApplyPayload(req, defaultCurrency = "AED") {
  const body = req.body || {};
  const amount = Math.round(Number(body.amount) * 10000) / 10000;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("مبلغ تطبيق الرصيد يجب أن يكون أكبر من صفر");
  }

  const currency = String(body.currency || defaultCurrency || "AED").trim().toUpperCase().slice(0, 8) || "AED";
  const date = body.date ? String(body.date).trim() : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new ValidationError("تاريخ تطبيق الرصيد يجب أن يكون بصيغة YYYY-MM-DD");
  }

  const description = String(body.description || "Apply customer credit to invoice").trim().slice(0, 255);
  const reference = body.reference == null ? null : String(body.reference).trim().slice(0, 120) || null;

  return {
    amount,
    currency,
    date,
    description,
    reference,
  };
}

router.post("/customers/:id/credit/deposit", authMiddleware, requireBusinessPermission("treasury.update", { touch: true }), async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const payload = normalizeCustomerDepositPayload(req, settings.currency || "AED");
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لإيداع رصيد دائن للعميل" });
    }

    const idemScope = "customer.credit_deposit";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, {
      customerId: req.params.id,
      companyId: req.companyId,
      ...payload,
    }, req.params);

    const actorName = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const actorId = req.user ? req.user.id : "System";
    let idemResponseBody = null;

    try {
      await models.sequelize.transaction(async (t) => {
        const idemClaim = await idempotencyService.claim({
          models,
          companyId: req.companyId,
          scope: idemScope,
          key: idempotencyKey,
          requestHash: idemRequestHash,
          transaction: t,
        });
        if (!idemClaim.claimed) {
          const dup = new Error("__IDEM_DUPLICATE__");
          dup.__idemDuplicate = true;
          throw dup;
        }
        const idemRequest = idemClaim.request;

        const customer = await models.Customer.findOne({
          where: { id: req.params.id, companyId: req.companyId },
          transaction: t,
          lock: { level: t.LOCK.UPDATE, of: models.Customer },
        });
        if (!customer) throw new NotFoundError("Customer not found.");
        if (customer.status && customer.status !== "active") {
          throw new ValidationError("لا يمكن تسجيل إيداع لعميل غير نشط");
        }

        let branch = null;
        if (payload.branchId) {
          branch = await models.Branch.findOne({
            where: { id: payload.branchId, companyId: req.companyId, isActive: true },
            transaction: t,
          });
          if (!branch) throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
        }

        const cashTransaction = await models.CashTransaction.create({
          id: `CT-CDEP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          type: "cash_in",
          account: payload.paymentMethod,
          amount: payload.amount,
          category: "customer_credit_deposit",
          counterAccountCode: "2300",
          description: payload.description,
          reference: payload.reference || customer.id,
          branch: branch ? branch.name : (payload.branchId || "Main Branch"),
          branchId: payload.branchId,
          date: payload.date,
          createdBy: actorId,
          status: "posted",
          idempotencyKey: idempotencyKey || null,
        }, { transaction: t });

        const creditRow = await customerCreditService.recordCreditIn({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          branchId: payload.branchId,
          amount: payload.amount,
          currency: payload.currency,
          sourceType: "manual_deposit",
          sourceId: cashTransaction.id,
          cashTransactionId: cashTransaction.id,
          description: payload.description,
          createdBy: actorId,
          metadata: {
            reference: payload.reference,
            paymentMethod: payload.paymentMethod,
            accountCode: payload.accountCode,
          },
          transaction: t,
          glPosting: {
            enabled: true,
            debitAccountCode: payload.accountCode,
            creditAccountCode: "2300",
            description: payload.description,
            date: payload.date,
            postedBy: actorName,
          },
        });

        await cashTransaction.update({ journalEntryId: creditRow.journalEntryId }, { transaction: t });

        const summary = await customerCreditService.getCustomerCreditSummary({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          transaction: t,
        });
        const journalEntry = creditRow.journalEntryId
          ? await models.JournalEntry.findOne({
              where: { id: creditRow.journalEntryId, companyId: req.companyId },
              transaction: t,
            })
          : null;

        await auditService.record(req.companyId, {
          action: "customer_credit_deposit_created",
          description: `Customer credit deposit ${payload.amount} ${payload.currency} for ${customer.name}`,
          user: actorName,
          userId: req.user ? req.user.id : null,
          place: branch ? branch.name : payload.branchId || null,
          branch: branch ? branch.name : payload.branchId || null,
          sourceDocument: cashTransaction.id,
          severity: "info",
          after: JSON.stringify({
            customerId: customer.id,
            amount: payload.amount,
            cashTransactionId: cashTransaction.id,
            customerCreditTransactionId: creditRow.id,
            journalEntryId: creditRow.journalEntryId,
          }),
        }, { transaction: t });

        const cashOut = cashTransaction.toJSON();
        cashOut.journalEntryId = creditRow.journalEntryId;
        idemResponseBody = {
          success: true,
          data: {
            customerCreditTransaction: creditRow.toJSON ? creditRow.toJSON() : creditRow,
            cashTransaction: cashOut,
            journalEntry: journalEntry ? journalEntry.toJSON() : (creditRow.journalEntryId ? { id: creditRow.journalEntryId } : null),
            availableCredit: summary.availableCredit,
            ledgerBased: true,
            source: "customer_credit_deposit",
            readOnly: false,
          },
        };
        await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });
      });
    } catch (txErr) {
      if (txErr && txErr.__idemDuplicate) {
        const prior = await idempotencyService.resolveExisting({
          models,
          companyId: req.companyId,
          scope: idemScope,
          key: idempotencyKey,
          requestHash: idemRequestHash,
        });
        if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
        return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
      }
      throw txErr;
    }

    emitEntityChanged(req.companyId, {
      entity: "CustomerCreditTransaction",
      action: "deposit",
      id: idemResponseBody?.data?.customerCreditTransaction?.id,
      branchId: payload.branchId,
      related: { customerId: req.params.id },
    });
    emitEntityChanged(req.companyId, {
      entity: "CashTransaction",
      action: "customer-credit-deposit",
      id: idemResponseBody?.data?.cashTransaction?.id,
      branchId: payload.branchId,
      related: { customerId: req.params.id },
    });

    return res.status(201).json(idemResponseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/customers/:id/credit/refund", authMiddleware, requireBusinessPermission("treasury.update", { touch: true }), async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const payload = normalizeCustomerRefundPayload(req, settings.currency || "AED");
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لرد الرصيد الدائن للعميل" });
    }

    const idemScope = "customer.credit_refund";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, {
      customerId: req.params.id,
      companyId: req.companyId,
      ...payload,
    }, req.params);

    const actorName = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const actorId = req.user ? req.user.id : "System";
    let idemResponseBody = null;

    try {
      await models.sequelize.transaction(async (t) => {
        const idemClaim = await idempotencyService.claim({
          models,
          companyId: req.companyId,
          scope: idemScope,
          key: idempotencyKey,
          requestHash: idemRequestHash,
          transaction: t,
        });
        if (!idemClaim.claimed) {
          const dup = new Error("__IDEM_DUPLICATE__");
          dup.__idemDuplicate = true;
          throw dup;
        }
        const idemRequest = idemClaim.request;

        const customer = await models.Customer.findOne({
          where: { id: req.params.id, companyId: req.companyId },
          transaction: t,
          lock: { level: t.LOCK.UPDATE, of: models.Customer },
        });
        if (!customer) throw new NotFoundError("Customer not found.");
        if (customer.status && customer.status !== "active") {
          throw new ValidationError("لا يمكن رد رصيد لعميل غير نشط");
        }

        let branch = null;
        if (payload.branchId) {
          branch = await models.Branch.findOne({
            where: { id: payload.branchId, companyId: req.companyId, isActive: true },
            transaction: t,
          });
          if (!branch) throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
        }

        const beforeSummary = await customerCreditService.getCustomerCreditSummary({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          transaction: t,
        });
        const availableBefore = Math.round(Number(beforeSummary.availableCredit || 0) * 10000) / 10000;
        if (payload.amount > availableBefore + 0.0001) {
          throw new ValidationError(`الرصيد الدائن المتاح غير كافٍ. المتاح ${availableBefore} والمطلوب ${payload.amount}`);
        }

        const cashTransaction = await models.CashTransaction.create({
          id: `CT-CREF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          type: "cash_out",
          account: payload.paymentMethod,
          amount: payload.amount,
          category: "customer_credit_refund",
          counterAccountCode: "2300",
          description: payload.description,
          reference: payload.reference || customer.id,
          branch: branch ? branch.name : (payload.branchId || "Main Branch"),
          branchId: payload.branchId,
          date: payload.date,
          createdBy: actorId,
          status: "posted",
          idempotencyKey: idempotencyKey || null,
        }, { transaction: t });

        const creditRow = await customerCreditService.recordCreditOut({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          branchId: payload.branchId,
          amount: payload.amount,
          currency: payload.currency,
          sourceType: "credit_refund",
          sourceId: cashTransaction.id,
          cashTransactionId: cashTransaction.id,
          description: payload.description,
          createdBy: actorId,
          metadata: {
            reference: payload.reference,
            paymentMethod: payload.paymentMethod,
            accountCode: payload.accountCode,
          },
          transaction: t,
          glPosting: {
            enabled: true,
            debitAccountCode: "2300",
            creditAccountCode: payload.accountCode,
            description: payload.description,
            date: payload.date,
            postedBy: actorName,
          },
        });

        await cashTransaction.update({ journalEntryId: creditRow.journalEntryId }, { transaction: t });

        const summary = await customerCreditService.getCustomerCreditSummary({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          transaction: t,
        });
        const journalEntry = creditRow.journalEntryId
          ? await models.JournalEntry.findOne({
              where: { id: creditRow.journalEntryId, companyId: req.companyId },
              transaction: t,
            })
          : null;

        await auditService.record(req.companyId, {
          action: "customer_credit_refund_created",
          description: `Customer credit refund ${payload.amount} ${payload.currency} for ${customer.name}`,
          user: actorName,
          userId: req.user ? req.user.id : null,
          place: branch ? branch.name : payload.branchId || null,
          branch: branch ? branch.name : payload.branchId || null,
          sourceDocument: cashTransaction.id,
          severity: "info",
          after: JSON.stringify({
            customerId: customer.id,
            amount: payload.amount,
            cashTransactionId: cashTransaction.id,
            customerCreditTransactionId: creditRow.id,
            journalEntryId: creditRow.journalEntryId,
            availableCreditBefore: availableBefore,
            availableCreditAfter: summary.availableCredit,
          }),
        }, { transaction: t });

        const cashOut = cashTransaction.toJSON();
        cashOut.journalEntryId = creditRow.journalEntryId;
        idemResponseBody = {
          success: true,
          data: {
            customerCreditTransaction: creditRow.toJSON ? creditRow.toJSON() : creditRow,
            cashTransaction: cashOut,
            journalEntry: journalEntry ? journalEntry.toJSON() : (creditRow.journalEntryId ? { id: creditRow.journalEntryId } : null),
            availableCredit: summary.availableCredit,
            ledgerBased: true,
            source: "customer_credit_refund",
            readOnly: false,
          },
        };
        await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });
      });
    } catch (txErr) {
      if (txErr && txErr.__idemDuplicate) {
        const prior = await idempotencyService.resolveExisting({
          models,
          companyId: req.companyId,
          scope: idemScope,
          key: idempotencyKey,
          requestHash: idemRequestHash,
        });
        if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
        return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
      }
      throw txErr;
    }

    emitEntityChanged(req.companyId, {
      entity: "CustomerCreditTransaction",
      action: "refund",
      id: idemResponseBody?.data?.customerCreditTransaction?.id,
      branchId: payload.branchId,
      related: { customerId: req.params.id },
    });
    emitEntityChanged(req.companyId, {
      entity: "CashTransaction",
      action: "customer-credit-refund",
      id: idemResponseBody?.data?.cashTransaction?.id,
      branchId: payload.branchId,
      related: { customerId: req.params.id },
    });

    return res.status(201).json(idemResponseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/invoices/:id/apply-customer-credit", authMiddleware, requireBusinessPermission("sales.create", { touch: true }), async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const payload = normalizeCustomerCreditApplyPayload(req, settings.currency || "AED");
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لتطبيق الرصيد الدائن على الفاتورة" });
    }

    const preflightInvoice = await models.Invoice.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      attributes: ["id", "customerId"],
    });
    if (!preflightInvoice) throw new NotFoundError("الفاتورة غير موجودة");
    if (!preflightInvoice.customerId) throw new ValidationError("الفاتورة غير مرتبطة بعميل");

    const idemScope = "customer.credit_apply";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, {
      companyId: req.companyId,
      customerId: preflightInvoice.customerId,
      invoiceId: req.params.id,
      ...payload,
    }, req.params);

    const actorName = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const actorId = req.user ? req.user.id : "System";
    let idemResponseBody = null;

    try {
      await models.sequelize.transaction(async (t) => {
        const idemClaim = await idempotencyService.claim({
          models,
          companyId: req.companyId,
          scope: idemScope,
          key: idempotencyKey,
          requestHash: idemRequestHash,
          transaction: t,
        });
        if (!idemClaim.claimed) {
          const dup = new Error("__IDEM_DUPLICATE__");
          dup.__idemDuplicate = true;
          throw dup;
        }
        const idemRequest = idemClaim.request;

        const invoice = await models.Invoice.findOne({
          where: { id: req.params.id, companyId: req.companyId },
          transaction: t,
          lock: { level: t.LOCK.UPDATE, of: models.Invoice },
        });
        if (!invoice) throw new NotFoundError("الفاتورة غير موجودة");
        if (!invoice.customerId) throw new ValidationError("الفاتورة غير مرتبطة بعميل");
        if (invoice.customerId !== preflightInvoice.customerId) {
          throw new ConflictError("تغير عميل الفاتورة أثناء معالجة الطلب، استخدم مفتاح منع تكرار جديد");
        }
        if (invoice.postingStatus !== "posted" || invoice.status === "cancelled") {
          throw new ValidationError("لا يمكن تطبيق الرصيد إلا على فاتورة مرحلة ونشطة");
        }
        if (invoice.type === "return" || invoice.type === "exchange") {
          throw new ValidationError("تطبيق الرصيد غير مدعوم على فواتير المرتجعات أو الاستبدال في هذه المرحلة");
        }

        const remainingBefore = round4(Number(invoice.remainingAmount || 0));
        if (remainingBefore <= 0.0001) {
          throw new ValidationError("الفاتورة مسددة بالكامل بالفعل");
        }
        if (payload.amount > remainingBefore + 0.0001) {
          throw new ValidationError(`مبلغ تطبيق الرصيد (${payload.amount}) يتجاوز المتبقي على الفاتورة (${remainingBefore})`);
        }

        const customer = await models.Customer.findOne({
          where: { id: invoice.customerId, companyId: req.companyId },
          transaction: t,
          lock: { level: t.LOCK.UPDATE, of: models.Customer },
        });
        if (!customer) throw new NotFoundError("العميل غير موجود");
        if (customer.status && customer.status !== "active") {
          throw new ValidationError("لا يمكن تطبيق الرصيد على عميل غير نشط");
        }

        const beforeSummary = await customerCreditService.getCustomerCreditSummary({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          transaction: t,
        });
        const availableBefore = round4(Number(beforeSummary.availableCredit || 0));
        if (payload.amount > availableBefore + 0.0001) {
          throw new ValidationError(`الرصيد الدائن المتاح غير كافٍ. المتاح ${availableBefore} والمطلوب ${payload.amount}`);
        }

        const creditRow = await customerCreditService.recordCreditOut({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          branchId: invoice.branchId || null,
          amount: payload.amount,
          currency: payload.currency,
          sourceType: "credit_application",
          sourceId: invoice.id,
          invoiceId: invoice.id,
          description: payload.description,
          createdBy: actorId,
          metadata: {
            reference: payload.reference,
            paymentMethod: "customer_credit",
          },
          transaction: t,
          glPosting: {
            enabled: true,
            debitAccountCode: "2300",
            creditAccountCode: "1300",
            description: payload.description,
            date: payload.date,
            postedBy: actorName,
          },
        });

        const payment = await models.Payment.create({
          id: `PAY-CAPP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          branchId: invoice.branchId || null,
          invoiceId: invoice.id,
          paymentMethod: "customer_credit",
          amount: payload.amount,
          reference: payload.reference || creditRow.id,
          date: payload.date,
          notes: `${payload.description} | creditTransactionId=${creditRow.id} | journalEntryId=${creditRow.journalEntryId || ""}`,
        }, { transaction: t });

        const newRemainingAmount = Math.max(0, round4(remainingBefore - payload.amount));
        const invoiceTotal = round4(Number(invoice.total || 0));
        const currentPaid = round4(Number(invoice.paidAmount || 0));
        const newPaidAmount = invoiceTotal > 0
          ? Math.min(invoiceTotal, round4(currentPaid + payload.amount))
          : round4(currentPaid + payload.amount);
        const newStatus = newRemainingAmount <= 0.0001 ? "paid" : "partial";

        await invoice.update({
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount,
          status: newStatus,
        }, { transaction: t });

        await customer.update({
          balance: Math.max(0, round4(Number(customer.balance || 0) - payload.amount)),
        }, { transaction: t });

        const summary = await customerCreditService.getCustomerCreditSummary({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          transaction: t,
        });
        const journalEntry = creditRow.journalEntryId
          ? await models.JournalEntry.findOne({
              where: { id: creditRow.journalEntryId, companyId: req.companyId },
              transaction: t,
            })
          : null;

        await auditService.record(req.companyId, {
          action: "customer_credit_applied_to_invoice",
          description: `Applied customer credit ${payload.amount} ${payload.currency} to invoice ${invoice.invoiceNumber || invoice.id}`,
          user: actorName,
          userId: req.user ? req.user.id : null,
          place: invoice.branch || invoice.branchId || null,
          branch: invoice.branch || invoice.branchId || null,
          sourceDocument: invoice.id,
          severity: "info",
          after: JSON.stringify({
            customerId: customer.id,
            invoiceId: invoice.id,
            amount: payload.amount,
            paymentId: payment.id,
            customerCreditTransactionId: creditRow.id,
            journalEntryId: creditRow.journalEntryId,
            availableCreditBefore: availableBefore,
            availableCreditAfter: summary.availableCredit,
            remainingBefore,
            remainingAfter: newRemainingAmount,
          }),
        }, { transaction: t });

        const invoiceOut = invoice.toJSON();
        invoiceOut.paidAmount = newPaidAmount;
        invoiceOut.remainingAmount = newRemainingAmount;
        invoiceOut.status = newStatus;

        idemResponseBody = {
          success: true,
          data: {
            customerCreditTransaction: creditRow.toJSON ? creditRow.toJSON() : creditRow,
            payment: payment.toJSON ? payment.toJSON() : payment,
            invoice: invoiceOut,
            journalEntry: journalEntry ? journalEntry.toJSON() : (creditRow.journalEntryId ? { id: creditRow.journalEntryId } : null),
            availableCredit: summary.availableCredit,
            ledgerBased: true,
            source: "customer_credit_apply",
            readOnly: false,
          },
        };
        await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });
      });
    } catch (txErr) {
      if (txErr && txErr.__idemDuplicate) {
        const prior = await idempotencyService.resolveExisting({
          models,
          companyId: req.companyId,
          scope: idemScope,
          key: idempotencyKey,
          requestHash: idemRequestHash,
        });
        if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
        return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
      }
      throw txErr;
    }

    emitEntityChanged(req.companyId, {
      entity: "CustomerCreditTransaction",
      action: "apply",
      id: idemResponseBody?.data?.customerCreditTransaction?.id,
      branchId: idemResponseBody?.data?.invoice?.branchId || null,
      related: { customerId: idemResponseBody?.data?.invoice?.customerId, invoiceId: req.params.id },
    });
    emitEntityChanged(req.companyId, {
      entity: "Payment",
      action: "customer-credit-apply",
      id: idemResponseBody?.data?.payment?.id,
      branchId: idemResponseBody?.data?.invoice?.branchId || null,
      related: { customerId: idemResponseBody?.data?.invoice?.customerId, invoiceId: req.params.id },
    });
    emitEntityChanged(req.companyId, {
      entity: "Invoice",
      action: "customer-credit-apply",
      id: req.params.id,
      branchId: idemResponseBody?.data?.invoice?.branchId || null,
      related: { customerId: idemResponseBody?.data?.invoice?.customerId },
    });

    return res.status(201).json(idemResponseBody);
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GL ACCOUNT STATEMENT (كشف حساب) — Phase 9B. READ-ONLY.
// Builds a per-GL-account ledger from POSTED journal lines only. It never reads
// Account.balance to derive opening/closing (those are computed from the lines
// themselves), and it performs ZERO writes — no balance/journal mutation.
//
// Opening balance = full server-side aggregate of every posted line for the
// account dated BEFORE `from` (0 when no `from`). Rows in [from,to] are ordered
// deterministically (date, entry.createdAt, entryId, lineId) and a running
// balance is computed across the WHOLE ordered set, then the requested page is
// sliced — so page 2's running balance correctly continues after page 1.
// closingBalance = opening + Σ delta over the entire range (not the page).
// Reversed originals are status="reversed" → excluded; the reversal entry is
// status="posted" → included, which is the correct net financial effect.
// ─────────────────────────────────────────────────────────────────────────────
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const isValidYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
const safeJson = (value) => {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
};
const ledgerMeta = {
  ledgerBased: true,
  source: "reportable_ledger_journal_lines",
  readOnly: true,
};

function ledgerDateWhere({ from, to, asOf, before }) {
  if (before) return { [Op.lt]: before };
  const date = {};
  if (from) date[Op.gte] = from;
  if (to) date[Op.lte] = to;
  if (asOf) date[Op.lte] = asOf;
  return Object.keys(date).length ? date : null;
}

function ledgerEntryWhere({ companyId, from, to, asOf, branchId, before }) {
  const where = { companyId, status: { [Op.in]: ledgerReportingService.REPORTABLE_LEDGER_STATUSES } };
  const date = ledgerDateWhere({ from, to, asOf, before });
  if (date) where.date = date;
  if (branchId) where.branchId = branchId;
  return where;
}

function accountSignedBalance(account, debit, credit) {
  return account.nature === "credit"
    ? round4((Number(credit) || 0) - (Number(debit) || 0))
    : round4((Number(debit) || 0) - (Number(credit) || 0));
}

async function ledgerTotalsByAccountCode({ companyId, accountCodes, from, to, asOf, branchId, before }) {
  await ledgerReportingService.assertReportableLedgerIntegrity({ companyId, branchId });
  const rows = await models.JournalLine.findAll({
    attributes: [
      "accountCode",
      [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("debit")), 0), "debitTotal"],
      [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("credit")), 0), "creditTotal"],
    ],
    where: { accountCode: { [Op.in]: accountCodes } },
    include: [{
      model: models.JournalEntry,
      as: "journalEntry",
      attributes: [],
      required: true,
      where: ledgerEntryWhere({ companyId, from, to, asOf, branchId, before }),
    }],
    group: ["accountCode"],
    raw: true,
  });

  const byCode = new Map(accountCodes.map((code) => [code, { debitTotal: 0, creditTotal: 0 }]));
  for (const row of rows) {
    byCode.set(row.accountCode, {
      debitTotal: round4(row.debitTotal),
      creditTotal: round4(row.creditTotal),
    });
  }
  return byCode;
}

router.get("/accounts/:id/statement", authMiddleware, requirePermission("accounting.view"), async (req, res, next) => {
  try {
    // 1. Account must exist within the tenant. Never modified.
    const account = await models.Account.findOne({
      where: { id: req.params.id, companyId: req.companyId },
    });
    if (!account) throw new NotFoundError("Account not found.");

    // 2. Validate the optional date window.
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const branchId = req.query.branchId ? String(req.query.branchId) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");
    await ledgerReportingService.assertReportableLedgerIntegrity({ companyId: req.companyId, branchId });

    // 3. Pagination (rows only; capped).
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);

    const nature = account.nature; // "debit" | "credit"
    const deltaOf = (debit, credit) =>
      nature === "debit" ? (Number(debit) || 0) - (Number(credit) || 0) : (Number(credit) || 0) - (Number(debit) || 0);

    // 4. Opening balance — full aggregate of posted lines BEFORE `from`.
    let openingBalance = 0;
    if (from) {
      const priorLines = await models.JournalLine.findAll({
        attributes: ["debit", "credit"],
        where: { accountId: account.id },
        include: [{
          model: models.JournalEntry,
          as: "journalEntry",
          attributes: [],
          required: true,
          where: ledgerEntryWhere({ companyId: req.companyId, before: from, branchId }),
        }],
        raw: true,
      });
      openingBalance = round4(priorLines.reduce((s, l) => s + deltaOf(l.debit, l.credit), 0));
    }

    // 5. All posted lines within [from,to], deterministically ordered.
    const entryWhere = ledgerEntryWhere({ companyId: req.companyId, from, to, branchId });
    const lineRows = await models.JournalLine.findAll({
      where: { accountId: account.id },
      include: [{
        model: models.JournalEntry,
        as: "journalEntry",
        attributes: ["id", "date", "status", "sourceType", "sourceId", "branchId", "createdAt"],
        required: true,
        where: entryWhere,
      }],
      order: [
        [{ model: models.JournalEntry, as: "journalEntry" }, "date", "ASC"],
        [{ model: models.JournalEntry, as: "journalEntry" }, "createdAt", "ASC"],
        [{ model: models.JournalEntry, as: "journalEntry" }, "id", "ASC"],
        ["id", "ASC"],
      ],
    });

    // 6. Running balance across the WHOLE ordered set (so paging stays correct).
    let running = openingBalance;
    const allRows = lineRows.map((r) => {
      const je = r.journalEntry;
      const debit = round4(r.debit);
      const credit = round4(r.credit);
      const delta = round4(deltaOf(debit, credit));
      running = round4(running + delta);
      return {
        journalEntryId: je.id,
        journalLineId: r.id,
        date: je.date,
        description: r.description,
        sourceType: je.sourceType,
        sourceId: je.sourceId,
        branchId: je.branchId,
        debit,
        credit,
        delta,
        runningBalance: running,
      };
    });

    const total = allRows.length;
    const totalPages = Math.ceil(total / pageSize);
    const closingBalance = total ? allRows[total - 1].runningBalance : openingBalance;
    const debitTotal = round4(allRows.reduce((sum, row) => sum + row.debit, 0));
    const creditTotal = round4(allRows.reduce((sum, row) => sum + row.credit, 0));
    const start = (page - 1) * pageSize;
    const items = allRows.slice(start, start + pageSize);

    return res.status(200).json({
      success: true,
      data: {
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
          nameAr: account.nameAr,
          nature: account.nature,
          balance: round4(account.balance),
        },
        from,
        to,
        branchId,
        openingBalance,
        debitTotal,
        creditTotal,
        closingBalance,
        page,
        pageSize,
        total,
        totalPages,
        items,
        meta: {
          ...ledgerMeta,
          report: "account_ledger",
          partyLevel: false,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIAL BALANCE (ميزان المراجعة) — Phase 9D — READ-ONLY.
// Computes debit/credit totals from reportable journal lines, never from
// Account.balance. A reversed original remains financial history alongside its
// separately posted reversal, so the pair nets correctly. Account.balance is surfaced purely as
// a reference, plus a `difference` against the ledger-derived calculated balance.
// No rows are created, updated, or deleted.
// ─────────────────────────────────────────────────────────────────────────────
function reservationReportFilters(req) {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const branchId = req.query.branchId ? String(req.query.branchId) : null;
  const status = req.query.status ? String(req.query.status) : null;
  if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
  if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
  if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");
  const where = { companyId: req.companyId };
  if (branchId) where.branchId = branchId;
  if (status) where.status = status;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(`${from}T00:00:00.000Z`);
    if (to) where.createdAt[Op.lte] = new Date(`${to}T23:59:59.999Z`);
  }
  return { where, filters: { from, to, branchId, status } };
}

async function secureReservationReportVisibilityWhere(req, requestedBranchId = null) {
  const maximumWhere = await reservationService._internal.reservationVisibilityWhere(req.companyId, req.user, req.branchId);

  // Own-scope visibility is also bounded by the authenticated branch context.
  if (maximumWhere[Op.or] && req.branchId) maximumWhere.branchId = req.branchId;
  if (!requestedBranchId || maximumWhere.id === "__NO_VISIBLE_RESERVATION_SCOPE__") return maximumWhere;

  // A scoped actor may only repeat their authenticated branch. A different
  // query branch produces the normal secure-empty report contract.
  if (maximumWhere.branchId) {
    if (maximumWhere.branchId !== requestedBranchId) {
      return { ...maximumWhere, id: "__FORCE_EMPTY_SET__" };
    }
    return maximumWhere;
  }

  // Company-wide actors may narrow to an active branch in their company.
  // Missing and wrong-company branch identifiers are indistinguishable.
  const branchExists = await models.Branch.count({
    where: { id: requestedBranchId, companyId: req.companyId, isActive: true }
  });
  if (!branchExists) throw new ValidationError("Invalid or unavailable branchId.");
  return { ...maximumWhere, branchId: requestedBranchId };
}

async function secureReservationReportFilters(req) {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const branchId = req.query.branchId ? String(req.query.branchId) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const customerId = req.query.customerId ? String(req.query.customerId) : null;
  const salesperson = req.query.salesperson ? String(req.query.salesperson) : null;

  if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
  if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
  if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

  const baseWhere = await secureReservationReportVisibilityWhere(req, branchId);
  const where = { ...baseWhere };

  if (baseWhere.id === "__NO_VISIBLE_RESERVATION_SCOPE__") {
    // Force empty result set
    where.id = "__FORCE_EMPTY_SET__";
  }

  if (branchId) where.branchId = branchId;
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;
  if (salesperson) where.createdBy = salesperson;

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(`${from}T00:00:00.000Z`);
    if (to) where.createdAt[Op.lte] = new Date(`${to}T23:59:59.999Z`);
  }
  return { where, filters: { from, to, branchId, status, customerId, salesperson } };
}

function reservationReportPagination(req, isExport = false) {
  const parsePositiveInteger = (value, field) => {
    const raw = String(value);
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new ValidationError(`${field} must be a positive integer.`);
    return Number(raw);
  };
  if (isExport) return { page: 1, limit: null, offset: 0 };
  const page = req.query.page === undefined ? 1 : parsePositiveInteger(req.query.page, "page");
  const limit = req.query.limit === undefined ? 50 : Math.min(100, parsePositiveInteger(req.query.limit, "limit"));
  return { page, limit, offset: (page - 1) * limit };
}

function reservationReportPaginationMeta(total, pagination, isExport = false) {
  if (isExport) {
    return { total, page: 1, limit: total, pages: total === 0 ? 0 : 1 };
  }
  return {
    total,
    page: pagination.page,
    limit: pagination.limit,
    pages: total === 0 ? 0 : Math.ceil(total / pagination.limit)
  };
}

router.get("/reports/reservations/summary", authMiddleware, requireAnyPermission(reservationPerms.reportsView), async (req, res, next) => {
  try {
    const isExport = req.query.export === "true";
    if (isExport) {
      const hasExport = await permissionService.userHasAnyPermission(req.user, reservationPerms.reportsExport);
      if (!hasExport) throw new ForbiddenError("Insufficient permissions to export reports.");
    }
    const { where, filters } = await secureReservationReportFilters(req);
    const pagination = reservationReportPagination(req, isExport);
    const order = [["createdAt", "DESC"], ["id", "ASC"]];
    const totalRows = await models.Reservation.findAll({ where, order, raw: true });
    const reservations = isExport
      ? totalRows
      : await models.Reservation.findAll({ where, order, limit: pagination.limit, offset: pagination.offset, raw: true });
    const totals = totalRows.reduce((acc, row) => {
      acc.count += 1;
      acc.agreedTotal = round4(acc.agreedTotal + Number(row.agreedTotal || 0));
      acc.paidTotal = round4(acc.paidTotal + Number(row.paidTotal || 0));
      acc.remainingTotal = round4(acc.remainingTotal + Number(row.remainingTotal || 0));
      acc.excessTotal = round4(acc.excessTotal + Number(row.excessTotal || 0));
      acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + 1;
      return acc;
    }, { count: 0, agreedTotal: 0, paidTotal: 0, remainingTotal: 0, excessTotal: 0, byStatus: {} });
    const paginationMeta = reservationReportPaginationMeta(totalRows.length, pagination, isExport);
    return res.status(200).json({ success: true, data: { filters, totals, pagination: paginationMeta, items: reservations }, items: reservations });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/reservations/payments", authMiddleware, requireAnyPermission(reservationPerms.reportsView), async (req, res, next) => {
  try {
    const isExport = req.query.export === "true";
    if (isExport) {
      const hasExport = await permissionService.userHasAnyPermission(req.user, reservationPerms.reportsExport);
      if (!hasExport) throw new ForbiddenError("Insufficient permissions to export reports.");
    }
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const requestedBranchId = req.query.branchId ? String(req.query.branchId) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

    const pagination = reservationReportPagination(req, isExport);
    const { page } = pagination;
    const limit = pagination.limit ?? 0;

    const baseWhere = await secureReservationReportVisibilityWhere(req, requestedBranchId);
    if (baseWhere.id === "__NO_VISIBLE_RESERVATION_SCOPE__") {
      return res.status(200).json({
        success: true,
        data: {
          filters: { from, to, branchId: requestedBranchId },
          totals: { count: 0, amount: 0, byMethod: {} },
          pagination: { total: 0, page, limit, pages: 0 },
          items: []
        },
        items: []
      });
    }

    const where = { companyId: req.companyId };
    const reservationWhere = { ...baseWhere };

    if (from || to) {
      where.receivedAt = {};
      if (from) where.receivedAt[Op.gte] = new Date(`${from}T00:00:00.000Z`);
      if (to) where.receivedAt[Op.lte] = new Date(`${to}T23:59:59.999Z`);
    }

    const include = [
      {
        model: models.Reservation,
        as: "reservation",
        required: true,
        where: reservationWhere,
        attributes: ["id", "customerId", "customerName", "branchId"]
      },
      {
        model: models.Customer,
        as: "customer",
        required: true,
        where: { companyId: req.companyId },
        attributes: ["id", "name"]
      }
    ];

    const totalRows = await models.ReservationPayment.findAll({
      where,
      include,
      attributes: ["amount", "paymentMethod"],
      raw: true,
      nest: true
    });
    const totals = totalRows.reduce((acc, row) => {
      acc.count += 1;
      acc.amount = round4(acc.amount + Number(row.amount || 0));
      acc.byMethod[row.paymentMethod] = round4((acc.byMethod[row.paymentMethod] || 0) + Number(row.amount || 0));
      return acc;
    }, { count: 0, amount: 0, byMethod: {} });

    const total = totalRows.length;
    const payments = await models.ReservationPayment.findAll({
      where,
      include,
      order: [["receivedAt", "ASC"], ["id", "ASC"]],
      ...(isExport ? {} : { limit, offset: pagination.offset }),
      raw: true,
      nest: true
    });
    const items = payments.map((payment) => ({
      ...payment,
      reservationNumber: payment.reservation?.id || payment.reservationId,
      customerName: payment.customer?.name || payment.reservation?.customerName || null
    }));
    const paginationMeta = reservationReportPaginationMeta(total, pagination, isExport);
    return res.status(200).json({
      success: true,
      data: { filters: { from, to, branchId: requestedBranchId }, totals, pagination: paginationMeta, items },
      items
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/reservations/unsettled-advances", authMiddleware, requireAnyPermission(reservationPerms.reportsView), async (req, res, next) => {
  try {
    const isExport = req.query.export === "true";
    if (isExport) {
      const hasExport = await permissionService.userHasAnyPermission(req.user, reservationPerms.reportsExport);
      if (!hasExport) throw new ForbiddenError("Insufficient permissions to export reports.");
    }

    const { where, filters } = await secureReservationReportFilters(req);
    where.status = { [Op.in]: ["active", "partially_paid", "fully_paid"] };
    where.paidTotal = { [Op.gt]: 0 };

    const pagination = reservationReportPagination(req, isExport);
    const order = [["createdAt", "DESC"], ["id", "ASC"]];
    const totalRows = await models.Reservation.findAll({ where, order, raw: true });
    const rows = isExport
      ? totalRows
      : await models.Reservation.findAll({ where, order, limit: pagination.limit, offset: pagination.offset, raw: true });

    const totals = totalRows.reduce((acc, row) => {
      acc.count += 1;
      acc.agreedTotal = round4(acc.agreedTotal + Number(row.agreedTotal || 0));
      acc.paidTotal = round4(acc.paidTotal + Number(row.paidTotal || 0));
      acc.remainingTotal = round4(acc.remainingTotal + Number(row.remainingTotal || 0));
      return acc;
    }, { count: 0, agreedTotal: 0, paidTotal: 0, remainingTotal: 0 });

    return res.status(200).json({
      success: true,
      data: {
        filters,
        pagination: reservationReportPaginationMeta(totalRows.length, pagination, isExport),
        totals,
        items: rows
      },
      items: rows
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/reservations/completions", authMiddleware, requireAnyPermission(reservationPerms.reportsView), async (req, res, next) => {
  try {
    const isExport = req.query.export === "true";
    if (isExport) {
      const hasExport = await permissionService.userHasAnyPermission(req.user, reservationPerms.reportsExport);
      if (!hasExport) throw new ForbiddenError("Insufficient permissions to export reports.");
    }

    const { where, filters } = await secureReservationReportFilters(req);
    where.status = "completed";

    if (req.query.from || req.query.to) {
      delete where.createdAt;
      where.completedAt = {};
      if (req.query.from) where.completedAt[Op.gte] = new Date(`${req.query.from}T00:00:00.000Z`);
      if (req.query.to) where.completedAt[Op.lte] = new Date(`${req.query.to}T23:59:59.999Z`);
    }

    const pagination = reservationReportPagination(req, isExport);
    const order = [["completedAt", "DESC"], ["id", "ASC"]];
    const totalRows = await models.Reservation.findAll({ where, order, raw: true });
    const rows = isExport
      ? totalRows
      : await models.Reservation.findAll({ where, order, limit: pagination.limit, offset: pagination.offset, raw: true });

    const totals = totalRows.reduce((acc, row) => {
      acc.count += 1;
      acc.agreedTotal = round4(acc.agreedTotal + Number(row.agreedTotal || 0));
      acc.paidTotal = round4(acc.paidTotal + Number(row.paidTotal || 0));
      return acc;
    }, { count: 0, agreedTotal: 0, paidTotal: 0 });

    return res.status(200).json({
      success: true,
      data: {
        filters,
        pagination: reservationReportPaginationMeta(totalRows.length, pagination, isExport),
        totals,
        items: rows
      },
      items: rows
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/reservations/cancellations-refunds", authMiddleware, requireAnyPermission(reservationPerms.reportsView), async (req, res, next) => {
  try {
    const isExport = req.query.export === "true";
    if (isExport) {
      const hasExport = await permissionService.userHasAnyPermission(req.user, reservationPerms.reportsExport);
      if (!hasExport) throw new ForbiddenError("Insufficient permissions to export reports.");
    }

    const { where, filters } = await secureReservationReportFilters(req);
    where.status = { [Op.in]: ["cancelled", "cancelled_refund_pending", "refunded"] };

    if (req.query.from || req.query.to) {
      delete where.createdAt;
      where.cancelledAt = {};
      if (req.query.from) where.cancelledAt[Op.gte] = new Date(`${req.query.from}T00:00:00.000Z`);
      if (req.query.to) where.cancelledAt[Op.lte] = new Date(`${req.query.to}T23:59:59.999Z`);
    }

    const pagination = reservationReportPagination(req, isExport);
    const order = [["cancelledAt", "DESC"], ["id", "ASC"]];
    const totalRows = await models.Reservation.findAll({ where, order, raw: true });
    const rows = isExport
      ? totalRows
      : await models.Reservation.findAll({ where, order, limit: pagination.limit, offset: pagination.offset, raw: true });

    const totals = totalRows.reduce((acc, row) => {
      acc.count += 1;
      acc.agreedTotal = round4(acc.agreedTotal + Number(row.agreedTotal || 0));
      acc.paidTotal = round4(acc.paidTotal + Number(row.paidTotal || 0));
      if (row.status === "cancelled_refund_pending") acc.refundPendingCount += 1;
      if (row.status === "refunded") acc.refundedCount += 1;
      return acc;
    }, { count: 0, agreedTotal: 0, paidTotal: 0, refundPendingCount: 0, refundedCount: 0 });

    return res.status(200).json({
      success: true,
      data: {
        filters,
        pagination: reservationReportPaginationMeta(totalRows.length, pagination, isExport),
        totals,
        items: rows
      },
      items: rows
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/reservations/expiry", authMiddleware, requireAnyPermission(reservationPerms.reportsView), async (req, res, next) => {
  try {
    const isExport = req.query.export === "true";
    if (isExport) {
      const hasExport = await permissionService.userHasAnyPermission(req.user, reservationPerms.reportsExport);
      if (!hasExport) throw new ForbiddenError("Insufficient permissions to export reports.");
    }

    const { where, filters } = await secureReservationReportFilters(req);
    where.status = { [Op.in]: ["expired", "cancelled", "cancelled_refund_pending"] };
    where.expiredBySystem = true;

    if (req.query.from || req.query.to) {
      delete where.createdAt;
      where.expiredAt = {};
      if (req.query.from) where.expiredAt[Op.gte] = new Date(`${req.query.from}T00:00:00.000Z`);
      if (req.query.to) where.expiredAt[Op.lte] = new Date(`${req.query.to}T23:59:59.999Z`);
    }

    const pagination = reservationReportPagination(req, isExport);
    const order = [["expiredAt", "DESC"], ["id", "ASC"]];
    const totalRows = await models.Reservation.findAll({ where, order, raw: true });
    const rows = isExport
      ? totalRows
      : await models.Reservation.findAll({ where, order, limit: pagination.limit, offset: pagination.offset, raw: true });

    const totals = totalRows.reduce((acc, row) => {
      acc.count += 1;
      acc.agreedTotal = round4(acc.agreedTotal + Number(row.agreedTotal || 0));
      acc.paidTotal = round4(acc.paidTotal + Number(row.paidTotal || 0));
      return acc;
    }, { count: 0, agreedTotal: 0, paidTotal: 0 });

    return res.status(200).json({
      success: true,
      data: {
        filters,
        pagination: reservationReportPaginationMeta(totalRows.length, pagination, isExport),
        totals,
        items: rows
      },
      items: rows
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/reservations/amendments", authMiddleware, requireAnyPermission(reservationPerms.reportsView), async (req, res, next) => {
  try {
    const isExport = req.query.export === "true";
    if (isExport) {
      const hasExport = await permissionService.userHasAnyPermission(req.user, reservationPerms.reportsExport);
      if (!hasExport) throw new ForbiddenError("Insufficient permissions to export reports.");
    }

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const branchId = req.query.branchId ? String(req.query.branchId) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

    const baseWhere = await secureReservationReportVisibilityWhere(req, branchId);
    const pagination = reservationReportPagination(req, isExport);

    const visibleReservations = await models.Reservation.findAll({ where: baseWhere, attributes: ["id"], raw: true });
    const visibleReservationIds = visibleReservations.map((row) => row.id);
    if (!visibleReservationIds.length) {
      return res.status(200).json({
        success: true,
        data: {
          filters: { from, to, branchId },
          pagination: reservationReportPaginationMeta(0, pagination, isExport),
          totals: { count: 0, totalBefore: 0, totalAfter: 0 },
          items: []
        },
        items: []
      });
    }

    const where = { companyId: req.companyId, reservationId: { [Op.in]: visibleReservationIds } };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt[Op.gte] = new Date(`${from}T00:00:00.000Z`);
      if (to) where.createdAt[Op.lte] = new Date(`${to}T23:59:59.999Z`);
    }

    const order = [["createdAt", "DESC"], ["id", "ASC"]];
    const totalRows = await models.ReservationAmendment.findAll({ where, order, raw: true });
    const rows = isExport
      ? totalRows
      : await models.ReservationAmendment.findAll({ where, order, limit: pagination.limit, offset: pagination.offset, raw: true });

    const totals = totalRows.reduce((acc, row) => {
      acc.count += 1;
      acc.totalBefore = round4(acc.totalBefore + Number(row.beforeTotal || 0));
      acc.totalAfter = round4(acc.totalAfter + Number(row.afterTotal || 0));
      return acc;
    }, { count: 0, totalBefore: 0, totalAfter: 0 });

    return res.status(200).json({
      success: true,
      data: {
        filters: { from, to, branchId },
        pagination: reservationReportPaginationMeta(totalRows.length, pagination, isExport),
        totals,
        items: rows
      },
      items: rows
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/reservations/renewals", authMiddleware, requireAnyPermission(reservationPerms.reportsView), async (req, res, next) => {
  try {
    const isExport = req.query.export === "true";
    if (isExport) {
      const hasExport = await permissionService.userHasAnyPermission(req.user, reservationPerms.reportsExport);
      if (!hasExport) throw new ForbiddenError("Insufficient permissions to export reports.");
    }

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const branchId = req.query.branchId ? String(req.query.branchId) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

    const baseWhere = await secureReservationReportVisibilityWhere(req, branchId);
    const pagination = reservationReportPagination(req, isExport);

    const visibleReservations = await models.Reservation.findAll({ where: baseWhere, attributes: ["id"], raw: true });
    const visibleReservationIds = visibleReservations.map((row) => row.id);
    if (!visibleReservationIds.length) {
      return res.status(200).json({
        success: true,
        data: {
          filters: { from, to, branchId },
          pagination: reservationReportPaginationMeta(0, pagination, isExport),
          totals: { count: 0, sourceTransferableBalance: 0, successorTotal: 0, transferAmount: 0, excessRefundAmount: 0 },
          items: []
        },
        items: []
      });
    }

    const where = { companyId: req.companyId, sourceReservationId: { [Op.in]: visibleReservationIds } };

    if (from || to) {
      where.requestedAt = {};
      if (from) where.requestedAt[Op.gte] = new Date(`${from}T00:00:00.000Z`);
      if (to) where.requestedAt[Op.lte] = new Date(`${to}T23:59:59.999Z`);
    }

    const order = [["requestedAt", "DESC"], ["id", "ASC"]];
    const totalRows = await models.ReservationRenewal.findAll({ where, order, raw: true });
    const rows = isExport
      ? totalRows
      : await models.ReservationRenewal.findAll({ where, order, limit: pagination.limit, offset: pagination.offset, raw: true });

    const totals = totalRows.reduce((acc, row) => {
      acc.count += 1;
      acc.sourceTransferableBalance = round4(acc.sourceTransferableBalance + Number(row.sourceTransferableBalance || 0));
      acc.successorTotal = round4(acc.successorTotal + Number(row.successorTotal || 0));
      acc.transferAmount = round4(acc.transferAmount + Number(row.transferAmount || 0));
      acc.excessRefundAmount = round4(acc.excessRefundAmount + Number(row.excessRefundAmount || 0));
      return acc;
    }, { count: 0, sourceTransferableBalance: 0, successorTotal: 0, transferAmount: 0, excessRefundAmount: 0 });

    return res.status(200).json({
      success: true,
      data: {
        filters: { from, to, branchId },
        pagination: reservationReportPaginationMeta(totalRows.length, pagination, isExport),
        totals,
        items: rows
      },
      items: rows
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/reservations/reconciliation", authMiddleware, requireAnyPermission(reservationPerms.reportsView), async (req, res, next) => {
  try {
    const isExport = req.query.export === "true";
    if (isExport) {
      const hasExport = await permissionService.userHasAnyPermission(req.user, reservationPerms.reportsExport);
      if (!hasExport) throw new ForbiddenError("Insufficient permissions to export reports.");
    }

    const { where, filters } = await secureReservationReportFilters(req);
    const pagination = reservationReportPagination(req, isExport);

    // Dynamic validation of configured advances account
    const advancesSetting = await models.Setting.findOne({ where: { companyId: req.companyId, key: "reservationAdvancesAccountId" } });
    const advancesAccountId = advancesSetting?.value;
    if (!advancesAccountId) {
      return res.status(200).json({
        success: true,
        data: {
          filters,
          pagination: reservationReportPaginationMeta(0, pagination, isExport),
          totals: { reconciledCount: 0, mismatchCount: 0, unsupportedCount: 0, netDifference: 0 },
          glReconciliation: {
            configured: false,
            reconciliationStatus: "configuration_missing",
            configurationIssue: "missing_setting",
            note: "Reservation advances account not configured."
          },
          items: []
        },
        items: []
      });
    }

    // Load account without filtering by company/active/type to detect exact validation issues
    const advancesAccount = await models.Account.findOne({ where: { id: advancesAccountId } });
    if (!advancesAccount) {
      return res.status(200).json({
        success: true,
        data: {
          filters,
          pagination: reservationReportPaginationMeta(0, pagination, isExport),
          totals: { reconciledCount: 0, mismatchCount: 0, unsupportedCount: 0, netDifference: 0 },
          glReconciliation: {
            configured: false,
            reconciliationStatus: "configuration_missing",
            configurationIssue: "account_not_found",
            note: "Configured advances account not found."
          },
          items: []
        },
        items: []
      });
    }

    if (advancesAccount.companyId !== req.companyId) {
      return res.status(200).json({
        success: true,
        data: {
          filters,
          pagination: reservationReportPaginationMeta(0, pagination, isExport),
          totals: { reconciledCount: 0, mismatchCount: 0, unsupportedCount: 0, netDifference: 0 },
          glReconciliation: {
            configured: false,
            reconciliationStatus: "configuration_missing",
            configurationIssue: "wrong_company",
            note: "Configured advances account belongs to another company."
          },
          items: []
        },
        items: []
      });
    }

    if (!advancesAccount.isActive) {
      return res.status(200).json({
        success: true,
        data: {
          filters,
          pagination: reservationReportPaginationMeta(0, pagination, isExport),
          totals: { reconciledCount: 0, mismatchCount: 0, unsupportedCount: 0, netDifference: 0 },
          glReconciliation: {
            configured: false,
            reconciliationStatus: "configuration_missing",
            configurationIssue: "inactive_account",
            note: "Configured advances account is inactive."
          },
          items: []
        },
        items: []
      });
    }

    // Check if it is a posting account (i.e. leaf node with no sub-accounts)
    const childCount = await models.Account.count({ where: { parentId: advancesAccountId } });
    if (childCount > 0) {
      return res.status(200).json({
        success: true,
        data: {
          filters,
          pagination: reservationReportPaginationMeta(0, pagination, isExport),
          totals: { reconciledCount: 0, mismatchCount: 0, unsupportedCount: 0, netDifference: 0 },
          glReconciliation: {
            configured: false,
            reconciliationStatus: "configuration_missing",
            configurationIssue: "invalid_posting_account",
            note: "Configured advances account is a summary account, not a posting account."
          },
          items: []
        },
        items: []
      });
    }

    if (advancesAccount.type !== "liability") {
      return res.status(200).json({
        success: true,
        data: {
          filters,
          pagination: reservationReportPaginationMeta(0, pagination, isExport),
          totals: { reconciledCount: 0, mismatchCount: 0, unsupportedCount: 0, netDifference: 0 },
          glReconciliation: {
            configured: false,
            reconciliationStatus: "configuration_missing",
            configurationIssue: "invalid_account_type",
            note: "Configured advances account type is not liability."
          },
          items: []
        },
        items: []
      });
    }

    if (advancesAccount.nature !== "credit") {
      return res.status(200).json({
        success: true,
        data: {
          filters,
          pagination: reservationReportPaginationMeta(0, pagination, isExport),
          totals: { reconciledCount: 0, mismatchCount: 0, unsupportedCount: 0, netDifference: 0 },
          glReconciliation: {
            configured: false,
            reconciliationStatus: "configuration_missing",
            configurationIssue: "invalid_account_nature",
            note: "Configured advances account nature is not credit."
          },
          items: []
        },
        items: []
      });
    }

    // Fetch reservations
    const reservations = await models.Reservation.findAll({ where, order: [["createdAt", "DESC"], ["id", "ASC"]], raw: true });
    const ids = reservations.map((r) => r.id);

    // Fetch related records
    const [payments, refunds, transfers] = await Promise.all([
      models.ReservationPayment.findAll({ where: { companyId: req.companyId }, raw: true }),
      models.ReservationRefund.findAll({ where: { companyId: req.companyId }, raw: true }),
      models.ReservationPaymentTransfer.findAll({ where: { companyId: req.companyId }, raw: true }),
    ]);

    const paymentsById = new Map(payments.map((p) => [p.id, p]));
    const refundsById = new Map(refunds.map((r) => [r.id, r]));

    // Maps to store computed subledger values per reservation
    const paymentsReceivedMap = new Map();
    const transfersInMap = new Map();
    const refundsExecutedMap = new Map();
    const completionAppliedMap = new Map();
    const transfersOutMap = new Map();
    const excessRefundsMap = new Map();

    // Map payments
    for (const p of payments) {
      if (p.status !== "posted") continue;
      const amt = Number(p.amount || 0);
      if (p.paymentMethod === "reservation_transfer") {
        transfersInMap.set(p.reservationId, round4((transfersInMap.get(p.reservationId) || 0) + amt));
      } else {
        paymentsReceivedMap.set(p.reservationId, round4((paymentsReceivedMap.get(p.reservationId) || 0) + amt));
      }
    }

    // Map refunds
    for (const r of refunds) {
      if (r.status !== "executed") continue;
      const amt = Number(r.amount || 0);
      if (r.refundType === "renewal_excess") {
        excessRefundsMap.set(r.reservationId, round4((excessRefundsMap.get(r.reservationId) || 0) + amt));
      } else {
        refundsExecutedMap.set(r.reservationId, round4((refundsExecutedMap.get(r.reservationId) || 0) + amt));
      }
    }

    // Map transfers out from renewals
    const renewals = await models.ReservationRenewal.findAll({ where: { companyId: req.companyId, status: "activated" }, raw: true });
    for (const ren of renewals) {
      const amt = Number(ren.transferAmount || 0);
      transfersOutMap.set(ren.sourceReservationId, round4((transfersOutMap.get(ren.sourceReservationId) || 0) + amt));
    }

    // Map completion applied
    for (const r of reservations) {
      if (r.status === "completed") {
        completionAppliedMap.set(r.id, Number(r.paidTotal || 0));
      }
    }

    // Fetch posted journal lines for advances account
    const journalLines = await models.JournalLine.findAll({
      include: [{
        model: models.JournalEntry,
        as: "journalEntry",
        where: { companyId: req.companyId, status: "posted" }
      }],
      where: { accountId: advancesAccount.id },
      order: [[{ model: models.JournalEntry, as: "journalEntry" }, "date", "DESC"], [{ model: models.JournalEntry, as: "journalEntry" }, "id", "ASC"], ["id", "ASC"]],
      raw: true,
      nest: true
    });

    // Map GL balances to reservations
    const glDebitMap = new Map();
    const glCreditMap = new Map();
    const unattributableLines = [];

    for (const line of journalLines) {
      const entry = line.journalEntry;
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);

      let targetResId = null;
      if (entry.sourceType === "reservation_payment") {
        const p = paymentsById.get(entry.sourceId);
        if (p) targetResId = p.reservationId;
      } else if (entry.sourceType === "reservation_refund") {
        const rf = refundsById.get(entry.sourceId);
        if (rf) targetResId = rf.reservationId;
      } else if (entry.sourceType === "reservation_settlement") {
        targetResId = entry.sourceId;
      }

      if (targetResId) {
        glDebitMap.set(targetResId, round4((glDebitMap.get(targetResId) || 0) + debit));
        glCreditMap.set(targetResId, round4((glCreditMap.get(targetResId) || 0) + credit));
      } else {
        unattributableLines.push({
          journalLineId: line.id,
          journalEntryId: entry.id,
          description: line.description || entry.description,
          debit,
          credit,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          date: entry.date
        });
      }
    }

    // Detailed per-reservation item building
    const detailItems = [];
    let reconciledCount = 0;
    let mismatchCount = 0;
    let unsupportedCount = 0;
    let subledgerSum = 0;
    let glSum = 0;

    for (const r of reservations) {
      const pmReceived = paymentsReceivedMap.get(r.id) || 0;
      const tfIn = transfersInMap.get(r.id) || 0;
      const rfExecuted = refundsExecutedMap.get(r.id) || 0;
      const compApplied = completionAppliedMap.get(r.id) || 0;
      const tfOut = transfersOutMap.get(r.id) || 0;
      const exRefund = excessRefundsMap.get(r.id) || 0;

      // Expected Liability = paymentsReceived + transfersIn - refundsExecuted - completionApplied - transfersOut - excessRefunds
      const expectedLiability = round4(pmReceived + tfIn - rfExecuted - compApplied - tfOut - exRefund);

      // GL balance = Credit - Debit
      const glDebit = glDebitMap.get(r.id) || 0;
      const glCredit = glCreditMap.get(r.id) || 0;
      const glLiability = round4(glCredit - glDebit);

      const difference = round4(expectedLiability - glLiability);
      const isReconciled = Math.abs(difference) < 0.01;

      if (isReconciled) reconciledCount++;
      else mismatchCount++;

      subledgerSum = round4(subledgerSum + expectedLiability);
      glSum = round4(glSum + glLiability);

      detailItems.push({
        reservationId: r.id,
        reservationNumber: r.id,
        companyId: r.companyId,
        customerId: r.customerId,
        customerName: r.customerName,
        branchId: r.branchId,
        status: r.status,
        expectedLiabilityBalance: expectedLiability,
        operationalAdvanceBalance: expectedLiability,
        glLiabilityBalance: glLiability,
        difference,
        reconciliationStatus: isReconciled ? "reconciled" : "mismatch",
        investigationFlag: !isReconciled,
        details: {
          paymentsReceived: pmReceived,
          transfersIn: tfIn,
          refundsExecuted: rfExecuted,
          completionApplied: compApplied,
          transfersOut: tfOut,
          excessRefunds: exRefund
        }
      });
    }

    const hasCompanyWideVisibility = ["admin", "owner"].includes(req.user?.role)
      || await permissionService.userHasAnyPermission(req.user, ["reservations.view_all", "sales.view"]);
    const mayViewUnattributableDiagnostics = hasCompanyWideVisibility && !filters.branchId;

    // Unattributable GL diagnostics have company-wide accounting scope. They
    // are excluded from branch/own scope and from company-wide requests that
    // explicitly narrow to a branch, including totals and export output.
    if (mayViewUnattributableDiagnostics) {
      for (const line of unattributableLines) {
        unsupportedCount++;
        const glLiability = round4(line.credit - line.debit);
        const difference = round4(0 - glLiability);

        glSum = round4(glSum + glLiability);

        detailItems.push({
          reservationId: null,
          reservationNumber: null,
          customerId: null,
          customerName: null,
          branchId: null,
          status: "unsupported_legacy",
          expectedLiabilityBalance: 0,
          glLiabilityBalance: glLiability,
          difference,
          reconciliationStatus: "unsupported_legacy",
          investigationFlag: true,
          details: {
            journalLineId: line.journalLineId,
            journalEntryId: line.journalEntryId,
            description: line.description,
            sourceType: line.sourceType,
            sourceId: line.sourceId,
            date: line.date
          }
        });
      }
    }

    // Pagination applies only after the final authorized logical row set has
    // been assembled, so hidden GL lines cannot influence counts or pages.
    const paginatedItems = isExport
      ? detailItems
      : detailItems.slice(pagination.offset, pagination.offset + pagination.limit);

    const totals = {
      reconciledCount,
      mismatchCount,
      unsupportedCount,
      subledgerSum,
      glSum,
      netDifference: round4(subledgerSum - glSum)
    };

    const reconciled = Math.abs(totals.netDifference) < 0.01;
    const glReconciliation = {
      configured: true,
      advancesAccountId: advancesAccount.id,
      advancesAccountCode: advancesAccount.code,
      advancesAccountName: advancesAccount.name,
      glBalance: glSum,
      subledgerBalance: subledgerSum,
      difference: totals.netDifference,
      reconciled,
      reconciliationStatus: reconciled ? "reconciled" : "mismatch"
    };

    return res.status(200).json({
      success: true,
      data: {
        filters,
        pagination: reservationReportPaginationMeta(detailItems.length, pagination, isExport),
        totals,
        glReconciliation,
        items: paginatedItems
      },
      items: paginatedItems
    });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/trial-balance", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    // 1. Validate query. `asOf` optional date, `includeZero` optional bool.
    const asOf = req.query.asOf ? String(req.query.asOf) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId);
    if (asOf && !isValidYmd(asOf)) throw new ValidationError("Invalid 'asOf' date (expected YYYY-MM-DD).");
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");
    const includeZero = String(req.query.includeZero ?? "false").toLowerCase() === "true";
    await ledgerReportingService.assertReportableLedgerIntegrity({ companyId: req.companyId, branchId });

    // 2. All accounts in the tenant — sorted for deterministic output.
    const accounts = await models.Account.findAll({
      where: { companyId: req.companyId },
      order: [["code", "ASC"], ["id", "ASC"]],
      raw: true,
    });

    // 3. Aggregate reportable journal lines per account, optionally up to `asOf`.
    const entryWhere = ledgerEntryWhere({ companyId: req.companyId, from, to, asOf, branchId });
    const rows = await models.JournalLine.findAll({
      attributes: [
        "accountId",
        [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("debit")), 0), "debitTotal"],
        [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("credit")), 0), "creditTotal"],
      ],
      include: [{
        model: models.JournalEntry,
        as: "journalEntry",
        attributes: [],
        required: true,
        where: entryWhere,
      }],
      group: [models.sequelize.col("accountId")],
      raw: true,
    });
    const totalsByAccount = new Map();
    for (const r of rows) totalsByAccount.set(r.accountId, { debitTotal: round4(r.debitTotal), creditTotal: round4(r.creditTotal) });

    // 4. Build per-account lines.
    const items = [];
    let totalDebit = 0;
    let totalCredit = 0;
    let totalDifference = 0;
    for (const a of accounts) {
      const t = totalsByAccount.get(a.id) || { debitTotal: 0, creditTotal: 0 };
      const debitTotal = t.debitTotal;
      const creditTotal = t.creditTotal;
      // Ledger-derived balance, signed by the account's nature.
      const calculatedBalance = a.nature === "credit" ? round4(creditTotal - debitTotal) : round4(debitTotal - creditTotal);
      // Presentation side: a negative balance flips to the opposite column.
      let netDebit = 0;
      let netCredit = 0;
      if (calculatedBalance >= 0) {
        if (a.nature === "credit") netCredit = calculatedBalance;
        else netDebit = calculatedBalance;
      } else if (a.nature === "credit") {
        netDebit = round4(-calculatedBalance);
      } else {
        netCredit = round4(-calculatedBalance);
      }

      const currentBalance = round4(a.balance);
      const difference = round4(currentBalance - calculatedBalance);

      // includeZero=false → drop accounts with nothing on any metric.
      const isZero = debitTotal === 0 && creditTotal === 0 && calculatedBalance === 0 && currentBalance === 0;
      if (!includeZero && isZero) continue;

      totalDebit = round4(totalDebit + netDebit);
      totalCredit = round4(totalCredit + netCredit);
      totalDifference = round4(totalDifference + Math.abs(difference));

      items.push({
        accountId: a.id,
        code: a.code,
        name: a.name,
        nameAr: a.nameAr,
        type: a.type,
        nature: a.nature,
        currentBalance,
        debitTotal,
        creditTotal,
        calculatedBalance,
        netDebit,
        netCredit,
        difference,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        asOf,
        from,
        to,
        branchId,
        includeZero,
        accountCount: items.length,
        totalDebit,
        totalCredit,
        isBalanced: Math.abs(totalDebit - totalCredit) <= 0.01,
        balanced: Math.abs(totalDebit - totalCredit) <= 0.01,
        totalDifference,
        items,
        meta: {
          ...ledgerMeta,
          report: "trial_balance",
          balanced: Math.abs(totalDebit - totalCredit) <= 0.01,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LEDGER RECONCILIATION (تسوية دفتر الأستاذ) — Phase 9F. READ-ONLY.
// Compares each account's STORED Account.balance against the balance CALCULATED
// from reportable journal lines, surfacing any drift. It NEVER writes, NEVER fixes,
// and NEVER uses Account.balance to derive the calculated value (that is built
// only from the lines). Reportable entries include both a reversed original and
// its posted reversal, which is the correct net effect. differenceCount / totalAbsoluteDifference are
// computed over EVERY account with drift in the tenant (the true reconciliation
// signal), independent of the includeZero / onlyDifferences display filters;
// accountCount reflects the rows actually returned after those filters.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/reports/ledger-reconciliation", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    // 1. Validate query.
    const asOf = req.query.asOf ? String(req.query.asOf) : null;
    if (asOf && !isValidYmd(asOf)) throw new ValidationError("Invalid 'asOf' date (expected YYYY-MM-DD).");
    const includeZero = String(req.query.includeZero ?? "false").toLowerCase() === "true";
    const onlyDifferences = String(req.query.onlyDifferences ?? "true").toLowerCase() === "true";
    await ledgerReportingService.assertReportableLedgerIntegrity({ companyId: req.companyId });

    // 2. All accounts in the tenant — deterministic order.
    const accounts = await models.Account.findAll({
      where: { companyId: req.companyId },
      order: [["code", "ASC"], ["id", "ASC"]],
      raw: true,
    });

    // 3. Aggregate reportable journal lines per account, optionally up to `asOf`.
    const entryWhere = { companyId: req.companyId, status: { [Op.in]: ledgerReportingService.REPORTABLE_LEDGER_STATUSES } };
    if (asOf) entryWhere.date = { [Op.lte]: asOf };
    const rows = await models.JournalLine.findAll({
      attributes: [
        "accountId",
        [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("debit")), 0), "debitTotal"],
        [models.sequelize.fn("COALESCE", models.sequelize.fn("SUM", models.sequelize.col("credit")), 0), "creditTotal"],
      ],
      include: [{
        model: models.JournalEntry,
        as: "journalEntry",
        attributes: [],
        required: true,
        where: entryWhere,
      }],
      group: [models.sequelize.col("accountId")],
      raw: true,
    });
    const totalsByAccount = new Map();
    for (const r of rows) totalsByAccount.set(r.accountId, { debitTotal: round4(r.debitTotal), creditTotal: round4(r.creditTotal) });

    // 4. Per-account comparison.
    const items = [];
    let differenceCount = 0;
    let totalAbsoluteDifference = 0;
    for (const a of accounts) {
      const tot = totalsByAccount.get(a.id) || { debitTotal: 0, creditTotal: 0 };
      const debitTotal = tot.debitTotal;
      const creditTotal = tot.creditTotal;
      // Ledger-derived balance, signed by the account's nature. NEVER uses a.balance.
      const calculatedBalance = a.nature === "credit"
        ? round4(creditTotal - debitTotal)
        : round4(debitTotal - creditTotal);
      const currentBalance = round4(a.balance);
      const difference = round4(currentBalance - calculatedBalance);
      const status = Math.abs(difference) <= 0.01 ? "matched" : "difference";
      const isDifference = status === "difference";

      // Global reconciliation signal — counted over ALL accounts, pre-display-filter.
      if (isDifference) {
        differenceCount += 1;
        totalAbsoluteDifference = round4(totalAbsoluteDifference + Math.abs(difference));
      }

      // Display filters.
      const isZero = debitTotal === 0 && creditTotal === 0 && calculatedBalance === 0 && currentBalance === 0 && difference === 0;
      if (!includeZero && isZero) continue;
      if (onlyDifferences && !isDifference) continue;

      items.push({
        accountId: a.id,
        code: a.code,
        name: a.name,
        nameAr: a.nameAr,
        type: a.type,
        nature: a.nature,
        currentBalance,
        debitTotal,
        creditTotal,
        calculatedBalance,
        difference,
        status,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        asOf,
        includeZero,
        onlyDifferences,
        accountCount: items.length,
        differenceCount,
        totalAbsoluteDifference,
        hasDifferences: differenceCount > 0,
        items,
        meta: {
          ...ledgerMeta,
          report: "ledger_reconciliation",
          reconciliation: true,
          comparedAgainst: "account_balance_mirror",
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Ledger account report by accountCode/accountId. This complements
// /accounts/:id/statement without replacing it, and keeps the GL as the source.
router.get("/reports/ledger/account", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    const accountId = req.query.accountId ? String(req.query.accountId) : null;
    const accountCode = req.query.accountCode ? String(req.query.accountCode) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId);
    if (!accountId && !accountCode) throw new ValidationError("accountId or accountCode is required.");
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");
    await ledgerReportingService.assertReportableLedgerIntegrity({ companyId: req.companyId, branchId });

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);
    const account = await models.Account.findOne({
      where: {
        companyId: req.companyId,
        ...(accountId ? { id: accountId } : { code: accountCode }),
      },
    });
    if (!account) throw new NotFoundError("Account not found.");

    const deltaOf = (debit, credit) =>
      account.nature === "debit"
        ? (Number(debit) || 0) - (Number(credit) || 0)
        : (Number(credit) || 0) - (Number(debit) || 0);

    let openingBalance = 0;
    if (from) {
      const priorLines = await models.JournalLine.findAll({
        attributes: ["debit", "credit"],
        where: { accountId: account.id },
        include: [{
          model: models.JournalEntry,
          as: "journalEntry",
          attributes: [],
          required: true,
          where: ledgerEntryWhere({ companyId: req.companyId, before: from, branchId }),
        }],
        raw: true,
      });
      openingBalance = round4(priorLines.reduce((sum, line) => sum + deltaOf(line.debit, line.credit), 0));
    }

    const lineRows = await models.JournalLine.findAll({
      where: { accountId: account.id },
      include: [{
        model: models.JournalEntry,
        as: "journalEntry",
        attributes: ["id", "date", "sourceType", "sourceId", "branchId", "createdAt"],
        required: true,
        where: ledgerEntryWhere({ companyId: req.companyId, from, to, branchId }),
      }],
      order: [
        [{ model: models.JournalEntry, as: "journalEntry" }, "date", "ASC"],
        [{ model: models.JournalEntry, as: "journalEntry" }, "createdAt", "ASC"],
        [{ model: models.JournalEntry, as: "journalEntry" }, "id", "ASC"],
        ["id", "ASC"],
      ],
    });

    let running = openingBalance;
    const allRows = lineRows.map((line) => {
      const entry = line.journalEntry;
      const debit = round4(line.debit);
      const credit = round4(line.credit);
      const delta = round4(deltaOf(debit, credit));
      running = round4(running + delta);
      return {
        journalEntryId: entry.id,
        journalLineId: line.id,
        date: entry.date,
        description: line.description,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        branchId: entry.branchId,
        debit,
        credit,
        delta,
        runningBalance: running,
      };
    });

    const debitTotal = round4(allRows.reduce((sum, row) => sum + row.debit, 0));
    const creditTotal = round4(allRows.reduce((sum, row) => sum + row.credit, 0));
    const total = allRows.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = allRows.slice(start, start + pageSize);

    return res.status(200).json({
      success: true,
      data: {
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
          nameAr: account.nameAr,
          type: account.type,
          nature: account.nature,
          balance: round4(account.balance),
        },
        from,
        to,
        branchId,
        openingBalance,
        debitTotal,
        creditTotal,
        closingBalance: total ? allRows[total - 1].runningBalance : openingBalance,
        page,
        pageSize,
        total,
        totalPages,
        items,
        meta: {
          ...ledgerMeta,
          report: "account_ledger",
          partyLevel: false,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Cash/bank reconciliation compares GL activity against operational treasury
// CashTransaction rows. It is read-only and reports differences only.
router.get("/reports/ledger/cash-reconciliation", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId);
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");
    await ledgerReportingService.assertReportableLedgerIntegrity({ companyId: req.companyId, branchId });

    const accountSpecs = [
      { key: "cash", code: "1110", label: "Cash on Hand" },
      { key: "bank", code: "1120", label: "Bank Accounts" },
    ];
    const codes = accountSpecs.map((spec) => spec.code);
    const accounts = await models.Account.findAll({
      where: { companyId: req.companyId, code: { [Op.in]: codes } },
      raw: true,
    });
    const accountByCode = new Map(accounts.map((account) => [account.code, account]));
    const openingByCode = from
      ? await ledgerTotalsByAccountCode({ companyId: req.companyId, accountCodes: codes, before: from, branchId })
      : new Map(codes.map((code) => [code, { debitTotal: 0, creditTotal: 0 }]));
    const periodByCode = await ledgerTotalsByAccountCode({ companyId: req.companyId, accountCodes: codes, from, to, branchId });

    const txWhere = {
      companyId: req.companyId,
      status: "posted",
      type: { [Op.in]: ["cash_in", "cash_out", "transfer"] },
    };
    if (from || to) {
      txWhere.date = {};
      if (from) txWhere.date[Op.gte] = from;
      if (to) txWhere.date[Op.lte] = to;
    }
    if (branchId) txWhere.branchId = branchId;
    const cashTransactions = await models.CashTransaction.findAll({
      where: txWhere,
      attributes: ["id", "type", "account", "toAccount", "amount", "date", "reference", "journalEntryId"],
      raw: true,
    });

    const txTotals = {
      cash: { debit: 0, credit: 0, transactionCount: 0 },
      bank: { debit: 0, credit: 0, transactionCount: 0 },
    };
    for (const tx of cashTransactions) {
      const amount = round4(tx.amount);
      for (const spec of accountSpecs) {
        if (tx.type === "cash_in" && tx.account === spec.key) {
          txTotals[spec.key].debit = round4(txTotals[spec.key].debit + amount);
          txTotals[spec.key].transactionCount += 1;
        } else if (tx.type === "cash_out" && tx.account === spec.key) {
          txTotals[spec.key].credit = round4(txTotals[spec.key].credit + amount);
          txTotals[spec.key].transactionCount += 1;
        } else if (tx.type === "transfer" && tx.account === spec.key) {
          txTotals[spec.key].credit = round4(txTotals[spec.key].credit + amount);
          txTotals[spec.key].transactionCount += 1;
        } else if (tx.type === "transfer" && tx.toAccount === spec.key) {
          txTotals[spec.key].debit = round4(txTotals[spec.key].debit + amount);
          txTotals[spec.key].transactionCount += 1;
        }
      }
    }

    const items = accountSpecs.map((spec) => {
      const account = accountByCode.get(spec.code) || { nature: "debit", balance: 0 };
      const opening = openingByCode.get(spec.code) || { debitTotal: 0, creditTotal: 0 };
      const period = periodByCode.get(spec.code) || { debitTotal: 0, creditTotal: 0 };
      const openingGlBalance = accountSignedBalance(account, opening.debitTotal, opening.creditTotal);
      const periodGlDebit = round4(period.debitTotal);
      const periodGlCredit = round4(period.creditTotal);
      const glNetMovement = round4(periodGlDebit - periodGlCredit);
      const operationalDebit = round4(txTotals[spec.key].debit);
      const operationalCredit = round4(txTotals[spec.key].credit);
      const operationalNetMovement = round4(operationalDebit - operationalCredit);
      return {
        account: spec.key,
        accountCode: spec.code,
        accountName: account.name || spec.label,
        openingGlBalance,
        periodGlDebit,
        periodGlCredit,
        closingGlBalance: round4(openingGlBalance + glNetMovement),
        cashTransactionInTotal: operationalDebit,
        cashTransactionOutTotal: operationalCredit,
        cashTransactionNetMovement: operationalNetMovement,
        transactionCount: txTotals[spec.key].transactionCount,
        movementDifference: round4(glNetMovement - operationalNetMovement),
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        from,
        to,
        branchId,
        items,
        totals: {
          glNetMovement: round4(items.reduce((sum, item) => sum + item.periodGlDebit - item.periodGlCredit, 0)),
          cashTransactionNetMovement: round4(items.reduce((sum, item) => sum + item.cashTransactionNetMovement, 0)),
          movementDifference: round4(items.reduce((sum, item) => sum + item.movementDifference, 0)),
        },
        meta: {
          ledgerBased: true,
          reconciliation: true,
          glSource: "journal_lines",
          operationalSource: "cash_transactions",
          readOnly: true,
          accounts: ["1110", "1120"],
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// AR/AP reconciliation compares account-level GL balances against operational
// mirrors. Party-level reconciliation is deferred because journal lines do not
// store customerId/supplierId dimensions.
router.get("/reports/ledger/ar-ap-reconciliation", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    const asOf = req.query.asOf ? String(req.query.asOf) : null;
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId);
    if (asOf && !isValidYmd(asOf)) throw new ValidationError("Invalid 'asOf' date (expected YYYY-MM-DD).");

    const accountCodes = ["1300", "2100", "2300"];
    const accounts = await models.Account.findAll({
      where: { companyId: req.companyId, code: { [Op.in]: accountCodes } },
      raw: true,
    });
    const accountByCode = new Map(accounts.map((account) => [account.code, account]));
    const ledgerTotals = await ledgerTotalsByAccountCode({ companyId: req.companyId, accountCodes, asOf, branchId });
    const ledgerBalance = (code) => {
      const account = accountByCode.get(code) || { nature: code === "1300" ? "debit" : "credit" };
      const totals = ledgerTotals.get(code) || { debitTotal: 0, creditTotal: 0 };
      return accountSignedBalance(account, totals.debitTotal, totals.creditTotal);
    };

    const customers = await models.Customer.findAll({
      where: { companyId: req.companyId },
      attributes: ["id", "balance", "status"],
      raw: true,
    });
    const suppliers = await models.Supplier.findAll({
      where: { companyId: req.companyId },
      attributes: ["id", "due", "status"],
      raw: true,
    });
    const customerBalanceTotal = round4(customers.reduce((sum, customer) => sum + (Number(customer.balance) || 0), 0));
    const supplierDueTotal = round4(suppliers.reduce((sum, supplier) => sum + (Number(supplier.due) || 0), 0));

    let customerCreditAvailableTotal = null;
    let customerCreditWarning = null;
    try {
      const creditRows = await models.CustomerCreditTransaction.findAll({
        where: { companyId: req.companyId, status: "active" },
        attributes: ["direction", "amount"],
        raw: true,
      });
      customerCreditAvailableTotal = round4(creditRows.reduce((sum, row) => {
        const amount = Number(row.amount) || 0;
        return sum + (row.direction === "credit_out" ? -amount : amount);
      }, 0));
    } catch (err) {
      customerCreditWarning = "customer_credit_transactions_unavailable";
    }

    const arGlBalance = ledgerBalance("1300");
    const apGlBalance = ledgerBalance("2100");
    const depositsGlBalance = ledgerBalance("2300");
    const items = [
      {
        key: "accountsReceivable",
        accountCode: "1300",
        accountName: accountByCode.get("1300")?.name || "Accounts Receivable",
        glBalance: arGlBalance,
        operationalBalance: customerBalanceTotal,
        operationalSource: "customers.balance",
        difference: round4(arGlBalance - customerBalanceTotal),
        recordCount: customers.length,
      },
      {
        key: "accountsPayable",
        accountCode: "2100",
        accountName: accountByCode.get("2100")?.name || "Accounts Payable",
        glBalance: apGlBalance,
        operationalBalance: supplierDueTotal,
        operationalSource: "suppliers.due",
        difference: round4(apGlBalance - supplierDueTotal),
        recordCount: suppliers.length,
      },
      {
        key: "customerDeposits",
        accountCode: "2300",
        accountName: accountByCode.get("2300")?.name || "Customer Deposits",
        glBalance: depositsGlBalance,
        operationalBalance: customerCreditAvailableTotal,
        operationalSource: "customer_credit_transactions.available_credit",
        difference: customerCreditAvailableTotal === null ? null : round4(depositsGlBalance - customerCreditAvailableTotal),
        warning: customerCreditWarning,
      },
    ];

    return res.status(200).json({
      success: true,
      data: {
        asOf,
        branchId,
        items,
        meta: {
          ledgerBased: true,
          reconciliation: true,
          glSource: "journal_lines",
          operationalSources: ["customers.balance", "suppliers.due", "customer_credit_transactions"],
          readOnly: true,
          accounts: ["1300", "2100", "2300"],
          partyLevel: false,
          reason: "Journal lines do not store customerId/supplierId",
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY VALUATION REPORT (تقييم المخزون) — READ-ONLY, grouped by karat.
// Cost value (book), market value (current gold price × weight) and the
// unrealized gain/loss — informational only, posts NO journal entry and changes
// NO balances/stock. Current valuation (not a historical snapshot).
// On-hand = assets in non-sold/melted/archived statuses + products by
// quantityOnHand. Gold weight basis = goldWeight ?? netWeight ?? grossWeight.
// ─────────────────────────────────────────────────────────────────────────────
const VALUATION_ASSET_STATUSES = ["available", "reserved", "pending_transfer", "in_workshop", "repair", "pending_tag", "returned"];

router.get("/reports/inventory-valuation", authMiddleware, requireBusinessPermission("reports.view"), async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const settings = await settingsService.getCompanySettings(companyId);
    const currency = settings.currency || "AED";
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId);
    const karatFilter = req.query.karat && req.query.karat !== "all" ? String(req.query.karat) : null;

    // Current per-gram price per gold karat (manual fixing wins over live).
    const prices = {};
    for (const k of [18, 21, 22, 24]) {
      try { prices[k] = await effectiveKaratPrice(companyId, currency, k); } catch { prices[k] = null; }
    }

    const buckets = new Map(); // key 18/21/22/24/'other'
    const bucketOf = (karat) => {
      const k = parseInt(karat, 10);
      return [18, 21, 22, 24].includes(k) ? String(k) : "other";
    };
    const ensure = (key) => {
      if (!buckets.has(key)) buckets.set(key, { karat: key, itemCount: 0, quantity: 0, totalWeight: 0, costValue: 0, marketValue: 0, unrealizedGainLoss: 0, missingCostCount: 0, missingWeightCount: 0, missingPriceCount: 0 });
      return buckets.get(key);
    };
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    // ── Serialized assets ──
    const assetWhere = { companyId, status: { [Op.in]: VALUATION_ASSET_STATUSES } };
    if (branchId) assetWhere.branchId = branchId;
    const assets = await models.Asset.findAll({ where: assetWhere });
    for (const a of assets) {
      const key = bucketOf(a.karat);
      if (karatFilter && key !== karatFilter) continue;
      const g = ensure(key);
      const weight = num(a.goldWeight) || num(a.netWeight) || num(a.grossWeight);
      const cost = num(a.cost);
      const perGram = key === "other" ? null : prices[Number(key)];
      g.itemCount += 1;
      g.quantity += 1;
      g.totalWeight = Math.round((g.totalWeight + weight) * 10000) / 10000;
      g.costValue = Math.round((g.costValue + cost) * 100) / 100;
      if (cost <= 0) g.missingCostCount += 1;
      if (weight <= 0) g.missingWeightCount += 1;
      if (!perGram) g.missingPriceCount += weight > 0 ? 1 : 0;
      else g.marketValue = Math.round((g.marketValue + weight * perGram) * 100) / 100;
    }

    // ── Quantity-based products (on-hand) ──
    const prodWhere = { companyId, isActive: true, quantityOnHand: { [Op.gt]: 0 } };
    if (branchId) prodWhere.branchId = branchId;
    const products = await models.Product.findAll({ where: prodWhere });
    for (const p of products) {
      const key = bucketOf(p.karat);
      if (karatFilter && key !== karatFilter) continue;
      const g = ensure(key);
      const qty = num(p.quantityOnHand);
      const unitCost = num(p.averageCost) || num(p.unitCost); // averageCost is the maintained inventory cost
      const cost = Math.round(unitCost * qty * 100) / 100;
      const weight = num(p.totalWeight); // maintained on-hand total weight
      const perGram = key === "other" ? null : prices[Number(key)];
      g.itemCount += 1;
      g.quantity += qty;
      g.totalWeight = Math.round((g.totalWeight + weight) * 10000) / 10000;
      g.costValue = Math.round((g.costValue + cost) * 100) / 100;
      if (unitCost <= 0) g.missingCostCount += 1;
      if (weight <= 0) g.missingWeightCount += 1;
      if (!perGram) g.missingPriceCount += weight > 0 ? 1 : 0;
      else g.marketValue = Math.round((g.marketValue + weight * perGram) * 100) / 100;
    }

    const groups = [...buckets.values()].map((g) => ({
      ...g,
      unrealizedGainLoss: Math.round((g.marketValue - g.costValue) * 100) / 100,
      pricePerGram: g.karat === "other" ? null : (prices[Number(g.karat)] ?? null),
    }));
    // Stable order: 18,21,22,24,other.
    const order = { "18": 1, "21": 2, "22": 3, "24": 4, other: 9 };
    groups.sort((a, b) => (order[a.karat] || 99) - (order[b.karat] || 99));

    const totals = groups.reduce((acc, g) => ({
      itemCount: acc.itemCount + g.itemCount,
      quantity: Math.round((acc.quantity + g.quantity) * 10000) / 10000,
      totalWeight: Math.round((acc.totalWeight + g.totalWeight) * 10000) / 10000,
      costValue: Math.round((acc.costValue + g.costValue) * 100) / 100,
      marketValue: Math.round((acc.marketValue + g.marketValue) * 100) / 100,
      unrealizedGainLoss: Math.round((acc.unrealizedGainLoss + g.unrealizedGainLoss) * 100) / 100,
      missingCostCount: acc.missingCostCount + g.missingCostCount,
      missingWeightCount: acc.missingWeightCount + g.missingWeightCount,
      missingPriceCount: acc.missingPriceCount + g.missingPriceCount,
    }), { itemCount: 0, quantity: 0, totalWeight: 0, costValue: 0, marketValue: 0, unrealizedGainLoss: 0, missingCostCount: 0, missingWeightCount: 0, missingPriceCount: 0 });

    const payload = {
      currency,
      generatedAt: new Date().toISOString(),
      valuationType: "current", // not a historical snapshot
      informational: true, // market value posts NO journal entry
      groups,
      totals,
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) {
    next(error);
  }
});

// ─── Financial aggregate report endpoints (Phase 5E-a) ───────────────────────
// Read-only, server-side summaries over POSTED invoices (companyId scoped), so
// the previously-truncated frontend financial reports can be re-enabled with
// correct figures. NO writes, NO posting/accounting changes. Returns are stored
// as NEGATIVE invoice totals, so summing posted invoice totals nets returns at
// the invoice level (Tax/Financial). The date filter uses Invoice.date, which
// is verified to be YYYY-MM-DD (sortable as a string); malformed from/to are
// ignored and reported in `filters.dateFilterRejected`.
const REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const reportNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const reportRound2 = (v) => Math.round(v * 100) / 100;

async function buildInvoiceReportWhere(req) {
  const where = { companyId: req.companyId, postingStatus: "posted" };
  const filters = {
    companyId: req.companyId,
    postedOnly: true,
    branchId: null,
    from: null,
    to: null,
    dateFilterApplied: false,
    dateFilterRejected: false,
  };
  const branchId = await resolveAuthorizedBranchId(req, req.query.branchId);
  if (branchId) { where.branchId = branchId; filters.branchId = branchId; }

  const from = req.query.from;
  const to = req.query.to;
  const fromOk = from && REPORT_DATE_RE.test(String(from));
  const toOk = to && REPORT_DATE_RE.test(String(to));
  if (fromOk || toOk) {
    where.date = {};
    if (fromOk) { where.date[Op.gte] = String(from); filters.from = String(from); }
    if (toOk) { where.date[Op.lte] = String(to); filters.to = String(to); }
    filters.dateFilterApplied = true;
  }
  if ((from && !fromOk) || (to && !toOk)) filters.dateFilterRejected = true;
  return { where, filters };
}

// GET /reports/tax-summary — posted invoices; returns net via negative totals.
router.get("/reports/tax-summary", authMiddleware, requireBusinessPermission("reports.view"), async (req, res, next) => {
  try {
    const { where, filters } = await buildInvoiceReportWhere(req);
    const invoices = await models.Invoice.findAll({ where });
    let salesTotal = 0, vatTotal = 0, netSubtotal = 0;
    for (const inv of invoices) {
      salesTotal += reportNum(inv.total);
      vatTotal += reportNum(inv.tax);
      netSubtotal += reportNum(inv.subtotal);
    }

    // Phase 12H — Input VAT / RCM from RECEIVED, non-consignment purchase orders
    // (snapshot fields from 12F/12G are the source of truth). Same from/to date
    // window as sales. branchId is resolved to the purchase-order branch NAME
    // (purchase_orders has no branch_id column) — see meta limitation. Draft /
    // sent / partial / cancelled / consignment purchases are excluded.
    const poWhere = { companyId: req.companyId, status: "received", isConsignment: false };
    if (filters.from || filters.to) {
      poWhere.date = {};
      if (filters.from) poWhere.date[Op.gte] = filters.from;
      if (filters.to) poWhere.date[Op.lte] = filters.to;
    }
    let purchaseBranchFilter = "not_applied";
    if (filters.branchId) {
      const br = await models.Branch.findOne({ where: { id: filters.branchId, companyId: req.companyId } });
      if (br && br.name) { poWhere.branch = br.name; purchaseBranchFilter = "by_resolved_name"; }
      else { purchaseBranchFilter = "branchId_unresolved_purchases_not_filtered"; }
    }
    const purchases = await models.PurchaseOrder.findAll({ where: poWhere });
    let inputVatTotal = 0, rcmOutputVatTotal = 0, rcmInputVatTotal = 0, purchasesTaxBaseTotal = 0, purchaseGrossTotal = 0;
    for (const po of purchases) {
      const isRcm = po.isRcm === true;
      const isRecoverable = po.isRecoverable !== false;
      const taxBase = reportNum(po.taxBase);
      const inputVat = reportNum(po.inputVatAmount);
      const rcmVat = reportNum(po.rcmVatAmount);
      purchaseGrossTotal += reportNum(po.total);
      purchasesTaxBaseTotal += taxBase;
      if (isRcm) {
        // RCM is net-zero: output and input each = rcmVatAmount. Never counted in
        // the ordinary inputVatTotal (avoids double-count).
        rcmOutputVatTotal += rcmVat;
        rcmInputVatTotal += rcmVat;
      } else if (isRecoverable && inputVat > 0) {
        inputVatTotal += inputVat;
      }
      // non-recoverable VAT stays capitalised in cost → not a VAT-return figure.
    }
    const outputVatTotal = vatTotal; // backward-compatible alias of the old vatTotal
    const netVatPayable = outputVatTotal + rcmOutputVatTotal - inputVatTotal - rcmInputVatTotal;

    const totals = {
      salesTotal: reportRound2(salesTotal),
      vatTotal: reportRound2(vatTotal),
      netSubtotal: reportRound2(netSubtotal),
      records: invoices.length,
      // Phase 12H additive totals (Output VAT figures above are unchanged).
      outputVatTotal: reportRound2(outputVatTotal),
      inputVatTotal: reportRound2(inputVatTotal),
      rcmOutputVatTotal: reportRound2(rcmOutputVatTotal),
      rcmInputVatTotal: reportRound2(rcmInputVatTotal),
      netVatPayable: reportRound2(netVatPayable),
      purchasesTaxBaseTotal: reportRound2(purchasesTaxBaseTotal),
      purchaseGrossTotal: reportRound2(purchaseGrossTotal),
      purchaseRecords: purchases.length,
    };
    const payload = {
      generatedAt: new Date().toISOString(),
      basis: "invoice",
      source: "source_documents",
      ledgerBased: false,
      postedOnly: true,
      returnsNetted: "via_negative_invoice_totals",
      // Phase 12B (UNCHANGED for backward compatibility — verify-vat-output): the
      // legacy `scope`/`meta` keep describing the OUTPUT-VAT view. The expanded
      // Output+Input+RCM view is exposed additively under `vatFull` below.
      scope: "output_vat",
      meta: { scope: "output_vat", includesInputVat: false, includesRcm: false },
      // Phase 12H — full VAT picture (Output + Input + RCM). Additive, does not
      // change any legacy field. netVatPayable = output + rcmOutput - input
      // - rcmInput (RCM nets to zero).
      vatFull: {
        scope: "vat_full",
        includesOutputVat: true,
        includesInputVat: true,
        includesRcm: true,
        outputVatAccountCode: "2200",
        inputVatAccountCode: "1400",
        rcmOutputAccountCode: "2210",
        purchaseBasis: "received_non_consignment_purchase_orders",
        purchaseBranchFilter,
        limitations: purchaseBranchFilter === "branchId_unresolved_purchases_not_filtered"
          ? ["branchId did not resolve to a branch; purchase figures are not branch-filtered"]
          : [],
      },
      filters,
      totals,
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) { next(error); }
});

// GET /reports/financial-summary — invoice-based (ledger-based is a future variant).
router.get("/reports/financial-summary", authMiddleware, requireBusinessPermission("reports.view"), async (req, res, next) => {
  try {
    const { where, filters } = await buildInvoiceReportWhere(req);
    const invoices = await models.Invoice.findAll({ where });
    let revenue = 0, vat = 0, receivables = 0;
    for (const inv of invoices) {
      revenue += reportNum(inv.total);
      vat += reportNum(inv.tax);
      receivables += reportNum(inv.remainingAmount);
    }
    const totals = {
      revenue: reportRound2(revenue),
      vat: reportRound2(vat),
      receivables: reportRound2(receivables),
      records: invoices.length,
      // Deferred: requires the inventory-valuation aggregate (cost basis). Left
      // null here so the frontend never presents a fabricated stock value.
      inventoryCostValue: null,
    };
    const payload = {
      generatedAt: new Date().toISOString(),
      basis: "invoice",
      postedOnly: true,
      ledgerBased: false,
      notes: [
        "Invoice-based summary; not derived from the accounting ledger.",
        "inventoryCostValue is deferred to /reports/inventory-valuation.",
      ],
      filters,
      totals,
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) { next(error); }
});

// GET /reports/profit-summary — realized gross profit from posted SALE items.
router.get("/reports/profit-summary", authMiddleware, requireBusinessPermission("reports.view"), async (req, res, next) => {
  try {
    const { where, filters } = await buildInvoiceReportWhere(req);
    // Scope to type="sale": return/exchange ITEM-level signing is unverified in
    // the data, so they are EXCLUDED rather than risk mis-signing realized
    // profit. This is surfaced in `returnsExchanges` below.
    where.type = "sale";
    const saleInvoices = await models.Invoice.findAll({ where, attributes: ["id"] });
    const saleIds = saleInvoices.map((i) => i.id);

    let revenue = 0, cogs = 0, lineCount = 0, missingCostCount = 0, zeroCostCount = 0;
    if (saleIds.length) {
      const items = await models.InvoiceItem.findAll({ where: { invoiceId: saleIds } });
      for (const it of items) {
        const qty = reportNum(it.quantity);
        revenue += reportNum(it.price) * qty;
        if (it.cost === null || it.cost === undefined) {
          missingCostCount += 1; // contributes 0 to COGS → profit may be overstated
        } else {
          const c = reportNum(it.cost);
          if (c === 0) zeroCostCount += 1;
          cogs += c * qty;
        }
        lineCount += 1;
      }
    }
    const grossProfit = revenue - cogs;
    const hasCostWarnings = missingCostCount > 0 || zeroCostCount > 0;
    const totals = {
      revenue: reportRound2(revenue),
      cogs: reportRound2(cogs),
      grossProfit: reportRound2(grossProfit),
      marginPct: revenue > 0 ? reportRound2((grossProfit / revenue) * 100) : null,
      saleInvoiceCount: saleIds.length,
      lineCount,
      missingCostCount,
      zeroCostCount,
      hasCostWarnings,
    };
    const payload = {
      generatedAt: new Date().toISOString(),
      basis: "invoice-items",
      source: "source_documents",
      ledgerBased: false,
      postedOnly: true,
      includedTypes: ["sale"],
      returnsExchanges: "excluded_pending_item_signing_review",
      profitReliability: hasCostWarnings ? "cost_warnings_present" : "ok",
      filters,
      totals,
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) { next(error); }
});

// Employee Session Management
router.get("/employees/:id/sessions", authMiddleware, requirePermission("employees.verification.view"), async (req, res, next) => {
  try {
    const employeeId = req.params.id;
    const employee = await models.Employee.findOne({
      where: { id: employeeId, companyId: req.companyId }
    });
    if (!employee) {
      throw new NotFoundError("الموظف غير موجود أو لا ينتمي لشركتك");
    }
    const sessions = await models.EmployeeSession.findAll({ where: { employeeId } });
    return res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
});

router.delete("/employees/:id/sessions/:sessionId", authMiddleware, requirePermission("employees.credentials.manage"), async (req, res, next) => {
  try {
    const { id, sessionId } = req.params;
    const employee = await models.Employee.findOne({
      where: { id, companyId: req.companyId }
    });
    if (!employee) {
      throw new NotFoundError("الموظف غير موجود أو لا ينتمي لشركتك");
    }
    await models.EmployeeSession.destroy({ where: { id: sessionId, employeeId: id } });
    return res.status(200).json({ success: true, data: { message: "Session revoked successfully" } });
  } catch (error) {
    next(error);
  }
});

// Supplier Purchase Orders, Consignments, and Documents
router.get("/suppliers/:id/purchase-orders", authMiddleware, requireBusinessPermission("suppliers.view"), async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const pos = await models.PurchaseOrder.findAll({
      where: { supplierId, companyId: req.companyId },
      include: [
        {
          model: models.PurchaseOrderItem,
          as: "items",
          include: [{ model: models.Asset, as: "asset" }],
        },
      ],
      order: [["date", "DESC"], ["createdAt", "DESC"]],
    });
    // Phase 17B — augment each PO with computed payment state so the UI can show
    // paid/remaining/status and gate the Pay button. paid is summed from supplier
    // -payment cash-outs (reference = PO.id) in ONE grouped query (no N+1).
    // Supplier.due is NOT used; no writes; /purchase-orders/:id/pay is unchanged.
    const paidMap = await supplierPaymentState.paidByReference(models, req.companyId, pos.map((p) => p.id));
    const items = pos.map((p) => ({ ...p.toJSON(), ...supplierPaymentState.computePoPaymentState(p, paidMap.get(p.id) || 0) }));
    return res.status(200).json({ success: true, items, data: items });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIER SUB-LEDGER STATEMENT (كشف حساب مورّد) — Phase 10E. READ-ONLY.
// A running-balance payable statement built from SOURCE DOCUMENTS, not the GL
// (JournalLine has no supplierId) and NOT from Supplier.due (which only ever
// increases on receive and is never reduced, so it is unreliable).
// Sources (confirmed): received purchase orders (credit = total; consignment and
// non-"received" statuses excluded) and supplier-payment cash-outs
// (category "supplier_purchase") linked to the supplier ONLY via
// CashTransaction.reference -> PurchaseOrder.id -> supplierId. Supplier.due is
// returned for REFERENCE only (with a non-destructive `difference`, and
// dueReferenceReliable:false); it is never written. opening/closing come from a
// full document scan, never from a page.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/suppliers/:id/statement", authMiddleware, requireBusinessPermission("suppliers.view"), async (req, res, next) => {
  try {
    // 1. Supplier must exist within the tenant. Never modified.
    const supplier = await models.Supplier.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!supplier) throw new NotFoundError("Supplier not found.");

    // 2. Validate the optional date window.
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");

    // 3. Pagination (rows only; capped).
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);

    // 4. Source 1 — received purchase orders (credit = total). Consignment and
    //    non-received statuses (draft/sent/partial/cancelled) are excluded.
    const pos = await models.PurchaseOrder.findAll({
      where: { supplierId: supplier.id, companyId: req.companyId, status: "received", isConsignment: { [Op.ne]: true } },
      attributes: ["id", "total", "date", "receivedDate", "createdAt"],
      raw: true,
    });

    // 5. Source 2 — supplier-payment cash-outs, linked to THIS supplier via the
    //    free-text reference -> PO id. We resolve POs with paranoid:false so a
    //    soft-deleted order still maps its payment to the supplier.
    const payTx = await models.CashTransaction.findAll({
      where: { companyId: req.companyId, type: "cash_out", category: "supplier_purchase" },
      attributes: ["id", "amount", "reference", "date", "createdAt", "description"],
      raw: true,
    });
    const refIds = [...new Set(payTx.map((tx) => tx.reference).filter(Boolean))];
    const supplierPoIds = new Set();
    if (refIds.length) {
      const refPos = await models.PurchaseOrder.findAll({
        where: { id: { [Op.in]: refIds }, companyId: req.companyId, supplierId: supplier.id },
        attributes: ["id"],
        paranoid: false, // map payments even if the PO was soft-deleted
        raw: true,
      });
      for (const p of refPos) supplierPoIds.add(p.id);
    }

    // 6. Unify into ledger rows. Supplier-payable convention: a receipt raises
    //    what we owe (credit); a payment lowers it (debit).
    const rowsAll = [];
    for (const po of pos) {
      const amount = round4(po.total);
      rowsAll.push({
        id: `PO-${po.id}`,
        type: "purchase_order",
        sourceId: po.id,
        sourceNumber: po.id,
        date: ((po.receivedDate || po.date) || "").slice(0, 10),
        createdAt: po.createdAt,
        description: `استلام أمر شراء ${po.id}`,
        debit: 0,
        credit: amount,
        sortType: "0_po",
      });
    }
    for (const tx of payTx) {
      if (!tx.reference || !supplierPoIds.has(tx.reference)) continue; // only this supplier's payments
      const amount = round4(tx.amount);
      rowsAll.push({
        id: `TX-${tx.id}`,
        type: "supplier_payment",
        sourceId: tx.id,
        sourceNumber: tx.reference || tx.id,
        date: (tx.date || "").slice(0, 10),
        createdAt: tx.createdAt,
        description: tx.description || `سداد للمورّد (${tx.reference})`,
        debit: amount,
        credit: 0,
        sortType: "1_payment",
      });
    }

    // 7. Deterministic order so the running balance is stable.
    rowsAll.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ca !== cb) return ca - cb;
      if (a.sortType !== b.sortType) return a.sortType < b.sortType ? -1 : 1;
      return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
    });

    // 8. Opening = full aggregate BEFORE `from` (0 when no `from`); period =
    //    rows within [from,to]; running computed across the WHOLE period set,
    //    then the page is sliced. delta = credit - debit (payable view).
    let openingBalance = 0;
    const periodRows = [];
    for (const r of rowsAll) {
      const delta = round4(r.credit - r.debit);
      if (from && r.date < from) {
        openingBalance = round4(openingBalance + delta);
        continue;
      }
      if (to && r.date > to) continue;
      periodRows.push({ ...r, delta });
    }

    let running = openingBalance;
    const withRunning = periodRows.map((r) => {
      running = round4(running + r.delta);
      return {
        id: r.id,
        type: r.type,
        sourceId: r.sourceId,
        sourceNumber: r.sourceNumber,
        date: r.date,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        delta: r.delta,
        runningBalance: running,
      };
    });

    const total = withRunning.length;
    const totalPages = Math.ceil(total / pageSize);
    const closingBalance = total ? withRunning[total - 1].runningBalance : openingBalance;
    const start = (page - 1) * pageSize;
    const items = withRunning.slice(start, start + pageSize);

    // 9. Supplier.due is reference-only; difference reported, never fixed.
    const supplierDueReference = round4(supplier.due);
    const difference = round4(supplierDueReference - closingBalance);

    return res.status(200).json({
      success: true,
      data: {
        supplier: {
          id: supplier.id,
          name: supplier.name,
          phone: supplier.phone,
          due: supplierDueReference,
        },
        from,
        to,
        openingBalance,
        closingBalance,
        supplierDueReference,
        difference,
        page,
        pageSize,
        total,
        totalPages,
        items,
        meta: { source: "source_documents", ledgerBased: false, readOnly: true, dueReferenceReliable: false },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/suppliers/:id/consignments", authMiddleware, requireBusinessPermission("suppliers.view"), async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const supplier = await models.Supplier.findOne({ where: { id: supplierId, companyId: req.companyId } });
    if (!supplier) throw new NotFoundError("Supplier not found.");
    const consignments = await models.SupplierConsignment.findAll({ where: { supplierId } });
    return res.status(200).json({ success: true, data: consignments });
  } catch (error) {
    next(error);
  }
});

router.get("/suppliers/:id/documents", authMiddleware, requireBusinessPermission("suppliers.view"), async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const supplier = await models.Supplier.findOne({ where: { id: supplierId, companyId: req.companyId } });
    if (!supplier) throw new NotFoundError("Supplier not found.");
    const docs = await models.SupplierDocument.findAll({ where: { supplierId } });
    return res.status(200).json({ success: true, data: docs });
  } catch (error) {
    next(error);
  }
});

router.post("/suppliers/:id/documents", authMiddleware, requireAnyBusinessPermission(["suppliers.update", "suppliers.documents.manage"], { touch: true }), uploadMiddleware.single("file"), async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const file = req.file;

    // 1. Validate supplier exists and belongs to company
    const supplier = await models.Supplier.findOne({
      where: { id: supplierId, companyId: req.companyId }
    });
    if (!supplier) {
      return res.status(404).json({ success: false, message: "المورد غير موجود" });
    }

    // 2. Validate permission
    const permissionService = require("../services/permission.service");
    const hasPermission = await permissionService.userHasAnyPermission(req.user, ["suppliers.update", "suppliers.documents.manage"]);
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: "تم رفض الدخول. لا تملك الصلاحية اللازمة لإدارة مستندات الموردين." });
    }

    // 3. Validate file exists
    if (!file) {
      return res.status(400).json({ success: false, message: "يرجى اختيار ملف لرفعه." });
    }

    // 4. Save file to backend/uploads/supplier-documents
    const fs = require("fs");
    const path = require("path");
    const baseUploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    const uploadDir = path.join(baseUploadDir, "supplier-documents");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const fileName = `${supplierId}_${timestamp}_${random}${ext}`;
    const targetPath = path.join(uploadDir, fileName);

    // Copy temporary file to target directory and delete temp file
    fs.copyFileSync(file.path, targetPath);
    fs.unlinkSync(file.path);

    const fileUrl = `/uploads/supplier-documents/${fileName}`;

    // 5. Create SupplierDocument record in database
    const docId = `DOC-${Date.now()}`;
    const newDoc = await models.SupplierDocument.create({
      id: docId,
      supplierId,
      name: req.body.name || file.originalname,
      type: req.body.type || "Other",
      expiryDate: req.body.expiryDate || new Date().toISOString().slice(0, 10),
      url: fileUrl,
      fileName,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      uploadedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      uploadedAt: new Date()
    });

    // 6. Write Audit Log
    const auditService = require("../services/audit.service");
    await auditService.record(req.companyId, {
      action: "SUPPLIER_DOCUMENT_UPLOADED",
      description: `تم رفع مستند ${newDoc.name} للمورد ${supplier.name}`,
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      userId: req.user ? req.user.id : null,
      place: req.branchId || "System",
      sourceDocument: supplier.id,
      severity: "info",
      after: JSON.stringify(newDoc.toJSON())
    });

    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "upload",
      id: docId,
      related: {
        supplierId: supplierId
      }
    });
    return res.status(201).json({
      success: true,
      data: newDoc
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/suppliers/:id/documents/:docId", authMiddleware, requireAnyBusinessPermission(["suppliers.update", "suppliers.documents.manage"], { touch: true }), async (req, res, next) => {
  try {
    const supplierId = req.params.id;
    const docId = req.params.docId;

    // 1. Validate supplier exists and belongs to company
    const supplier = await models.Supplier.findOne({
      where: { id: supplierId, companyId: req.companyId }
    });
    if (!supplier) {
      return res.status(404).json({ success: false, message: "المورد غير موجود" });
    }

    // 2. Validate permission
    const permissionService = require("../services/permission.service");
    const hasPermission = await permissionService.userHasAnyPermission(req.user, ["suppliers.update", "suppliers.documents.manage"]);
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: "تم رفض الدخول. لا تملك الصلاحية اللازمة لإدارة مستندات الموردين." });
    }

    // 3. Find supplier document
    const doc = await models.SupplierDocument.findOne({
      where: { id: docId, supplierId }
    });
    if (!doc) {
      return res.status(404).json({ success: false, message: "المستند غير موجود" });
    }

    const docDataBefore = doc.toJSON();

    // 4. Delete physical file if exists
    if (doc.url) {
      const fs = require("fs");
      const path = require("path");
      const filename = path.basename(doc.url);
      const baseUploadDir = process.env.UPLOAD_DIR
        ? path.resolve(process.env.UPLOAD_DIR)
        : path.join(__dirname, "../../../uploads");
      const filePath = path.join(baseUploadDir, "supplier-documents", filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (fileErr) {
          logger.error(`Failed to delete physical file: ${filePath}`, fileErr);
        }
      }
    }

    // 5. Delete from database
    await doc.destroy();

    // 6. Write Audit Log
    const auditService = require("../services/audit.service");
    await auditService.record(req.companyId, {
      action: "SUPPLIER_DOCUMENT_DELETED",
      description: `تم حذف مستند ${doc.name} للمورد ${supplier.name}`,
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      userId: req.user ? req.user.id : null,
      place: req.branchId || "System",
      sourceDocument: supplier.id,
      severity: "info",
      before: JSON.stringify(docDataBefore)
    });

    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "delete",
      id: docId,
      related: {
        supplierId: supplierId
      }
    });
    return res.status(200).json({
      success: true,
      message: "تم حذف المستند بنجاح"
    });
  } catch (error) {
    next(error);
  }
});

// Asset Timeline Logs
router.get("/assets/:id/timeline", authMiddleware, async (req, res, next) => {
  try {
    const assetId = req.params.id;
    const events = await models.AssetEvent.findAll({ where: { assetId }, order: [["date", "DESC"]] });
    return res.status(200).json({ success: true, items: events, data: events });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POS — Pricing preview & invoice posting
// ─────────────────────────────────────────────────────────────────────────────

// Pricing preview — sums asset prices + charges, applies discount and VAT.
router.post("/pricing/calculate", authMiddleware, async (req, res, next) => {
  try {
    const { assetIds = [], discount = 0, makingCharge = 0, stoneValue = 0 } = req.body || {};

    const products = await models.Product.findAll({
      where: { id: assetIds, companyId: req.companyId }
    });

    const assets = await models.Asset.findAll({
      where: { id: assetIds, companyId: req.companyId }
    });

    const itemsMap = new Map();
    products.forEach(p => itemsMap.set(p.id, { price: Number(p.salePrice) || 0, cost: Number(p.unitCost) || 0 }));
    assets.forEach(a => itemsMap.set(a.id, { price: Number(a.price) || 0, cost: Number(a.cost) || 0 }));

    let basePrice = 0;
    let cost = 0;
    const items = [];

    for (const id of assetIds) {
      const match = itemsMap.get(id);
      if (match) {
        basePrice += match.price;
        cost += match.cost;
        items.push({ assetId: id, price: String(match.price) });
      }
    }

    const settings = await settingsService.getCompanySettings(req.companyId);

    // VAT/totals via the SHARED sales service so preview == checkout exactly.
    // `taxBase` is the net-of-VAT amount (= total - tax) used for revenue posting.
    const { taxBase, tax, total, vatRate: vatRatePercent } = salesService.computeTotals({
      subtotal: basePrice,
      makingCharge: Number(makingCharge),
      stoneValue: Number(stoneValue),
      discount: Number(discount),
      vatRatePercent: settings.vatRate,
    });
    const journalPreview = postingService.previewInvoiceLines({
      total, tax, subtotal: taxBase, cost,
      paymentMethod: req.body.paymentMethod || "Cash",
      status: req.body.status || "paid"
    });

    // Top-level fields for direct front-end binding + nested data envelope.
    const payload = {
      subtotal: String(taxBase),
      tax: String(tax),
      total: String(total),
      vatRate: vatRatePercent,
      items,
      journalPreview
    };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) {
    next(error);
  }
});

// Create a sales invoice (draft/post). Idempotent on Idempotency-Key header.
router.post(
  "/sales/invoices/draft",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.legacy_immediate_post", {
    resolveBranchId: (req) => (req.body && req.body.branchId) || req.headers["x-branch-id"] || req.branchId
  }),
  async (req, res, next) => {
  try {
    const body = req.body || {};
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission: "sales.create",
      requestedOperation: "sales.legacy_immediate_post",
      authorizationResult: "allowed"
    });
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;

    // Return the existing invoice if this key was already used (idempotency).
    if (idempotencyKey) {
      const existing = await models.Invoice.findOne({
        where: { idempotencyKey, companyId: req.companyId }
      });
      if (existing) {
        return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
      }
    }

    const id = body.id || `INV-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const items = Array.isArray(body.items) ? body.items : [];
    await salesOperatorPolicy.assertSalesOperatorPolicy(req, "sales.legacy_immediate_post", {
      branchId: (body.branchId || req.headers["x-branch-id"] || req.branchId)
    });

    // VAT rate from settings (single source of truth) — stored on the invoice
    // so receipts/reports can show the exact rate applied at the time of sale.
    const draftSettings = await settingsService.getCompanySettings(req.companyId);
    const vatRatePercent = Number(draftSettings.vatRate) || 0;

    // Phase 18B-1 — this immediate-post route posts GL right away, so totals MUST
    // be computed server-side (like /pos/checkout), never trusted from the body.
    // Only for sale/installment (deposit uses its own amount; return reverses).
    const draftType = body.type || "sale";
    const draftIsSale = draftType !== "return" && draftType !== "deposit";
    const draftServerTotals = draftIsSale
      ? salesService.computeTotals({
          subtotal: items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0),
          makingCharge: Number(body.makingCharge) || 0,
          stoneValue: Number(body.stoneValue) || 0,
          discount: Number(body.discount) || 0,
          vatRatePercent,
        })
      : null;

    const invoice = await models.Invoice.create({
      id,
      companyId: req.companyId,
      type: body.type || "sale",
      customerId: body.customerId || "",
      customerName: body.customerName || "عميل نقدي",
      date: body.date || now,
      subtotal: draftServerTotals ? draftServerTotals.taxBase : (body.subtotal || 0),
      total: draftServerTotals ? draftServerTotals.total : (body.total || 0),
      tax: draftServerTotals ? draftServerTotals.tax : (body.tax || 0),
      vatRate: draftServerTotals ? draftServerTotals.vatRate : (body.vatRate !== undefined ? Number(body.vatRate) : vatRatePercent),
      discount: body.discount || 0,
      makingCharge: body.makingCharge || 0,
      stoneValue: body.stoneValue || 0,
      deposit: body.deposit || 0,
      status: body.status || "paid",
      paymentMethod: body.paymentMethod || "Cash",
      paymentSplits: body.paymentSplits || [],
      branch: body.branch || req.branchId || "Main Branch",
      notes: body.notes || "",
      idempotencyKey: idempotencyKey || null,
      postingStatus: "posted", // legacy misnamed immediate-post route (used by reservations)
      invoiceNumber: id,
      postedAt: now,
      finalizedByEmployeeId: commandActor.employeeId || null
    });

    // Phase 16B — resolve COGS book cost SERVER-SIDE (Asset.cost / Product
    // .averageCost). Never trust the client-supplied item.cost. Selling fields
    // (price/qty/discount/tax) are kept from the request unchanged.
    const safeItems = [];
    for (const item of items) {
      const refId = item.assetId || item.id;
      let serverCost = 0;
      if (refId) {
        const asset = await models.Asset.findOne({ where: { id: refId, companyId: req.companyId } });
        if (asset) {
          serverCost = Number(asset.cost) || 0;
        } else {
          const product = await models.Product.findOne({ where: { id: refId, companyId: req.companyId } });
          if (product) serverCost = Number(product.averageCost) || Number(product.unitCost) || 0;
        }
      }
      safeItems.push({ ...item, cost: serverCost });
    }

    // Persist line items (server book cost) and mark the sold assets.
    for (const item of safeItems) {
      await models.InvoiceItem.create({
        invoiceId: id,
        assetId: item.assetId || item.id,
        name: item.name || "",
        quantity: item.quantity || 1,
        price: item.price || 0,
        cost: item.cost,
        weight: item.weight || item.grossWeight || 0,
        karat: item.karat || null,
        discount: item.discount || 0,
        makingCharge: item.makingCharge || 0,
        stoneValue: item.stoneValue || 0
      });
      if (item.assetId || item.id) {
        await models.Asset.update(
          { status: "sold" },
          { where: { id: item.assetId || item.id, companyId: req.companyId } }
        );
      }
    }

    // ── Auto-post the double-entry journal (Financial Posting Engine) ──
    const actor = commandActor.employeeName || commandActor.technicalUserName || "System";
    const inv = invoice.toJSON();
    inv.downPayment = Number(body.downPayment) || 0;
    let journalEntry = null;
    try {
      if (inv.type === "return") {
        journalEntry = await postingService.postReturnEntry(inv, items, actor);
      } else if (inv.type === "deposit") {
        journalEntry = await postingService.postDepositEntry(inv, actor, {
          receivedAmount: Number(inv.deposit),
        });
      } else {
        journalEntry = await postingService.postInvoiceEntry(inv, safeItems, actor);
      }
    } catch (postErr) {
      // Never let a posting issue lose the sale; surface it instead.
      logger.error(`[Posting] Failed to post journal for invoice ${id}: ${postErr.message}`);
    }

    // ── Generate the installment schedule for installment sales ──
    // Uses the SAME shared scheduler as /pos/checkout so both paths agree.
    let installments = [];
    if (inv.type === "installment") {
      const financed = Math.max(0, Number(inv.total) - inv.downPayment);
      const schedule = salesService.buildInstallmentSchedule({
        remaining: financed,
        installmentCount: Math.max(1, parseInt(body.installmentCount) || 1),
        frequency: body.installmentFrequency || draftSettings.installment.defaultFrequency || "monthly",
        firstDueDate: body.firstDueDate || body.date,
        customDays: body.customDays,
      });
      for (const inst of schedule) {
        const row = await models.Installment.create({
          id: `INST-${id}-${inst.sequence}`,
          companyId: req.companyId,
          invoiceId: id,
          customerId: inv.customerId,
          customerName: inv.customerName,
          sequence: inst.sequence,
          dueDate: inst.dueDate,
          amount: inst.amount,
          paidAmount: 0,
          status: "pending",
          branch: inv.branch
        });
        installments.push(row.toJSON());
      }
    }

    // ── Award loyalty points + refresh segment for real customer sales ──
    let loyalty = null;
    if ((inv.type === "sale" || inv.type === "installment") && inv.customerId) {
      try {
        const customer = await models.Customer.findOne({ where: { id: inv.customerId, companyId: req.companyId } });
        if (customer) loyalty = await awardLoyaltyForSale(req.companyId, customer, Number(inv.total) || 0, id);
      } catch (loyErr) {
        logger.error(`[Loyalty] Failed to award points for invoice ${id}: ${loyErr.message}`);
      }
    }

    const out = invoice.toJSON();
    out.journalEntry = journalEntry;
    out.installments = installments;
    out.loyalty = loyalty;
    out.items = items; // line items live in a separate table — echo them for the receipt
    // Realtime: a POS sale touches invoices, inventory, accounts & customers.
    emitEntityChanged(req.companyId, { entity: "Invoice", action: inv.type || "create", id });
    await notificationService.createNotification(req.companyId, {
      title: "Sale created",
      message: `Invoice ${id} was created for ${inv.customerName || "customer"}.`,
      type: "success",
      entityType: "Invoice",
      entityId: id
    });
    return res.status(201).json({ success: true, ...out, data: out });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE DRAFT LIFECYCLE (P4.2) — create / edit / cancel a DRAFT only.
// A draft has ZERO side effects: no inventory, no journal, no payment/cash, no
// customer balance, no loyalty, no postedAt. Posting a draft is P4.3 (separate).
// These are the official lifecycle endpoints; generic CRUD remains blocked from
// touching lifecycle fields (P4.1a).
// ─────────────────────────────────────────────────────────────────────────────

// Lifecycle fields a draft edit must never accept directly (mirrors P4.1a).
const DRAFT_PROTECTED_FIELDS = [
  "postingStatus", "posting_status",
  "postedAt", "posted_at",
  "cancelledAt", "cancelled_at",
  "cancelReason", "cancel_reason"
];

// Validate + normalize the items array for a draft. Each item must reference an
// existing asset of this company (we do NOT change the asset — drafts are
// side-effect free). Returns the rows to persist.
async function buildDraftItems(items, companyId, transaction) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("لا يمكن إنشاء مسودة بدون أصناف");
  }
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const assetId = it.assetId || it.id;
    if (!assetId) throw new ValidationError(`الصنف رقم ${i + 1} بدون معرف أصل`);
    const asset = await models.Asset.findOne({ where: { id: assetId, companyId }, transaction });
    if (!asset) throw new ValidationError(`الأصل ${assetId} غير موجود`);
    rows.push({
      assetId,
      name: it.name || asset.name || "",
      quantity: it.quantity || 1,
      price: Number(it.price) || 0,
      // Phase 16B — COGS book cost is server-sourced (Asset.cost), never the
      // client-supplied it.cost. (buildDraftItems is asset-only.)
      cost: Number(asset.cost) || 0,
      weight: Number(it.weight || it.grossWeight) || 0,
      karat: it.karat ?? null,
      discount: Number(it.discount) || 0,
      makingCharge: Number(it.makingCharge) || 0,
      stoneValue: Number(it.stoneValue) || 0
    });
  }
  return rows;
}

// Resolve + validate the branch for a draft; returns the Branch record.
async function resolveDraftBranch(body, req, transaction) {
  const branchId = body.branchId || req.headers["x-branch-id"] || req.branchId;
  if (!branchId) throw new ValidationError("الفرع النشط مطلوب");
  const branch = await models.Branch.findOne({ where: { id: branchId, companyId: req.companyId, isActive: true }, transaction });
  if (!branch) throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");
  return branch;
}

// 1) Create a DRAFT invoice (no side effects).
router.post(
  "/sales/invoices/drafts",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.draft.create", {
    resolveBranchId: (req) => (req.body && req.body.branchId) || req.headers["x-branch-id"] || req.branchId
  }),
  async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission: "sales.create",
      requestedOperation: "sales.draft.create",
      authorizationResult: "allowed"
    });
    const actor = commandActor.employeeName || commandActor.technicalUserName || "System";
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;

    // Idempotency: same key returns the existing draft instead of a new one.
    if (idempotencyKey) {
      const existing = await models.Invoice.findOne({
        where: { idempotencyKey, companyId: req.companyId },
        include: [{ model: models.InvoiceItem, as: "items" }],
        transaction: t
      });
      if (existing) {
        await t.rollback();
        return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
      }
    }

    // Validate customer exists.
    if (!body.customerId) throw new ValidationError("العميل مطلوب لإنشاء المسودة");
    const customer = await models.Customer.findOne({ where: { id: body.customerId, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("العميل غير موجود");

    const branch = await resolveDraftBranch(body, req, t);
    const itemRows = await buildDraftItems(body.items, req.companyId, t);

    const draftSettings = await settingsService.getCompanySettings(req.companyId);
    const vatRatePercent = body.vatRate !== undefined ? Number(body.vatRate) : (Number(draftSettings.vatRate) || 0);
    // Phase 18B-1 — compute draft money fields server-side (never trust body
    // subtotal/tax/total). For sale drafts; /post recomputes again at posting.
    const draftType = body.type || "sale";
    const draftIsSale = draftType !== "return" && draftType !== "deposit";
    const draftServerTotals = draftIsSale
      ? salesService.computeTotals({
          subtotal: itemRows.reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.quantity) || 1), 0),
          makingCharge: Number(body.makingCharge) || 0,
          stoneValue: Number(body.stoneValue) || 0,
          discount: Number(body.discount) || 0,
          vatRatePercent,
        })
      : null;
    const computedSubtotal = itemRows.reduce((s, r) => s + (Number(r.price) || 0), 0);
    const id = `DRAFT-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");

    const invoice = await models.Invoice.create({
      id,
      companyId: req.companyId,
      type: body.type || "sale",
      customerId: customer.id,
      customerName: customer.name || body.customerName || "عميل",
      date: body.date || now,
      subtotal: draftServerTotals ? draftServerTotals.taxBase : (body.subtotal !== undefined ? Number(body.subtotal) : computedSubtotal),
      total: draftServerTotals ? draftServerTotals.total : (body.total !== undefined ? Number(body.total) : computedSubtotal),
      tax: draftServerTotals ? draftServerTotals.tax : (body.tax !== undefined ? Number(body.tax) : 0),
      vatRate: draftServerTotals ? draftServerTotals.vatRate : vatRatePercent,
      discount: Number(body.discount) || 0,
      makingCharge: Number(body.makingCharge) || 0,
      stoneValue: Number(body.stoneValue) || 0,
      status: "due", // payment status; a draft owes nothing yet but never "paid"
      postingStatus: "draft", // ← lifecycle: NO posting side effects
      paymentMethod: body.paymentMethod || "Cash",
      branch: branch.name,
      branchId: branch.id,
      notes: body.notes || "",
      idempotencyKey: idempotencyKey || null,
      createdByEmployeeId: commandActor.employeeId || null
      // NOTE: deliberately NO postedAt — a draft is not posted.
    }, { transaction: t });

    for (const r of itemRows) {
      await models.InvoiceItem.create({ invoiceId: id, ...r }, { transaction: t });
    }

    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "invoice.draft.create",
      description: `Draft invoice ${id} created for ${customer.name || customer.id}`,
      user: actor,
      place: branch.name,
      branch: branch.name,
      sourceDocument: id,
      severity: "info",
      before: null,
      after: JSON.stringify({ id, postingStatus: "draft", total: invoice.total, items: itemRows.length })
    }, commandActor), { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Invoice", action: "draft-create", id, related: { customerId: customer.id } });
    const out = invoice.toJSON();
    out.items = itemRows;
    return res.status(201).json({ success: true, ...out, data: out });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 2) Edit a DRAFT invoice (draft only; no side effects).
router.patch(
  "/sales/invoices/:id",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.draft.update", {
    resolveBranchId: (req) => (req.body && req.body.branchId) || req.headers["x-branch-id"] || req.branchId
  }),
  async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission: "sales.create",
      requestedOperation: "sales.draft.update",
      authorizationResult: "allowed"
    });
    // Never allow lifecycle fields to be set through the edit route.
    if (DRAFT_PROTECTED_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(body, f))) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Invoice lifecycle fields can only be changed through invoice lifecycle endpoints" });
    }

    const invoice = await models.Invoice.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!invoice) { await t.rollback(); return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" }); }
    if (invoice.postingStatus !== "draft") {
      await t.rollback();
      return res.status(409).json({ success: false, message: "يمكن تعديل المسودات فقط (هذه الفاتورة ليست مسودة)" });
    }

    const before = invoice.toJSON();
    const actor = commandActor.employeeName || commandActor.technicalUserName || "System";

    // Allowed scalar fields.
    const updates = {};
    for (const f of ["customerId", "customerName", "date", "notes", "discount", "makingCharge", "stoneValue", "paymentMethod", "total", "subtotal", "tax", "type"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    if (body.customerId !== undefined) {
      const customer = await models.Customer.findOne({ where: { id: body.customerId, companyId: req.companyId }, transaction: t });
      if (!customer) throw new NotFoundError("العميل غير موجود");
      updates.customerName = body.customerName || customer.name;
    }
    if (body.branchId !== undefined || body.branch !== undefined) {
      const branch = await resolveDraftBranch(body, req, t);
      updates.branch = branch.name;
      updates.branchId = branch.id;
    }
    await invoice.update(updates, { transaction: t });

    // Replace items if provided — NO stock effects.
    let itemRows = null;
    if (Array.isArray(body.items)) {
      itemRows = await buildDraftItems(body.items, req.companyId, t);
      await models.InvoiceItem.destroy({ where: { invoiceId: invoice.id }, transaction: t });
      for (const r of itemRows) {
        await models.InvoiceItem.create({ invoiceId: invoice.id, ...r }, { transaction: t });
      }
    }

    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "invoice.draft.update",
      description: `Draft invoice ${invoice.id} updated`,
      user: actor,
      place: invoice.branch,
      branch: invoice.branch,
      sourceDocument: invoice.id,
      severity: "info",
      before: JSON.stringify({ total: before.total, items: "(unchanged unless replaced)" }),
      after: JSON.stringify({ total: invoice.total, reason: body.reason || null, itemsReplaced: itemRows ? itemRows.length : false })
    }, commandActor), { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Invoice", action: "draft-update", id: invoice.id });
    const out = invoice.toJSON();
    if (itemRows) out.items = itemRows;
    return res.status(200).json({ success: true, ...out, data: out });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 3) Cancel a DRAFT invoice (draft only; no reversal needed — drafts have no effects).
router.post(
  "/sales/invoices/:id/cancel",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.draft.cancel", {
    resolveBranchId: (req) => (req.body && req.body.branchId) || req.headers["x-branch-id"] || req.branchId
  }),
  async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission: "sales.create",
      requestedOperation: "sales.draft.cancel",
      authorizationResult: "allowed"
    });
    const invoice = await models.Invoice.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t });
    if (!invoice) { await t.rollback(); return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" }); }

    // Idempotent: already cancelled → return it unchanged, no side effects.
    if (invoice.postingStatus === "cancelled") {
      await t.rollback();
      return res.status(200).json({ success: true, ...invoice.toJSON(), data: invoice.toJSON() });
    }
    // Only drafts can be cancelled here; a posted invoice needs a return/void.
    if (invoice.postingStatus !== "draft") {
      await t.rollback();
      return res.status(409).json({ success: false, message: "لا يمكن إلغاء فاتورة مرحَّلة من هذا المسار — استخدم المرتجع/الإلغاء المحاسبي" });
    }

    const reason = (body.reason || "").trim();
    if (!reason) {
      await t.rollback();
      return res.status(422).json({ success: false, message: "سبب الإلغاء مطلوب" });
    }

    const actor = commandActor.employeeName || commandActor.technicalUserName || "System";
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    await invoice.update({ postingStatus: "cancelled", cancelledAt: now, cancelReason: reason }, { transaction: t });

    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "invoice.draft.cancel",
      description: `Draft invoice ${invoice.id} cancelled: ${reason}`,
      user: actor,
      place: invoice.branch,
      branch: invoice.branch,
      sourceDocument: invoice.id,
      severity: "info",
      before: JSON.stringify({ postingStatus: "draft" }),
      after: JSON.stringify({ postingStatus: "cancelled", cancelledAt: now, cancelReason: reason })
    }, commandActor), { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Invoice", action: "draft-cancel", id: invoice.id });
    return res.status(200).json({ success: true, ...invoice.toJSON(), data: invoice.toJSON() });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 4) POST a DRAFT → posted (P4.3). Applies the full operational effects ONCE,
// in a single transaction, reusing the shared posting/sales services (the same
// ones /pos/checkout uses) — checkout itself is left untouched. Idempotent:
// guarded by row-lock + postingStatus, so retry/refresh cannot double-post.
//
// NOTE: the draft keeps its DRAFT-* id when posted (no PK change → no broken
// InvoiceItem FK). Assigning a final sequential invoice number at post time is a
// deliberate FOLLOW-UP (see docs) — not done here to avoid PK/relation risk.
router.post(
  "/sales/invoices/:id/post",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.post", {
    resolveBranchId: (req) => req.headers["x-branch-id"] || req.branchId
  }),
  async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission: "sales.create",
      requestedOperation: "sales.post",
      authorizationResult: "allowed"
    });
    const actor = commandActor.employeeName || commandActor.technicalUserName || "System";
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;

    // Lock the invoice row so concurrent posts serialize.
    const invoice = await models.Invoice.findOne({
      where: { id: req.params.id, companyId: req.companyId },
      lock: true,
      transaction: t
    });
    if (!invoice) { await t.rollback(); return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" }); }

    // Already posted → idempotent return for the SAME key, else 409.
    if (invoice.postingStatus === "posted") {
      await t.rollback();
      if (idempotencyKey && invoice.idempotencyKey === idempotencyKey) {
        const items = await models.InvoiceItem.findAll({ where: { invoiceId: invoice.id } });
        const out = invoice.toJSON(); out.items = items;
        return res.status(200).json({ success: true, ...out, data: out });
      }
      return res.status(409).json({ success: false, message: "الفاتورة مرحَّلة بالفعل" });
    }
    if (invoice.postingStatus !== "draft") {
      await t.rollback();
      return res.status(409).json({ success: false, message: "لا يمكن ترحيل فاتورة ملغاة" });
    }

    // Re-validate customer + active branch at post time.
    const customer = await models.Customer.findOne({ where: { id: invoice.customerId, companyId: req.companyId }, transaction: t });
    if (!customer) throw new NotFoundError("العميل غير موجود");
    const branchId = invoice.branchId;
    await salesOperatorPolicy.assertSalesOperatorPolicy(req, "sales.post", { branchId, transaction: t });
    assertOperatorBranchForCommand(req, branchId);
    const branchRecord = await models.Branch.findOne({ where: { id: branchId, companyId: req.companyId, isActive: true }, transaction: t });
    if (!branchRecord) throw new ValidationError("الفرع المحدد غير موجود أو غير نشط");

    // Draft items already exist; re-validate + LOCK each product/asset now
    // (a draft does not reserve stock, so availability must be re-checked).
    const draftItems = await models.InvoiceItem.findAll({ where: { invoiceId: invoice.id }, transaction: t });
    if (!draftItems.length) throw new ValidationError("لا يمكن ترحيل مسودة بدون أصناف");

    const validated = [];
    let subtotal = 0;
    for (const di of draftItems) {
      const itemId = di.assetId;
      const product = await models.Product.findOne({ where: { id: itemId, companyId: req.companyId }, lock: true, transaction: t });
      if (product) {
        const qty = Number(di.quantity) || 1;
        if (Number(product.quantityAvailable) < qty) {
          throw new ValidationError(`الكمية المطلوبة غير متاحة للمنتج ${product.productName}. المتاح: ${product.quantityAvailable}`);
        }
        if (product.branchId !== branchId) throw new ValidationError(`المنتج ${product.productName} تابع لفرع آخر`);
        validated.push({ isProduct: true, product, di, qty, price: Number(di.price) || 0, weight: Number(di.weight) || 0, cost: Number(di.cost) || 0 });
        subtotal += (Number(di.price) || 0) * qty;
      } else {
        const asset = await models.Asset.findOne({ where: { id: itemId, companyId: req.companyId }, lock: true, transaction: t });
        if (!asset) throw new ValidationError(`الأصل ${itemId} غير موجود`);
        if (asset.status !== "available") throw new ValidationError(`الأصل ${asset.name} (${asset.id}) غير متاح للبيع، حالته: ${asset.status}`);
        if (asset.branchId !== branchId) throw new ValidationError(`الأصل ${asset.name} تابع لفرع آخر`);
        validated.push({ isProduct: false, asset, di, price: Number(di.price) || 0, weight: Number(di.weight) || 0, cost: Number(di.cost) || 0 });
        subtotal += Number(di.price) || 0;
      }
    }

    // Totals + payment via the shared sales service (single source of truth).
    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const discount = Number(invoice.discount) || 0;
    const makingCharge = Number(invoice.makingCharge) || 0;
    const stoneValue = Number(invoice.stoneValue) || 0;
    const totals = salesService.computeTotals({ subtotal, makingCharge, stoneValue, discount, vatRatePercent: settings.vatRate });
    const paymentMethod = invoice.paymentMethod || "cash";
    const payment = salesService.resolvePayment({
      paymentMethod,
      total: totals.total,
      body: {
        downPayment: invoice.downPayment,
        installmentCount: invoice.installmentCount,
        installmentFrequency: invoice.installmentFrequency,
        firstDueDate: body.firstDueDate || invoice.date,
        deposit: invoice.deposit,
        paymentSplits: invoice.paymentSplits,
      },
      installmentRules: settings.installment,
      user: req.user,
    });
    const { paidAmount, remainingAmount, status, installmentsToCreate } = payment;
    const type = paymentMethod === "installment" ? "installment" : (paymentMethod === "deposit" ? "deposit" : (invoice.type || "sale"));
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");

    // Assign a final customer-facing number from the shared sequence (the draft
    // keeps its DRAFT-* id). Reuse an already-assigned number on idempotent retry.
    const prefix = settings.invoicePrefix || "INV-2026";
    const finalInvoiceNumber = invoice.invoiceNumber || (await nextInvoiceNumber(req.companyId, prefix, t));

    // Flip the draft to posted with the authoritative computed money fields.
    await invoice.update({
      type,
      subtotal: totals.taxBase, // net-of-VAT base so the journal balances (checkout convention)
      tax: totals.tax,
      vatRate: totals.vatRate,
      total: totals.total,
      paidAmount,
      remainingAmount,
      status,
      postingStatus: "posted",
      invoiceNumber: finalInvoiceNumber,
      postedAt: nowStr,
      idempotencyKey: idempotencyKey || invoice.idempotencyKey,
      finalizedByEmployeeId: commandActor.employeeId || null
    }, { transaction: t });

    // Inventory effects (InvoiceItems already exist — do NOT recreate them).
    for (const v of validated) {
      if (v.isProduct) {
        const product = v.product, qty = v.qty;
        product.quantityAvailable = Math.round((Number(product.quantityAvailable) - qty) * 100) / 100;
        product.quantityOnHand = Math.round((Number(product.quantityOnHand) - qty) * 100) / 100;
        product.quantitySold = Math.round((Number(product.quantitySold) + qty) * 100) / 100;
        product.totalWeight = Math.round((Number(product.totalWeight) - v.weight) * 10000) / 10000;
        await product.save({ transaction: t, skipAdjustmentHook: true });
        await models.StockMovement.create({
          id: `SM-SALE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          companyId: req.companyId, productId: product.id, productCode: product.productCode,
          type: "sale", quantityIn: 0, quantityOut: qty, weightIn: 0, weightOut: v.weight,
          unitCost: v.cost, totalCost: v.cost * qty, referenceType: "Invoice", referenceId: invoice.id,
          customerId: customer.id, branchId, createdBy: actor
        }, { transaction: t });
      } else {
        const asset = v.asset;
        await asset.update({ status: "sold" }, { transaction: t });
        await models.AssetEvent.create({
          id: `ASE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          assetId: asset.id, action: "SALE", date: nowStr.slice(0, 10), user: actor,
          branch: branchRecord.name, note: `تم البيع بموجب الفاتورة رقم ${invoice.id}`,
          sourceDocument: invoice.id, beforeState: "status:available", afterState: "status:sold"
        }, { transaction: t });
      }
    }

    // Payments (mirror checkout: split / installment down payment / single).
    const paymentsCreated = [];
    const mkPay = async (method, amount, notes) => {
      const p = await models.Payment.create({
        id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId, branchId, invoiceId: invoice.id,
        paymentMethod: method, amount, reference: body.reference || "",
        date: invoice.date || nowStr.slice(0, 10), notes,
        receivedByEmployeeId: commandActor.employeeId || null
      }, { transaction: t });
      paymentsCreated.push(p.toJSON());
    };
    if (paymentMethod === "split") {
      for (const s of (Array.isArray(invoice.paymentSplits) ? invoice.paymentSplits : [])) {
        await mkPay(s.method, s.amount, `دفع مجزأ للفاتورة ${invoice.id}`);
      }
    } else if (paymentMethod === "installment") {
      if (paidAmount > 0) await mkPay("cash", paidAmount, `دفعة أولى للفاتورة ${invoice.id}`);
    } else if (paidAmount > 0) {
      await mkPay(paymentMethod, paidAmount, paymentMethod === "deposit" ? `عربون للفاتورة ${invoice.id}` : `سداد للفاتورة ${invoice.id}`);
    }

    // Installment schedule.
    const createdInstallments = [];
    for (const inst of installmentsToCreate) {
      const row = await models.Installment.create({
        id: `INST-${invoice.id}-${inst.sequence}`, companyId: req.companyId, invoiceId: invoice.id,
        customerId: customer.id, customerName: customer.name, sequence: inst.sequence,
        dueDate: inst.dueDate, amount: inst.amount, paidAmount: 0, status: "pending", branch: branchRecord.name
      }, { transaction: t });
      createdInstallments.push(row.toJSON());
    }

    // Journal entry (balanced; failure throws → whole post rolls back).
    // Phase 16B — recompute COGS book cost SERVER-SIDE at post time (defense-in-
    // depth; also protects drafts saved before this fix). The stored
    // InvoiceItem.cost is NOT trusted for COGS. assetId may reference an Asset or
    // (for quantity products) a Product. No silent client/stored fallback.
    const safeDraftItems = [];
    for (const di of draftItems) {
      const d = di.toJSON();
      let serverCost = null;
      if (d.assetId) {
        const asset = await models.Asset.findOne({ where: { id: d.assetId, companyId: req.companyId }, transaction: t });
        if (asset) {
          serverCost = Number(asset.cost) || 0;
        } else {
          const product = await models.Product.findOne({ where: { id: d.assetId, companyId: req.companyId }, transaction: t });
          if (product) serverCost = Number(product.averageCost) || Number(product.unitCost) || 0;
        }
      }
      if (serverCost === null) throw new ValidationError(`تعذّر تحديد تكلفة الصنف ${d.assetId || d.id} من السيرفر للترحيل`);
      safeDraftItems.push({ ...d, cost: serverCost });
    }

    const invPlain = invoice.toJSON();
    invPlain.downPayment = Number(invoice.downPayment) || 0;
    let journalEntry;
    try {
      if (type === "deposit") {
        journalEntry = await postingService.postDepositEntry(invPlain, actor, {
          transaction: t,
          receivedAmount: paidAmount,
        });
      } else {
        journalEntry = await postingService.postInvoiceEntry(invPlain, safeDraftItems, actor, { transaction: t });
      }
    } catch (postErr) {
      logger.error(`[Posting] Failed to post journal for draft ${invoice.id}: ${postErr.message}`);
      throw new Error(`خطأ في إنشاء القيد المحاسبي: ${postErr.message}`);
    }

    // Treasury cash-in per payment.
    for (const pay of paymentsCreated) {
      const m = pay.paymentMethod.toLowerCase();
      const account = (m.includes("card") || m.includes("bank") || m.includes("transfer")) ? "bank" : "cash";
      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId, branchId, branch: branchRecord.name, type: "cash_in", account,
        amount: pay.amount, category: type === "deposit" ? "عربون عميل" : "مبيعات مجوهرات",
        description: `مقبوضات فاتورة ${invoice.id} - ${pay.paymentMethod}`, reference: invoice.id,
        date: invoice.date || nowStr.slice(0, 10), status: "posted",
        createdBy: req.user ? req.user.id : "System", journalEntryId: journalEntry ? journalEntry.id : null
      }, { transaction: t });
    }

    // Loyalty + customer balance (only when something is owed) — inside the tx.
    const loyalty = await awardLoyaltyForSale(req.companyId, customer, totals.total, invoice.id, { transaction: t });
    if (remainingAmount > 0) {
      await customer.update(
        { balance: Math.round((Number(customer.balance || 0) + remainingAmount) * 100) / 100 },
        { transaction: t }
      );
    }

    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "invoice.draft.post",
      description: `Draft invoice ${invoice.id} posted (total ${totals.total})`,
      user: actor,
      place: branchRecord.name, branch: branchRecord.name, sourceDocument: invoice.id,
      severity: "info",
      before: JSON.stringify({ postingStatus: "draft" }),
      after: JSON.stringify({ postingStatus: "posted", postedAt: nowStr, total: totals.total, paymentMethod, idempotencyKey: idempotencyKey || null })
    }, commandActor), { transaction: t });

    const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
    await recalculateCustomerNetPurchases(models, req.companyId, customer.id, { transaction: t });

    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Invoice", action: "post", id: invoice.id, branchId, related: { customerId: customer.id } });
    await notificationService.createNotification(req.companyId, {
      title: "ترحيل فاتورة", message: `تم ترحيل الفاتورة ${invoice.id} للعميل ${customer.name}.`,
      type: "success", entityType: "Invoice", entityId: invoice.id
    });

    const out = invoice.toJSON();
    out.journalEntry = journalEntry;
    out.payments = paymentsCreated;
    out.installments = createdInstallments;
    out.loyalty = loyalty;
    out.items = draftItems.map((d) => d.toJSON());
    return res.status(200).json({ success: true, ...out, data: out });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS BY KEY (إعدادات مفتاح/قيمة) — e.g. receipt customization
// ─────────────────────────────────────────────────────────────────────────────

// Read a settings document by key (returns its value JSON, or null).
// Per-user view preferences persisted via the settings table but excluded from
// the audit chain (they are convenience UI state, not operational config).
const SETTINGS_AUDIT_EXCLUDED_KEYS = new Set(["inventory-columns"]);

router.get("/settings/by-key/:key", authMiddleware, requirePermission("settings.view"), async (req, res, next) => {
  try {
    const row = await models.Setting.findOne({
      where: { companyId: req.companyId, key: req.params.key }
    });
    const value = row ? row.value : null;
    return res.status(200).json({ success: true, key: req.params.key, value, data: value });
  } catch (error) {
    next(error);
  }
});

// Upsert a settings document by key.
router.put("/settings/by-key/:key", authMiddleware, requirePermission("settings.update"), async (req, res, next) => {
  try {
    const value = req.body && req.body.value !== undefined ? req.body.value : req.body;
    const [row, created] = await models.Setting.findOrCreate({
      where: { companyId: req.companyId, key: req.params.key },
      defaults: { companyId: req.companyId, key: req.params.key, value }
    });
    const before = created ? null : row.value;
    if (!created) await row.update({ value });

    // Audit operational settings mutations (this by-key path previously wrote
    // no audit row, unlike PATCH /settings). Routed through auditService so it
    // joins the tamper-evident hash chain. Pure per-user view preferences
    // (e.g. inventory column visibility) are intentionally excluded so toggling
    // a column does not flood the financial audit chain with low-value rows.
    if (!SETTINGS_AUDIT_EXCLUDED_KEYS.has(req.params.key)) {
      await auditService.record(req.companyId, {
        action: "settings.update",
        description: `Setting "${req.params.key}" updated`,
        user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
        userId: req.user ? req.user.id : null,
        place: req.branchId || "System",
        sourceDocument: req.params.key,
        severity: "info",
        before: before === null ? null : JSON.stringify(before),
        after: JSON.stringify(value)
      });
    }

    emitEntityChanged(req.companyId, { entity: "Settings", action: "update", id: req.params.key });
    return res.status(200).json({ success: true, key: req.params.key, value: row.value, data: row.value });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IMMUTABLE AUDIT (سجل التدقيق غير القابل للتعديل) — append-only + hash chain
// ─────────────────────────────────────────────────────────────────────────────
const auditController = new ErpController(models.AuditLog, ["description", "user", "place", "action"]);

// List + read (reuse the generic controller's pagination/filtering).
router.get("/audit-logs", authMiddleware, auditController.list);

// Verify the tamper-evident hash chain. Registered before :id so "verify"
// is not captured as an audit id.
router.get("/audit-logs/verify", authMiddleware, async (req, res, next) => {
  try {
    const result = await auditService.verifyChain(req.companyId);
    return res.status(200).json({ success: true, ...result, data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/audit-logs/:id", authMiddleware, auditController.getById);

// Append a new audit entry (chained + hashed). No update/delete routes exist.
router.post("/audit-logs", authMiddleware, async (req, res, next) => {
  try {
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : (req.body.user || "System");
    const row = await auditService.record(req.companyId, {
      ...req.body,
      user: req.body.user || actor,
      userId: req.body.userId || (req.user ? req.user.id : null)
    });
    return res.status(201).json({ success: true, ...row.toJSON(), data: row.toJSON() });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOYALTY & SEGMENTATION (الولاء وتقسيم العملاء)
// ─────────────────────────────────────────────────────────────────────────────

// Tunable loyalty rules.
const LOYALTY_EARN_RATE = 0.1; // points earned per 1 currency spent
const LOYALTY_REDEEM_RATE = 0.1; // currency value per 1 point redeemed
// Auto-tier thresholds by lifetime purchases.
const SEGMENT_THRESHOLDS = { VIP: 100000, Gold: 30000 };

function tierForPurchases(purchases) {
  const p = Number(purchases) || 0;
  if (p >= SEGMENT_THRESHOLDS.VIP) return "VIP";
  if (p >= SEGMENT_THRESHOLDS.Gold) return "Gold";
  return "Standard";
}

// Award loyalty points for a sale and refresh the customer's tier.
// Safe to call inside a sale flow — callers wrap it so it never blocks a sale.
async function awardLoyaltyForSale(companyId, customer, amount, invoiceId, opts = {}) {
  const pts = Math.floor(Number(amount) * LOYALTY_EARN_RATE);
  const newPurchases = parseFloat(customer.purchases || 0) + Number(amount);
  const newPoints = (customer.loyaltyPoints || 0) + pts;
  const tier = tierForPurchases(newPurchases);
  await customer.update(
    { purchases: newPurchases, loyaltyPoints: newPoints, tier, lastVisit: new Date().toISOString().slice(0, 10) },
    { transaction: opts.transaction }
  );
  if (pts > 0) {
    await models.LoyaltyTransaction.create({
      id: `LYT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId, customerId: customer.id, customerName: customer.name,
      type: "earn", points: pts, balanceAfter: newPoints,
      invoiceId, date: new Date().toISOString().slice(0, 10)
    }, { transaction: opts.transaction });
  }
  return { points: pts, balance: newPoints, tier };
}

// Segment overview: customer counts and lifetime purchases per tier.
router.get("/loyalty/segments", authMiddleware, async (req, res, next) => {
  try {
    const customers = await models.Customer.findAll({ where: { companyId: req.companyId } });
    const segments = { VIP: { count: 0, purchases: 0, points: 0 }, Gold: { count: 0, purchases: 0, points: 0 }, Standard: { count: 0, purchases: 0, points: 0 } };
    customers.forEach((c) => {
      const tier = c.tier || "Standard";
      const s = segments[tier] || segments.Standard;
      s.count += 1;
      s.purchases += parseFloat(c.purchases || 0);
      s.points += c.loyaltyPoints || 0;
    });
    return res.status(200).json({ success: true, segments, thresholds: SEGMENT_THRESHOLDS, data: { segments } });
  } catch (error) {
    next(error);
  }
});

// Recompute every customer's tier from lifetime purchases.
router.post("/loyalty/recalculate-segments", authMiddleware, async (req, res, next) => {
  try {
    const customers = await models.Customer.findAll({ where: { companyId: req.companyId } });
    let updated = 0;
    for (const c of customers) {
      const tier = tierForPurchases(c.purchases);
      if (tier !== c.tier) { await c.update({ tier }); updated += 1; }
    }
    return res.status(200).json({ success: true, updated, total: customers.length, data: { updated } });
  } catch (error) {
    next(error);
  }
});

// Loyalty transactions ledger (optionally by customer).
router.get("/loyalty/transactions", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.customerId) where.customerId = req.query.customerId;
    const rows = await models.LoyaltyTransaction.findAll({
      where, order: [["created_at", "DESC"]], limit: parseInt(req.query.pageSize) || 200
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// A customer's loyalty summary + recent ledger.
router.get("/customers/:id/loyalty", authMiddleware, async (req, res, next) => {
  try {
    const c = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!c) return res.status(404).json({ success: false, message: "العميل غير موجود" });
    const ledger = await models.LoyaltyTransaction.findAll({
      where: { companyId: req.companyId, customerId: c.id }, order: [["created_at", "DESC"]], limit: 50
    });
    const out = {
      customerId: c.id, customerName: c.name, tier: c.tier,
      loyaltyPoints: c.loyaltyPoints || 0, purchases: parseFloat(c.purchases || 0),
      redeemValue: Math.round((c.loyaltyPoints || 0) * LOYALTY_REDEEM_RATE * 100) / 100,
      ledger
    };
    return res.status(200).json({ success: true, ...out, data: out });
  } catch (error) {
    next(error);
  }
});

// Manually award/earn points (by explicit points or by spend amount).
router.post("/customers/:id/loyalty/earn", authMiddleware, async (req, res, next) => {
  try {
    const c = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!c) return res.status(404).json({ success: false, message: "العميل غير موجود" });
    const pts = req.body.points != null
      ? parseInt(req.body.points)
      : Math.floor((Number(req.body.amount) || 0) * LOYALTY_EARN_RATE);
    if (!pts || pts <= 0) return res.status(422).json({ success: false, message: "نقاط غير صالحة" });
    const newPoints = (c.loyaltyPoints || 0) + pts;
    await c.update({ loyaltyPoints: newPoints });
    const txn = await models.LoyaltyTransaction.create({
      id: `LYT-${Date.now()}`, companyId: req.companyId, customerId: c.id, customerName: c.name,
      type: "earn", points: pts, balanceAfter: newPoints, date: new Date().toISOString().slice(0, 10),
      notes: req.body.notes || null
    });
    return res.status(201).json({ success: true, balance: newPoints, ...txn.toJSON(), data: txn.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Redeem points for monetary value (returns the value the POS can apply).
router.post("/customers/:id/loyalty/redeem", authMiddleware, async (req, res, next) => {
  try {
    const c = await models.Customer.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!c) return res.status(404).json({ success: false, message: "العميل غير موجود" });
    const pts = parseInt(req.body.points);
    if (!pts || pts <= 0) return res.status(422).json({ success: false, message: "نقاط غير صالحة" });
    if (pts > (c.loyaltyPoints || 0)) {
      return res.status(409).json({ success: false, message: "النقاط المطلوبة أكبر من الرصيد" });
    }
    const value = Math.round(pts * LOYALTY_REDEEM_RATE * 100) / 100;
    const newPoints = (c.loyaltyPoints || 0) - pts;
    await c.update({ loyaltyPoints: newPoints });
    const txn = await models.LoyaltyTransaction.create({
      id: `LYT-${Date.now()}`, companyId: req.companyId, customerId: c.id, customerName: c.name,
      type: "redeem", points: -pts, value, balanceAfter: newPoints, invoiceId: req.body.invoiceId || null,
      date: new Date().toISOString().slice(0, 10)
    });
    return res.status(201).json({ success: true, balance: newPoints, value, ...txn.toJSON(), data: txn.toJSON() });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL & ATTENDANCE (الرواتب والحضور)
// ─────────────────────────────────────────────────────────────────────────────

// Attendance list (filter by employee / date).
router.get("/attendance", authMiddleware, requirePermission("payroll.view"), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.date) where.date = req.query.date;
    const rows = await models.Attendance.findAll({
      where, order: [["date", "DESC"], ["created_at", "DESC"]], limit: parseInt(req.query.pageSize) || 300
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// Check-in: create today's attendance row for an employee.
router.post("/attendance/check-in", authMiddleware, requirePermission("payroll.manage"), async (req, res, next) => {
  try {
    const emp = await models.Employee.findOne({ where: { id: req.body.employeeId, companyId: req.companyId } });
    if (!emp) return res.status(404).json({ success: false, message: "الموظف غير موجود" });
    const today = new Date().toISOString().slice(0, 10);
    let row = await models.Attendance.findOne({ where: { companyId: req.companyId, employeeId: emp.id, date: today } });
    if (row && row.checkIn) {
      return res.status(409).json({ success: false, message: "تم تسجيل الحضور بالفعل اليوم" });
    }
    const now = new Date().toISOString();
    if (row) {
      await row.update({ checkIn: now });
    } else {
      row = await models.Attendance.create({
        id: `ATT-${emp.id}-${today}`, companyId: req.companyId, employeeId: emp.id, employeeName: emp.name,
        date: today, checkIn: now, status: "present", branch: emp.branch
      });
    }
    return res.status(201).json({ success: true, ...row.toJSON(), data: row.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Check-out: stamp check-out and compute hours worked.
router.post("/attendance/check-out", authMiddleware, requirePermission("payroll.manage"), async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const row = await models.Attendance.findOne({ where: { companyId: req.companyId, employeeId: req.body.employeeId, date: today } });
    if (!row || !row.checkIn) return res.status(404).json({ success: false, message: "لا يوجد تسجيل حضور اليوم" });
    const now = new Date();
    const hours = Math.round(((now - new Date(row.checkIn)) / 3600000) * 100) / 100;
    await row.update({ checkOut: now.toISOString(), hours: hours > 0 ? hours : 0 });
    return res.status(200).json({ success: true, ...row.toJSON(), data: row.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Payslips list (filter by period / status / employee).
router.get("/payslips", authMiddleware, requirePermission("payroll.view"), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.period) where.period = req.query.period;
    if (req.query.status) where.status = req.query.status;
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    const rows = await models.Payslip.findAll({
      where, order: [["period", "DESC"], ["employee_name", "ASC"]], limit: parseInt(req.query.pageSize) || 300
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// Generate draft payslips for all active employees for a period (YYYY-MM).
router.post("/payroll/generate", authMiddleware, requirePermission("payroll.manage"), async (req, res, next) => {
  try {
    const period = req.body.period || new Date().toISOString().slice(0, 7);
    const employees = await models.Employee.findAll({ where: { companyId: req.companyId, status: ["present", "leave"] } });
    const created = [];
    for (const e of employees) {
      const exists = await models.Payslip.findOne({ where: { companyId: req.companyId, employeeId: e.id, period } });
      if (exists) continue;
      const base = parseFloat(e.baseSalary || 0);
      const allow = parseFloat(e.allowances || 0);
      const net = Math.round((base + allow) * 100) / 100;
      const slip = await models.Payslip.create({
        id: `PS-${period}-${e.id}`, companyId: req.companyId, employeeId: e.id, employeeName: e.name,
        period, baseSalary: base, allowances: allow, overtime: 0, deductions: 0, net,
        status: "draft", branch: e.branch
      });
      created.push(slip.toJSON());
    }
    return res.status(201).json({ success: true, created: created.length, items: created, data: { items: created } });
  } catch (error) {
    next(error);
  }
});

// Pay a payslip + auto-post the salary journal entry.
router.post("/payslips/:id/pay", authMiddleware, requirePermission("payroll.manage"), async (req, res, next) => {
  try {
    const slip = await models.Payslip.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!slip) return res.status(404).json({ success: false, message: "كشف الراتب غير موجود" });

    // Phase 21.5 — central race-safe idempotency (unique company_id+scope+key),
    // replacing the optional-key lookup-only check. The key is now REQUIRED and
    // req.params (the payslip id) is folded into the request hash.
    const idempotencyKey = req.headers["idempotency-key"] || req.body.idempotencyKey;
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لصرف الراتب" });
    }
    const idemScope = "payroll.payslip_payment";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, req.body, req.params);

    if (slip.status === "paid") return res.status(409).json({ success: false, message: "تم صرف الراتب بالفعل" });

    const method = req.body.paymentMethod || "Cash";
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    let idemResponseBody = null;
    try {
      await models.sequelize.transaction(async (t) => {
        // Claim the idempotency key FIRST inside the business transaction; a
        // concurrent duplicate fails the unique insert → rollback → replay.
        const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
        if (!idemClaim.claimed) {
          const dup = new Error("__IDEM_DUPLICATE__");
          dup.__idemDuplicate = true;
          throw dup;
        }
        const idemRequest = idemClaim.request;

        // Phase 21.5 — post the payroll journal INSIDE the transaction (was a
        // best-effort post-then-swallow before): a posting failure now rolls back
        // the whole payment, so a payslip is never marked paid without its GL entry.
        const journalEntry = await postingService.postPayrollEntry(slip.toJSON(), method, actor, { transaction: t });
        await slip.update({
          status: "paid", paidDate: new Date().toISOString().slice(0, 10),
          paymentMethod: method, journalEntryId: journalEntry ? journalEntry.id : null,
          idempotencyKey: idempotencyKey || slip.idempotencyKey
        }, { transaction: t });

        const out = slip.toJSON();
        out.journalEntry = journalEntry;
        idemResponseBody = { success: true, ...out, data: out };
        await idempotencyService.succeed({ request: idemRequest, statusCode: 200, responseBody: idemResponseBody, transaction: t });
      });
    } catch (txErr) {
      if (txErr && txErr.__idemDuplicate) {
        const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
        if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
        return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
      }
      throw txErr;
    }

    return res.status(200).json(idemResponseBody);
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GOLD CENTER (مركز الذهب) — karat prices, item quoting & rate fixing
// ─────────────────────────────────────────────────────────────────────────────

// Latest manual gold-price row for a karat, TENANT-SAFE: prefer the company's
// own price, else fall back to a legacy/global row (company_id IS NULL). A
// company NEVER reads another company's price.
async function findLatestGoldPrice(companyId, currency, karat) {
  const k = parseInt(karat);
  let row = await models.GoldPrice.findOne({ where: { companyId, currency, karat: k }, order: [["updated_at", "DESC"]] });
  if (!row) row = await models.GoldPrice.findOne({ where: { companyId: null, currency, karat: k }, order: [["updated_at", "DESC"]] });
  return row;
}

// Effective per-gram rate for a karat: a manual daily fixing wins over the
// live-derived rate, so quotes and fixings honour the rate the shop set.
async function effectiveKaratPrice(companyId, currency, karat) {
  const override = await findLatestGoldPrice(companyId, currency, karat);
  if (override) return parseFloat(override.pricePerGram);
  const snap = await goldService.getKaratPrices(currency, [parseInt(karat)]);
  return snap.prices[0].pricePerGram;
}

// Derived per-gram karat prices (from the live feed) merged with any manual
// daily fixings stored in gold_prices (manual overrides win).
router.get("/gold/karat-prices", authMiddleware, async (req, res, next) => {
  try {
    const currency = req.query.currency || "AED";
    const snap = await goldService.getKaratPrices(currency);
    // Tenant-safe: the company's own prices win per karat; legacy/global
    // (company_id NULL) rows only fill karats the company has not fixed.
    const companyOverrides = await models.GoldPrice.findAll({
      where: { companyId: req.companyId, currency },
      order: [["updated_at", "DESC"]]
    });
    const legacyOverrides = await models.GoldPrice.findAll({
      where: { companyId: null, currency },
      order: [["updated_at", "DESC"]]
    });
    const byKarat = {};
    companyOverrides.forEach((o) => { if (!byKarat[o.karat]) byKarat[o.karat] = o; });
    legacyOverrides.forEach((o) => { if (!byKarat[o.karat]) byKarat[o.karat] = o; });
    const prices = snap.prices.map((p) => {
      const o = byKarat[p.karat];
      return o
        ? { ...p, pricePerGram: parseFloat(o.pricePerGram), source: "manual", updatedBy: o.updatedBy }
        : { ...p, source: "live" };
    });
    return res.status(200).json({ success: true, ...snap, prices, data: { ...snap, prices } });
  } catch (error) {
    next(error);
  }
});

// Manually fix (lock) today's per-gram price for one or more karats.
router.post("/gold/karat-prices", authMiddleware, async (req, res, next) => {
  try {
    const currency = req.body.currency || "AED";
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const entries = Array.isArray(req.body.prices) ? req.body.prices : [];
    if (!entries.length) {
      return res.status(422).json({ success: false, message: "لا توجد أسعار للحفظ" });
    }
    const saved = [];
    const auditChanges = [];
    for (const e of entries) {
      const karat = parseInt(e.karat);
      const newPrice = Number(e.pricePerGram);
      // Previous effective price for this karat (company-scoped), for the audit "before".
      const prev = await findLatestGoldPrice(req.companyId, currency, karat);
      const row = await models.GoldPrice.create({
        karat,
        pricePerGram: newPrice,
        currency,
        updatedBy: actor,
        companyId: req.companyId, // tenant-scoped write
        source: "manual"
      });
      saved.push(row.toJSON());
      auditChanges.push({ karat, oldPrice: prev ? Number(prev.pricePerGram) : null, newPrice });
    }

    // Audit the manual gold-price fixing (was previously unaudited). Each POST
    // appends a new gold_prices row, so the row log IS the price history; this
    // records the before/after in the tamper-evident chain too.
    await auditService.record(req.companyId, {
      action: "gold_price.update",
      description: `Gold prices updated (${currency}): ${auditChanges.map((c) => `${c.karat}K ${c.oldPrice ?? "-"}→${c.newPrice}`).join(", ")}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: req.branchId || "System",
      sourceDocument: "gold-prices",
      severity: "info",
      before: JSON.stringify(auditChanges.map((c) => ({ karat: c.karat, pricePerGram: c.oldPrice }))),
      after: JSON.stringify(auditChanges.map((c) => ({ karat: c.karat, pricePerGram: c.newPrice, source: "manual" })))
    });

    return res.status(201).json({ success: true, items: saved, data: { items: saved } });
  } catch (error) {
    next(error);
  }
});

// Quote an item: metal value + making charge + stone value + VAT.
router.post("/gold/quote", authMiddleware, async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const currency = req.body.currency || settings.currency || "AED";
    const karat = Number(req.body.karat) || 21;
    const perGram = await effectiveKaratPrice(req.companyId, currency, karat);
    const quote = await goldService.quoteItem({
      grossWeight: Number(req.body.grossWeight) || 0,
      karat,
      makingCharge: Number(req.body.makingCharge) || 0,
      stoneValue: Number(req.body.stoneValue) || 0,
      currency,
      vatRate: (Number(settings.vatRate) || 0) / 100,
      perGram
    });
    return res.status(200).json({ success: true, ...quote, data: quote });
  } catch (error) {
    next(error);
  }
});

// List gold fixings (optionally by status).
router.get("/gold/fixings", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.status) where.status = req.query.status;
    const rows = await models.GoldFixing.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: parseInt(req.query.pageSize) || 200
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// Fix (lock) the rate for a gold weight position at the current/quoted rate.
router.post("/gold/fixings", authMiddleware, async (req, res, next) => {
  try {
    const b = req.body || {};
    const currency = b.currency || "AED";
    const karat = parseInt(b.karat) || 21;
    const grossWeight = Number(b.grossWeight) || 0;
    if (grossWeight <= 0) {
      return res.status(422).json({ success: false, message: "الوزن يجب أن يكون أكبر من صفر" });
    }
    // Use the supplied rate, otherwise lock at the effective karat price
    // (manual daily fixing wins over the live-derived rate).
    let ratePerGram = Number(b.ratePerGram);
    if (!ratePerGram || ratePerGram <= 0) {
      ratePerGram = await effectiveKaratPrice(req.companyId, currency, karat);
    }
    const purity = Number(b.purity) || goldService.constructor.purityFor(karat);
    const fineWeight = Math.round(grossWeight * purity * 10000) / 10000;
    const value = Math.round(grossWeight * ratePerGram * 100) / 100;
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const fixing = await models.GoldFixing.create({
      id: `GF-${Date.now()}`,
      companyId: req.companyId,
      customerId: b.customerId || null,
      customerName: b.customerName || null,
      direction: b.direction === "sell" ? "sell" : "buy",
      karat,
      grossWeight,
      fineWeight,
      ratePerGram,
      value,
      currency,
      status: "fixed",
      fixedAt: new Date().toISOString(),
      fixedBy: actor,
      notes: b.notes || null
    });

    return res.status(201).json({ success: true, ...fixing.toJSON(), data: fixing.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Unfix (release) a fixing back to a floating weight position.
router.post("/gold/fixings/:id/unfix", authMiddleware, async (req, res, next) => {
  try {
    const fixing = await models.GoldFixing.findOne({
      where: { id: req.params.id, companyId: req.companyId }
    });
    if (!fixing) return res.status(404).json({ success: false, message: "التثبيت غير موجود" });
    if (fixing.status === "settled") {
      return res.status(409).json({ success: false, message: "تمت تسوية هذا التثبيت ولا يمكن فكّه" });
    }
    await fixing.update({ status: "unfixed", unfixedAt: new Date().toISOString() });
    return res.status(200).json({ success: true, ...fixing.toJSON(), data: fixing.toJSON() });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTALLMENTS (التقسيط) — schedule listing & collection
// ─────────────────────────────────────────────────────────────────────────────

// List installments (optionally by invoice or status), newest due first.
router.get("/installments", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.invoiceId) where.invoiceId = req.query.invoiceId;
    if (req.query.status) where.status = req.query.status;
    const rows = await models.Installment.findAll({
      where,
      order: [["due_date", "ASC"]],
      limit: parseInt(req.query.pageSize) || 200
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

// Pay (collect) an installment + auto-post the journal.
router.post(
  "/installments/:id/pay",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.installment.collect", {
    resolveBranchId: resolveInstallmentCollectionBranchId
  }),
  async (req, res, next) => {
  try {
    const inst = await models.Installment.findOne({
      where: { id: req.params.id, companyId: req.companyId }
    });
    if (!inst) return res.status(404).json({ success: false, message: "القسط غير موجود" });

    // Phase 21.4 — central race-safe idempotency (unique company_id+scope+key),
    // replacing the optional-key lookup-only check. The key is now REQUIRED and
    // req.params (the installment id) is folded into the request hash, so one key
    // cannot be reused across different installments.
    const idempotencyKey = req.headers["idempotency-key"] || req.body.idempotencyKey;
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لتحصيل القسط" });
    }
    const idemScope = "installment.payment";
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission: "sales.installments.collect",
      requestedOperation: "sales.installment.collect",
      authorizationResult: "allowed"
    });
    const idemRequestHash = idempotencyService.hashRequest(
      idemScope,
      idempotencyBodyWithActor(req, req.body, commandActor),
      req.params
    );

    if (inst.status === "paid") {
      return res.status(409).json({ success: false, message: "القسط مدفوع بالفعل" });
    }

    const remaining = round4(parseFloat(inst.amount) - parseFloat(inst.paidAmount || 0));

    // Phase 10P: strict amount validation BEFORE any update/create/posting. The
    // old `Number(req.body.amount) || due` shortcut treated 0 / NaN / missing as
    // a full payment, which (now that a Payment row is created) could record a
    // Payment of the wrong value. amount must be an explicit finite number > 0,
    // and a full payment must send amount = remaining explicitly (no shortcut).
    const amount = Number(req.body.amount);
    if (
      req.body.amount === undefined ||
      req.body.amount === null ||
      req.body.amount === "" ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(422).json({ success: false, message: "Payment amount must be greater than zero" });
    }
    if (amount > remaining + 0.01) {
      return res.status(422).json({
        success: false,
        message: `Overpayment rejected: amount ${amount} exceeds remaining ${remaining}`,
      });
    }
    const method = req.body.paymentMethod || "Cash";
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const newPaid = parseFloat(inst.paidAmount || 0) + amount;
    const status = newPaid >= parseFloat(inst.amount) - 0.01 ? "paid" : "partial";
    const payDate = new Date().toISOString().slice(0, 10);

    // Treasury account mirrors the GL cash account chosen by
    // postInstallmentPayment (cashCode 1120/bank vs 1110/cash) so the treasury
    // log row lands on the same account the journal debits.
    const m = String(method).toLowerCase();
    const treasuryAccount =
      m.includes("card") || m.includes("bank") || m.includes("شبك") || m.includes("تحويل") ? "bank" : "cash";
    const branchId =
      req.branchId && String(req.branchId).startsWith("BR-") ? req.branchId : null;

    // Phase 10O + 11D: record the installment collection ATOMICALLY — the
    // installment update, the Payment row (so Customer Statement V2 picks it up
    // as a credit), the GL journal, and a treasury CashTransaction all commit
    // together. The journal posting is moved INSIDE the transaction (it used to
    // be best-effort after commit): a posting failure now rolls back the whole
    // collection, so we never leave a paid installment / Payment without a GL
    // entry, nor a CashTransaction without its journalEntryId. The idempotency
    // early-return above guarantees a replay never reaches this block, so
    // nothing is duplicated. The operational AR mirrors (Customer.balance and
    // Invoice paid/remaining amounts) are updated only on this fresh mutation
    // path, inside the same transaction. The CashTransaction is an operational
    // treasury LOG only — it is linked to the EXISTING installment journal and
    // NO postCashEntry is called, so there is no second journal and no
    // double-posting (mirrors the POS/invoice-post pattern, not the
    // supplier-payment pattern that is itself the journal).
    let installmentPayment = null;
    let journalEntry = null;
    let idemResponseBody = null;
    try {
      await models.sequelize.transaction(async (t) => {
        // Phase 21.4 — claim the idempotency key FIRST inside the business
        // transaction; a concurrent duplicate fails the unique insert → the
        // transaction rolls back and we replay/conflict from the stored row.
        const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
        if (!idemClaim.claimed) {
          const dup = new Error("__IDEM_DUPLICATE__");
          dup.__idemDuplicate = true;
          throw dup;
        }
        const idemRequest = idemClaim.request;

        const invoice = await models.Invoice.findOne({
          where: { id: inst.invoiceId, companyId: req.companyId },
          transaction: t,
          lock: { level: t.LOCK.UPDATE, of: models.Invoice }
        });
        if (!invoice) throw new NotFoundError("الفاتورة المرتبطة بالقسط غير موجودة");
        await salesOperatorPolicy.assertSalesOperatorPolicy(req, "sales.installment.collect", {
          branchId: invoice.branchId || branchId,
          transaction: t
        });

        const customerId = inst.customerId || invoice.customerId;
        const customer = customerId
          ? await models.Customer.findOne({
              where: { id: customerId, companyId: req.companyId },
              transaction: t,
              lock: { level: t.LOCK.UPDATE, of: models.Customer }
            })
          : null;
        if (customerId && !customer) throw new NotFoundError("العميل المرتبط بالقسط غير موجود");

        await inst.update({
          paidAmount: newPaid,
          status,
          paidDate: payDate,
          idempotencyKey: idempotencyKey || inst.idempotencyKey
        }, { transaction: t });

        await invoice.update({
          remainingAmount: Math.max(0, round4(Number(invoice.remainingAmount || 0) - amount)),
          paidAmount: round4(Number(invoice.paidAmount || 0) + amount)
        }, { transaction: t });

        if (customer) {
          await customer.update({
            balance: Math.max(0, round4(Number(customer.balance || 0) - amount))
          }, { transaction: t });
        }

        installmentPayment = await models.Payment.create({
          id: `PAY-INST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: inst.companyId,
          branchId,
          invoiceId: inst.invoiceId,
          paymentMethod: method,
          amount,
          reference: req.body.reference || `Installment #${inst.sequence}`,
          date: payDate,
          notes: req.body.notes || `تحصيل قسط ${inst.id}`,
          receivedByEmployeeId: commandActor.employeeId || null
        }, { transaction: t });

        journalEntry = await postingService.postInstallmentPayment(
          inst.toJSON(), amount, method, actor, { transaction: t }
        );

        await models.CashTransaction.create({
          id: `TX-INST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: inst.companyId,
          type: "cash_in",
          account: treasuryAccount,
          amount,
          category: "تحصيل قسط",
          description: `تحصيل قسط ${inst.id} — فاتورة ${inst.invoiceId}`,
          reference: inst.invoiceId,
          branch: inst.branch || "Main Branch",
          branchId,
          date: payDate,
          createdBy: req.user ? req.user.id : "System",
          status: "posted",
          journalEntryId: journalEntry ? journalEntry.id : null
        }, { transaction: t });

        await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
          action: "sales.installment.collect",
          description: `Collected installment ${inst.id} for invoice ${inst.invoiceId}`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: inst.branch || branchId || null,
          branch: inst.branch || branchId || null,
          sourceDocument: inst.invoiceId,
          severity: "info",
          after: JSON.stringify({
            installmentId: inst.id,
            invoiceId: inst.invoiceId,
            paymentId: installmentPayment.id,
            amount,
            status,
            journalEntryId: journalEntry ? journalEntry.id : null
          })
        }, commandActor), { transaction: t });

        // Persist the success response for idempotent replay BEFORE commit.
        const out = inst.toJSON();
        out.journalEntry = journalEntry;
        out.payment = installmentPayment;
        idemResponseBody = { success: true, ...out, data: out };
        await idempotencyService.succeed({ request: idemRequest, statusCode: 200, responseBody: idemResponseBody, transaction: t });
      });
    } catch (txErr) {
      if (txErr && txErr.__idemDuplicate) {
        const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
        if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
        return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
      }
      throw txErr;
    }

    if (inst.customerId) {
      const { recalculateCustomerNetPurchases } = require("../services/customer-purchases.service");
      await recalculateCustomerNetPurchases(models, req.companyId, inst.customerId);
    }

    return res.status(200).json(idemResponseBody);
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GIFT VOUCHERS (قسائم الهدايا) — issue, lookup & redeem
// ─────────────────────────────────────────────────────────────────────────────

router.get("/gift-vouchers", authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.status) where.status = req.query.status;
    const rows = await models.GiftVoucher.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: parseInt(req.query.pageSize) || 200
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

router.get("/gift-vouchers/:code", authMiddleware, async (req, res, next) => {
  try {
    const v = await models.GiftVoucher.findOne({
      where: { code: req.params.code, companyId: req.companyId }
    });
    if (!v) return res.status(404).json({ success: false, message: "القسيمة غير موجودة" });
    return res.status(200).json({ success: true, ...v.toJSON(), data: v.toJSON() });
  } catch (error) {
    next(error);
  }
});

// Gift voucher write workflows are read-compatible only for launch. Issue/redeem
// needs a final approved liability/revenue policy, so deny before any mutation.
router.post("/gift-vouchers/issue", authMiddleware, (req, res) =>
  stableForbidden(
    res,
    "GIFT_VOUCHER_FINANCIAL_WORKFLOW_DISABLED",
    "Gift voucher issue/redeem financial workflows are disabled until liability accounting is approved."
  )
);

router.post("/gift-vouchers/redeem", authMiddleware, (req, res) =>
  stableForbidden(
    res,
    "GIFT_VOUCHER_FINANCIAL_WORKFLOW_DISABLED",
    "Gift voucher issue/redeem financial workflows are disabled until liability accounting is approved."
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// TREASURY (الخزنة) — cash movements, balances & closing reconciliation
// ─────────────────────────────────────────────────────────────────────────────

const TREASURY_GL = { cash: "1110", bank: "1120" };

router.get("/treasury/register/current", authMiddleware, requireAnyBusinessPermission(["treasury.register.view", "treasury.view"]), async (req, res, next) => {
  try {
    const branch = await resolveAuthorizedBranch(req, req.query.branchId || req.query.branch || req.branchId, { required: true });
    const session = await cashRegisterService.currentOpen({ companyId: req.companyId, branchId: branch.id });
    const expected = session ? await cashRegisterService.calculateExpected(session) : null;
    const data = session ? { ...session.toJSON(), expected, branchId: branch.id, branchName: branch.name } : { status: "CLOSED", branchId: branch.id, branchName: branch.name, expected: null };
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/treasury/registers", authMiddleware, requireAnyBusinessPermission(["treasury.register.view", "treasury.view"]), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.query.branch);
    const items = await cashRegisterService.listSessions({
      companyId: req.companyId,
      branchId,
      limit: Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 50)),
    });
    return res.status(200).json({ success: true, items, data: { items, branchId } });
  } catch (error) {
    next(error);
  }
});

router.post("/treasury/register/open", authMiddleware, requireBusinessPermission("treasury.register.open", { touch: true }), async (req, res, next) => {
  try {
    const branch = await resolveAuthorizedBranch(req, req.body?.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });
    const result = await cashRegisterService.openRegister({
      companyId: req.companyId,
      branchId: branch.id,
      openingCountedAmount: req.body?.openingCountedAmount,
      idempotencyKey: req.headers["idempotency-key"] || req.body?.idempotencyKey || null,
      actor: cashRegisterService.actorFromRequest(req),
    });
    const expected = await cashRegisterService.calculateExpected(result);
    return res.status(201).json({ success: true, data: { ...result.toJSON(), expected, branchName: branch.name } });
  } catch (error) {
    next(error);
  }
});

router.post("/treasury/register/close", authMiddleware, requireBusinessPermission("treasury.register.close", { touch: true }), async (req, res, next) => {
  try {
    const branch = await resolveAuthorizedBranch(req, req.body?.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });
    const result = await cashRegisterService.closeRegister({
      companyId: req.companyId,
      branchId: branch.id,
      countedAmount: req.body?.countedAmount,
      varianceReason: req.body?.varianceReason || req.body?.description || null,
      idempotencyKey: req.headers["idempotency-key"] || req.body?.idempotencyKey || null,
      actor: cashRegisterService.actorFromRequest(req),
    });
    return res.status(200).json({ success: true, data: { ...result.toJSON(), branchName: branch.name } });
  } catch (error) {
    next(error);
  }
});

// List treasury transactions (newest first), optional type/branch/account filters.
router.get("/treasury/transactions", authMiddleware, requireBusinessPermission("treasury.view"), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.type) where.type = req.query.type;
    if (req.query.account) where.account = normalizeTreasuryAccount(req.query.account);
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.query.branch);
    if (branchId) where.branchId = branchId;

    // Phase 6B: real server-side pagination (offset + total). page/pageSize are
    // optional and clamped; pageSize defaults to 20 and is capped at 100 (the
    // previous limit-only default), so callers that pass neither still get the
    // newest rows and the {items}/{data.items} shape stays backward compatible.
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const { count, rows } = await models.CashTransaction.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit: pageSize,
      offset,
    });
    const total = count;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const payload = { items: rows, page, pageSize, total, totalPages };
    return res.status(200).json({ success: true, ...payload, data: payload });
  } catch (error) {
    next(error);
  }
});

// Current treasury balances + today's movement totals.
router.get("/treasury/summary", authMiddleware, requireBusinessPermission("treasury.view"), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.query.branch);
    const ledgerSummary = await accountBalanceService.calculateTreasuryLedgerSummary({ companyId: req.companyId, branchId });
    const cash = ledgerSummary.cash;
    const bank = ledgerSummary.bank;

    const today = new Date().toISOString().slice(0, 10);
    const txWhere = { companyId: req.companyId, date: today };
    if (branchId) txWhere.branchId = branchId;
    const todays = await models.CashTransaction.findAll({
      where: txWhere
    });
    const sum = (type) =>
      todays.filter((t) => t.type === type).reduce((s, t) => s + parseFloat(t.amount || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        cash,
        bank,
        total: cash + bank,
        todayIn: sum("cash_in"),
        todayOut: sum("cash_out"),
        todayTransfers: sum("transfer"),
        branchId,
        source: "reportable_ledger_journal_lines",
        mirrorDifferences: ledgerSummary.mirrorDifferences,
      }
    });
  } catch (error) {
    next(error);
  }
});

// Create a treasury transaction (cash_in / cash_out / transfer) + auto-post journal.
// Phase 11B: gated by treasury.update and made ATOMIC — the CashTransaction, its
// GL posting (postCashEntry), the journalEntryId back-link, and the audit row are
// created in ONE DB transaction. If posting fails, everything rolls back so no
// orphan CashTransaction (without a journal) is ever left behind.
router.post("/treasury/transactions", authMiddleware, requireBusinessPermission("treasury.update", { touch: true }), async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(422).json({ success: false, message: "المبلغ يجب أن يكون أكبر من صفر" });
    }
    if (!["cash_in", "cash_out", "transfer"].includes(b.type)) {
      throw new ValidationError("type must be one of cash_in, cash_out, or transfer.");
    }
    const type = b.type;
    const account = normalizeTreasuryAccount(b.account, "account");
    const toAccount = type === "transfer" ? normalizeTreasuryAccount(b.toAccount, "toAccount") : null;
    if (type === "transfer" && account === toAccount) {
      throw new ValidationError("Transfer source and destination treasury accounts must be different.");
    }
    await assertTreasuryAccountKey(req.companyId, account);
    if (toAccount) await assertTreasuryAccountKey(req.companyId, toAccount);
    if (type !== "transfer") {
      const counterAccount = await assertActiveAccountCode(req.companyId, b.counterAccountCode);
      if (["1110", "1120"].includes(counterAccount.code)) {
        throw new ValidationError("counterAccountCode must not be a treasury cash/bank account.");
      }
    }
    const branch = await resolveAuthorizedBranch(req, b.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });
    if (b.date && !isValidYmd(String(b.date))) {
      throw new ValidationError("Invalid 'date' (expected YYYY-MM-DD).");
    }
    const id = `CT-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    // Phase 21.4 — central race-safe idempotency (unique company_id+scope+key),
    // replacing the optional-key lookup-only check that admitted a race window.
    // The key is now REQUIRED and req.params is folded into the request hash.
    const idempotencyKey = req.headers["idempotency-key"] || b.idempotencyKey;
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لعملية الخزينة" });
    }
    const idemScope = "treasury.cash_transaction";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, b, req.params);

    let idemResponseBody = null;
    try {
      await models.sequelize.transaction(async (t) => {
        // Claim the idempotency key FIRST inside the business transaction; a
        // concurrent duplicate fails the unique insert → rollback → replay.
        const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
        if (!idemClaim.claimed) {
          const dup = new Error("__IDEM_DUPLICATE__");
          dup.__idemDuplicate = true;
          throw dup;
        }
        const idemRequest = idemClaim.request;
        await cashRegisterService.requireOpenForCashMutation({
          companyId: req.companyId,
          branchId: branch.id,
          account,
          toAccount,
          transaction: t,
        });

        const tx = await models.CashTransaction.create({
          id,
          companyId: req.companyId,
          type,
          account,
          toAccount,
          amount,
          category: b.category || null,
          counterAccountCode: b.counterAccountCode || null,
          description: b.description || null,
          reference: b.reference || null,
          branch: branch.name,
          branchId: branch.id,
          date: b.date || now.slice(0, 10),
          createdBy: actor,
          status: "posted",
          idempotencyKey: idempotencyKey || null
        }, { transaction: t });

        // Post the GL entry inside the SAME transaction; any failure rolls back the
        // CashTransaction too (no orphan cash movement without a journal).
        const journalEntry = await postingService.postCashEntry(tx.toJSON(), actor, { transaction: t });
        await tx.update({ journalEntryId: journalEntry.id }, { transaction: t });

        await auditService.record(req.companyId, {
          action: "treasury_transaction_created",
          description: `Treasury ${type} ${amount} (${account})${b.category ? " — " + b.category : ""}`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: tx.branch,
          branch: tx.branch,
          sourceDocument: tx.id,
          severity: "info",
          after: JSON.stringify({
            id: tx.id, type, account: tx.account, toAccount: tx.toAccount, amount,
            category: tx.category, reference: tx.reference, journalEntryId: journalEntry.id,
          }),
        }, { transaction: t });

        // Persist the success response for idempotent replay BEFORE commit.
        const out = tx.toJSON();
        out.journalEntry = journalEntry;
        idemResponseBody = { success: true, ...out, data: out };
        await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });
      });
    } catch (txErr) {
      if (txErr && txErr.__idemDuplicate) {
        const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
        if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
        return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
      }
      throw txErr;
    }

    return res.status(201).json(idemResponseBody);
  } catch (error) {
    next(error);
  }
});

// Treasury closing — reconcile expected vs actual and record variance.
router.post("/treasury/closing", authMiddleware, requireBusinessPermission("treasury.update", { touch: true }), async (req, res, next) => {
  try {
    const b = req.body || {};

    const account = normalizeTreasuryAccount(b.account, "account");
    await assertTreasuryAccountKey(req.companyId, account);
    const glCode = TREASURY_GL[account];
    const branch = await resolveAuthorizedBranch(req, b.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });

    // Idempotency: a retried/double-clicked closing returns the original closing
    // record instead of recording a second one. Checked BEFORE the duplicate
    // guard so a genuine replay (same key) returns 200, never 409.
    const idempotencyKey = req.headers["idempotency-key"] || b.idempotencyKey;
    if (idempotencyKey) {
      const existing = await models.CashTransaction.findOne({
        where: { idempotencyKey, companyId: req.companyId, type: "closing" }
      });
      if (existing) {
        const out = existing.toJSON();
        return res.status(200).json({ success: true, ...out, data: out });
      }
    }

    // Phase 11F: strict actualBalance validation. The old `Number(x) || 0`
    // turned a missing/blank/non-numeric value into 0 silently, recording a
    // bogus variance (= -expected) and poisoning the next closing's opening.
    // 0 is allowed ONLY when sent explicitly as a valid number.
    if (b.actualBalance === undefined || b.actualBalance === null || b.actualBalance === "") {
      return res.status(422).json({ success: false, message: "Actual balance must be a valid non-negative number" });
    }
    const actual = Number(b.actualBalance);
    if (!Number.isFinite(actual) || actual < 0) {
      return res.status(422).json({ success: false, message: "Actual balance must be a valid non-negative number" });
    }

    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const closingDate = b.date || now.slice(0, 10);
    const closingDay = String(closingDate).slice(0, 10);

    // Phase 11F: prevent a second closing for the same account on the same day
    // within the company (a genuine idempotent replay already returned above).
    // Scoped by the stored `date` day — not createdAt.
    const dupe = await models.CashTransaction.findOne({
      where: {
        companyId: req.companyId,
        type: "closing",
        account,
        date: { [Op.like]: `${closingDay}%` }
      }
    });
    if (dupe) {
      return res.status(409).json({ success: false, message: "Treasury closing already exists for this account and date" });
    }

    // Expected = authoritative posted journal-line balance, not the stale
    // Account.balance mirror.
    const balanceRow = await accountBalanceService.calculateAccountBalance({
      companyId: req.companyId,
      branchId: branch.id,
      accountCode: glCode,
    });
    const expected = balanceRow ? Number(balanceRow.calculatedBalance || 0) : 0;

    // Opening = previous closing's actual balance for the same account (else 0).
    // Scoped by account ONLY (not day) so cross-day chaining is preserved.
    const prev = await models.CashTransaction.findOne({
      where: { companyId: req.companyId, type: "closing", account },
      order: [["created_at", "DESC"]]
    });
    const opening = prev ? parseFloat(prev.actualBalance || 0) : 0;

    const variance = Math.round((actual - expected) * 100) / 100;
    if (Math.abs(variance) >= 0.01 && !String(b.description || "").trim()) {
      throw new ValidationError("Variance reason is required when actual balance differs from expected balance.");
    }
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const closingId = `CLS-${Date.now()}`;
    const closing = await models.sequelize.transaction(async (t) => {
      const row = await models.CashTransaction.create({
        id: closingId,
        companyId: req.companyId,
        type: "closing",
        account,
        amount: actual,
        description: b.description || `إغلاق خزينة ${account === "bank" ? "البنك" : "النقدية"}`,
        branch: branch.name,
        branchId: branch.id,
        date: closingDate,
        createdBy: actor,
        status: "approved",
        openingBalance: opening,
        expectedBalance: expected,
        actualBalance: actual,
        variance,
        idempotencyKey: idempotencyKey || null
      }, { transaction: t });

      // Phase 11B: audit the closing (no GL variance posting — recorded only).
      await auditService.record(req.companyId, {
        action: "treasury_closing_created",
        description: `Treasury closing ${account} — actual ${actual}, expected ${expected}, variance ${variance}`,
        user: actor,
        userId: req.user ? req.user.id : null,
        place: row.branch,
        branch: row.branch,
        sourceDocument: row.id,
        severity: variance === 0 ? "info" : "warning",
        after: JSON.stringify({ id: row.id, account, openingBalance: opening, expectedBalance: expected, actualBalance: actual, variance }),
      }, { transaction: t });

      return row;
    });

    return res.status(201).json({
      success: true,
      ...closing.toJSON(),
      data: { ...closing.toJSON(), opening, expected, actual, variance }
    });
  } catch (error) {
    next(error);
  }
});

// List closing records.
router.get("/treasury/closings", authMiddleware, requireBusinessPermission("treasury.view"), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.query.branch);
    const where = { companyId: req.companyId, type: "closing" };
    if (branchId) where.branchId = branchId;
    const rows = await models.CashTransaction.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: 50
    });
    return res.status(200).json({ success: true, items: rows, data: { items: rows } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
