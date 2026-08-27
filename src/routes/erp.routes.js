const express = require("express");
const bcrypt = require("bcryptjs");
const Decimal = require("decimal.js");
const { Op } = require("sequelize");
const { authMiddleware, requirePermission, requireAnyPermission } = require("../middleware/auth.middleware");
const { requireBusinessPermission, requireAnyBusinessPermission } = require("../middleware/business-permission.middleware");
const ErpController = require("../controllers/erp.controller");
const models = require("../models");
const postingService = require("../services/posting.service");
const journalService = require("../services/journal.service");
const goldService = require("../services/gold.service");
const goldCenterReferencePriceService = require("../services/gold-center-reference-price.service");
const goldPriceApprovalService = require("../services/gold-price-approval.service");
const settingsService = require("../services/settings.service");
const companyTaxPolicyService = require("../services/company-tax-policy.service");
const transactionTaxContextService = require("../services/transaction-tax-context.service");
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
const customerPosSummaryService = require("../services/customer-pos-summary.service");
const { normalizePhone } = require("../services/customer-phone.service");
const { buildCustomerContactSnapshot, copyInvoiceContactSnapshot } = require("../services/invoice-contact-snapshot.service");
const installmentOverpaymentReclassificationService = require("../services/installment-overpayment-reclassification.service");
const installmentPrecisionRemediationService = require("../services/installment-precision-remediation.service");
const barcodeIdentityService = require("../services/barcode-identity.service");
const pearlSizeMasterDataService = require("../services/pearl-size-master-data.service");
const profileMasterDataService = require("../services/profile-master-data.service");
const diamondJewelleryProfileService = require("../services/diamond-jewellery-profile.service");
const gemStoneJewelleryProfileService = require("../services/gem-stone-jewellery-profile.service");
const pearlJewelleryProfileService = require("../services/pearl-jewellery-profile.service");
const loosePearlProfileService = require("../services/loose-pearl-profile.service");
const inventoryMasterPolicy = require("../services/inventory-master-policy.service");
const inventoryV2Runtime = require("../services/inventory-v2-runtime.service");
const workshopPolicy = require("../services/workshop-policy.service");
const inventoryMasterDataBootstrapService = require("../services/inventory-master-data-bootstrap.service");
const cgpLegacyIsolation = require("../services/cgp-legacy-isolation.service");
const goldValuationService = require("../services/gold-valuation.service");
const looseProfileFinanceService = require("../services/loose-profile-finance.service");
const supplierAcquisitionPreviewService = require("../services/supplier-acquisition-preview.service");
const supplierReceiveContractService = require("../services/supplier-receive-contract.service");
const inventoryCommonProfileFieldsService = require("../services/inventory-common-profile-fields.service");
const goldSalePricingService = require("../services/gold-sale-pricing.service");
const goldByPieceProfileService = require("../services/gold-by-piece-profile.service");
const assetMetadataService = require("../services/asset-metadata.service");
const assetSellingPriceService = require("../services/asset-selling-price.service");
const inventoryV2PriceMappingService = require("../services/inventory-v2-price-mapping.service");
const { calculateMakingChargeTotal, calculateGoldByWeightMakingTotal } = goldSalePricingService;
const inventoryAuditCanonicalService = require("../services/inventory-audit-canonical.service");
const inventoryCountPolicy = require("../services/inventory-count-policy.service");
const reservationService = require("../services/reservation.service");
const reservationDepositReceiptService = require("../services/reservation-deposit-receipt.service");
const reservationDepositSettingsService = require("../services/reservation-deposit-settings.service");
const permissionService = require("../services/permission.service");
const employeeAuthorizationService = require("../services/employee-authorization.service");
const commandActorContext = require("../services/command-actor-context.service");
const salesOperatorPolicy = require("../services/sales-operator-policy.service");
const invoiceProjectionService = require("../services/invoice-projection.service");
const statementReconciliationService = require("../services/statement-reconciliation.service");
const sourceAwareStatementService = require("../services/source-aware-statement.service");
const accountingLockService = require("../services/accounting-lock.service");
const accountBalanceService = require("../services/account-balance.service");
const cashRegisterService = require("../services/cash-register.service");
const companyBootstrapService = require("../services/company-bootstrap.service");
const operationalReadinessService = require("../services/operational-readiness.service");
const ledgerReportingService = require("../services/ledger-reporting.service");
const financialBootstrapService = require("../services/financial-bootstrap.service");
const { CGP_REQUIRED_FINANCIAL_ROLE_CODES } = require("../services/financial-account-catalog.service");
const financialAccountService = require("../services/financial-account.service");
const financialAccountResolver = require("../services/financial-account-resolver.service");
const financialReportingService = require("../services/financial-reporting.service");
const financialMappingCompatibility = require("../services/financial-mapping-compatibility.service");
const { BRANCH_MAPPING_CATALOG } = require("../services/financial-account-catalog.service");
const { requireBranchCustomerResource } = require("../services/branch-isolation.service");
const logger = require("../utils/logger");
const { AppError, ValidationError, NotFoundError, ConflictError, ForbiddenError } = require("../utils/errors");
const uploadMiddleware = require("../middleware/upload.middleware");
const { moveUploadedFileSafe } = require("../utils/file-move");
const { CRUD_PERMISSIONS, crudGuardPermissionCandidates } = require("../bootstrap/permission-consumer-coverage");

const router = express.Router();
const allowAuthenticated = (req, res, next) => next();

async function loadDiamondMasterData(companyId, transaction = null) {
  const categories = Array.from(new Set([
    "GOLD_ITEM_DESCRIPTION",
    ...profileMasterDataService.categoriesForProfile(diamondJewelleryProfileService.PROFILE),
    ...profileMasterDataService.categoriesForProfile("LOOSE_DIAMOND"),
  ]));
  const masters = await profileMasterDataService.list({ models, companyId, categories, activeOnly: true, transaction });
  return diamondJewelleryProfileService.masterIndex(masters);
}

async function loadGemStoneMasterData(companyId, transaction = null) {
  const categories = profileMasterDataService.categoriesForProfile(gemStoneJewelleryProfileService.PROFILE);
  const masters = await profileMasterDataService.list({ models, companyId, categories, activeOnly: true, transaction });
  return gemStoneJewelleryProfileService.masterIndex(masters);
}

async function loadPearlJewelleryMasterData(companyId, transaction = null) {
  const categories = profileMasterDataService.categoriesForProfile(pearlJewelleryProfileService.PROFILE);
  const masters = await profileMasterDataService.list({ models, companyId, categories, activeOnly: true, transaction });
  const pearlSizes = await pearlSizeMasterDataService.list({ models, companyId, activeOnly: true, transaction });
  return { masters: pearlJewelleryProfileService.masterIndex(masters), pearlSizes };
}

async function loadLoosePearlMasterData(companyId, transaction = null) {
  const categories = profileMasterDataService.categoriesForProfile(loosePearlProfileService.PROFILE);
  const masters = await profileMasterDataService.list({ models, companyId, categories, activeOnly: true, transaction });
  const pearlSizes = await pearlSizeMasterDataService.list({ models, companyId, activeOnly: true, transaction });
  return { masters, pearlSizes };
}

const reservationPerms = {
  view: ["reservations.view", "reservations.view_all", "reservations.view_branch", "reservations.view_own", "sales.view"],
  viewReceipts: "reservations.view_receipts",
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

// Branch operational readiness is server-scoped. A company-level actor must
// provide an explicit branch; a Branch Account already has a fixed branch.
router.get("/readiness/operations", authMiddleware, async (req, res, next) => {
  try {
    const branch = await resolveAuthorizedBranch(req, req.query.branchId || req.branchId, { required: true });
    return res.status(200).json({ success: true, data: await companyBootstrapService.branchReadiness(req.companyId, branch.id) });
  } catch (error) {
    return next(error);
  }
});

// One read-only, company-scoped onboarding authority. The branch is resolved
// from the authenticated branch context or the existing server-validated
// branch header; no client body can override either scope.
router.get("/settings/operational-readiness", authMiddleware, requirePermission("settings.view"), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.branchId || req.headers["x-branch-id"] || req.query.branchId, { required: true });
    const data = await operationalReadinessService.getOperationalReadiness({
      companyId: req.companyId,
      branchId,
      workflow: ["SUPPLIER_RECEIVE", "CGP"].includes(String(req.query.workflow || "SUPPLIER_RECEIVE").toUpperCase()) ? String(req.query.workflow || "SUPPLIER_RECEIVE").toUpperCase() : "SUPPLIER_RECEIVE",
    });
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.post("/bootstrap/branch-accounts", authMiddleware, requirePermission("settings.update"), async (req, res, next) => {
  try {
    const branch = await resolveAuthorizedBranch(req, req.body?.branchId || req.branchId, { required: true });
    const report = await companyBootstrapService.bootstrapBranchAccounts(req.companyId, branch.id);
    return res.status(report.blockers.length ? 422 : 200).json({ success: report.blockers.length === 0, data: report });
  } catch (error) {
    return next(error);
  }
});

router.get("/readiness/branches", authMiddleware, requirePermission("settings.update"), async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await companyBootstrapService.branchReadinessReport(req.companyId) });
  } catch (error) { return next(error); }
});

// Branch-only reservation-deposit configuration. Account IDs are validated on
// the server against the selected operational branch; no code/treasury value
// supplied by a client is ever treated as financial authority.
router.get("/branch-settings/reservation-deposit", authMiddleware, requireAnyBusinessPermission(["settings.update"], { touch: true, operation: "reservation_deposit.settings_read" }), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
    return res.status(200).json({ success: true, data: await reservationDepositSettingsService.read({ companyId: req.companyId, branchId }) });
  } catch (error) { return next(error); }
});

router.put("/branch-settings/reservation-deposit", authMiddleware, requireAnyBusinessPermission(["settings.update"], { touch: true, operation: "reservation_deposit.settings_write" }), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const data = await reservationDepositSettingsService.save({
      companyId: req.companyId, branchId, body: req.body || {},
      actor: req.user?.id || req.user?.email || "System"
    });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "reservation_deposit.branch_settings_updated",
      description: `Branch reservation deposit settings updated for ${branchId}`,
      metadata: { branchId }
    }));
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

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
  if (numericKarat === 14) return 14 / 24;
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
  if (!CRUD_PERMISSIONS[resourceName]) return allowAuthenticated;
  const candidates = crudGuardPermissionCandidates(resourceName, action);
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
  },
  companies: {
    code: "GENERIC_COMPANY_MUTATION_FORBIDDEN",
    message: "Company mutations must use the approved onboarding and settings endpoints."
  },
  "manufacturing-orders": {
    code: "GENERIC_MANUFACTURING_MUTATION_FORBIDDEN",
    message: "Manufacturing mutations must use the dedicated Inventory V2 transformation endpoint."
  },
  "customer-gold-pools": {
    code: "GENERIC_CGP_MUTATION_FORBIDDEN",
    message: "Customer Gold Purchase mutations must use the canonical Gold Purchase workflow."
  },
  "inventory-gold-pools": {
    code: "GENERIC_IGP_MUTATION_FORBIDDEN",
    message: "Investment Gold Purchase mutations must use the canonical Gold Purchase workflow."
  },
  "approval-requests": {
    code: "GENERIC_APPROVAL_MUTATION_FORBIDDEN",
    message: "Approval mutations must be created and transitioned by the owning financial workflow."
  },
  "journal-entries": {
    code: "GENERIC_JOURNAL_MUTATION_FORBIDDEN",
    message: "Journal mutations must use the dedicated draft, post, reverse, or cancel endpoints."
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

function treasuryMappingRoleForPayment(value = "cash") {
  const method = String(value || "cash").toLowerCase();
  return method.includes("card") || method.includes("bank") ||
    method.includes("شبك") || method.includes("transfer") || method.includes("تحويل")
    ? "BANK_ACCOUNT"
    : "CASH_TREASURY";
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

async function resolveTreasuryAccount(companyId, branchId, key, options = {}) {
  return financialAccountResolver.resolveRequiredBranchFinancialAccount({
    companyId,
    branchId,
    mappingRole: key === "bank" ? "BANK_ACCOUNT" : "CASH_TREASURY",
    transaction: options.transaction,
  });
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
  if (resourceName === "customer-gold-pools") {
    // Historical pool reads remain available.  Generic writes, however, can
    // fabricate a customer-gold balance without the later canonical CGP
    // Posting boundary, so cutover mode rejects them before controller/DB work.
    const requireLegacyCgpAcquisitionPath = (req, res, next) => {
      try {
        cgpLegacyIsolation.assertLegacyCustomerGoldAcquisitionAllowed();
        return next();
      } catch (error) {
        return next(error);
      }
    };
    router.post(`/${resourceName}`, authMiddleware, guardFor(resourceName, "create"), requireLegacyCgpAcquisitionPath, controller.create);
    router.put(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), requireLegacyCgpAcquisitionPath, controller.update);
    router.patch(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "update"), requireLegacyCgpAcquisitionPath, controller.update);
    router.post(`/${resourceName}/:id/deactivate`, authMiddleware, guardFor(resourceName, "update"), requireLegacyCgpAcquisitionPath, controller.deactivate);
    router.post(`/${resourceName}/:id/reactivate`, authMiddleware, guardFor(resourceName, "update"), requireLegacyCgpAcquisitionPath, controller.reactivate);
    router.delete(`/${resourceName}/:id`, authMiddleware, guardFor(resourceName, "delete"), requireLegacyCgpAcquisitionPath, controller.delete);
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

// ─── Canonical Sale Orchestration ───────────────────────────────────────────
function assertPositiveSaleAmount(value, subject) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError("تعذر تحديد سعر بيع صالح لهذه القطعة. حدّث سعر الذهب أو بيانات التسعير ثم أعد المحاولة.", 422, "POS_SELLING_PRICE_REQUIRED", { subject });
  }
  return amount;
}

async function executeCanonicalSale(req, res, next, { operation = "pos.checkout", requiredPermission = "pos.sell" } = {}) {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const makingChargePerGram = body.makingChargePerGram !== undefined && body.makingChargePerGram !== null && body.makingChargePerGram !== ""
      ? Number(body.makingChargePerGram)
      : null;
    if (makingChargePerGram !== null && (!Number.isFinite(makingChargePerGram) || makingChargePerGram < 0)) {
      throw new ValidationError("Making charge per gram must be a non-negative number");
    }
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission,
      requestedOperation: operation,
      authorizationResult: "allowed"
    });
    const actor = commandActor.employeeName || commandActor.technicalUserName || "System";
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
    await salesOperatorPolicy.assertSalesOperatorPolicy(req, operation, {
      branchId: (body.branchId || req.headers["x-branch-id"] || req.branchId),
      transaction: t
    });

    // 1. Idempotency Check — Phase 21.3 central race-safe (unique company_id+scope+key).
    if (!idempotencyKey) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لإتمام البيع" });
    }
    const idemScope = operation;
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
    const branchId = await resolveAuthorizedBranchId(req, body.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });

    // Validate Branch belongs to same company, is active
    const branchRecord = await models.Branch.findOne({ where: { id: branchId, companyId: req.companyId, isActive: true }, transaction: t });
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
    const customerContactSnapshot = buildCustomerContactSnapshot(customer);

    // 4. Products/assets validation
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      throw new ValidationError("لا يمكن البيع بدون منتجات في السلة");
    }

    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const invoiceId = `INV-ID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const validatedItems = [];
    let subtotal = 0;
    let totalGoldTax = 0;
    let goldSubtotal = 0;
    let totalMakingCharge = 0;
    let makingChargeIncludedInSubtotal = 0;
    let hasGoldPricing = false;
    const canonicalGoldRateCache = { rates: new Map(), snapshots: new Map() };

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
        // Product quantity is retained only for non-final legacy scope. A
        // direct Product payload must not bypass the Asset authority even if
        // the POS search projection was bypassed or a client supplied a
        // misleading item shape.
        if (inventoryMasterPolicy.isFinalClientInventoryProduct(product)
          || inventoryMasterPolicy.isFinalClientInventoryProfile(item.inventoryProfile || item.profile)) {
          throw new AppError(
            "Final client inventory profiles must be sold by Asset identity, not Product quantity.",
            422,
            "FINAL_PROFILE_PRODUCT_SALE_FORBIDDEN"
          );
        }
        const qty = Number(item.quantity) || 1;
        if (Number(product.quantityAvailable) < qty) {
          throw new ValidationError(`الكمية المطلوبة غير متاحة في المخزون للمنتج ${product.productName}. المتاح: ${product.quantityAvailable}`);
        }
        if (product.branchId !== branchId) {
          throw new ValidationError(`المنتج ${product.productName} تابع لفرع آخر وليس للفرع النشط`);
        }

        const itemWeight = Number(item.totalWeight) || (Number(product.averageUnitWeight || 0) * qty);
        const itemPrice = Number(item.price) || Number(product.salePrice) || 0;
        assertPositiveSaleAmount(itemPrice, product.id);

        validatedItems.push({
          isProduct: true,
          product,
          quantity: qty,
          price: itemPrice,
          weight: itemWeight,
          cost: Number(product.unitCost) || 0,
          discount: Number(item.discount) || 0,
          // Per-gram making is an Asset-only authority. Product quantity is
          // never used as a physical-weight substitute.
          makingCharge: makingChargePerGram === null ? (Number(item.makingCharge) || 0) : 0,
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
        if (Object.prototype.hasOwnProperty.call(item, "quantity") && Number(item.quantity) !== 1) {
          throw new ValidationError("لا تقبل مبيعات الأصل المتسلسل كمية غير 1؛ اختر معرف أصل مستقل لكل قطعة");
        }
        if (asset.status !== "available") {
          throw new ValidationError(`المنتج ${asset.name} (${asset.id}) غير متاح للبيع حالياً، حالته: ${asset.status}`);
        }
        if (asset.branchId !== branchId) {
          throw new ValidationError(`المنتج ${asset.name} (${asset.id}) تابع لفرع آخر وليس للفرع النشط`);
        }

        const profile = asset.inventoryProfile || asset.profile;
        if (goldSalePricingService.isSalePricingProfile(profile)) {
          hasGoldPricing = true;
          const pricingItem = { ...item };
          // Client-side price fields are display hints only.  Sale pricing must
          // resolve from the server-side Asset/profile authority.
          delete pricingItem.price;
          delete pricingItem.sellingPrice;
          delete pricingItem.salePrice;
          if (["CGP_CUSTOMER_GOLD_PURCHASE", "GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K"].includes(profile)) {
            pricingItem.sellingGoldRate = await goldSalePricingService.resolveCanonicalSellingGoldRate({
              models, companyId: req.companyId, currency: settings.currency || "AED", karat: asset.karat,
              cache: canonicalGoldRateCache, transaction: t,
            });
          }
          const goldPricing = await goldSalePricingService.calculateGoldSalePriceForAsset({
            asset,
            models,
            companyId: req.companyId,
            transaction: t,
            itemInput: makingChargePerGram === null ? pricingItem : { ...pricingItem, makingChargePerGram },
            configuredVatRate: settings.vatRate,
          });

          if (goldPricing.approvalRequired) {
            const isSuperAdmin = req.user?.accountType === "super_admin";
            const isAdmin = req.user && (isSuperAdmin || req.user.role === "admin" || req.user.role === "owner");
            const hasApprovePerm = req.user && (isAdmin || await permissionService.userHasAnyPermission(req.user, ["sales.approve", "pos.discount.approve", "approvals.manage"]));

            if (!hasApprovePerm) {
              throw new AppError(goldPricing.approvalReason, 403, "BELOW_MINIMUM_APPROVAL_REQUIRED");
            }

            const approvalId = `APP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            await models.ApprovalRequest.create({
              id: approvalId,
              companyId: req.companyId,
              type: "price-override",
              requestedBy: commandActor.employeeId || req.user?.id || "System",
              requestedAt: new Date().toISOString().slice(0, 16),
              branch: branchRecord.name,
              description: goldPricing.approvalReason,
              amount: Number(goldPricing.makingTotal || goldPricing.certificateSaleAmount || goldPricing.proposedDiscount || 0),
              status: "approved",
              reviewedBy: actor,
              reviewedAt: new Date().toISOString().slice(0, 16),
              reason: goldPricing.approvalReason,
              relatedId: invoiceId
            }, { transaction: t });

            await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
              action: "pos.below_minimum.approve",
              description: `Below minimum pricing approved for asset ${asset.id}: ${goldPricing.approvalReason}`,
              place: branchRecord.name,
              branch: branchRecord.name,
              severity: "warning",
              before: null,
              after: JSON.stringify({ assetId: asset.id, goldPricing, branchId })
            }, {
              requiredPermission: "sales.approve",
              requestedOperation: operation,
              authorizationResult: "allowed"
            }), { transaction: t });
          }

          const itemSubtotal = Number(goldPricing.subtotal);
          const itemTax = Number(goldPricing.vatAmount);
          assertPositiveSaleAmount(itemSubtotal, asset.id);

          validatedItems.push({
            isProduct: false,
            asset,
            quantity: 1,
            price: itemSubtotal,
            weight: Number(asset.grossWeight || 0),
            cost: Number(asset.cost) || 0,
            // For GOLD_BY_PIECE: discount is baked into finalSalePrice (subtotal). Do not double-count.
            discount: ["GOLD_BY_PIECE", "LOOSE_GEMSTONE", "LOOSE_PEARL"].includes(goldPricing.profile) ? 0 : (Number(item.discount) || 0),
            makingCharge: Number(goldPricing.makingTotal || 0),
            stoneValue: Number(item.stoneValue) || 0,
            makingIncludedInSubtotal: true,
            goldPricing,
          });

          subtotal += itemSubtotal;
          goldSubtotal += itemSubtotal;
          totalGoldTax += itemTax;
          totalMakingCharge += Number(goldPricing.makingTotal || 0);
          makingChargeIncludedInSubtotal += Number(goldPricing.makingTotal || 0);
       } else {
          // Never accept item.price as a physical Asset sale authority.
          const effectiveAssetPrice = Number(asset.price) || 0;
          assertPositiveSaleAmount(effectiveAssetPrice, asset.id);
         validatedItems.push({
            isProduct: false,
            asset,
            quantity: 1,
            price: effectiveAssetPrice,
            weight: Number(asset.grossWeight) || 0,
            cost: Number(asset.cost) || 0,
            discount: Number(item.discount) || 0,
            makingCharge: makingChargePerGram === null
              ? (Number(item.makingCharge) || 0)
              : Number(calculateMakingChargeTotal({ itemWeightGrams: asset.grossWeight, makingChargePerGram })),
            stoneValue: Number(item.stoneValue) || 0
          });

          subtotal += effectiveAssetPrice;
          const lineMakingCharge = makingChargePerGram === null
            ? (Number(item.makingCharge) || 0)
            : Number(calculateMakingChargeTotal({ itemWeightGrams: asset.grossWeight, makingChargePerGram }));
          totalMakingCharge += lineMakingCharge;
        }
      }
    }
    const discount = Number(body.discount) || 0;
    const legacyMakingCharge = Number(body.makingCharge) || 0;
    const makingCharge = makingChargePerGram === null ? legacyMakingCharge : totalMakingCharge;
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

    // 6. Settings + totals calculation
    let totals;
    if (hasGoldPricing) {
      // Gold pricing subtotal already contains each gold line's making total;
      // only non-gold asset lines need an additional making component here.
      const additionalMakingCharge = Math.max(0, makingCharge - makingChargeIncludedInSubtotal);
      const taxBase = Math.max(0, subtotal + additionalMakingCharge + stoneValue - discount);
      const nonGoldTaxBase = Math.max(0, (subtotal - goldSubtotal) + additionalMakingCharge + stoneValue - discount);
      const computedTax = Math.round((totalGoldTax + (nonGoldTaxBase * (Number(settings.vatRate) || 0) / 100)) * 10000) / 10000;
      const total = Math.round((taxBase + computedTax) * 10000) / 10000;
      totals = { subtotal, taxBase, tax: computedTax, total, vatRate: Number(settings.vatRate) || 0 };
    } else {
      totals = salesService.computeTotals({ subtotal, makingCharge, stoneValue, discount, vatRatePercent: settings.vatRate });
    }
    const vatRatePercent = totals.vatRate;
   const computedTax = totals.tax;
   const total = totals.total;
    assertPositiveSaleAmount(total, "invoice");

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
    const invoiceNumber = await nextInvoiceNumber(req.companyId, prefix, t);

    // 8. Create Invoice
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const invoice = await models.Invoice.create({
      id: invoiceId,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      customerId,
      customerName: customer.name,
      ...customerContactSnapshot,
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

        if (asset.inventoryProfile) {
          await inventoryV2Runtime.linkInvoiceAsset({
            models, transaction: t, invoiceItemId: invoiceItem.id, asset: asset.toJSON(), companyId: req.companyId,
            ordinal: 1,
            quoteSnapshot: {
              price: vItem.price,
              discount: vItem.discount,
              makingCharge: vItem.makingCharge,
              stoneValue: vItem.stoneValue,
              vatRate: vItem.goldPricing ? vItem.goldPricing.vatRate : vatRatePercent,
              cost: vItem.cost,
              invoiceId,
              ...(vItem.goldPricing || {})
            },
          });
        }
        await inventoryV2Runtime.transitionAsset({
          models, transaction: t, asset,
          context: { companyId: req.companyId, branchId, branchName: branchRecord.name, actorId: commandActor.technicalUserId || req.user?.id || null, actorName: actor, occurredAt: new Date() },
          toStatus: "SOLD", eventType: "SALE", movementType: "SALE", sourceType: "INVOICE", sourceId: invoiceId,
          note: `Sold under invoice ${invoiceNumber}`, idempotencyKey: `${idempotencyKey}:${asset.id}`,
        });
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
    logger.error(`[ExecuteCanonicalSale Error] ${error.stack || error.message}`);
    await t.rollback();
    next(error);
  }
}

// Compatibility adapter for the historical immediately-posted invoice route.
// It retains its authorization middleware and response envelope, but delegates
// the durable sale to the very same canonical sale orchestration as POS.
async function executeLegacyInstantInvoiceAdapter(req, res, next) {
  const body = req.body || {};
  const originalKey = req.headers["idempotency-key"];
  const rawFingerprint = JSON.stringify({ companyId: req.companyId, branchId: body.branchId || req.branchId || null, body });
  const key = String(originalKey || body.idempotencyKey || "").trim() || `legacy-invoice-${require("crypto").createHash("sha256").update(rawFingerprint).digest("hex").slice(0, 48)}`;
  req.headers["idempotency-key"] = key;
  try {
    if (String(body.type || "sale").toLowerCase() === "return") {
      const originalInvoiceId = body.originalInvoiceId || body.relatedInvoiceId;
      const returnedAssetIds = Array.isArray(body.returnedAssetIds)
        ? body.returnedAssetIds
        : (Array.isArray(body.items) ? body.items.map((item) => item.assetId || item.id).filter(Boolean) : []);
      if (!originalInvoiceId || !returnedAssetIds.length) {
        throw new ValidationError("Legacy immediate return requires relatedInvoiceId/originalInvoiceId and exact returned Asset IDs.");
      }
      const originalBody = req.body;
      req.body = { ...body, originalInvoiceId, returnedAssetIds, reason: body.reason || body.notes || "Legacy immediate return" };
      try {
        return await executeCanonicalReturn(req, res, next, { operation: "sales.legacy_immediate_post", requiredPermission: "sales.create" });
      } finally {
        req.body = originalBody;
      }
    }
    return await executeCanonicalSale(req, res, next, { operation: "sales.legacy_immediate_post", requiredPermission: "sales.create" });
  } finally {
    if (originalKey === undefined) delete req.headers["idempotency-key"];
    else req.headers["idempotency-key"] = originalKey;
  }
}

router.post("/pos/checkout",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("pos.checkout", {
    resolveBranchId: (req) => (req.body && req.body.branchId) || req.headers["x-branch-id"] || req.branchId
  }),
  (req, res, next) => executeCanonicalSale(req, res, next)
);

// ─── Canonical Return Orchestration ─────────────────────────────────────────
async function executeCanonicalReturn(req, res, next, { operation = "sales.return.execute", requiredPermission = "sales.returns.execute" } = {}) {
  const t = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const { originalInvoiceId, returnedAssetIds = [], reason = "" } = body;
    const commandActor = commandActorContext.fromRequest(req, {
      requiredPermission,
      requestedOperation: operation,
      authorizationResult: "allowed"
    });

    // Phase 21.3 — central race-safe idempotency (unique company_id+scope+key).
    const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
    if (!idempotencyKey) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لعملية المرتجع" });
    }
    const idemScope = operation;
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
        if (inventoryMasterPolicy.isFinalClientInventoryProduct(product)) {
          throw new AppError(
            "Final client inventory profiles must preserve Asset identity through returns.",
            422,
            "FINAL_PROFILE_PRODUCT_RETURN_FORBIDDEN"
          );
        }
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
    await salesOperatorPolicy.assertSalesOperatorPolicy(req, operation, { branchId, transaction: t });

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
    const originalContactSnapshot = copyInvoiceContactSnapshot(originalInvoice);
    const returnInvoice = await models.Invoice.create({
      id: returnInvoiceId,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      customerId: originalInvoice.customerId,
      customerName: originalInvoice.customerName,
      ...originalContactSnapshot,
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
        // A returned V2 Asset keeps its immutable sale linkage and moves only
        // to RETURNED. It never re-enters AVAILABLE without the separately
        // governed Returned→Available approval extension.
        await inventoryV2Runtime.transitionAsset({
          models, transaction: t, asset: line.asset,
          context: { companyId: req.companyId, branchId, branchName: branchRecord.name, actorId: commandActor.technicalUserId || req.user?.id || null, actorName: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System", occurredAt: new Date() },
          toStatus: "RETURNED", eventType: "RETURN", movementType: "RETURN", sourceType: "RETURN_INVOICE", sourceId: returnInvoiceId,
          note: `Returned from invoice ${originalInvoice.id}: ${reason || "unspecified"}`,
          idempotencyKey: `${idempotencyKey}:${line.asset.id}`,
        });
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
    // The return journal is the sole GL owner: mapped AR relief + mapped cash /
    // bank + mapped customer credit liability, all in one balanced entry.
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
}

router.post(
  "/sales/returns",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.return.execute", {
    resolveBranchId: resolveAdjustmentInvoiceBranchId
  }),
  (req, res, next) => executeCanonicalReturn(req, res, next)
);

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
      if (inventoryMasterPolicy.isFinalClientInventoryProduct(returnedProduct)) {
        throw new AppError(
          "Final client inventory profiles must preserve Asset identity through exchanges.",
          422,
          "FINAL_PROFILE_PRODUCT_EXCHANGE_FORBIDDEN"
        );
      }
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
        if (inventoryMasterPolicy.isFinalClientInventoryProduct(product)) {
          throw new AppError(
            "Final client inventory profiles must use an Asset replacement, not Product quantity.",
            422,
            "FINAL_PROFILE_PRODUCT_EXCHANGE_FORBIDDEN"
          );
        }
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
      if (inventoryMasterPolicy.isFinalClientInventoryProduct(product)) {
        throw new AppError(
          "Final client inventory profiles must preserve Asset identity through exchanges.",
          422,
          "FINAL_PROFILE_PRODUCT_EXCHANGE_FORBIDDEN"
        );
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
        if (inventoryMasterPolicy.isFinalClientInventoryProduct(product)) {
          throw new AppError(
            "Final client inventory profiles must use an Asset replacement, not Product quantity.",
            422,
            "FINAL_PROFILE_PRODUCT_EXCHANGE_FORBIDDEN"
          );
        }
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
    const originalContactSnapshot = copyInvoiceContactSnapshot(originalInvoice);
    const exchangeInvoice = await models.Invoice.create({
      id: exchangeInvoiceId,
      companyId: req.companyId,
      branchId,
      branch: branchRecord.name,
      customerId: originalInvoice.customerId,
      customerName: originalInvoice.customerName,
      ...originalContactSnapshot,
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

      if (it.itemType === "asset" && it.asset.inventoryProfile) {
        await inventoryV2Runtime.linkInvoiceAsset({
          models, transaction: t, invoiceItemId: item.id, asset: it.asset.toJSON(), companyId: req.companyId,
          ordinal: 1,
          quoteSnapshot: { price: it.unitPrice, discount: 0, makingCharge: it.makingCharge, stoneValue: it.stoneValue, vatRate: vatRatePercent, cost: it.unitCost, exchangeInvoiceId },
        });
      }

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
        await inventoryV2Runtime.transitionAsset({
          models, transaction: t, asset: returnedAsset,
          context: { companyId: req.companyId, branchId, branchName: branchRecord.name, actorId: commandActor.technicalUserId || req.user?.id || null, actorName: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System", occurredAt: new Date() },
          toStatus: "RETURNED", eventType: "EXCHANGE_RETURN", movementType: "EXCHANGE_RETURN", sourceType: "EXCHANGE", sourceId: exchangeInvoiceId,
          note: `Returned through exchange ${exchangeInvoiceId} from invoice ${originalInvoice.id}`,
          idempotencyKey: `${idempotencyKey}:return:${returnedAsset.id}`,
        });
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
        await inventoryV2Runtime.transitionAsset({
          models, transaction: t, asset: it.asset,
          context: { companyId: req.companyId, branchId, branchName: branchRecord.name, actorId: commandActor.technicalUserId || req.user?.id || null, actorName: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System", occurredAt: new Date() },
          toStatus: "SOLD", eventType: "EXCHANGE_SALE", movementType: "EXCHANGE_SALE", sourceType: "EXCHANGE", sourceId: exchangeInvoiceId,
          note: `Sold as exchange replacement under ${exchangeInvoiceId}`,
          idempotencyKey: `${idempotencyKey}:replacement:${it.asset.id}`,
        });
    }

    // 11. Create balanced Accounting Entry
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const payAcc = paymentMethod.toLowerCase();
    const isBank = payAcc.includes("card") || payAcc.includes("bank") || payAcc.includes("transfer") || payAcc.includes("شبكة") || payAcc.includes("تحويل");
    const paymentMappingRole = isBank ? "BANK_ACCOUNT" : "CASH_TREASURY";

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
    // Money leg (Phase 21.2 + Phase 30): split between the authoritative Branch
    // cash, bank, customer-deposit, and receivable mappings. One journal.
    if (amountDueFromCustomer > 0) {
      if (cashInAmount > 0) lines.push({ mappingRole: paymentMappingRole, debit: cashInAmount, credit: 0, description: "دفع فارق استبدال نقداً" });
      if (receivableIncreaseAmount > 0) lines.push({ mappingRole: "ACCOUNTS_RECEIVABLE", debit: receivableIncreaseAmount, credit: 0, description: "زيادة ذمم العميل — فارق استبدال" });
    } else if (excessDueToCustomer > 0 || receivableReliefAmount > 0) {
      if (receivableReliefAmount > 0) lines.push({ mappingRole: "ACCOUNTS_RECEIVABLE", debit: 0, credit: receivableReliefAmount, description: "تخفيض ذمم العميل — فارق استبدال" });
      if (refundCashPortion > 0) lines.push({ mappingRole: "CASH_TREASURY", debit: 0, credit: refundCashPortion, description: "إرجاع فارق استبدال نقداً" });
      if (refundBankPortion > 0) lines.push({ mappingRole: "BANK_ACCOUNT", debit: 0, credit: refundBankPortion, description: "إرجاع فارق استبدال بنكياً" });
      if (refundCreditPortion > 0) lines.push({ mappingRole: "RESERVATION_ADVANCE_LIABILITY", debit: 0, credit: refundCreditPortion, description: "رصيد دائن للعميل — فارق استبدال" });
    }

    if (returnedValue > 0) {
      lines.push({ mappingRole: "SALES_REVENUE", debit: returnedValue, credit: 0, description: "عكس إيراد مبيعات أصل قديم" });
    }
    if (newAssetsValue > 0) {
      lines.push({ mappingRole: "SALES_REVENUE", debit: 0, credit: newAssetsValue, description: "إيراد بيع أصل بديل" });
    }

    if (newTax > 0) {
      lines.push({ mappingRole: "VAT_PAYABLE", debit: 0, credit: newTax, description: "ضريبة عناصر الاستبدال الجديدة" });
    }

    if (newAssetsCost > 0) {
      lines.push({ mappingRole: "COST_OF_GOODS_SOLD", debit: newAssetsCost, credit: 0, description: "تكلفة مبيعات بديلة" });
      lines.push({ mappingRole: "INVENTORY_ASSET", debit: 0, credit: newAssetsCost, description: "تخفيض مخزون بديل" });
    }
    if (returnedCost > 0) {
      lines.push({ mappingRole: "INVENTORY_ASSET", debit: returnedCost, credit: 0, description: "إرجاع أصل قديم للمخزن" });
      lines.push({ mappingRole: "COST_OF_GOODS_SOLD", debit: 0, credit: returnedCost, description: "عكس تكلفة أصل قديم" });
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
  let t;
  try {
    cgpLegacyIsolation.assertLegacyCustomerGoldAcquisitionAllowed();
    t = await models.sequelize.transaction();
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
    const customerContactSnapshot = buildCustomerContactSnapshot(customer);

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
    const scrapBarcode = await barcodeIdentityService.generateBarcodeForAsset({
      companyId: req.companyId,
      assetType: "gold-weight",
      karat: Number(karat),
      transaction: t,
    });
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
      ...scrapBarcode,
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
        ...customerContactSnapshot,
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

      // Payout Journal: Dr mapped customer deposits / Cr mapped cash or bank.
      const payMethodLower = payMethod.toLowerCase();
      const treasurySource = (payMethodLower.includes("bank") || payMethodLower.includes("transfer")) ? "bank" : "cash";

      payoutJournal = await postingService.postEntry(req.companyId, {
        description: `صرف نقدي مقابل ذهب مستعمل — ${customer.name} (${payoutId})`,
        date: nowStr.slice(0, 10),
        sourceType: "invoice",
        sourceId: payoutId,
        postedBy: actor,
        transaction: t,
        branchId
      }, [
        { mappingRole: "RESERVATION_ADVANCE_LIABILITY", debit: calculatedValue, credit: 0, description: "تسوية التزام ذهب عميل" },
        { mappingRole: treasuryMappingRoleForPayment(treasurySource), debit: 0, credit: calculatedValue, description: "صرف نقدي للعميل" }
      ]);

      // Create Treasury Cash Transaction
      await models.CashTransaction.create({
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: req.companyId,
        branchId,
        branch: branchRecord.name,
        type: "cash_out",
        account: treasurySource,
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
    if (t) await t.rollback();
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

    // Dr mapped customer deposits / Cr mapped cash or bank.
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const payMethodLower = payMethod.toLowerCase();
    const treasurySource = (payMethodLower.includes("bank") || payMethodLower.includes("transfer")) ? "bank" : "cash";

    const journalEntry = await postingService.postEntry(req.companyId, {
      description: `صرف رصيد ذهب عميل — ${customer.name} (سند ${cgpId})`,
      date: nowStr.slice(0, 10),
      sourceType: "customer_gold_pool",
      sourceId: cgpId,
      postedBy: actor,
      transaction: t
    }, [
      { mappingRole: "RESERVATION_ADVANCE_LIABILITY", debit: calculatedValue, credit: 0, description: "سحب أمانات عملاء" },
      { mappingRole: treasuryMappingRoleForPayment(treasurySource), debit: 0, credit: calculatedValue, description: "صرف نقدي للعميل" }
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
  // Compatibility surface only.  The legacy handler below is retained in this
  // source file temporarily for historical review, but it is unreachable: all
  // durable work now flows through the canonical transformation orchestration.
  return executeLegacyManufacturingAdapter(req, res, next);

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
    await parentAsset.update({
      grossWeight: remainingWeight,
      netWeight: remainingWeight
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
    const finishedBarcode = await barcodeIdentityService.generateBarcodeForAsset({
      companyId: req.companyId,
      assetType: outputType,
      karat: Number(outputKarat) || parentAsset.karat,
      transaction: t,
    });
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
      ...finishedBarcode,
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
      { mappingRole: "INVENTORY_ASSET", debit: manufacturingCost, credit: 0, description: `إدخال منتج مصنع ${finishedAssetId}` },
      { mappingRole: "INVENTORY_ASSET", debit: 0, credit: rawGoldCost, description: `استهلاك خام ذهب ${parentAsset.id}` }
    ];
    if (labor > 0) {
      glLines.push({ mappingRole: "CASH_TREASURY", debit: 0, credit: labor, description: `أجور صياغة مدفوعة نقداً` });
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
router.get("/stock-audits", authMiddleware, requireBusinessPermission(inventoryCountPolicy.COUNT_PERMISSIONS.read), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const where = { companyId: req.companyId, branchId };
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

// 2. Legacy mutation is blocked; the Inventory V2 route above is the only
// authoritative creation path.
router.post("/stock-audits", authMiddleware, async (_req, res) => res.status(410).json({ success: false, code: "LEGACY_INVENTORY_COUNT_DISABLED", message: "Use the canonical Inventory Count workflow." }));
router.post("/stock-audits-legacy-disabled", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  // Compatibility adapter: durable lifecycle belongs only to the canonical
  // Inventory V2 audit service. The historical implementation below is
  // intentionally unreachable and retained temporarily for source review.
  const adapterTransaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"] || req.body?.branchId, { required: true });
    const existing = await models.StockAudit.findOne({ where: { companyId: req.companyId, branchId, status: "in-progress" }, transaction: adapterTransaction, lock: true });
    if (existing) {
      await adapterTransaction.commit();
      return res.status(200).json({ success: true, ...existing.toJSON(), data: existing.toJSON() });
    }
    const auditNumber = String(req.body?.auditNumber || `LEGACY-AUD-${Date.now()}`);
    const actor = { id: req.user?.id || null, name: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System" };
    const created = await inventoryAuditCanonicalService.createAudit({
      models, companyId: req.companyId, branchId, auditNumber,
      auditMethod: req.body?.auditMethod || "RFID_SCAN", notes: req.body?.notes || null,
      actor, transaction: adapterTransaction,
      recordAudit: (audit, auditMethod) => auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
        action: "inventory_v2.audit_created", description: `Inventory audit ${audit.auditNumber} created.`, sourceDocument: audit.id, metadata: { auditMethod, branchId },
      }), { transaction: adapterTransaction }),
    });
    const started = await inventoryAuditCanonicalService.startAudit({ models, companyId: req.companyId, branchId, auditId: created.audit.id, transaction: adapterTransaction });
    await adapterTransaction.commit();
    const result = started.audit.toJSON();
    result.itemsCount = started.expectedCount;
    return res.status(201).json({ success: true, ...result, data: result });
  } catch (error) {
    await adapterTransaction.rollback();
    return next(error);
  }

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
router.get("/stock-audits/:id", authMiddleware, requireBusinessPermission(inventoryCountPolicy.COUNT_PERMISSIONS.read), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const audit = await models.StockAudit.findOne({
      where: { id: req.params.id, companyId: req.companyId, branchId },
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

// 4. Store scanned items in the session (legacy mutation disabled)
router.post("/stock-audits/:id/items", authMiddleware, async (_req, res) => res.status(410).json({ success: false, code: "LEGACY_INVENTORY_COUNT_DISABLED", message: "Use the canonical Inventory Count workflow." }));
router.post("/stock-audits-legacy-disabled/:id/items", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  // Compatibility adapter. Observation is persisted only by the canonical
  // audit service; this route keeps the legacy request and response envelope.
  const adapterTransaction = await models.sequelize.transaction();
  try {
    const audit = await models.StockAudit.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: adapterTransaction, lock: true });
    if (!audit) throw new NotFoundError("جلسة الجرد غير موجودة");
    await inventoryAuditCanonicalService.observeAudit({
      models, companyId: req.companyId, branchId: audit.branchId, auditId: audit.id,
      assetIds: Array.isArray(req.body?.scannedAssetIds) ? req.body.scannedAssetIds : [],
      barcodes: Array.isArray(req.body?.barcodes) ? req.body.barcodes : [],
      rfidNumbers: Array.isArray(req.body?.rfidNumbers) ? req.body.rfidNumbers : [],
      method: req.body?.method || audit.auditMethod,
      transaction: adapterTransaction,
    });
    const updated = await models.StockAudit.findOne({
      where: { id: audit.id }, transaction: adapterTransaction,
      include: [{ model: models.StockAuditItem, as: "items", include: [{ model: models.Asset, as: "asset" }] }],
    });
    await adapterTransaction.commit();
    return res.status(200).json({ success: true, ...updated.toJSON(), data: updated.toJSON() });
  } catch (error) {
    await adapterTransaction.rollback();
    return next(error);
  }

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

// 5. Complete stock audit session (legacy mutation disabled)
router.post("/stock-audits/:id/complete", authMiddleware, async (_req, res) => res.status(410).json({ success: false, code: "LEGACY_INVENTORY_COUNT_DISABLED", message: "Use the canonical Inventory Count workflow." }));
router.post("/stock-audits-legacy-disabled/:id/complete", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  // Compatibility adapter. Complete and close are one atomic legacy operation
  // so a legacy caller never observes a partially terminal canonical audit.
  const adapterTransaction = await models.sequelize.transaction();
  try {
    const audit = await models.StockAudit.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: adapterTransaction, lock: true });
    if (!audit) throw new NotFoundError("جلسة الجرد غير موجودة");
    const actor = { id: req.user?.id || null, name: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System" };
    const completed = await inventoryAuditCanonicalService.completeAudit({ models, companyId: req.companyId, branchId: audit.branchId, auditId: audit.id, transaction: adapterTransaction });
    const closed = await inventoryAuditCanonicalService.closeAudit({ models, companyId: req.companyId, branchId: audit.branchId, auditId: audit.id, actor, transaction: adapterTransaction });
    const items = await models.StockAuditItem.findAll({ where: { stockAuditId: audit.id }, transaction: adapterTransaction });
    const missingCount = items.filter((item) => item.status === "missing").length;
    const unexpectedCount = items.filter((item) => item.status === "unexpected").length;
    await adapterTransaction.commit();
    return res.status(200).json({ success: true, audit: closed.audit, missingCount, unexpectedCount, replayed: completed.replayed && closed.replayed });
  } catch (error) {
    await adapterTransaction.rollback();
    return next(error);
  }

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

    // An audit is observation only.  Corrections require the explicit
    // request/approve/apply adjustment workflow; this compatibility endpoint
    // must never archive an Asset or silently move it between branches.
    for (const item of audit.items) {
      const asset = item.asset;
      if (!asset) continue;

      if (item.status === "missing") {
        missingCount++;
        await auditService.record(req.companyId, {
          action: "inventory.audit_missing_observed",
          description: `تم رصد الأصل المفقود في جرد RFID رقم ${audit.id} للأصل ${asset.id} دون تعديل حالته`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: branchRecord.name,
          sourceDocument: "stock_audit",
          severity: "warning",
          before: `status:${asset.status}`,
          after: "observation:MISSING"
        }, { transaction: t });

      } else if (item.status === "unexpected") {
        unexpectedCount++;
        await auditService.record(req.companyId, {
          action: "inventory.audit_extra_observed",
          description: `تم رصد أصل إضافي في جرد RFID رقم ${audit.id} للأصل ${asset.id} دون نقل الفرع`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: branchRecord.name,
          sourceDocument: "stock_audit",
          severity: "warning",
          before: `branch:${asset.branch || "unknown"} (branchId:${asset.branchId || "unknown"})`,
          after: "observation:EXTRA"
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

router.post("/customers/:id/attachments", authMiddleware, requireAnyBusinessPermission(["customers.update"], { touch: true }), uploadMiddleware.single("file"), async (req, res, next) => {
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

router.delete("/customers/:id/attachments/:attachmentId", authMiddleware, requireAnyBusinessPermission(["customers.update"], { touch: true }), async (req, res, next) => {
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

router.patch("/customers/:id/kyc", authMiddleware, requireAnyBusinessPermission(["customers.update"], { touch: true }), async (req, res, next) => {
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
router.post("/assets/:id/attachments", authMiddleware, requireAnyBusinessPermission(["inventory.adjust"], { touch: true }), uploadMiddleware.single("file"), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  let transactionFinalized = false;
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

    // The receipt screen uploads evidence after the Asset has been created.
    // Preserve the legacy unkeyed endpoint, but make a supplied key a real
    // durable replay boundary so retries cannot create a second attachment.
    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    let idempotencyRequest = null;
    if (idempotencyKey) {
      const fileFingerprint = require("crypto").createHash("sha256").update(fs.readFileSync(req.file.path)).digest("hex");
      const scope = "asset.attachment.upload";
      const requestHash = idempotencyService.hashRequest(scope, {
        assetId: asset.id,
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size,
        fileFingerprint,
      });
      const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash, transaction: t });
      if (!claim.claimed) {
        await t.rollback();
        transactionFinalized = true;
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash });
        if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
        throw new ConflictError(prior.message || "Idempotency-Key body conflict.");
      }
      idempotencyRequest = claim.request;
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

    const serialized = serializeAssetAttachment(attachment);
    const responseBody = { success: true, ...serialized, data: serialized };
    if (idempotencyRequest) await idempotencyService.succeed({ request: idempotencyRequest, statusCode: 201, responseBody, transaction: t });
    await t.commit();
    transactionFinalized = true;
    emitEntityChanged(req.companyId, {
      entity: "Attachment",
      action: "upload",
      id: attachmentId,
      branchId: asset.branchId,
      related: {
        assetIds: [asset.id]
      }
    });
    return res.status(201).json(responseBody);
  } catch (error) {
    if (!transactionFinalized) await t.rollback();
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) { }
    }
    next(error);
  }
});

// 3. Delete an attachment for an asset
router.delete("/assets/:id/attachments/:attachmentId", authMiddleware, requireAnyBusinessPermission(["inventory.adjust"], { touch: true }), async (req, res, next) => {
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

// Legacy transfer implementation is unreachable; canonical routes are mounted
// before this router from transfer.routes.js. Keep the historical block only as
// evidence until the next approved cleanup batch removes it.
router.use("/transfers-legacy-disabled", authMiddleware, (_req, res) => stableForbidden(res, "LEGACY_TRANSFER_ROUTE_DISABLED", "Inventory transfers must use the canonical transfer endpoints."));
// ─── Legacy Transfers Logic (disabled) ───────────────────────────────────────
router.post("/transfers-legacy-disabled", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
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

    // Every transfer surface uses the same pending-transfer state and the same
    // normalized item evidence.  The legacy endpoint is only a payload adapter.
    for (const asset of assets) {
        await models.sequelize.query(`INSERT INTO transfer_items
          (id,transfer_id,asset_id,company_id,from_branch_id,to_branch_id,status,created_at,updated_at)
          VALUES (:id,:transferId,:assetId,:companyId,:fromBranchId,:toBranchId,'PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, {
          replacements: { id: `TRI-${transferId}-${asset.id}`, transferId, assetId: asset.id, companyId: req.companyId, fromBranchId, toBranchId }, transaction: t,
        });
        await inventoryV2Runtime.transitionAsset({
          models, transaction: t, asset,
          context: { companyId: req.companyId, branchId: fromBranchId, branchName: fromBranchRecord.name, actorId: req.user?.id || null, actorName: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System", occurredAt: new Date() },
          toStatus: "PENDING_TRANSFER", eventType: "TRANSFER_REQUEST", movementType: "TRANSFER_REQUEST", sourceType: "TRANSFER", sourceId: transferId,
          note: `Transfer requested to ${toBranchRecord.name}`, idempotencyKey: `transfer-request:${transferId}:${asset.id}`,
        });
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

router.patch("/transfers-legacy-disabled/:id", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
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
          const event = await inventoryV2Runtime.recordAssetEvent({
            models, transaction: t, asset: asset.toJSON(), context: { companyId: req.companyId, branchId: transfer.fromBranchId, branchName: transfer.fromBranch, actorId: req.user?.id || null, actorName: actor, occurredAt: new Date() },
            eventType: "TRANSFER_OUT", oldStatus: "PENDING_TRANSFER", newStatus: "PENDING_TRANSFER", sourceType: "TRANSFER", sourceId: transfer.id,
            note: `Transfer dispatched to ${transfer.toBranch}`, idempotencyKey: `transfer-out:${transfer.id}:${asset.id}`,
          });
          await inventoryV2Runtime.recordMovement({ models, transaction: t, asset: asset.toJSON(), context: { companyId: req.companyId, actorId: req.user?.id || null, occurredAt: new Date() }, movementType: "TRANSFER_OUT", sourceType: "TRANSFER", sourceId: transfer.id, eventId: event.id, fromBranchId: transfer.fromBranchId, toBranchId: transfer.toBranchId });
          await models.sequelize.query("UPDATE transfer_items SET status='IN_TRANSIT',dispatched_at=:now,dispatched_by=:actor,updated_at=CURRENT_TIMESTAMP WHERE transfer_id=:transferId AND asset_id=:assetId", { replacements: { now: new Date(), actor, transferId: transfer.id, assetId: asset.id }, transaction: t });
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
          await inventoryV2Runtime.transitionAsset({
            models, transaction: t, asset,
            context: { companyId: req.companyId, branchId: transfer.toBranchId, branchName: transfer.toBranch, actorId: req.user?.id || null, actorName: actor, occurredAt: new Date() },
            toStatus: "AVAILABLE", eventType: "TRANSFER_IN", movementType: "TRANSFER_IN", sourceType: "TRANSFER", sourceId: transfer.id,
            note: `Transfer received in ${transfer.toBranch}`, idempotencyKey: `transfer-in:${transfer.id}:${asset.id}`, toBranchId: transfer.toBranchId,
          });
          await asset.update({ branch: transfer.toBranch }, { transaction: t });
          await models.sequelize.query("UPDATE transfer_items SET status='RECEIVED',received_at=:now,received_by=:actor,updated_at=CURRENT_TIMESTAMP WHERE transfer_id=:transferId AND asset_id=:assetId", { replacements: { now: new Date(), actor, transferId: transfer.id, assetId: asset.id }, transaction: t });
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
          await inventoryV2Runtime.transitionAsset({
            models, transaction: t, asset,
            context: { companyId: req.companyId, branchId: transfer.fromBranchId, branchName: transfer.fromBranch, actorId: req.user?.id || null, actorName: actor, occurredAt: new Date() },
            toStatus: "AVAILABLE", eventType: "TRANSFER_CANCELLED", movementType: "TRANSFER_CANCEL", sourceType: "TRANSFER", sourceId: transfer.id,
            note: `Transfer cancelled: ${cancelReason || "cancelled"}`, idempotencyKey: `transfer-cancel:${transfer.id}:${asset.id}`,
          });
          await models.sequelize.query("UPDATE transfer_items SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE transfer_id=:transferId AND asset_id=:assetId", { replacements: { transferId: transfer.id, assetId: asset.id }, transaction: t });
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
    if (!body.name || !body.role || !body.employeeCode) {
      throw new ValidationError("name, role and employeeCode are required.");
    }
    // Employee creation is identity-only; assign Branch access separately.
    if (body.branchId || (typeof body.branch === "string" && body.branch.trim())) {
      throw new ValidationError("Employee creation is identity-only; assign Branch access separately.", {
        branchId: ["Create the employee first, then assign allowed Branches explicitly."]
      });
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
      branch: "",
      branchId: null,
      status: "inactive",
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
    const attribution = commandActorContext.buildAttributionContract(req, {
      sourceOperation: "employees.create",
      sourceReference: employee.id
    });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "employee.created",
      description: `Employee ${employee.name} created.`,
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      userId: req.user?.id,
      place: req.branchId || "Employees",
      sourceDocument: employee.id,
      ...attribution,
      date: attribution.occurredAt,
      after: JSON.stringify({ employeeId: employee.id, employeeCode: employee.employeeCode })
    }, { requestedOperation: "employees.create", authorizationResult: "allowed" }), { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Employee", action: "create", id: employee.id });
    return res.status(201).json({ success: true, data: employee, setupState: "BRANCH_ASSIGNMENT_REQUIRED" });
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
    if (req.body.branch !== undefined || req.body.branchId !== undefined) {
      throw new ValidationError("Employee default Branch is managed through explicit Branch access.", {
        branchId: ["Use PUT /employees/:id/branches to assign and select a default Branch."]
      });
    }
    for (const key of ["name", "role", "systemRole", "status", "email", "phone", "joinDate", "jobTitle", "approvalLimit", "assignedDevice", "notes", "approvalLimitsDetail", "deactivateReason"]) {
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
    if (updates.status === "present") {
      if (!(await employeeHasConfiguredCredential(req.companyId, employee.id, t))) {
        throw new ValidationError("Employee PIN must be configured before activation.", { pin: ["Set a six-digit Employee PIN before activating this Employee."] });
      }
      const readiness = await employeeAuthorizationService.assertEmployeeOperationalReadiness({ companyId: req.companyId, employeeId: employee.id, transaction: t });
      if (!readiness.ready) {
        throw new ValidationError("Employee Branch assignment must be completed before activation.", { branchId: ["Assign at least one active Branch before activating this Employee."] });
      }
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
    const attribution = commandActorContext.buildAttributionContract(req, {
      sourceOperation: "employees.update",
      sourceReference: employee.id
    });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "employee.updated",
      description: `Employee ${employee.name} updated.`,
      user: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System",
      userId: req.user?.id,
      place: req.branchId || "Employees",
      sourceDocument: employee.id,
      ...attribution,
      date: attribution.occurredAt,
      before: JSON.stringify({ employeeCode: before.employeeCode, role: before.role, branchId: before.branchId }),
      after: JSON.stringify({ employeeCode: employee.employeeCode, role: employee.role, branchId: employee.branchId })
    }, { requestedOperation: "employees.update", authorizationResult: "allowed" }), { transaction: t });
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
  const t = await models.sequelize.transaction();
  try {
    const employee = await models.Employee.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!employee) throw new NotFoundError("Employee not found.");
    const before = employee.toJSON();
    await employee.update({ status: "inactive", deactivateReason: req.body?.reason || employee.deactivateReason || "" }, { transaction: t });
    const attribution = commandActorContext.buildAttributionContract(req, { sourceOperation: "employees.deactivate", sourceReference: employee.id });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "employee.deactivated",
      description: `Employee ${employee.name} deactivated.`,
      place: req.branchId || "Employees",
      sourceDocument: employee.id,
      ...attribution,
      date: attribution.occurredAt,
      before: JSON.stringify({ status: before.status, deactivateReason: before.deactivateReason }),
      after: JSON.stringify({ status: employee.status, deactivateReason: employee.deactivateReason })
    }, { requestedOperation: "employees.deactivate", authorizationResult: "allowed" }), { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Employee", action: "update", id: employee.id });
    return res.status(200).json({ success: true, data: employee });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});
router.post("/employees/:id/reactivate", authMiddleware, requireAnyPermission(employeeCoreManagePermissions), async (req, res, next) => {
  const t = await models.sequelize.transaction();
  try {
    const employee = await models.Employee.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!employee) throw new NotFoundError("Employee not found.");
    if (!(await employeeHasConfiguredCredential(req.companyId, employee.id, t))) {
      throw new ValidationError("Employee PIN must be configured before activation.", { pin: ["Set a six-digit Employee PIN before activating this Employee."] });
    }
    const readiness = await employeeAuthorizationService.assertEmployeeOperationalReadiness({ companyId: req.companyId, employeeId: employee.id, transaction: t });
    if (!readiness.ready) {
      throw new ValidationError("Employee Branch assignment must be completed before activation.", { branchId: ["Assign at least one active Branch before activating this Employee."] });
    }
    const before = employee.toJSON();
    await employee.update({ status: "present", deactivateReason: null }, { transaction: t });
    const attribution = commandActorContext.buildAttributionContract(req, { sourceOperation: "employees.reactivate", sourceReference: employee.id });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "employee.reactivated",
      description: `Employee ${employee.name} reactivated.`,
      place: req.branchId || "Employees",
      sourceDocument: employee.id,
      ...attribution,
      date: attribution.occurredAt,
      before: JSON.stringify({ status: before.status, deactivateReason: before.deactivateReason }),
      after: JSON.stringify({ status: employee.status, deactivateReason: employee.deactivateReason })
    }, { requestedOperation: "employees.reactivate", authorizationResult: "allowed" }), { transaction: t });
    await t.commit();
    emitEntityChanged(req.companyId, { entity: "Employee", action: "update", id: employee.id });
    return res.status(200).json({ success: true, data: employee });
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// 1. Initialize Standard CRUD Endpoints
// Read-only POS customer lookup.  It is intentionally separate from the
// customer CRUD route: POS may find an existing company customer by phone,
// but it never creates or mutates a customer at transaction time.
router.get("/pos/customer-lookup", authMiddleware, requireAnyBusinessPermission(["pos.view", "pos.sell"]), async (req, res, next) => {
  try {
    const normalizedPhone = normalizePhone(req.query.phone);
    if (!normalizedPhone) {
      throw new AppError("Customer phone is required.", 422, "CUSTOMER_PHONE_REQUIRED");
    }

    const rows = await models.sequelize.query(`
      SELECT id, name, phone, email, tier, status
      FROM customers
      WHERE company_id = :companyId
        AND status = 'active'
        AND deleted_at IS NULL
        AND ltrim(regexp_replace(phone, '[^0-9]', '', 'g'), '0') = :normalizedPhone
      ORDER BY created_at ASC, id ASC
      LIMIT 2
    `, {
      replacements: { companyId: req.companyId, normalizedPhone },
      type: require("sequelize").QueryTypes.SELECT,
    });

    if (rows.length > 1) {
      throw new AppError("More than one active customer matches this phone number.", 409, "CUSTOMER_PHONE_AMBIGUOUS");
    }

    const customer = rows[0] || null;
    return res.status(200).json({
      success: true,
      data: {
        found: Boolean(customer),
        customer,
      },
    });
  } catch (error) {
    return next(error);
  }
});
setupCrud("customers", models.Customer, ["name", "phone", "email"]);

// One selected-Customer projection only. Do not enrich every /customers list
// row with customer-credit work, and do not own any financial calculation here.
router.get("/customers/:id/pos-summary", authMiddleware, requireBusinessPermission("customers.view"), async (req, res, next) => {
  try {
    const customer = await requireBranchCustomerResource({
      companyId: req.companyId,
      branchId: req.branchId,
      customerId: req.params.id,
    });
    const summary = await customerPosSummaryService.getCustomerPosSummary({
      models,
      companyId: req.companyId,
      customer,
    });
    return res.status(200).json({ success: true, data: summary });
  } catch (error) {
    return next(error);
  }
});
setupCrud("suppliers", models.Supplier, ["name", "phone", "email", "category"]);
setupCrud("employees", models.Employee, ["name", "phone", "email", "role"]);

// Inventory Master V2 read and evidence endpoints. These deliberately use the
// normalized V2 tables; the legacy generic assets CRUD remains compatibility
// only and is not a quantity-stock authority for these routes.
function inventoryV2Context(req, branchId) {
  return {
    companyId: req.companyId,
    branchId,
    branchName: req.branchName || null,
    actorId: req.user?.id || null,
    actorName: req.user ? `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email || "System" : "System",
    occurredAt: new Date(),
  };
}

function requireInventoryV2IdempotencyKey(req) {
  const key = String(req.headers["idempotency-key"] || "").trim();
  if (!key) throw new ValidationError("Idempotency-Key is required for Inventory V2 mutations.");
  return key;
}

async function resolveInventoryCountIdempotency({ req, scope, normalizedBody, params, transaction }) {
  const key = requireInventoryV2IdempotencyKey(req);
  const requestHash = idempotencyService.hashRequest(scope, normalizedBody, params);
  const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key, requestHash, transaction });
  return { key, requestHash, claim };
}

async function findScopedInventoryV2Asset(req, assetId, branchId, transaction, { lock = false } = {}) {
  const asset = await models.Asset.findOne({
    where: { id: assetId, companyId: req.companyId, branchId },
    transaction,
    ...(lock ? { lock: true } : {}),
  });
  if (!asset || !asset.inventoryProfile || !asset.operationalStatus) throw new NotFoundError("Inventory V2 Asset not found in the authorized Branch.");
  return asset;
}

router.get("/inventory-v2/assets", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
    const filters = ["a.company_id=:companyId", "a.branch_id=:branchId"];
    const replacements = { companyId: req.companyId, branchId, limit: Math.min(Math.max(Number(req.query.limit) || 50, 1), 200), offset: Math.max(Number(req.query.offset) || 0, 0) };
    for (const [queryKey, column] of [["profile", "a.inventory_profile"], ["status", "a.operational_status"], ["condition", "a.condition"], ["tagState", "a.tag_state"], ["locationId", "a.location_id"], ["supplierId", "a.supplier_id"]]) {
      if (req.query[queryKey]) { filters.push(`${column}=:${queryKey}`); replacements[queryKey] = String(req.query[queryKey]); }
    }
    if (req.query.search) {
      // Canonical All Items search queries only serialized Assets and their
      // normalized identity relations; Products never provide stock results.
      filters.push(`(a.id ILIKE :search OR a.name ILIKE :search OR a.description ILIKE :search
        OR a.barcode ILIKE :search OR a.rfid ILIKE :search OR a.brand ILIKE :search
        OR a.model ILIKE :search OR a.model_number ILIKE :search
        OR EXISTS (SELECT 1 FROM suppliers supplier_search WHERE supplier_search.id=a.supplier_id AND supplier_search.name ILIKE :search)
        OR EXISTS (SELECT 1 FROM asset_certificates certificate_search WHERE certificate_search.asset_id=a.id AND (certificate_search.certificate_number ILIKE :search OR certificate_search.issuer ILIKE :search)))`);
      replacements.search = `%${String(req.query.search).trim()}%`;
    }
    const sortMap = { createdAt: "a.created_at", barcode: "a.barcode", profile: "a.inventory_profile", status: "a.operational_status", purchaseDate: "a.purchase_date" };
    const sort = sortMap[req.query.sort] || sortMap.createdAt;
    const direction = String(req.query.direction || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    const where = filters.join(" AND ");
    const [items, [total]] = await Promise.all([
      models.sequelize.query(`SELECT a.id,a.name,a.description,a.brand,a.model,a.model_number AS \"modelNumber\",a.barcode,a.inventory_profile AS \"inventoryProfile\",a.operational_status AS \"operationalStatus\",a.condition,a.tag_state AS \"tagState\",a.branch_id AS \"branchId\",b.name AS \"branchName\",a.location_id AS \"locationId\",a.location,a.supplier_id AS \"supplierId\",supplier.name AS \"supplierName\",a.purchase_date AS \"purchaseDate\",a.gross_weight AS \"grossWeight\",a.net_weight AS \"netWeight\",a.karat,a.created_at AS \"createdAt\",r.rfid_number AS \"rfid\" FROM assets a LEFT JOIN asset_rfid_assignments r ON r.asset_id=a.id AND r.is_current=true LEFT JOIN suppliers supplier ON supplier.id=a.supplier_id LEFT JOIN branches b ON b.id=a.branch_id WHERE ${where} ORDER BY ${sort} ${direction},a.id ASC LIMIT :limit OFFSET :offset`, { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query(`SELECT COUNT(*)::int AS total FROM assets a WHERE ${where}`, { replacements, type: require("sequelize").QueryTypes.SELECT }),
    ]);
    return res.status(200).json({ success: true, data: { items, total: total.total, pieceTotal: total.total, limit: replacements.limit, offset: replacements.offset } });
  } catch (error) { return next(error); }
});

// The profile registry is the single server-side authority.  The intake UI
// consumes this read-only contract for presentation and lets the receipt path
// remain the authoritative validator.
router.get("/inventory-v2/profiles", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const profiles = Object.entries(inventoryMasterPolicy.PROFILE_REGISTRY).map(([key, contract]) => ({
      key,
      aliases: contract.aliases,
      assetType: contract.assetType,
      family: contract.family,
      required: contract.required,
      optional: contract.optional,
      condition: contract.condition,
      weightApplicable: contract.weightApplicable,
      certificateSupported: contract.certificateSupported,
      componentsSupported: contract.componentsSupported,
      rfidAllowed: contract.rfidAllowed,
      locationOptional: contract.locationOptional,
      looseDetails: contract.looseDetails || null,
      masterDataCategories: profileMasterDataService.categoriesForProfile(key),
      goldValuation: contract.goldValuation || { enabled: false },
    }));
    return res.status(200).json({ success: true, data: {
      profiles,
      // C3 additive read-only contract: the existing profile registry remains
      // the authority; this metadata makes its shared Asset/receive boundary
      // explicit without creating another persistence or mutation path.
      commonFieldContract: inventoryCommonProfileFieldsService.getPublicContract(),
    } });
  } catch (error) { return next(error); }
});

// Read-only acquisition preview. It deliberately uses the exact V2 piece
// normalizer and summary rules used by Supplier Receive; it never creates a
// PurchaseOrder, Asset, payable, journal, or treasury row.
router.post("/inventory-v2/receive-preview", authMiddleware, requireAnyBusinessPermission(["inventory.view", "suppliers.create"]), async (req, res, next) => {
  try {
    const body = req.body || {};
    let rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw new ValidationError("Inventory V2 preview requires at least one item.");
    supplierReceiveContractService.assertCanonicalReceiveInput({
      body,
      items: rawItems,
      requestBranchId: req.branchId,
      headerBranchId: req.headers["x-branch-id"],
    });
    const canonicalLocations = await supplierReceiveContractService.resolveAndCanonicalizeLocations({
      models,
      companyId: req.companyId,
      branchId: req.branchId,
      body,
      items: rawItems,
    });
    rawItems = canonicalLocations.items;
    rawItems = rawItems.map((item) => ({ ...item, taxTreatment: item.taxTreatment || body.taxTreatment, taxContext: item.taxContext || body.taxContext }));
    const vatRateDefault = await goldValuationService.resolveConfiguredVatRate({ models, companyId: req.companyId });
    const diamondMasterData = await loadDiamondMasterData(req.companyId);
    const gemMasterData = await loadGemStoneMasterData(req.companyId);
    const pearlMasterData = await loadPearlJewelleryMasterData(req.companyId);
    const loosePearlMasterData = await loadLoosePearlMasterData(req.companyId);
    const pieceSets = inventoryV2Runtime.requireV2ReceiptPieces(rawItems, { vatRateDefault, diamondMasterData });
    const settings = await settingsService.getCompanySettings(req.companyId);
    const companyTaxPolicy = await companyTaxPolicyService.getCompanyTaxPolicy(req.companyId);
    const calculatedPieceSets = await Promise.all(pieceSets.map((pieces) => Promise.all(pieces.map(async (piece) => {
      if (piece.profile === gemStoneJewelleryProfileService.PROFILE) return gemStoneJewelleryProfileService.calculateReceiptPiece({ companyId: req.companyId, input: piece, settings, taxPolicy: companyTaxPolicy, masterData: gemMasterData, requireSalePrice: false });
      if (piece.profile === pearlJewelleryProfileService.PROFILE) return pearlJewelleryProfileService.calculateReceiptPiece({ companyId: req.companyId, input: piece, taxPolicy: companyTaxPolicy, masterData: pearlMasterData.masters, pearlSizes: pearlMasterData.pearlSizes, requireSalePrice: false });
      if (piece.profile === loosePearlProfileService.PROFILE) return loosePearlProfileService.calculateReceiptPiece({ input: piece, taxPolicy: companyTaxPolicy, masters: loosePearlMasterData.masters, pearlSizes: loosePearlMasterData.pearlSizes, requireSalePrice: false });
      return piece;
    }))));
    const normalizedItems = rawItems.map((item, index) => supplierAcquisitionPreviewService.normalizeItem(item, calculatedPieceSets[index]));
    const preview = supplierAcquisitionPreviewService.previewFromPieces({ normalizedItems, body, settings, inventoryV2Target: true });
    return res.status(200).json({ success: true, data: preview, readOnly: true });
  } catch (error) {
    const diamondProfile = require("../services/diamond-jewellery-profile.service");
    const hasDiamondProfile = Array.isArray(req.body?.items) && req.body.items.some((item) => Array.isArray(item?.perPiece) && item.perPiece.some((piece) => String(piece?.profile || piece?.inventoryProfile || "").toUpperCase() === diamondProfile.PROFILE));
    const diamondValidation = diamondProfile.toValidationError(error) || (hasDiamondProfile && error?.message === "INVENTORY_CERTIFICATE_REQUIRED_FIELDS" ? diamondProfile.toValidationError(new Error("DIAMOND_CERTIFICATE_AUTHORITY_REQUIRED")) : null);
    if (diamondValidation) return next(diamondValidation);
    return next(error);
  }
});

// Pearl Size is canonical company Master Data.  Receive operators only read
// active values; administration reuses the established settings/inventory
// maintenance permissions and never creates values inline from Receive.
const pearlSizeMasterReadGuard = requireAnyBusinessPermission(["settings.view", "inventory.view"]);
const pearlSizeMasterWriteGuard = requireAnyBusinessPermission(["settings.update", "inventory.adjust"], { touch: true });

async function auditPearlSizeMasterData(req, action, row, before, transaction) {
  await auditService.record(req.companyId, {
    action,
    description: `Pearl Size Master Data ${row.displayValue} mm ${before ? "updated" : "created"}`,
    user: actorName(req), userId: req.user?.id, place: req.branchId || "System Settings",
    sourceDocument: row.id, severity: "info", before: before ? JSON.stringify(before) : null,
    after: JSON.stringify(pearlSizeMasterDataService.serialize(row)),
  }, { transaction });
}

router.get("/pearl-size-master-data", authMiddleware, pearlSizeMasterReadGuard, async (req, res, next) => {
  try {
    const values = await pearlSizeMasterDataService.list({ models, companyId: req.companyId, activeOnly: req.query.includeInactive !== "true" });
    return res.status(200).json({ success: true, data: { unit: "MM", values } });
  } catch (error) { return next(error); }
});

router.post("/pearl-size-master-data", authMiddleware, pearlSizeMasterWriteGuard, async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const result = await pearlSizeMasterDataService.create({ models, companyId: req.companyId, value: req.body?.value, actorId: req.user?.id || null, transaction });
    if (result.created) await auditPearlSizeMasterData(req, "pearl_size_master_data.create", result.row, null, transaction);
    await transaction.commit();
    if (result.created) emitEntityChanged(req.companyId, { entity: "PearlSizeMasterData", action: "create", id: result.row.id });
    return res.status(result.created ? 201 : 200).json({ success: true, data: pearlSizeMasterDataService.serialize(result.row), replayed: !result.created });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.patch("/pearl-size-master-data/:id", authMiddleware, pearlSizeMasterWriteGuard, async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const row = await models.PearlSizeMasterData.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw new NotFoundError("Pearl Size Master Data value not found.");
    const before = pearlSizeMasterDataService.serialize(row);
    if (req.body?.isActive !== undefined) await row.update({ isActive: Boolean(req.body.isActive), updatedBy: req.user?.id || null }, { transaction });
    await auditPearlSizeMasterData(req, "pearl_size_master_data.update", row, before, transaction);
    await transaction.commit();
    emitEntityChanged(req.companyId, { entity: "PearlSizeMasterData", action: "update", id: row.id });
    return res.status(200).json({ success: true, data: pearlSizeMasterDataService.serialize(row) });
  } catch (error) { await transaction.rollback(); return next(error); }
});

// Typed source-backed lists for Loose Pearl and Loose Gemstone. Pearl Size is
// intentionally excluded: its numeric MM table above remains its sole owner.
router.post("/inventory-master-data/bootstrap", authMiddleware, requireBusinessPermission("settings.update", { touch: true, operation: "inventory_master_data.bootstrap" }), async (req, res, next) => {
  try {
    const data = await inventoryMasterDataBootstrapService.bootstrapInventoryMasterData({
      models,
      companyId: req.companyId,
      actorId: req.user?.id || "inventory-master-data-bootstrap",
      dryRun: Boolean(req.body?.dryRun),
    });
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.get("/profile-master-data", authMiddleware, pearlSizeMasterReadGuard, async (req, res, next) => {
  try {
    const categories = String(req.query.categories || "").split(",").map((entry) => entry.trim()).filter(Boolean);
    const values = await profileMasterDataService.list({ models, companyId: req.companyId, categories, activeOnly: req.query.includeInactive !== "true" });
    return res.status(200).json({ success: true, data: { values } });
  } catch (error) { return next(error); }
});

router.post("/profile-master-data", authMiddleware, pearlSizeMasterWriteGuard, async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const result = await profileMasterDataService.create({ models, companyId: req.companyId, category: req.body?.category, value: req.body?.value, actorId: req.user?.id || null, transaction });
    if (result.created) await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "profile_master_data.create", description: `Profile Master Data ${result.row.category} ${result.row.label} created`, sourceDocument: result.row.id, after: JSON.stringify(result.row) }), { transaction });
    await transaction.commit();
    if (result.created) emitEntityChanged(req.companyId, { entity: "ProfileMasterData", action: "create", id: result.row.id });
    return res.status(result.created ? 201 : 200).json({ success: true, data: result.row, replayed: !result.created });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.patch("/profile-master-data/:id", authMiddleware, pearlSizeMasterWriteGuard, async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const result = await profileMasterDataService.update({ models, companyId: req.companyId, id: req.params.id, value: req.body?.value, isActive: req.body?.isActive, actorId: req.user?.id || null, transaction });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "profile_master_data.update", description: `Profile Master Data ${result.row.category} updated`, sourceDocument: result.row.id, before: JSON.stringify(result.before), after: JSON.stringify(result.row) }), { transaction });
    await transaction.commit();
    emitEntityChanged(req.companyId, { entity: "ProfileMasterData", action: "update", id: result.row.id });
    return res.status(200).json({ success: true, data: result.row });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.get("/inventory-v2/assets/:id", authMiddleware, requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId);
    const replacements = { assetId: asset.id, companyId: req.companyId };
    const [origin, cost, valuation, goldDetails, pricing, components, rfid, certificates, attachments, history, movements, links, profileMasterReferences, saleLinks, returnReviews] = await Promise.all([
      models.sequelize.query("SELECT * FROM asset_origins WHERE asset_id=:assetId", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT * FROM asset_purchase_cost_revisions WHERE asset_id=:assetId AND is_current=true", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT * FROM asset_current_valuations WHERE asset_id=:assetId", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT * FROM asset_gold_details WHERE asset_id=:assetId", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT * FROM asset_pricing_policies WHERE asset_id=:assetId", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      inventoryV2Runtime.fetchAssetComponents({ models, assetId: asset.id }),
      models.sequelize.query("SELECT * FROM asset_rfid_assignments WHERE asset_id=:assetId ORDER BY assigned_at DESC", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT id,type,issuer,certificate_number AS \"certificateNumber\",issue_date AS \"issueDate\",url FROM asset_certificates WHERE asset_id=:assetId ORDER BY created_at ASC", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT id,name,type,url,uploaded_at AS \"uploadedAt\",uploaded_by AS \"uploadedBy\" FROM asset_attachments WHERE asset_id=:assetId ORDER BY created_at ASC", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT * FROM asset_events WHERE asset_id=:assetId ORDER BY occurred_at DESC NULLS LAST,created_at DESC", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT * FROM inventory_asset_movements WHERE asset_id=:assetId ORDER BY occurred_at DESC", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT 'PURCHASE_ORDER' AS type,purchase_order_item_id::text AS id FROM purchase_order_item_asset_links WHERE asset_id=:assetId UNION ALL SELECT 'INVOICE',invoice_item_id::text FROM invoice_item_asset_links WHERE asset_id=:assetId", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT r.category_key AS \"category\",r.master_data_id AS \"masterDataId\",r.value_snapshot AS \"value\",r.label_snapshot AS \"label\",m.is_active AS \"isActive\" FROM asset_profile_master_data_references r JOIN profile_master_data m ON m.id=r.master_data_id WHERE r.asset_id=:assetId ORDER BY r.category_key", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT invoice_item_id, quote_snapshot FROM invoice_item_asset_links WHERE asset_id=:assetId", { replacements, type: require("sequelize").QueryTypes.SELECT }),
      models.sequelize.query("SELECT id,return_invoice_id AS \"returnInvoiceId\",condition_outcome AS \"conditionOutcome\",note,reviewed_by AS \"reviewedBy\",reviewed_at AS \"reviewedAt\",approved_by AS \"approvedBy\",approved_at AS \"approvedAt\" FROM asset_return_reviews WHERE asset_id=:assetId ORDER BY reviewed_at DESC", { replacements, type: require("sequelize").QueryTypes.SELECT }),
    ]);
    const rawQuote = saleLinks[0]?.quote_snapshot;
    const salePricing = rawQuote ? (typeof rawQuote === "string" ? JSON.parse(rawQuote) : rawQuote) : null;
    const looseProfiles = new Set(["LOOSE_DIAMOND", "LOOSE_GEMSTONE", "LOOSE_PEARL"]);
    const looseDetailComponent = looseProfiles.has(asset.inventoryProfile) ? components.find((component) => component.role === "PRIMARY_SUBJECT") || null : null;
    const looseDetails = looseDetailComponent ? {
      ...looseDetailComponent,
      ...(looseDetailComponent.diamondDetails || looseDetailComponent.gemstoneDetails || looseDetailComponent.pearlDetails || {}),
      carat: looseDetailComponent.component_carat || null,
      totalPearlWeight: looseDetailComponent.component_weight || null,
      unit: looseDetailComponent.measurement_unit || null,
    } : null;
    const looseMeasurement = inventoryMasterPolicy.describeLooseMeasurement(asset.inventoryProfile, looseDetails);
    // The immutable event stream is the lifecycle authority.  Movement rows
    // are deliberately exposed beside it for the physical trail; they are not
    // client-created history and retain any event link the runtime recorded.
    const timeline = [
      ...history.map((event) => ({ kind: "EVENT", occurredAt: event.occurred_at || event.occurredAt || event.created_at || event.createdAt, id: event.id, eventType: event.event_type || event.eventType || event.action, note: event.notes || event.note, oldStatus: event.before_state || event.beforeState, newStatus: event.after_state || event.afterState, sourceType: event.source_type || event.sourceType, sourceId: event.source_id || event.sourceId, actor: event.employee_name || event.employeeName || event.user, branch: event.branch })),
      ...movements.map((movement) => ({ kind: "MOVEMENT", occurredAt: movement.occurred_at || movement.occurredAt, id: movement.id, eventId: movement.asset_event_id || movement.assetEventId || null, eventType: movement.movement_type || movement.movementType, sourceType: movement.source_type || movement.sourceType, sourceId: movement.source_id || movement.sourceId, fromBranchId: movement.from_branch_id || movement.fromBranchId || null, toBranchId: movement.to_branch_id || movement.toBranchId || null, fromLocationId: movement.from_location_id || movement.fromLocationId || null, toLocationId: movement.to_location_id || movement.toLocationId || null })),
    ].sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime());
    return res.status(200).json({ success: true, data: { asset: asset.toJSON(), origin: origin[0] || null, currentPurchaseCost: cost[0] || null, currentValuation: valuation[0] || null, goldDetails: goldDetails[0] || null, pricingPolicy: pricing[0] || null, components: looseDetailComponent ? components.filter((component) => component.id !== looseDetailComponent.id) : components, looseDetails: looseDetails ? { ...looseDetails, measurement: looseMeasurement, masterDataReferences: profileMasterReferences } : null, rfidAssignments: rfid, certificates, attachments, history, movements, timeline, documentLinks: links, salePricing, returnReviews, legalActions: Array.from(inventoryV2Runtime.TRANSITIONS[asset.operationalStatus] || []) } });
  } catch (error) { return next(error); }
});

// Dedicated operational selling-price command. Price is not part of generic
// metadata editing because it is the POS/Sale/Return/Exchange authority.
router.patch("/inventory-v2/assets/:id/selling-price", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true, operation: assetSellingPriceService.PRICE_EDIT_OPERATION }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"] || req.branchId, { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const scope = "inventory-v2.asset-selling-price";
    const requestHash = idempotencyService.hashRequest(scope, body, { assetId: req.params.id, branchId });
    const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash, transaction });
    if (!claim.claimed) {
      await transaction.rollback();
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message, code: "IDEMPOTENCY_CONFLICT" });
    }
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId, transaction, { lock: true });
    const result = await assetSellingPriceService.updateSellingPrice({ models, asset, body, req, transaction });
    const responseBody = { success: true, replayed: false, data: { assetId: asset.id, branchId, ...result } };
    await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody, transaction });
    await transaction.commit();
    if (result.changed) emitEntityChanged(req.companyId, { entity: "Asset", action: "selling_price_changed", id: asset.id, branchId });
    return res.status(200).json(responseBody);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    return next(error);
  }
});

const RETURN_REVIEW_OUTCOMES = new Set(["GOOD", "NEEDS_INSPECTION", "DAMAGED", "BROKEN", "NEEDS_REPAIR"]);
async function claimReturnedRestockIdempotency(req, transaction, scope, body) {
  const key = req.headers["idempotency-key"] || body.idempotencyKey;
  if (!key) throw new ValidationError("مفتاح منع التكرار (Idempotency-Key) مطلوب لمراجعة القطعة المرتجعة");
  const requestHash = idempotencyService.hashRequest(scope, idempotencyBodyWithActor(req, body, commandActorContext.fromRequest(req)));
  const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key, requestHash, transaction });
  if (!claim.claimed) {
    await transaction.rollback();
    const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key, requestHash });
    const error = new AppError(prior.message || "طلب مراجعة سابق", prior.statusCode || 409, prior.state === "replay" ? "IDEMPOTENCY_REPLAY" : "IDEMPOTENCY_CONFLICT");
    error.idempotencyReplay = prior;
    throw error;
  }
  return { key, request: claim.request };
}

async function completedReturnForAsset({ assetId, companyId, transaction }) {
  const rows = await models.sequelize.query(`SELECT i.id FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id
    WHERE i.company_id=:companyId AND ii.asset_id=:assetId AND i.type='return' AND i.status='returned' AND i.posting_status='posted'
    ORDER BY i.posted_at DESC NULLS LAST LIMIT 1 FOR UPDATE`, { replacements: { assetId, companyId }, transaction, type: require("sequelize").QueryTypes.SELECT });
  if (!rows.length) throw new ValidationError("لا توجد عملية مرتجع مالية مكتملة لهذا الأصل");
  return rows[0].id;
}

router.post("/inventory-v2/assets/:id/return-review", authMiddleware, requireBusinessPermission("inventory.returns.approve_restock", { touch: true, operation: "inventory.returns.approve_restock" }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const claimed = await claimReturnedRestockIdempotency(req, transaction, "inventory.returned.review", body);
    const branch = await resolveAuthorizedBranch(req, body.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });
    const asset = await models.Asset.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!asset || asset.branchId !== branch.id) throw new NotFoundError("Returned Asset not found in the authorized Branch.");
    if (inventoryV2Runtime.operationalStatusOf(asset) !== "RETURNED") throw new ValidationError("لا يمكن مراجعة إعادة الإدخال إلا لأصل حالته مرتجع");
    const conditionOutcome = String(body.conditionOutcome || "").trim().toUpperCase();
    if (!RETURN_REVIEW_OUTCOMES.has(conditionOutcome)) throw new ValidationError("نتيجة مراجعة المرتجع غير معتمدة");
    const returnInvoiceId = await completedReturnForAsset({ assetId: asset.id, companyId: req.companyId, transaction });
    const existing = await models.AssetReturnReview.findOne({ where: { assetId: asset.id, returnInvoiceId }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing) throw new ConflictError("تم تسجيل مراجعة هذا المرتجع مسبقاً");
    const now = new Date();
    const review = await models.AssetReturnReview.create({ id: inventoryV2Runtime.newId("IMRETREV"), assetId: asset.id, returnInvoiceId, companyId: req.companyId, branchId: branch.id, conditionOutcome, note: body.note ? String(body.note).trim() : null, reviewedBy: req.user.id, reviewedAt: now }, { transaction });
    const context = { ...inventoryV2Context(req, branch.id), branchName: branch.name, occurredAt: now };
    await inventoryV2Runtime.recordAssetEvent({ models, transaction, asset: asset.toJSON(), context, eventType: "RETURN_REVIEW_RECORDED", oldStatus: "RETURNED", newStatus: "RETURNED", sourceType: "RETURN_INVOICE", sourceId: returnInvoiceId, note: `Return review: ${conditionOutcome}${review.note ? ` — ${review.note}` : ""}`, idempotencyKey: claimed.key });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory.returned.review", description: `Returned Asset ${asset.id} reviewed as ${conditionOutcome}`, sourceDocument: returnInvoiceId, after: JSON.stringify({ reviewId: review.id, conditionOutcome }) }, { requiredPermission: "inventory.returns.approve_restock", requestedOperation: "inventory.returns.approve_restock", authorizationResult: "allowed" }), { transaction });
    const responseBody = { success: true, data: { reviewId: review.id, assetId: asset.id, returnInvoiceId, conditionOutcome, restockEligible: conditionOutcome === "GOOD" } };
    await idempotencyService.succeed({ request: claimed.request, statusCode: 201, responseBody, transaction });
    await transaction.commit();
    return res.status(201).json(responseBody);
  } catch (error) {
    if (error.idempotencyReplay) return res.status(error.idempotencyReplay.statusCode || 200).json(error.idempotencyReplay.responseBody);
    if (!transaction.finished) await transaction.rollback();
    return next(error);
  }
});

router.post("/inventory-v2/assets/:id/return-review/approve-restock", authMiddleware, requireBusinessPermission("inventory.returns.approve_restock", { touch: true, operation: "inventory.returns.approve_restock" }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const claimed = await claimReturnedRestockIdempotency(req, transaction, "inventory.returned.approve_restock", body);
    const branch = await resolveAuthorizedBranch(req, body.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });
    const asset = await models.Asset.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!asset || asset.branchId !== branch.id) throw new NotFoundError("Returned Asset not found in the authorized Branch.");
    if (inventoryV2Runtime.operationalStatusOf(asset) !== "RETURNED") throw new ValidationError("لا يمكن اعتماد إعادة الإدخال إلا لأصل حالته مرتجع");
    const returnInvoiceId = await completedReturnForAsset({ assetId: asset.id, companyId: req.companyId, transaction });
    const review = await models.AssetReturnReview.findOne({ where: { assetId: asset.id, returnInvoiceId, companyId: req.companyId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!review) throw new ValidationError("يجب تسجيل مراجعة القطعة المرتجعة قبل اعتمادها");
    if (review.conditionOutcome !== "GOOD") throw new ValidationError("إعادة القطعة إلى المتاح تتطلب حالة Good");
    if (review.approvedAt) throw new ConflictError("تم اعتماد إعادة هذه القطعة للمخزون مسبقاً");
    const now = new Date();
    await review.update({ approvedBy: req.user.id, approvedAt: now }, { transaction });
    const context = { ...inventoryV2Context(req, branch.id), branchName: branch.name, occurredAt: now };
    await inventoryV2Runtime.transitionAsset({ models, transaction, asset, context, toStatus: "AVAILABLE", eventType: "RETURNED_RESTOCK_APPROVED", movementType: "RETURNED_RESTOCK", sourceType: "RETURN_INVOICE", sourceId: returnInvoiceId, note: review.note || "Returned Asset reviewed GOOD and approved for restock", idempotencyKey: claimed.key });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory.returned.approve_restock", description: `Returned Asset ${asset.id} approved back to available inventory`, sourceDocument: returnInvoiceId, before: "RETURNED", after: "AVAILABLE" }, { requiredPermission: "inventory.returns.approve_restock", requestedOperation: "inventory.returns.approve_restock", authorizationResult: "allowed" }), { transaction });
    const responseBody = { success: true, data: { assetId: asset.id, returnInvoiceId, reviewId: review.id, operationalStatus: "AVAILABLE", financialSideEffectCount: 0 } };
    await idempotencyService.succeed({ request: claimed.request, statusCode: 200, responseBody, transaction });
    await transaction.commit();
    return res.status(200).json(responseBody);
  } catch (error) {
    if (error.idempotencyReplay) return res.status(error.idempotencyReplay.statusCode || 200).json(error.idempotencyReplay.responseBody);
    if (!transaction.finished) await transaction.rollback();
    return next(error);
  }
});

// Current valuation is a controlled, non-financial Asset fact.  It updates the
// normalized valuation row only; purchase cost revisions remain immutable
// historical receipt evidence.
router.put("/inventory-v2/assets/:id/current-valuation", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const scope = "inventory-v2.current-valuation";
    const requestHash = idempotencyService.hashRequest(scope, req.body || {});
    const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash, transaction });
    if (!claim.claimed) {
      try { await transaction.rollback(); } catch (_) { /* unique claim may already abort the transaction */ }
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId, transaction, { lock: true });
    const expectedVersion = req.body?.expectedVersion;
    if (expectedVersion !== undefined && (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 0)) throw new ValidationError("Current valuation expectedVersion must be a non-negative integer.");
    const configuredVatRate = await goldValuationService.resolveConfiguredVatRate({ models, companyId: req.companyId, transaction });
    let valuation;
    if (goldValuationService.isTargetProfile(asset.inventoryProfile)) {
      const [goldRows] = await models.sequelize.query("SELECT * FROM asset_gold_details WHERE asset_id=:assetId FOR UPDATE", { replacements: { assetId: asset.id }, transaction });
      const goldDetails = goldRows[0];
      if (!goldDetails) throw new ValidationError("Gold weight evidence is required before current valuation.");
      const settings = await settingsService.getCompanySettings(req.companyId, { transaction });
      const canonicalCurrentGoldRate = await goldSalePricingService.resolveCanonicalSellingGoldRate({
        models,
        companyId: req.companyId,
        currency: settings.currency || "AED",
        karat: asset.karat,
        cache: { rates: new Map(), snapshots: new Map() },
        transaction,
      });
      valuation = goldValuationService.calculateCurrentGoldValuation({ profile: asset.inventoryProfile, goldDetails, input: req.body?.goldValuation || {}, canonicalCurrentGoldRate, configuredVatRate });
    } else if (looseProfileFinanceService.isLooseProfile(asset.inventoryProfile)) {
      valuation = looseProfileFinanceService.calculateCurrent({ profile: asset.inventoryProfile, input: req.body?.looseValuation || req.body, configuredVatRate });
    } else {
      throw new ValidationError("Current valuation is available only for supported profile Assets.");
    }
    const [updated] = await models.sequelize.query(`UPDATE asset_current_valuations SET
      rate_source=:rateSource,gold_rate=:goldRate,gold_value=:goldValue,making_value=:makingValue,
      certificate_value=:certificateValue,component_value=:componentValue,vat_rate=:vatRate,
      vat_rate_source=:vatRateSource,vat_base=:vatBase,vat_amount=:vatAmount,total_value=:totalValue,
      as_of=CURRENT_TIMESTAMP,input_version=input_version+1,version=version+1,override_reason=:reason,
      override_by=:actor,updated_at=CURRENT_TIMESTAMP
      WHERE asset_id=:assetId AND company_id=:companyId AND branch_id=:branchId AND (:expectedVersion IS NULL OR version=:expectedVersion) RETURNING *`, {
      replacements: { assetId: asset.id, companyId: req.companyId, branchId, expectedVersion: expectedVersion === undefined ? null : Number(expectedVersion), reason: req.body?.reason ? String(req.body.reason).trim() : null, actor: req.user?.id || null, ...valuation }, transaction,
    });
    if (!updated[0]) {
      if (expectedVersion !== undefined) throw new ConflictError("Current valuation has changed; refresh before retrying.");
      throw new NotFoundError("Current valuation evidence not found for Asset.");
    }
    await inventoryV2Runtime.recordAssetEvent({ models, transaction, asset: asset.toJSON(), context: { ...inventoryV2Context(req, branchId), branchName: asset.branch }, eventType: "CURRENT_VALUATION_UPDATED", oldStatus: asset.operationalStatus, newStatus: asset.operationalStatus, sourceType: "CURRENT_VALUATION", sourceId: asset.id, note: req.body?.reason ? String(req.body.reason).trim() : "Current valuation updated", idempotencyKey });
    const output = { success: true, data: updated[0] };
    await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody: output, transaction });
    await transaction.commit();
    return res.status(200).json(output);
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.patch("/inventory-v2/assets/:id/metadata", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true, operation: "inventory_v2.asset_metadata_update" }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const body = req.body || {};
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const scope = "inventory-v2.asset-metadata";
    const requestHash = idempotencyService.hashRequest(scope, body);
    const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash, transaction });
    if (!claim.claimed) {
      await transaction.rollback();
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"] || req.branchId, { required: true });
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId, transaction, { lock: true });
    const result = await assetMetadataService.update({ models, asset, body, req, transaction });
    const responseBody = { success: true, replayed: false, noop: !result.changed, data: { asset: result.asset, editableFields: assetMetadataService.ALLOWLIST } };
    await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody, transaction });
    await transaction.commit();
    emitEntityChanged(req.companyId, { entity: "Asset", action: result.changed ? "update" : "noop", id: asset.id, branchId });
    return res.status(200).json(responseBody);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    return next(error);
  }
});

router.put("/inventory-v2/assets/:id/components", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const scope = "inventory-v2.update-components";
    const requestHash = idempotencyService.hashRequest(scope, req.body || {});
    const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash, transaction });
    if (!claim.claimed) {
      try { await transaction.rollback(); } catch (_) {}
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId, transaction, { lock: true });
    if (!Array.isArray(req.body?.components)) throw new ValidationError("components must be an array.");
    const updatedComponents = await inventoryV2Runtime.updateAssetComponents({
      models,
      transaction,
      asset,
      context: { ...inventoryV2Context(req, branchId), branchName: asset.branch },
      components: req.body.components,
    });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "inventory_v2.components_updated",
      description: `Components updated for Asset ${asset.id}`,
      sourceDocument: asset.id,
      metadata: { assetId: asset.id, componentCount: updatedComponents.length },
    }), { transaction });
    const output = { success: true, data: { assetId: asset.id, components: updatedComponents } };
    await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody: output, transaction });
    await transaction.commit();
    return res.status(200).json(output);
  } catch (error) {
    await transaction.rollback();
    return next(error);
  }
});

router.post("/inventory-v2/assets/:id/rfid", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    if (!String(req.body?.rfidNumber || "").trim()) throw new ValidationError("RFID number is required.");
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId, transaction, { lock: true });
    const replay = await models.sequelize.query("SELECT source_id FROM asset_events WHERE company_id=:companyId AND idempotency_key=:idempotencyKey", { replacements: { companyId: req.companyId, idempotencyKey }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (replay.length) {
      const [assignment] = await models.sequelize.query("SELECT id,rfid_number AS \"rfidNumber\" FROM asset_rfid_assignments WHERE id=:id", { replacements: { id: replay[0].source_id }, transaction, type: require("sequelize").QueryTypes.SELECT });
      if (!assignment || assignment.rfidNumber !== String(req.body?.rfidNumber || "").trim()) throw new ConflictError("Idempotency-Key body conflict.");
      await transaction.commit();
      return res.status(200).json({ success: true, replayed: true, data: assignment });
    }
    let data;
    try {
      data = await inventoryV2Runtime.assignRfid({ models, transaction, asset, context: { ...inventoryV2Context(req, branchId), branchName: asset.branch }, rfidNumber: req.body?.rfidNumber, reason: req.body?.reason || null, sourceId: null, idempotencyKey });
    } catch (error) {
      if (String(error?.message || "").startsWith("INVENTORY_V2_RFID_REUSE_FORBIDDEN")) throw new ConflictError("RFID reuse is forbidden.");
      throw error;
    }
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.rfid_assigned", description: `RFID assigned to Asset ${asset.id}`, sourceDocument: data.assignmentId, metadata: { assetId: asset.id, rfidNumber: data.rfidNumber } }), { transaction });
    await transaction.commit();
    return res.status(201).json({ success: true, data });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/assets/:id/rfid/unassign", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const reason = String(req.body?.reason || "").trim();
    if (!reason) throw new ValidationError("RFID unassign reason is required.");
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId, transaction, { lock: true });
    const replay = await models.sequelize.query("SELECT source_id,asset_id,notes,event_type FROM asset_events WHERE company_id=:companyId AND idempotency_key=:idempotencyKey", { replacements: { companyId: req.companyId, idempotencyKey }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (replay.length) {
      const prior = replay[0];
      const [assignment] = await models.sequelize.query("SELECT id,rfid_number AS \"rfidNumber\",status,is_current AS \"isCurrent\" FROM asset_rfid_assignments WHERE id=:id", { replacements: { id: prior.source_id }, transaction, type: require("sequelize").QueryTypes.SELECT });
      if (prior.asset_id !== req.params.id || prior.event_type !== "RFID_UNASSIGNED" || prior.notes !== reason) throw new ConflictError("Idempotency-Key body conflict.");
      await transaction.commit();
      return res.status(200).json({ success: true, replayed: true, data: { assignmentId: assignment?.id || prior.source_id, rfidNumber: assignment?.rfidNumber || null, eventId: null, reason, isCurrent: Boolean(assignment?.isCurrent) } });
    }
    let data;
    try {
      data = await inventoryV2Runtime.unassignRfid({ models, transaction, asset, context: { ...inventoryV2Context(req, branchId), branchName: asset.branch }, reason, idempotencyKey });
    } catch (error) {
      if (String(error?.message || "").startsWith("INVENTORY_V2_RFID_NOT_ASSIGNED")) throw new ConflictError("Asset has no current RFID assignment.");
      throw error;
    }
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.rfid_unassigned", description: `RFID unassigned from Asset ${asset.id}`, sourceDocument: data.assignmentId, metadata: { assetId: asset.id, rfidNumber: data.rfidNumber, reason } }), { transaction });
    await transaction.commit();
    return res.status(200).json({ success: true, data });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/rfid/scan", authMiddleware, requireBusinessPermission("inventory.view", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    if (!String(req.body?.rfidNumber || "").trim()) throw new ValidationError("RFID number is required.");
    const data = await inventoryV2Runtime.recordRfidScan({ models, transaction, context: inventoryV2Context(req, branchId), rfidNumber: req.body?.rfidNumber, sourceType: req.body?.sourceType || "RFID_SCAN", sourceId: req.body?.sourceId || null, deviceId: req.body?.deviceId || null });
    const asset = await findScopedInventoryV2Asset(req, data.assetId, branchId, transaction);
    await transaction.commit();
    return res.status(200).json({ success: true, data: { ...data, asset: asset.toJSON() } });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/assets/:id/tags/print", authMiddleware, requireBusinessPermission("inventory.print", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const printKind = String(req.body?.printKind || "").toUpperCase();
    if (!["INITIAL", "REPRINT"].includes(printKind)) throw new ValidationError("Inventory V2 print kind must be INITIAL or REPRINT.");
    if (printKind === "REPRINT" && !String(req.body?.reason || "").trim()) throw new ValidationError("A reprint reason is required.");
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId, transaction, { lock: true });
    const replay = await models.sequelize.query("SELECT p.id,p.print_kind AS \"printKind\",p.template_name AS \"templateName\",p.template_version AS \"templateVersion\",p.printer_name AS \"printerName\",p.device_id AS \"deviceId\",p.reason,a.barcode FROM asset_tag_print_events p JOIN assets a ON a.id=p.asset_id WHERE p.company_id=:companyId AND p.idempotency_key=:idempotencyKey", { replacements: { companyId: req.companyId, idempotencyKey }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (replay.length) {
      const previous = replay[0];
      const sameRequest = previous.printKind === printKind
        && (previous.templateName || null) === (req.body?.templateName || null)
        && (previous.templateVersion || null) === (req.body?.templateVersion || null)
        && (previous.printerName || null) === (req.body?.printerName || null)
        && (previous.deviceId || null) === (req.body?.deviceId || null)
        && (previous.reason || null) === (req.body?.reason || null);
      if (!sameRequest) throw new ConflictError("Idempotency-Key body conflict.");
      await transaction.commit();
      return res.status(200).json({ success: true, replayed: true, data: previous });
    }
    const data = await inventoryV2Runtime.recordTagPrint({ models, transaction, asset, context: { ...inventoryV2Context(req, branchId), branchName: asset.branch }, printKind, templateName: req.body?.templateName, templateVersion: req.body?.templateVersion, printerName: req.body?.printerName, deviceId: req.body?.deviceId, reason: req.body?.reason, idempotencyKey });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.tag_printed", description: `${data.printKind} tag print for Asset ${asset.id}`, sourceDocument: data.id, metadata: { assetId: asset.id, barcode: asset.barcode } }), { transaction });
    await transaction.commit();
    return res.status(201).json({ success: true, data });
  } catch (error) { await transaction.rollback(); return next(error); }
});

// Barcode replacement is the only controlled identity change. The server
// allocates the next barcode, retires the old one permanently, and records
// both the durable history row and the normal Asset event/audit evidence.
router.post("/inventory-v2/assets/:id/barcode/replace", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true, operation: "inventory_v2.barcode_replace" }), async (req, res, next) => {
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return next(new ValidationError("Barcode replacement reason is required."));
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const scope = "inventory-v2.barcode-replacement";
    const requestHash = idempotencyService.hashRequest(scope, req.body || {});
    const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash, transaction });
    if (!claim.claimed) {
      await transaction.rollback();
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId, transaction, { lock: true });
    const result = await barcodeIdentityService.replaceAssetBarcode({
      asset,
      companyId: req.companyId,
      context: { ...inventoryV2Context(req, branchId), branchName: asset.branch },
      reason,
      transaction,
    });
    const event = await inventoryV2Runtime.recordAssetEvent({
      models,
      transaction,
      asset: asset.toJSON(),
      context: { ...inventoryV2Context(req, branchId), branchName: asset.branch },
      eventType: "BARCODE_REPLACED",
      oldStatus: asset.operationalStatus,
      newStatus: asset.operationalStatus,
      sourceType: "BARCODE_REPLACEMENT",
      sourceId: asset.id,
      note: reason,
      idempotencyKey,
      oldContextExtra: { barcode: result.oldBarcode },
      newContextExtra: { barcode: result.barcode, barcodeRevision: result.barcodeRevision },
    });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "inventory_v2.barcode_replaced",
      description: `Barcode replaced for Asset ${asset.id}`,
      sourceDocument: event.id,
      operatorReason: reason,
      requiredPermission: "inventory.adjust",
      requestedOperation: "inventory_v2.barcode_replace",
      authorizationResult: "allowed",
      metadata: { assetId: asset.id, oldBarcode: result.oldBarcode, newBarcode: result.barcode, barcodeRevision: result.barcodeRevision },
    }), { transaction });
    const responseBody = { success: true, data: result };
    await idempotencyService.succeed({ request: claim.request, statusCode: 201, responseBody, transaction });
    await transaction.commit();
    return res.status(201).json(responseBody);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    return next(error);
  }
});

router.get("/inventory-v2/workshop-orders", authMiddleware, requireBusinessPermission(workshopPolicy.WORKSHOP_PERMISSIONS.read), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
    const rows = await models.sequelize.query(`
      SELECT wo.id, wo.order_number AS "orderNumber", wo.branch_id AS "branchId",
        wo.workshop_location_id AS "workshopLocationId", wl.name AS "workshopLocationName",
        wo.return_location_id AS "returnLocationId", rl.name AS "returnLocationName",
        wo.provider_name AS "providerName", wo.status, wo.expected_return_at AS "expectedReturnAt",
        wo.created_at AS "createdAt", COUNT(wi.id)::int AS "assetCount",
        COALESCE(json_agg(json_build_object('assetId', wi.asset_id, 'barcode', a.barcode, 'status', wi.status))
          FILTER (WHERE wi.id IS NOT NULL), '[]'::json) AS assets
      FROM inventory_workshop_orders wo
      LEFT JOIN inventory_locations wl ON wl.id=wo.workshop_location_id
      LEFT JOIN inventory_locations rl ON rl.id=wo.return_location_id
      LEFT JOIN inventory_workshop_items wi ON wi.workshop_order_id=wo.id
      LEFT JOIN assets a ON a.id=wi.asset_id
      WHERE wo.company_id=:companyId AND wo.branch_id=:branchId
      GROUP BY wo.id, wl.name, rl.name
      ORDER BY wo.created_at DESC
      LIMIT 100
    `, { replacements: { companyId: req.companyId, branchId }, type: require("sequelize").QueryTypes.SELECT });
    return res.status(200).json({ success: true, data: { items: rows } });
  } catch (error) { return next(error); }
});

router.post("/inventory-v2/workshop-orders", authMiddleware, requireBusinessPermission(workshopPolicy.WORKSHOP_PERMISSIONS.send, { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const body = workshopPolicy.normalizeSendBody(req.body || {});
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true, transaction });
    const workshopLocation = await models.InventoryLocation.findOne({ where: { id: body.workshopLocationId, companyId: req.companyId }, transaction, lock: transaction.LOCK.UPDATE });
    workshopPolicy.assertScopedActiveLocation(workshopLocation, { companyId: req.companyId, branchId });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const scope = "workshop.send";
    const requestHash = idempotencyService.hashRequest(scope, body, { branchId });
    const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash, transaction });
    if (!claim.claimed) {
      await transaction.rollback();
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message, code: "IDEMPOTENCY_CONFLICT" });
    }
    const assetIds = body.assetIds;
    const orderId = inventoryV2Runtime.newId("IMWORK");
    const context = inventoryV2Context(req, branchId);
    await models.sequelize.query(`INSERT INTO inventory_workshop_orders
      (id,company_id,branch_id,order_number,provider_name,status,expected_return_at,workshop_location_id,created_by)
      VALUES (:id,:companyId,:branchId,:orderNumber,:providerName,'SENT',:expectedReturnAt,:workshopLocationId,:createdBy)`, {
      replacements: { id: orderId, companyId: req.companyId, branchId, orderNumber: orderId, providerName: body.providerName, expectedReturnAt: body.expectedReturnAt, workshopLocationId: workshopLocation.id, createdBy: context.actorId || null }, transaction,
    });
    const assets = [];
    for (let ordinal = 0; ordinal < assetIds.length; ordinal += 1) {
      const asset = await findScopedInventoryV2Asset(req, assetIds[ordinal], branchId, transaction, { lock: true });
      if (asset.operationalStatus !== "AVAILABLE") throw new ConflictError(`Asset ${asset.id} is not available for workshop.`);
      await models.sequelize.query(`INSERT INTO inventory_workshop_items
        (id,workshop_order_id,asset_id,company_id,from_location_id,prior_operational_status,status,sent_at,sent_by)
        VALUES (:id,:orderId,:assetId,:companyId,:fromLocationId,'AVAILABLE','SENT',:sentAt,:sentBy)`, {
        replacements: { id: inventoryV2Runtime.newId("IMWORKITEM"), orderId, assetId: asset.id, companyId: req.companyId, fromLocationId: asset.locationId || null, sentAt: context.occurredAt, sentBy: context.actorId || null }, transaction,
      });
      await inventoryV2Runtime.transitionAsset({ models, transaction, asset, context: { ...context, branchName: asset.branch }, toStatus: "WORKSHOP", eventType: "WORKSHOP_SENT", movementType: "WORKSHOP_OUT", sourceType: "WORKSHOP_ORDER", sourceId: orderId, note: body.notes || "Asset sent to workshop", idempotencyKey: `${idempotencyKey}:${ordinal}`, toBranchId: branchId, toLocationId: workshopLocation.id });
      assets.push(asset.id);
    }
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.workshop_sent", description: `Workshop order ${orderId} sent with ${assets.length} Asset(s).`, sourceDocument: orderId, metadata: { assets } }), { transaction });
    const responseBody = { success: true, replayed: false, data: { workshopOrderId: orderId, assetIds: assets, workshopLocationId: workshopLocation.id } };
    await idempotencyService.succeed({ request: claim.request, statusCode: 201, responseBody, transaction });
    await transaction.commit();
    return res.status(201).json(responseBody);
  } catch (error) { if (!transaction.finished) await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/workshop-orders/:id/return", authMiddleware, requireBusinessPermission(workshopPolicy.WORKSHOP_PERMISSIONS.complete, { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const body = workshopPolicy.normalizeCompleteBody(req.body || {});
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true, transaction });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const scope = "workshop.complete";
    const requestHash = idempotencyService.hashRequest(scope, body, { branchId, workshopOrderId: req.params.id });
    const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash, transaction });
    if (!claim.claimed) {
      await transaction.rollback();
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key: idempotencyKey, requestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message, code: "IDEMPOTENCY_CONFLICT" });
    }
    const [order] = await models.sequelize.query("SELECT * FROM inventory_workshop_orders WHERE id=:id AND company_id=:companyId AND branch_id=:branchId FOR UPDATE", { replacements: { id: req.params.id, companyId: req.companyId, branchId }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (!order) throw new NotFoundError("Inventory V2 workshop order not found.");
    workshopPolicy.assertOrderCanComplete(order);
    const returnLocation = await models.InventoryLocation.findOne({ where: { id: body.returnLocationId, companyId: req.companyId }, transaction, lock: transaction.LOCK.UPDATE });
    workshopPolicy.assertScopedActiveLocation(returnLocation, { companyId: req.companyId, branchId }, "WORKSHOP_RETURN_LOCATION");
    const items = await models.sequelize.query("SELECT * FROM inventory_workshop_items WHERE workshop_order_id=:orderId AND status='SENT' ORDER BY created_at", { replacements: { orderId: order.id }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (!items.length) throw new ConflictError("Workshop order has no sent Asset items to return.");
    const context = inventoryV2Context(req, branchId);
    for (let ordinal = 0; ordinal < items.length; ordinal += 1) {
      const item = items[ordinal];
      const asset = await findScopedInventoryV2Asset(req, item.asset_id, branchId, transaction, { lock: true });
      if (asset.operationalStatus !== "WORKSHOP") throw new ConflictError(`Asset ${asset.id} is not in workshop.`);
      await inventoryV2Runtime.transitionAsset({ models, transaction, asset, context: { ...context, branchName: asset.branch }, toStatus: "AVAILABLE", eventType: "WORKSHOP_RETURNED", movementType: "WORKSHOP_IN", sourceType: "WORKSHOP_ORDER", sourceId: order.id, note: body.notes || "Asset returned from workshop", idempotencyKey: `${idempotencyKey}:${ordinal}`, toBranchId: branchId, toLocationId: returnLocation.id });
      await models.sequelize.query("UPDATE inventory_workshop_items SET status='RETURNED',returned_at=:returnedAt,returned_by=:returnedBy,updated_at=CURRENT_TIMESTAMP WHERE id=:id", { replacements: { id: item.id, returnedAt: context.occurredAt, returnedBy: context.actorId || null }, transaction });
    }
    await models.sequelize.query("UPDATE inventory_workshop_orders SET status='RETURNED',return_location_id=:returnLocationId,updated_at=CURRENT_TIMESTAMP WHERE id=:id", { replacements: { id: order.id, returnLocationId: returnLocation.id }, transaction });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.workshop_returned", description: `Workshop order ${order.id} returned.`, sourceDocument: order.id }), { transaction });
    const responseBody = { success: true, replayed: false, data: { workshopOrderId: order.id, returnedAssets: items.map((item) => item.asset_id), returnLocationId: returnLocation.id } };
    await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody, transaction });
    await transaction.commit();
    return res.status(200).json(responseBody);
  } catch (error) { if (!transaction.finished) await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/assets/:id/missing", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    if (!String(req.body?.reason || "").trim()) throw new ValidationError("A missing-case reason is required.");
    const asset = await findScopedInventoryV2Asset(req, req.params.id, branchId, transaction, { lock: true });
    const replay = await models.sequelize.query("SELECT source_id FROM asset_events WHERE company_id=:companyId AND idempotency_key=:idempotencyKey", { replacements: { companyId: req.companyId, idempotencyKey }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (replay.length) { await transaction.commit(); return res.status(200).json({ success: true, replayed: true, data: { missingCaseId: replay[0].source_id } }); }
    if (asset.operationalStatus !== "AVAILABLE") throw new ConflictError("Only an available Asset can be marked missing.");
    const missingCaseId = inventoryV2Runtime.newId("IMMISSING");
    const context = inventoryV2Context(req, branchId);
    await models.sequelize.query(`INSERT INTO asset_missing_cases
      (id,asset_id,company_id,branch_id,status,prior_operational_status,prior_location_id,discovered_at,discovered_by,reason)
      VALUES (:id,:assetId,:companyId,:branchId,'OPEN','AVAILABLE',:priorLocationId,:discoveredAt,:discoveredBy,:reason)`, {
      replacements: { id: missingCaseId, assetId: asset.id, companyId: req.companyId, branchId, priorLocationId: asset.locationId || null, discoveredAt: context.occurredAt, discoveredBy: context.actorId || null, reason: String(req.body.reason).trim() }, transaction,
    });
    await inventoryV2Runtime.transitionAsset({ models, transaction, asset, context: { ...context, branchName: asset.branch }, toStatus: "MISSING", eventType: "MISSING_REPORTED", movementType: "MISSING_REPORTED", sourceType: "ASSET_MISSING_CASE", sourceId: missingCaseId, note: String(req.body.reason).trim(), idempotencyKey });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.missing_reported", description: `Asset ${asset.id} reported missing.`, sourceDocument: missingCaseId, metadata: { assetId: asset.id } }), { transaction });
    await transaction.commit();
    return res.status(201).json({ success: true, data: { missingCaseId, assetId: asset.id } });
  } catch (error) { await transaction.rollback(); return next(error); }
});

// Canonical B3 Inventory Count routes. The historical definitions below are
// intentionally unreachable compatibility source and are kept only for
// forensic traceability during this minimum-safe batch.
async function claimInventoryCountAction(req, scope, body, params, transaction) {
  const key = requireInventoryV2IdempotencyKey(req);
  const requestHash = idempotencyService.hashRequest(scope, body, params);
  const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key, requestHash, transaction });
  return { key, requestHash, claim };
}

async function returnInventoryCountIdempotency(res, req, scope, idem, transaction) {
  await transaction.rollback();
  const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key: idem.key, requestHash: idem.requestHash });
  if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
  return res.status(409).json({ success: false, code: "IDEMPOTENCY_CONFLICT", message: prior.message });
}

function inventoryCountReadModel(audit) {
  const data = audit.toJSON();
  const items = (data.items || []).map((item) => {
    if (!item.asset || !item.createdAt || !item.asset.updatedAt) return item;
    return {
      ...item,
      asset: {
        ...item.asset,
        lifecycleChangedAfterSnapshot: new Date(item.asset.updatedAt).getTime() > new Date(item.createdAt).getTime(),
      },
    };
  });
  return {
    ...data,
    expectedCount: items.length,
    countedCount: items.filter((item) => item.result === "MATCHED").length,
    missingCount: items.filter((item) => item.result === "MISSING").length,
    unexpectedCount: items.filter((item) => item.result === "EXTRA").length,
  };
}

router.get("/inventory-v2/audits", authMiddleware, requireBusinessPermission(inventoryCountPolicy.COUNT_PERMISSIONS.read), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const requestedStatus = String(req.query.status || "").trim();
    const allowedStatuses = new Set(["draft", "in-progress", "completed", "closed"]);
    const where = { companyId: req.companyId, branchId };
    if (requestedStatus && allowedStatuses.has(requestedStatus)) where.status = requestedStatus;
    const audits = await models.StockAudit.findAll({
      where,
      include: [{ model: models.StockAuditItem, as: "items", include: [{ model: models.Asset, as: "asset" }] }],
      order: [["createdAt", "DESC"]],
      limit: 100,
    });
    return res.status(200).json({ success: true, data: { items: audits.map(inventoryCountReadModel) } });
  } catch (error) { return next(error); }
});

router.get("/inventory-v2/audits/:id", authMiddleware, requireBusinessPermission(inventoryCountPolicy.COUNT_PERMISSIONS.read), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const audit = await models.StockAudit.findOne({ where: { id: req.params.id, companyId: req.companyId, branchId }, include: [{ model: models.StockAuditItem, as: "items", include: [{ model: models.Asset, as: "asset" }] }] });
    if (!audit) throw new NotFoundError("Inventory Count not found in the authorized Branch.");
    return res.status(200).json({ success: true, data: inventoryCountReadModel(audit) });
  } catch (error) { return next(error); }
});

router.post("/inventory-v2/audits", authMiddleware, requireBusinessPermission(inventoryCountPolicy.COUNT_PERMISSIONS.create, { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true, transaction });
    const body = inventoryCountPolicy.normalizeCreateBody(req.body || {});
    const location = await models.InventoryLocation.findOne({ where: { id: body.locationId, companyId: req.companyId }, transaction, lock: transaction.LOCK.UPDATE });
    inventoryCountPolicy.assertScopedActiveLocation(location, { companyId: req.companyId, branchId });
    const scope = "inventory-count.create";
    const idem = await claimInventoryCountAction(req, scope, body, { branchId }, transaction);
    if (!idem.claim.claimed) return returnInventoryCountIdempotency(res, req, scope, idem, transaction);
    const context = inventoryV2Context(req, branchId);
    const result = await inventoryAuditCanonicalService.createAudit({ models, companyId: req.companyId, branchId, auditNumber: body.auditNumber, auditMethod: body.auditMethod, locationId: body.locationId, notes: body.notes, actor: { id: context.actorId, name: context.actorName }, transaction, recordAudit: (audit, auditMethod) => auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.audit_created", description: `Inventory Count ${audit.auditNumber} created.`, sourceDocument: audit.id, metadata: { auditMethod, branchId, locationId: body.locationId } }), { transaction }) });
    const responseBody = { success: true, replayed: false, data: result.audit.toJSON() };
    await idempotencyService.succeed({ request: idem.claim.request, statusCode: 201, responseBody, transaction });
    await transaction.commit();
    return res.status(201).json(responseBody);
  } catch (error) { if (!transaction.finished) await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/audits/:id/start", authMiddleware, requireBusinessPermission(inventoryCountPolicy.COUNT_PERMISSIONS.create, { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    inventoryCountPolicy.assertNoBody(req.body || {});
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true, transaction });
    const scope = "inventory-count.start";
    const idem = await claimInventoryCountAction(req, scope, {}, { branchId, auditId: req.params.id }, transaction);
    if (!idem.claim.claimed) return returnInventoryCountIdempotency(res, req, scope, idem, transaction);
    const result = await inventoryAuditCanonicalService.startAudit({ models, companyId: req.companyId, branchId, auditId: req.params.id, transaction });
    const responseBody = { success: true, replayed: result.replayed, data: { ...result.audit.toJSON(), expectedCount: result.expectedCount } };
    await idempotencyService.succeed({ request: idem.claim.request, statusCode: 200, responseBody, transaction });
    await transaction.commit();
    return res.status(200).json(responseBody);
  } catch (error) { if (!transaction.finished) await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/audits/:id/observe", authMiddleware, requireBusinessPermission(inventoryCountPolicy.COUNT_PERMISSIONS.scan, { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true, transaction });
    const body = inventoryCountPolicy.normalizeScanBody(req.body || {});
    const audit = await models.StockAudit.findOne({ where: { id: req.params.id, companyId: req.companyId, branchId }, transaction, lock: true });
    if (!audit) throw new NotFoundError("Inventory Count not found in the authorized Branch.");
    const normalizedBody = { ...body, method: body.method || audit.auditMethod };
    const scope = "inventory-count.scan";
    const idem = await claimInventoryCountAction(req, scope, normalizedBody, { branchId, auditId: req.params.id }, transaction);
    if (!idem.claim.claimed) return returnInventoryCountIdempotency(res, req, scope, idem, transaction);
    const result = await inventoryAuditCanonicalService.observeAudit({ models, companyId: req.companyId, branchId, auditId: req.params.id, assetIds: body.assetIds, barcodes: body.barcodes, rfidNumbers: body.rfidNumbers, method: normalizedBody.method, transaction });
    const responseBody = { success: true, replayed: false, data: { auditId: result.audit.id, observed: result.observed } };
    await idempotencyService.succeed({ request: idem.claim.request, statusCode: 200, responseBody, transaction });
    await transaction.commit();
    return res.status(200).json(responseBody);
  } catch (error) { if (!transaction.finished) await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/audits/:id/complete", authMiddleware, requireBusinessPermission(inventoryCountPolicy.COUNT_PERMISSIONS.complete, { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    inventoryCountPolicy.assertNoBody(req.body || {});
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true, transaction });
    const scope = "inventory-count.complete";
    const idem = await claimInventoryCountAction(req, scope, {}, { branchId, auditId: req.params.id }, transaction);
    if (!idem.claim.claimed) return returnInventoryCountIdempotency(res, req, scope, idem, transaction);
    const result = await inventoryAuditCanonicalService.completeAudit({ models, companyId: req.companyId, branchId, auditId: req.params.id, transaction });
    const responseBody = { success: true, replayed: result.replayed, data: result.audit.toJSON(), note: "Count completion does not mutate Asset state or apply adjustments." };
    await idempotencyService.succeed({ request: idem.claim.request, statusCode: 200, responseBody, transaction });
    await transaction.commit();
    return res.status(200).json(responseBody);
  } catch (error) { if (!transaction.finished) await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/audits/:id/close", authMiddleware, requireBusinessPermission(inventoryCountPolicy.COUNT_PERMISSIONS.complete, { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    inventoryCountPolicy.assertNoBody(req.body || {});
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true, transaction });
    const scope = "inventory-count.close";
    const idem = await claimInventoryCountAction(req, scope, {}, { branchId, auditId: req.params.id }, transaction);
    if (!idem.claim.claimed) return returnInventoryCountIdempotency(res, req, scope, idem, transaction);
    const context = inventoryV2Context(req, branchId);
    const result = await inventoryAuditCanonicalService.closeAudit({ models, companyId: req.companyId, branchId, auditId: req.params.id, actor: { id: context.actorId, name: context.actorName }, transaction });
    const responseBody = { success: true, replayed: result.replayed, data: result.audit.toJSON() };
    await idempotencyService.succeed({ request: idem.claim.request, statusCode: 200, responseBody, transaction });
    await transaction.commit();
    return res.status(200).json(responseBody);
  } catch (error) { if (!transaction.finished) await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/audits-legacy-disabled", authMiddleware, async (_req, res) => res.status(410).json({ success: false, code: "LEGACY_INVENTORY_COUNT_DISABLED", message: "Use the canonical Inventory Count workflow." }));

router.post("/inventory-v2/audits", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const adapterTransaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const context = inventoryV2Context(req, branchId);
    const result = await inventoryAuditCanonicalService.createAudit({
      models, companyId: req.companyId, branchId, auditNumber: req.body?.auditNumber,
      auditMethod: req.body?.auditMethod, locationId: req.body?.locationId || null, notes: req.body?.notes || null,
      actor: { id: context.actorId || null, name: context.actorName || null }, transaction: adapterTransaction,
      recordAudit: (audit, auditMethod) => auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
        action: "inventory_v2.audit_created", description: `Inventory audit ${audit.auditNumber} created.`, sourceDocument: audit.id, metadata: { auditMethod, branchId },
      }), { transaction: adapterTransaction }),
    });
    await adapterTransaction.commit();
    return res.status(result.replayed ? 200 : 201).json({ success: true, ...(result.replayed ? { replayed: true } : {}), data: result.audit.toJSON() });
  } catch (error) {
    await adapterTransaction.rollback();
    return next(error);
  }

  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const auditNumber = String(req.body?.auditNumber || "").trim();
    const auditMethod = String(req.body?.auditMethod || "").toUpperCase();
    if (!auditNumber) throw new ValidationError("Inventory V2 auditNumber is required for durable replay.");
    if (!["MANUAL_COUNT", "BARCODE_SCAN", "RFID_SCAN"].includes(auditMethod)) throw new ValidationError("Inventory V2 audit method is invalid.");
    const existing = await models.StockAudit.findOne({ where: { companyId: req.companyId, auditNumber }, transaction, lock: true });
    if (existing) {
      if (existing.branchId !== branchId || existing.auditMethod !== auditMethod) throw new ConflictError("Audit number body conflict.");
      await transaction.commit();
      return res.status(200).json({ success: true, replayed: true, data: existing.toJSON() });
    }
    const context = inventoryV2Context(req, branchId);
    const audit = await models.StockAudit.create({ id: inventoryV2Runtime.newId("IMAUD"), companyId: req.companyId, branchId, status: "draft", createdBy: context.actorId || context.actorName, auditNumber, auditDate: new Date().toISOString().slice(0, 10), auditMethod, locationId: req.body?.locationId || null, notes: req.body?.notes || null }, { transaction });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.audit_created", description: `Inventory audit ${auditNumber} created.`, sourceDocument: audit.id, metadata: { auditMethod, branchId } }), { transaction });
    await transaction.commit();
    return res.status(201).json({ success: true, data: audit.toJSON() });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/audits/:id/start", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const adapterTransaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await inventoryAuditCanonicalService.startAudit({ models, companyId: req.companyId, branchId, auditId: req.params.id, transaction: adapterTransaction });
    await adapterTransaction.commit();
    return res.status(200).json({ success: true, ...(result.replayed ? { replayed: true } : {}), data: { ...result.audit.toJSON(), expectedCount: result.expectedCount } });
  } catch (error) {
    await adapterTransaction.rollback();
    return next(error);
  }

  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const audit = await models.StockAudit.findOne({ where: { id: req.params.id, companyId: req.companyId, branchId }, transaction, lock: true });
    if (!audit) throw new NotFoundError("Inventory V2 audit not found.");
    if (audit.status === "in-progress") { await transaction.commit(); return res.status(200).json({ success: true, replayed: true, data: audit.toJSON() }); }
    if (audit.status !== "draft") throw new ConflictError("Only a DRAFT audit can start.");
    const assets = await models.Asset.findAll({ where: { companyId: req.companyId, branchId, operationalStatus: { [Op.notIn]: ["SOLD", "MELTED"] } }, transaction });
    for (const asset of assets) await models.StockAuditItem.create({ id: inventoryV2Runtime.newId("IMAUDITEM"), stockAuditId: audit.id, assetId: asset.id, expectedBranchId: branchId, status: "missing", result: null }, { transaction });
    await audit.update({ status: "in-progress" }, { transaction });
    await transaction.commit();
    return res.status(200).json({ success: true, data: { ...audit.toJSON(), expectedCount: assets.length } });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/audits/:id/observe", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const adapterTransaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await inventoryAuditCanonicalService.observeAudit({
      models, companyId: req.companyId, branchId, auditId: req.params.id,
      assetIds: req.body?.assetIds || [], barcodes: req.body?.barcodes || [], rfidNumbers: req.body?.rfidNumbers || [],
      method: req.body?.method || null, transaction: adapterTransaction,
    });
    await adapterTransaction.commit();
    return res.status(200).json({ success: true, data: { auditId: result.audit.id, observed: result.observed } });
  } catch (error) {
    await adapterTransaction.rollback();
    return next(error);
  }

  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const audit = await models.StockAudit.findOne({ where: { id: req.params.id, companyId: req.companyId, branchId }, transaction, lock: true });
    if (!audit) throw new NotFoundError("Inventory V2 audit not found.");
    if (audit.status !== "in-progress") throw new ConflictError("Only an IN_PROGRESS audit can accept observations.");
    const method = String(req.body?.method || audit.auditMethod).toUpperCase();
    const requested = [...new Set([...(req.body?.assetIds || []).map(String), ...(req.body?.barcodes || []).map(String), ...(req.body?.rfidNumbers || []).map(String)])];
    if (!requested.length) throw new ValidationError("At least one Asset ID, barcode, or RFID number is required.");
    const assets = await models.Asset.findAll({ where: { companyId: req.companyId, [Op.or]: [{ id: requested }, { barcode: requested }, { rfid: requested }] }, transaction, lock: true });
    if (!assets.length) throw new ValidationError("No scanned Inventory V2 Asset was found.");
    const observed = [];
    for (const asset of assets) {
      const expected = await models.StockAuditItem.findOne({ where: { stockAuditId: audit.id, assetId: asset.id }, transaction, lock: true });
      if (expected) await expected.update({ status: "matched", result: "MATCHED", observedAt: new Date(), scanMethod: method, scannedBranchId: branchId }, { transaction });
      else await models.StockAuditItem.create({ id: inventoryV2Runtime.newId("IMAUDITEM"), stockAuditId: audit.id, assetId: asset.id, expectedBranchId: asset.branchId, scannedBranchId: branchId, status: "unexpected", result: "EXTRA", observedAt: new Date(), scanMethod: method }, { transaction });
      observed.push({ assetId: asset.id, result: expected ? "MATCHED" : "EXTRA" });
    }
    await transaction.commit();
    return res.status(200).json({ success: true, data: { auditId: audit.id, observed } });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/audits/:id/complete", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const adapterTransaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await inventoryAuditCanonicalService.completeAudit({ models, companyId: req.companyId, branchId, auditId: req.params.id, transaction: adapterTransaction });
    await adapterTransaction.commit();
    return res.status(200).json({ success: true, ...(result.replayed ? { replayed: true } : {}), data: result.audit.toJSON(), note: "Observations do not mutate Asset state or apply adjustments." });
  } catch (error) {
    await adapterTransaction.rollback();
    return next(error);
  }

  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const audit = await models.StockAudit.findOne({ where: { id: req.params.id, companyId: req.companyId, branchId }, transaction, lock: true });
    if (!audit) throw new NotFoundError("Inventory V2 audit not found.");
    if (audit.status === "completed") { await transaction.commit(); return res.status(200).json({ success: true, replayed: true, data: audit.toJSON() }); }
    if (audit.status !== "in-progress") throw new ConflictError("Only an IN_PROGRESS audit can complete.");
    await models.StockAuditItem.update({ status: "missing", result: "MISSING", observedAt: new Date() }, { where: { stockAuditId: audit.id, result: null }, transaction });
    await audit.update({ status: "completed", completedAt: new Date().toISOString() }, { transaction });
    await transaction.commit();
    return res.status(200).json({ success: true, data: audit.toJSON(), note: "Observations do not mutate Asset state or apply adjustments." });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/audits/:id/close", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const adapterTransaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const context = inventoryV2Context(req, branchId);
    const result = await inventoryAuditCanonicalService.closeAudit({ models, companyId: req.companyId, branchId, auditId: req.params.id, actor: { id: context.actorId || null, name: context.actorName || null }, transaction: adapterTransaction });
    await adapterTransaction.commit();
    return res.status(200).json({ success: true, ...(result.replayed ? { replayed: true } : {}), data: result.audit.toJSON() });
  } catch (error) {
    await adapterTransaction.rollback();
    return next(error);
  }

  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const audit = await models.StockAudit.findOne({ where: { id: req.params.id, companyId: req.companyId, branchId }, transaction, lock: true });
    if (!audit) throw new NotFoundError("Inventory V2 audit not found.");
    if (audit.status === "closed") { await transaction.commit(); return res.status(200).json({ success: true, replayed: true, data: audit.toJSON() }); }
    if (audit.status !== "completed") throw new ConflictError("Only a COMPLETED audit can close.");
    await audit.update({ status: "closed", closedAt: new Date(), closedBy: req.user?.id || null }, { transaction });
    await transaction.commit();
    return res.status(200).json({ success: true, data: audit.toJSON() });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/adjustments", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const reason = String(req.body?.reason || "").trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!reason || !items.length) throw new ValidationError("Adjustment reason and exact Asset items are required.");
    const existing = await models.sequelize.query("SELECT * FROM inventory_adjustments WHERE company_id=:companyId AND idempotency_key=:idempotencyKey", { replacements: { companyId: req.companyId, idempotencyKey }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (existing.length) {
      const priorItems = await models.sequelize.query("SELECT asset_id,old_context,new_context FROM inventory_adjustment_items WHERE adjustment_id=:adjustmentId ORDER BY asset_id", { replacements: { adjustmentId: existing[0].id }, transaction, type: require("sequelize").QueryTypes.SELECT });
      const parseContext = (value) => {
        if (!value || typeof value === "object") return value || {};
        try { return JSON.parse(value); } catch (_) { return {}; }
      };
      const requested = items.map((item) => ({
        assetId: String(item?.assetId || ""),
        expectedOperationalStatus: item?.expectedOperationalStatus == null ? null : String(item.expectedOperationalStatus).toUpperCase(),
        newOperationalStatus: String(item?.newOperationalStatus || "").toUpperCase(),
        evidence: item?.evidence || null,
        reference: item?.reference || null,
      })).sort((left, right) => left.assetId.localeCompare(right.assetId));
      const stored = priorItems.map((item) => {
        const oldContext = parseContext(item.old_context);
        const newContext = parseContext(item.new_context);
        return {
          assetId: String(item.asset_id),
          expectedOperationalStatus: String(oldContext.operationalStatus || "").toUpperCase(),
          newOperationalStatus: String(newContext.operationalStatus || "").toUpperCase(),
          evidence: newContext.evidence || null,
          reference: newContext.reference || null,
        };
      });
      const sameItems = requested.length === stored.length && requested.every((item, index) =>
        item.assetId === stored[index].assetId
        && item.newOperationalStatus === stored[index].newOperationalStatus
        && (item.expectedOperationalStatus === null || item.expectedOperationalStatus === stored[index].expectedOperationalStatus)
        && item.evidence === stored[index].evidence
        && item.reference === stored[index].reference);
      if (String(existing[0].reason || "") !== reason || !sameItems) throw new ConflictError("Idempotency-Key body conflict.");
      await transaction.commit(); return res.status(200).json({ success: true, replayed: true, data: existing[0] });
    }
    const context = inventoryV2Context(req, branchId);
    const adjustmentId = inventoryV2Runtime.newId("IMADJ");
    await models.sequelize.query(`INSERT INTO inventory_adjustments
      (id,company_id,branch_id,status,reason,requested_by,requested_at,idempotency_key)
      VALUES (:id,:companyId,:branchId,'REQUESTED',:reason,:requestedBy,:requestedAt,:idempotencyKey)`, { replacements: { id: adjustmentId, companyId: req.companyId, branchId, reason, requestedBy: context.actorId || context.actorName, requestedAt: context.occurredAt, idempotencyKey }, transaction });
    const seen = new Set();
    for (const item of items) {
      const assetId = String(item?.assetId || "");
      const toStatus = String(item?.newOperationalStatus || "").toUpperCase();
      if (!assetId || seen.has(assetId)) throw new ValidationError("Adjustment items must contain unique exact Asset IDs.");
      if (!inventoryV2Runtime.TRANSITIONS[toStatus]) throw new ValidationError("Adjustment target operational status is invalid.");
      seen.add(assetId);
      const asset = await findScopedInventoryV2Asset(req, assetId, branchId, transaction, { lock: true });
      const expected = String(item.expectedOperationalStatus || asset.operationalStatus).toUpperCase();
      if (asset.operationalStatus !== expected) throw new ConflictError(`Asset ${asset.id} pre-state conflict.`);
      await models.sequelize.query(`INSERT INTO inventory_adjustment_items
        (id,adjustment_id,asset_id,company_id,old_context,new_context)
        VALUES (:id,:adjustmentId,:assetId,:companyId,:oldContext,:newContext)`, { replacements: { id: inventoryV2Runtime.newId("IMADJITEM"), adjustmentId, assetId, companyId: req.companyId, oldContext: JSON.stringify({ operationalStatus: asset.operationalStatus, version: asset.updatedAt }), newContext: JSON.stringify({ operationalStatus: toStatus, evidence: item.evidence || null, reference: item.reference || null }) }, transaction });
    }
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.adjustment_requested", description: `Inventory adjustment ${adjustmentId} requested.`, sourceDocument: adjustmentId }), { transaction });
    await transaction.commit();
    return res.status(201).json({ success: true, data: { adjustmentId, status: "REQUESTED" } });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/adjustments/:id/approve", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const [adjustment] = await models.sequelize.query("SELECT * FROM inventory_adjustments WHERE id=:id AND company_id=:companyId AND branch_id=:branchId FOR UPDATE", { replacements: { id: req.params.id, companyId: req.companyId, branchId }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (!adjustment) throw new NotFoundError("Inventory V2 adjustment not found.");
    if (adjustment.status === "APPROVED") { await transaction.commit(); return res.status(200).json({ success: true, replayed: true, data: adjustment }); }
    if (adjustment.status !== "REQUESTED") throw new ConflictError("Only a REQUESTED adjustment can approve.");
    const approverId = req.user?.id;
    if (!approverId || approverId === adjustment.requested_by) throw new ForbiddenError("Adjustment requester cannot approve the same adjustment.");
    await models.sequelize.query("UPDATE inventory_adjustments SET status='APPROVED',approved_by=:approvedBy,approved_at=:approvedAt,updated_at=CURRENT_TIMESTAMP WHERE id=:id", { replacements: { id: adjustment.id, approvedBy: approverId, approvedAt: new Date() }, transaction });
    await transaction.commit();
    return res.status(200).json({ success: true, data: { adjustmentId: adjustment.id, status: "APPROVED" } });
  } catch (error) { await transaction.rollback(); return next(error); }
});

router.post("/inventory-v2/adjustments/:id/apply", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const [adjustment] = await models.sequelize.query("SELECT * FROM inventory_adjustments WHERE id=:id AND company_id=:companyId AND branch_id=:branchId FOR UPDATE", { replacements: { id: req.params.id, companyId: req.companyId, branchId }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (!adjustment) throw new NotFoundError("Inventory V2 adjustment not found.");
    if (adjustment.status === "APPLIED") { await transaction.commit(); return res.status(200).json({ success: true, replayed: true, data: { adjustmentId: adjustment.id, status: "APPLIED" } }); }
    if (adjustment.status !== "APPROVED") throw new ConflictError("Only an APPROVED adjustment can apply.");
    const items = await models.sequelize.query("SELECT * FROM inventory_adjustment_items WHERE adjustment_id=:adjustmentId ORDER BY created_at", { replacements: { adjustmentId: adjustment.id }, transaction, type: require("sequelize").QueryTypes.SELECT });
    const context = inventoryV2Context(req, branchId);
    for (let ordinal = 0; ordinal < items.length; ordinal += 1) {
      const item = items[ordinal];
      const oldContext = item.old_context;
      const newContext = item.new_context;
      const asset = await findScopedInventoryV2Asset(req, item.asset_id, branchId, transaction, { lock: true });
      if (asset.operationalStatus !== oldContext.operationalStatus) throw new ConflictError(`Adjustment ${adjustment.id} is stale for Asset ${asset.id}.`);
      await inventoryV2Runtime.transitionAsset({ models, transaction, asset, context: { ...context, branchName: asset.branch }, toStatus: newContext.operationalStatus, eventType: "INVENTORY_ADJUSTMENT_APPLIED", movementType: "INVENTORY_ADJUSTMENT", sourceType: "INVENTORY_ADJUSTMENT", sourceId: adjustment.id, note: adjustment.reason, idempotencyKey: `${adjustment.id}:${ordinal}` });
    }
    await models.sequelize.query("UPDATE inventory_adjustments SET status='APPLIED',applied_by=:appliedBy,applied_at=:appliedAt,updated_at=CURRENT_TIMESTAMP WHERE id=:id", { replacements: { id: adjustment.id, appliedBy: req.user?.id || null, appliedAt: new Date() }, transaction });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.adjustment_applied", description: `Inventory adjustment ${adjustment.id} applied.`, sourceDocument: adjustment.id }), { transaction });
    await transaction.commit();
    return res.status(200).json({ success: true, data: { adjustmentId: adjustment.id, status: "APPLIED" } });
  } catch (error) { await transaction.rollback(); return next(error); }
});

// The historical manufacturing surface accepts a smaller payload than the
// Inventory Master command.  It is deliberately an adapter: partial-weight
// consumption is rejected because it changes a physical identity in place.
// The supplied legacy measurement fields are copied into immutable command
// evidence; the adapter never creates an Asset, Barcode, event, movement, or
// journal itself.
async function executeLegacyManufacturingAdapter(req, res, next) {
  try {
    const body = req.body || {};
    const inputAssetId = String(body.inputAssetId || "").trim();
    const outputName = String(body.outputName || "").trim();
    const inputWeight = Number(body.inputWeight);
    const outputWeight = Number(body.outputWeight);
    const laborCost = Number(body.laborCost || 0);
    if (!inputAssetId || !outputName || !Number.isFinite(inputWeight) || inputWeight <= 0 || !Number.isFinite(outputWeight) || outputWeight <= 0 || !Number.isFinite(laborCost) || laborCost < 0) {
      throw new ValidationError("Legacy manufacturing requires one input Asset and valid measured input/output weights.");
    }
    const branchId = req.headers["x-branch-id"] || body.branchId || req.branchId;
    if (!branchId) throw new ValidationError("The active Branch is required for manufacturing.");
    const input = await models.Asset.findOne({ where: { id: inputAssetId, companyId: req.companyId, branchId } });
    if (!input) throw new NotFoundError("Legacy manufacturing input Asset was not found in the authorized Branch.");
    if (Math.abs(Number(input.grossWeight) - inputWeight) > 0.000001) {
      throw new ValidationError("Partial legacy manufacturing is no longer safe: submit the exact whole input Asset to the canonical transformation workflow.");
    }
    const rawFingerprint = JSON.stringify({ inputAssetId, inputWeight, outputName, outputWeight, outputKarat: body.outputKarat || null, outputType: body.outputType || null, laborCost, notes: body.notes || "" });
    const key = String(req.headers["idempotency-key"] || "").trim() || `legacy-manufacturing-${require("crypto").createHash("sha256").update(rawFingerprint).digest("hex").slice(0, 48)}`;
    const originalBody = req.body;
    const originalKey = req.headers["idempotency-key"];
    const originalJson = res.json.bind(res);
    req.headers["idempotency-key"] = key;
    req.body = {
      inputAssetIds: [inputAssetId],
      reason: String(body.notes || `Legacy manufacturing of ${outputName}`).trim(),
      outputs: [{
        name: outputName,
        category: body.category || "تصنيع محلي",
        // The legacy route has always described weighed gold work.  This
        // nullable-condition profile avoids inventing a NEW condition.
        profile: String(body.inventoryProfile || "GOLD_BY_WEIGHT_JEWELLERY").toUpperCase(),
        grossWeight: outputWeight,
        stoneWeight: Number(body.stoneWeight || 0),
        karat: Number(body.outputKarat || input.karat || 21),
        purchaseCost: Number(input.cost || 0) + laborCost,
        goldValue: Number(body.goldValue || 0),
        certificateCost: Number(body.certificateCost || 0),
        vatRate: Number(body.vatRate || 0),
        physicalEvidence: String(body.physicalEvidence || `legacy-measurement:${outputName}:${outputWeight}:${body.outputKarat || input.karat || "unknown"}`),
        metadata: { legacyManufacturingAdapter: true, legacyOutputType: body.outputType || "gold-piece", legacyInputWeight: inputWeight, laborCost },
      }],
    };
    res.json = (payload) => {
      if (!payload?.success || !payload.data?.manufacturingOrderId) return originalJson(payload);
      const data = payload.data;
      return originalJson({
        success: true,
        mo: { id: data.manufacturingOrderId, status: "completed", type: "manufacturing" },
        finishedAsset: data.outputAssetIds?.[0] ? { id: data.outputAssetIds[0] } : null,
        parentAsset: { id: inputAssetId },
        journalEntry: null,
        data,
      });
    };
    try {
      return await executeInventoryV2Transformation(req, res, next, "manufacturing");
    } finally {
      req.body = originalBody;
      if (originalKey === undefined) delete req.headers["idempotency-key"];
      else req.headers["idempotency-key"] = originalKey;
      res.json = originalJson;
    }
  } catch (error) {
    return next(error);
  }
}

// Canonical transformation orchestration for manufacturing and melt.  Routes
// are adapters only and never write state, identity, lineage, or finance.
async function executeInventoryV2Transformation(req, res, next, orderType) {
  const transaction = await models.sequelize.transaction();
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const branch = await models.Branch.findOne({ where: { id: branchId, companyId: req.companyId, isActive: true }, transaction });
    if (!branch) throw new NotFoundError("Authorized Branch not found.");
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const reason = String(req.body?.reason || "").trim();
    const inputAssetIds = [...new Set(Array.isArray(req.body?.inputAssetIds) ? req.body.inputAssetIds.map(String) : [])];
    if (!reason || !inputAssetIds.length) throw new ValidationError("Transformation reason and exact input Asset IDs are required.");
    const rawOutputs = Array.isArray(req.body?.outputs) ? req.body.outputs : [];
    if (orderType === "manufacturing" && !rawOutputs.length) throw new ValidationError("Manufacturing requires explicit physical output pieces.");
    const outputs = rawOutputs.map((raw) => {
      if (!String(raw?.physicalEvidence || "").trim()) throw new ValidationError("Every physical output requires physical evidence.");
      if (raw?.assetId || raw?.barcode) throw new ValidationError("Output Asset IDs and Barcodes are server-generated and cannot be reused.");
      const piece = inventoryV2Runtime.normalizeReceiptPiece(raw);
      if (raw.postWeight !== undefined && Number(raw.postWeight) !== Number(piece.grossWeight)) throw new ValidationError("Output postWeight must equal the recorded physical grossWeight.");
      return piece;
    });
    const requestFingerprint = JSON.stringify({ orderType, reason, inputAssetIds: [...inputAssetIds].sort(), outputs: rawOutputs });
    const existing = await models.sequelize.query("SELECT source_id FROM asset_events WHERE company_id=:companyId AND idempotency_key=:idempotencyKey LIMIT 1", { replacements: { companyId: req.companyId, idempotencyKey: `${idempotencyKey}:input:0` }, transaction, type: require("sequelize").QueryTypes.SELECT });
    if (existing.length) {
      const existingOrder = await models.ManufacturingOrder.findOne({ where: { id: existing[0].source_id, companyId: req.companyId }, transaction });
      if (!existingOrder || existingOrder.inputAssets?.[0]?.requestFingerprint !== requestFingerprint) throw new ConflictError("Idempotency-Key body conflict.");
      await transaction.commit();
      return res.status(200).json({ success: true, replayed: true, data: { manufacturingOrderId: existingOrder.id, outputAssetIds: (existingOrder.outputAssets || []).map((item) => item.id) } });
    }
    const totalOutputWeight = outputs.reduce((sum, piece) => sum + Number(piece.grossWeight), 0);
    const context = { ...inventoryV2Context(req, branchId), branchName: branch.name };
    const orderedInputIds = [...inputAssetIds].sort();
    const inputs = [];
    for (const assetId of orderedInputIds) {
      const asset = await findScopedInventoryV2Asset(req, assetId, branchId, transaction, { lock: true });
      if (asset.operationalStatus !== "AVAILABLE") throw new ConflictError(`Asset ${asset.id} is not available for ${orderType}.`);
      inputs.push(asset);
    }
    const totalInputWeight = inputs.reduce((sum, asset) => sum + Number(asset.grossWeight), 0);
    if (outputs.length && totalOutputWeight > totalInputWeight) throw new ValidationError("Output physical weight cannot exceed the known input weight.");
    const orderId = inventoryV2Runtime.newId(orderType === "melting" ? "IMMELT" : "IMMFG");
    const now = context.occurredAt;
    await models.ManufacturingOrder.create({
      id: orderId, companyId: req.companyId, status: "completed", type: orderType === "melting" ? "melting" : "manufacturing",
      inputAssets: inputs.map((asset, ordinal) => ({ id: asset.id, ordinal, preWeight: asset.grossWeight, operationalStatus: asset.operationalStatus, requestFingerprint: ordinal === 0 ? requestFingerprint : undefined })),
      outputAssets: [], expectedOutputWeight: totalInputWeight, actualOutputWeight: totalOutputWeight || null,
      processLoss: Math.max(0, totalInputWeight - totalOutputWeight), wastage: Math.max(0, totalInputWeight - totalOutputWeight),
      branch: branch.name, notes: reason, startedAt: now.toISOString(), completedAt: now.toISOString(), createdBy: context.actorId || context.actorName, approvedBy: context.actorId || context.actorName,
    }, { transaction });
    for (let ordinal = 0; ordinal < inputs.length; ordinal += 1) {
      const asset = inputs[ordinal];
      await models.sequelize.query(`INSERT INTO manufacturing_order_inputs
        (id,manufacturing_order_id,asset_id,company_id,ordinal,pre_weight,disposition)
        VALUES (:id,:orderId,:assetId,:companyId,:ordinal,:preWeight,'MELTED')`, { replacements: { id: inventoryV2Runtime.newId("IMMFGIN"), orderId, assetId: asset.id, companyId: req.companyId, ordinal, preWeight: asset.grossWeight }, transaction });
      await inventoryV2Runtime.transitionAsset({ models, transaction, asset, context, toStatus: "MELTED", eventType: orderType === "melting" ? "MELTED" : "MANUFACTURING_CONSUMED", movementType: orderType === "melting" ? "MELT_OUT" : "MANUFACTURING_OUT", sourceType: "MANUFACTURING_ORDER", sourceId: orderId, note: reason, idempotencyKey: `${idempotencyKey}:input:${ordinal}` });
    }
    const outputAssets = [];
    for (let ordinal = 0; ordinal < outputs.length; ordinal += 1) {
      const piece = outputs[ordinal];
      const barcodeIdentity = await barcodeIdentityService.generateBarcodeForAsset({ companyId: req.companyId, assetType: piece.type, inventoryCode: piece.inventoryCode, itemCode: piece.itemCode, karat: piece.karat, inventorySubtype: piece.inventorySubtype || inventoryV2Runtime.legacySubtypeForProfile(piece.profile), transaction });
      const asset = await models.Asset.create({
        id: inventoryV2Runtime.newId("ASTV2MFG"), companyId: req.companyId, name: piece.name || `${orderType === "melting" ? "Melt" : "Manufactured"} output ${ordinal + 1}`,
        type: piece.type, category: piece.category || "V2 transformation", karat: piece.karat, purity: piece.weights?.purityRatio ?? null,
        grossWeight: piece.grossWeight, netWeight: piece.weights?.netGoldWeight ?? piece.grossWeight, goldWeight: piece.weights?.netGoldWeight ?? piece.grossWeight,
        price: inventoryV2PriceMappingService.resolveAssetSellingPrice({ piece, fallback: piece.purchaseCost }), cost: piece.purchaseCost, branch: branch.name, branchId, location: piece.location || "", status: "available", ...barcodeIdentity,
        inventorySubtype: piece.inventorySubtype || inventoryV2Runtime.legacySubtypeForProfile(piece.profile), metadataSchemaVersion: piece.metadataSchemaVersion || 1, metadata: { ...(piece.metadata || {}), physicalEvidence: piece.physicalEvidence },
        source: orderType === "melting" ? "inventory_v2_melt_output" : "inventory_v2_manufacturing_output", manufacturingOrderId: orderId,
        inventoryProfile: piece.profile, operationalStatus: "AVAILABLE", condition: piece.condition, conditionClassification: piece.condition === null ? "V2_PROFILE_NULLABLE" : "V2_EXPLICIT", tagState: "PENDING", tagStateClassification: "V2_TRANSFORMATION_INITIAL", description: piece.description || null, brand: piece.brand || null, model: piece.model || null, modelNumber: piece.modelNumber || null, purchaseDate: now.toISOString().slice(0, 10), createdBy: context.actorId || null, updatedBy: context.actorId || null,
      }, { transaction });
      const event = await inventoryV2Runtime.recordAssetEvent({ models, transaction, asset: asset.toJSON(), context, eventType: orderType === "melting" ? "MELT_OUTPUT_CREATED" : "MANUFACTURED", newStatus: "AVAILABLE", sourceType: "MANUFACTURING_ORDER", sourceId: orderId, note: reason, idempotencyKey: `${idempotencyKey}:output:${ordinal}` });
      await inventoryV2Runtime.recordMovement({ models, transaction, asset: asset.toJSON(), context, movementType: orderType === "melting" ? "MELT_IN" : "MANUFACTURING_IN", sourceType: "MANUFACTURING_ORDER", sourceId: orderId, eventId: event.id, toBranchId: branchId, toLocationId: asset.locationId || null });
      await inventoryV2Runtime.persistManufacturingEvidence({ models, transaction, asset: asset.toJSON(), piece, context, manufacturingOrderId: orderId });
      await models.sequelize.query(`INSERT INTO manufacturing_order_outputs
        (id,manufacturing_order_id,asset_id,company_id,ordinal,post_weight,process_loss)
        VALUES (:id,:orderId,:assetId,:companyId,:ordinal,:postWeight,:processLoss)`, { replacements: { id: inventoryV2Runtime.newId("IMMFGOUT"), orderId, assetId: asset.id, companyId: req.companyId, ordinal, postWeight: piece.grossWeight, processLoss: null }, transaction });
      for (const input of inputs) await models.sequelize.query(`INSERT INTO asset_lineage_links
        (id,company_id,parent_asset_id,child_asset_id,relation_type,source_type,source_id,occurred_at)
        VALUES (:id,:companyId,:parentAssetId,:childAssetId,:relationType,'MANUFACTURING_ORDER',:orderId,:occurredAt)`, { replacements: { id: inventoryV2Runtime.newId("IMLINEAGE"), companyId: req.companyId, parentAssetId: input.id, childAssetId: asset.id, relationType: orderType === "melting" ? "MELT_OUTPUT" : "MANUFACTURING_OUTPUT", orderId, occurredAt: now }, transaction });
      outputAssets.push(asset);
    }
    await models.ManufacturingOrder.update({ outputAssets: outputAssets.map((asset, ordinal) => ({ id: asset.id, ordinal, postWeight: asset.grossWeight })) }, { where: { id: orderId }, transaction });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: `inventory_v2.${orderType}_completed`, description: `${orderType} order ${orderId} completed with ${inputs.length} inputs and ${outputAssets.length} outputs.`, sourceDocument: orderId, metadata: { inputAssetIds: inputs.map((asset) => asset.id), outputAssetIds: outputAssets.map((asset) => asset.id) } }), { transaction });
    await transaction.commit();
    return res.status(201).json({ success: true, data: { manufacturingOrderId: orderId, inputAssetIds: inputs.map((asset) => asset.id), outputAssetIds: outputAssets.map((asset) => asset.id), financialEffect: "NONE_DEFINED" } });
  } catch (error) { await transaction.rollback(); return next(error); }
}

router.post("/inventory-v2/manufacturing-orders", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), (req, res, next) => executeInventoryV2Transformation(req, res, next, "manufacturing"));
router.post("/inventory-v2/melt-orders", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), (req, res, next) => executeInventoryV2Transformation(req, res, next, "melting"));

// A CGP document line remains the authority.  Conversion is permitted only
// when the caller supplies matching physical-piece evidence; aggregate source
// material is deliberately retained as a disposition with no invented Asset.
router.post("/inventory-v2/cgp-items/:id/disposition", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  let transaction;
  try {
    cgpLegacyIsolation.assertCgpDispositionConversionAllowed({ disposition: req.body?.disposition });
    transaction = await models.sequelize.transaction();
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const idempotencyKey = requireInventoryV2IdempotencyKey(req);
    const disposition = String(req.body?.disposition || "").toUpperCase();
    if (!["PENDING", "CONVERTED_TO_ASSET", "TRANSFER", "TRANSIT", "MELTED", "MISSING"].includes(disposition)) throw new ValidationError("CGP disposition is invalid.");
    const item = await models.CustomerGoldPurchaseItem.findOne({ where: { id: req.params.id, companyId: req.companyId }, transaction, lock: true });
    if (!item) throw new NotFoundError("Customer Gold Purchase item not found.");
    const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { id: item.documentId, companyId: req.companyId, branchId }, transaction, lock: true });
    if (!document) throw new NotFoundError("CGP source document is not in the authorized Branch.");
    if (document.status !== "approved") throw new ConflictError("Only an approved CGP source document can be disposed.");
    const existing = await models.sequelize.query("SELECT * FROM cgp_item_dispositions WHERE cgp_item_id=:cgpItemId FOR UPDATE", { replacements: { cgpItemId: item.id }, transaction, type: require("sequelize").QueryTypes.SELECT });
    const requestFingerprint = JSON.stringify({ disposition, physicalPiece: req.body?.physicalPiece || null, evidence: req.body?.evidence || null });
    if (existing.length) {
      let prior = null; try { prior = JSON.parse(existing[0].evidence); } catch { /* legacy text is non-replayable evidence */ }
      if (prior?.idempotencyKey === idempotencyKey && prior?.requestFingerprint === requestFingerprint) { await transaction.commit(); return res.status(200).json({ success: true, replayed: true, data: existing[0] }); }
      throw new ConflictError("CGP source item already has an immutable disposition.");
    }
    const context = inventoryV2Context(req, branchId);
    let asset = null;
    if (disposition === "CONVERTED_TO_ASSET") {
      const rawPiece = req.body?.physicalPiece;
      if (!rawPiece || !String(rawPiece.physicalEvidence || "").trim()) throw new ValidationError("CGP conversion requires exact physical-piece evidence.");
      if (rawPiece.assetId || rawPiece.barcode) throw new ValidationError("CGP conversion Asset ID and Barcode are server-generated.");
      if (String(rawPiece.profile || "").toUpperCase() === "CGP_CUSTOMER_GOLD_PURCHASE") throw new ValidationError("CGP source profile cannot fabricate a physical Asset profile; choose the verified target profile.");
      const grossMatches = Number(rawPiece.grossWeight) === Number(item.grossWeight);
      const stoneMatches = Number(rawPiece.stoneWeight ?? 0) === Number(item.stoneWeight);
      const karatMatches = Number(rawPiece.karat) === Number(item.karat);
      if (!grossMatches || !stoneMatches || !karatMatches) throw new ConflictError("CGP physical evidence must match the approved source line exactly.");
      if (item.proposedRate === null || item.proposedRate === undefined) throw new ConflictError("CGP source has no approved economic rate.");
      const derivedCost = Number(item.netWeight) * Number(item.proposedRate);
      const piece = inventoryV2Runtime.normalizeReceiptPiece({ ...rawPiece, purchaseCost: derivedCost, goldValue: derivedCost });
      const branch = await models.Branch.findOne({ where: { id: branchId, companyId: req.companyId, isActive: true }, transaction });
      if (!branch) throw new NotFoundError("Authorized Branch not found.");
      const barcodeIdentity = await barcodeIdentityService.generateBarcodeForAsset({ companyId: req.companyId, assetType: piece.type, inventoryCode: piece.inventoryCode, itemCode: piece.itemCode, karat: piece.karat, inventorySubtype: piece.inventorySubtype || inventoryV2Runtime.legacySubtypeForProfile(piece.profile), transaction });
      asset = await models.Asset.create({
        id: inventoryV2Runtime.newId("ASTV2CGP"), companyId: req.companyId, name: piece.name || `CGP conversion ${item.id}`, type: piece.type, category: piece.category || "CGP conversion", karat: piece.karat, purity: piece.weights?.purityRatio ?? null,
        grossWeight: piece.grossWeight, netWeight: piece.weights?.netGoldWeight ?? piece.grossWeight, goldWeight: piece.weights?.netGoldWeight ?? piece.grossWeight, price: inventoryV2PriceMappingService.resolveAssetSellingPrice({ piece, fallback: piece.purchaseCost }), cost: piece.purchaseCost,
        branch: branch.name, branchId, location: piece.location || "", status: "available", ...barcodeIdentity, inventorySubtype: piece.inventorySubtype || inventoryV2Runtime.legacySubtypeForProfile(piece.profile), metadataSchemaVersion: piece.metadataSchemaVersion || 1, metadata: { ...(piece.metadata || {}), physicalEvidence: piece.physicalEvidence, cgpItemId: item.id }, source: "inventory_v2_cgp_conversion",
        inventoryProfile: piece.profile, operationalStatus: "AVAILABLE", condition: piece.condition, conditionClassification: piece.condition === null ? "V2_PROFILE_NULLABLE" : "V2_EXPLICIT", tagState: "PENDING", tagStateClassification: "V2_CGP_CONVERSION_INITIAL", purchaseDate: context.occurredAt.toISOString().slice(0, 10), createdBy: context.actorId || null, updatedBy: context.actorId || null,
      }, { transaction });
      const event = await inventoryV2Runtime.recordAssetEvent({ models, transaction, asset: asset.toJSON(), context: { ...context, branchName: branch.name }, eventType: "CGP_CONVERTED_TO_ASSET", newStatus: "AVAILABLE", sourceType: "CGP_ITEM", sourceId: item.id, note: String(rawPiece.physicalEvidence), idempotencyKey });
      await inventoryV2Runtime.recordMovement({ models, transaction, asset: asset.toJSON(), context, movementType: "CGP_CONVERSION_IN", sourceType: "CGP_ITEM", sourceId: item.id, eventId: event.id, toBranchId: branchId, toLocationId: asset.locationId || null });
      await inventoryV2Runtime.persistManufacturingEvidence({ models, transaction, asset: asset.toJSON(), piece, context, cgpItemId: item.id, originType: "CGP" });
    }
    const evidence = JSON.stringify({ idempotencyKey, requestFingerprint, evidence: req.body?.evidence || null, physicalEvidence: req.body?.physicalPiece?.physicalEvidence || null, sourceDocumentId: document.id });
    const dispositionId = inventoryV2Runtime.newId("IMCGPDISP");
    await models.sequelize.query(`INSERT INTO cgp_item_dispositions
      (id,cgp_item_id,company_id,branch_id,disposition,asset_id,gold_pool_id,evidence,decided_at,decided_by)
      VALUES (:id,:cgpItemId,:companyId,:branchId,:disposition,:assetId,NULL,:evidence,:decidedAt,:decidedBy)`, { replacements: { id: dispositionId, cgpItemId: item.id, companyId: req.companyId, branchId, disposition, assetId: asset?.id || null, evidence, decidedAt: context.occurredAt, decidedBy: context.actorId || null }, transaction });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, { action: "inventory_v2.cgp_disposition", description: `CGP item ${item.id} disposition ${disposition}.`, sourceDocument: item.documentId, metadata: { cgpItemId: item.id, disposition, assetId: asset?.id || null } }), { transaction });
    await transaction.commit();
    return res.status(201).json({ success: true, data: { dispositionId, cgpItemId: item.id, disposition, assetId: asset?.id || null, financialEffect: "NONE_DEFINED" } });
  } catch (error) { if (transaction) await transaction.rollback(); return next(error); }
});

// This guard is deliberately registered before generic CRUD. A completed V2
// audit is evidence, and a closed one is immutable; neither may be erased by
// the older stock-audit management surface.
router.delete("/stock-audits/:id", authMiddleware, requireBusinessPermission("inventory.adjust", { touch: true }), async (req, res, next) => {
  try {
    const audit = await models.StockAudit.findOne({ where: { id: req.params.id, companyId: req.companyId } });
    if (!audit) throw new NotFoundError("Stock audit not found.");
    if (["completed", "closed"].includes(audit.status)) throw new ConflictError("Completed and closed inventory audits are immutable evidence.");
    return next();
  } catch (error) { return next(error); }
});

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
    const financialReadiness = await financialBootstrapService.evaluateReadiness({
      models,
      companyId: req.companyId,
      branchId: branch.id,
      transaction: t,
      requiredRoleCodes: CGP_REQUIRED_FINANCIAL_ROLE_CODES,
    });
    if (financialReadiness.status !== "READY") {
      throw new AppError("Branch cannot be reactivated until the required financial configuration is complete.", 422, "CGP_FINANCIAL_READINESS_REQUIRED", { readiness: financialReadiness });
    }
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

+// D2 compatibility adapter — the canonical search authority is the
// read-only invoice projection service. This legacy URL remains only for
// clients that have not migrated their route; it performs no separate ORM
// search and cannot expose inactive/future source types.
router.get("/invoices/search-print", authMiddleware, requireBusinessPermission("sales.view"), async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 25, 1), 100);
    const requestedType = String(req.query.type || req.query.sourceType || "all").trim().toLowerCase();
    const sourceTypes = requestedType === "all"
      ? [...invoiceProjectionService.ACTIVE_PROJECTION_SOURCE_TYPES]
      : [...new Set(requestedType.split(",").map((value) => value.trim()).filter(Boolean))];
    sourceTypes.forEach((sourceType) => invoiceProjectionService.assertActiveSourceType(sourceType));

    const requestedStatus = String(req.query.status || "all").trim().toLowerCase();
    const supportedStatuses = new Set(["draft", "posted", "closed", "cancelled", "returned"]);
    if (requestedStatus !== "all" && !supportedStatuses.has(requestedStatus)) {
      throw new ValidationError("Unsupported invoice status for Search & Print.");
    }

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

    let branchId = req.branchId || null;
    const requestedBranch = String(req.query.branch || req.query.branchId || "").trim();
    if (requestedBranch && requestedBranch !== "all") {
      const branchRecord = await models.Branch.findOne({
        where: {
          companyId: req.companyId,
          isActive: true,
          [Op.or]: [{ id: requestedBranch }, { name: requestedBranch }, { code: requestedBranch }],
        },
        attributes: ["id"],
        raw: true,
      });
      if (!branchRecord) throw new ValidationError("Selected branch is invalid or inactive.");
      if (req.branchId && String(branchRecord.id) !== String(req.branchId)) {
        const error = new ForbiddenError("Selected branch is outside this account scope.");
        error.errorCode = "BRANCH_SCOPE_FORBIDDEN";
        throw error;
      }
      branchId = branchRecord.id;
    }

    const filters = {
      page,
      pageSize,
      sourceTypes,
      search: String(req.query.search || "").trim(),
      partyName: String(req.query.customer || req.query.customerName || "").trim(),
      partyId: String(req.query.customerId || "").trim(),
      employee: String(req.query.employee || "").trim(),
      branchId,
      dateFrom,
      dateTo,
      status: requestedStatus === "all" ? "" : requestedStatus,
    };
    const data = await invoiceProjectionService.listSummaries({
      companyId: req.companyId,
      branchId,
      filters,
    });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "invoice_projection.search",
      description: "Legacy invoice Search & Print compatibility adapter delegated to the canonical projection.",
      sourceDocument: "INVOICE_SEARCH_PROJECTION",
      requiredPermission: "sales.view",
      requestedOperation: "invoice.search",
      authorizationResult: "allowed",
      after: JSON.stringify({ filters, resultCount: data.total }),
    }));

    return res.status(200).json({
      success: true,
      items: data.items,
      page: data.page,
      pageSize: data.pageSize,
      total: data.total,
      totalPages: data.totalPages,
      capabilities: {
        employeeFilter: Boolean(data.filterContract?.supportsEmployeeFilter),
        supportedTypes: data.filterContract?.sourceTypes || sourceTypes,
        canonicalRoute: "/invoice-projection/summaries",
        readOnly: true,
      },
      data,
      readOnly: true,
    });
  } catch (error) {
    return next(error);
  }
});

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

// Receipt reads are deliberately separate from reservation mutation.  Every
// lookup is bound to the authenticated company and one authorized branch, and
// receipt data comes only from the immutable server-created snapshot.
router.get("/reservation-deposit-receipts/number/:receiptNumber", authMiddleware, requireBusinessPermission(reservationPerms.viewReceipts), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"] || req.query.branchId, { required: true });
    const receipt = await reservationDepositReceiptService.readByNumber({
      companyId: req.companyId,
      branchId,
      receiptNumber: req.params.receiptNumber
    });
    return res.status(200).json({ success: true, data: receipt });
  } catch (error) { return next(error); }
});

router.get("/reservation-deposit-receipts/:receiptId", authMiddleware, requireBusinessPermission(reservationPerms.viewReceipts), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"] || req.query.branchId, { required: true });
    const receipt = await reservationDepositReceiptService.readById({
      companyId: req.companyId,
      branchId,
      receiptId: req.params.receiptId
    });
    return res.status(200).json({ success: true, data: receipt });
  } catch (error) { return next(error); }
});

router.get("/reservation-payments/:paymentId/deposit-receipt", authMiddleware, requireBusinessPermission(reservationPerms.viewReceipts), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"] || req.query.branchId, { required: true });
    const receipt = await reservationDepositReceiptService.readByPaymentId({
      companyId: req.companyId,
      branchId,
      paymentId: req.params.paymentId
    });
    return res.status(200).json({ success: true, data: receipt });
  } catch (error) { return next(error); }
});

router.get("/reservations/:id/deposit-receipts", authMiddleware, requireBusinessPermission(reservationPerms.viewReceipts), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"] || req.query.branchId, { required: true });
    const result = await reservationDepositReceiptService.history({
      companyId: req.companyId,
      branchId,
      reservationId: req.params.id,
      page: req.query.page,
      pageSize: req.query.limit
    });
    return res.status(200).json({ success: true, ...result, data: result.items });
  } catch (error) { return next(error); }
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
    const operationBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const body = {
      ...(req.body || {}),
      // A browser cannot choose the receipt operator identity.  Branch-shell
      // sessions have a verified operator context; company users may use only
      // their server-owned default Employee reference.
      receivedEmployeeId: req.operatorContext?.employeeId || req.user?.defaultEmployeeId || null
    };
    const result = await reservationService.addPayment({
      companyId: req.companyId,
      branchId: operationBranchId,
      user: req.user,
      reservationId: req.params.id,
      body,
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
    const operationBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await reservationService.completeSale({
      companyId: req.companyId,
      branchId: operationBranchId,
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
    const operationBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await reservationService.requestRefund({
      companyId: req.companyId,
      branchId: operationBranchId,
      user: req.user,
      reservationId: req.params.id,
      body: req.body || {},
      idempotencyKey: req.headers["idempotency-key"] || req.body?.idempotencyKey
    });
    emitEntityChanged(req.companyId, { entity: "Reservation", action: "refund-request", id: req.params.id });
    return res.status(result.statusCode).json(result.responseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/reservation-refunds/:id/approve", authMiddleware, requireAnyBusinessPermission(reservationPerms.refundApprove, { touch: true }), async (req, res, next) => {
  try {
    const operationBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await reservationService.approveRefund({
      companyId: req.companyId,
      branchId: operationBranchId,
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

router.post("/reservation-refunds/:id/reject", authMiddleware, requireAnyBusinessPermission(reservationPerms.refundReject, { touch: true }), async (req, res, next) => {
  try {
    const operationBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await reservationService.rejectRefund({
      companyId: req.companyId,
      branchId: operationBranchId,
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

router.post("/reservation-refunds/:id/execute", authMiddleware, requireAnyBusinessPermission(reservationPerms.refundExecute, { touch: true }), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const operationBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await reservationService.executeRefund({
      companyId: req.companyId,
      branchId: operationBranchId,
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
    await reservationService.getById({ companyId: req.companyId, id: req.params.id, user: req.user, branchId: req.branchId });
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
    await reservationService.getById({ companyId: req.companyId, id: req.params.id, user: req.user, branchId: req.branchId });
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
    await reservationService.getById({ companyId: req.companyId, id: req.params.id, user: req.user, branchId: req.branchId });
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

router.post("/reservation-renewal-refunds/:id/approve", authMiddleware, requireAnyBusinessPermission(reservationPerms.refundApprove, { touch: true }), async (req, res, next) => {
  try {
    const operationBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await reservationService.approveRenewalExcessRefund({
      companyId: req.companyId,
      branchId: operationBranchId,
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

router.post("/reservation-renewal-refunds/:id/execute", authMiddleware, requireAnyBusinessPermission(reservationPerms.refundExecute, { touch: true }), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    const operationBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"], { required: true });
    const result = await reservationService.executeRenewalExcessRefund({
      companyId: req.companyId,
      branchId: operationBranchId,
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
    const reservation = await reservationService.getById({ companyId: req.companyId, id: req.params.id, user: req.user, branchId: req.branchId });
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
      const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.query.branch, { required: true });
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

const auditFinancialConfiguration = (req, action, entityId = null) =>
  auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
    action,
    description: "Financial configuration changed through the supported accounting domain.",
    metadata: entityId ? { entityId } : undefined,
  }));

router.get("/accounts", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    const data = await financialAccountService.listAccounts({ models, companyId: req.companyId, query: req.query });
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.get("/accounts/:id", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    const data = await financialAccountService.getAccount({ models, companyId: req.companyId, accountId: req.params.id });
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.post("/accounts", authMiddleware, requireBusinessPermission("accounting.post", { touch: true }), async (req, res, next) => {
  try {
    const data = await financialAccountService.createAccount({ models, companyId: req.companyId, body: req.body || {} });
    await auditFinancialConfiguration(req, "financial_account.created", data.id);
    return res.status(201).json({ success: true, data });
  } catch (error) { return next(error); }
});

const updateFinancialAccount = async (req, res, next) => {
  try {
    const data = await financialAccountService.updateAccount({
      models,
      companyId: req.companyId,
      accountId: req.params.id,
      body: req.body || {},
    });
    await auditFinancialConfiguration(req, "financial_account.updated", data.id);
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
};
router.put("/accounts/:id", authMiddleware, requireBusinessPermission("accounting.post", { touch: true }), updateFinancialAccount);
router.patch("/accounts/:id", authMiddleware, requireBusinessPermission("accounting.post", { touch: true }), updateFinancialAccount);

router.post("/accounts/:id/deactivate", authMiddleware, requireBusinessPermission("accounting.post", { touch: true }), async (req, res, next) => {
  try {
    const data = await financialAccountService.deactivateAccount({ models, companyId: req.companyId, accountId: req.params.id });
    await auditFinancialConfiguration(req, "financial_account.deactivated", data.id);
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});
router.post("/accounts/:id/reactivate", authMiddleware, requireBusinessPermission("accounting.post", { touch: true }), async (req, res, next) => {
  try {
    const data = await financialAccountService.reactivateAccount({ models, companyId: req.companyId, accountId: req.params.id });
    await auditFinancialConfiguration(req, "financial_account.reactivated", data.id);
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});
router.delete("/accounts/:id", authMiddleware, requireBusinessPermission("accounting.post", { touch: true }), async (req, res, next) => {
  try {
    await financialAccountService.deleteAccount({ models, companyId: req.companyId, accountId: req.params.id });
    return res.status(204).end();
  } catch (error) { return next(error); }
});

router.get("/financial/readiness", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
    const data = await financialBootstrapService.evaluateReadiness({ models, companyId: req.companyId, branchId });
    return res.status(200).json({
      success: true,
      data: {
        ...data,
        blockingCode: data.status === "READY" ? null : "FINANCIAL_READINESS_REQUIRED",
      },
    });
  } catch (error) { return next(error); }
});

router.post("/financial/reconcile", authMiddleware, requireBusinessPermission("settings.update", { touch: true }), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.body?.branchId || req.headers["x-branch-id"], { required: true });
    const data = await financialBootstrapService.reconcile({
      models,
      companyId: req.companyId,
      branchId,
      actorId: req.user?.id || "financial-reconcile",
      dryRun: Boolean(req.body?.dryRun),
    });
    if (!req.body?.dryRun) await auditFinancialConfiguration(req, "financial_configuration.reconciled");
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.get("/financial/branch-mappings", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
    const rows = await models.BranchFinancialMapping.findAll({
      where: { companyId: req.companyId, branchId, channel: null, isActive: true },
      attributes: ["mappingType", "accountId", "isActive"],
      order: [["mappingType", "ASC"]],
    });
    return res.status(200).json({
      success: true,
      data: {
        branchId,
        required: Object.keys(BRANCH_MAPPING_CATALOG),
        mappings: rows,
      },
    });
  } catch (error) { return next(error); }
});

router.get("/financial/branch-mappings/:mappingRole/eligible-accounts", authMiddleware, requireBusinessPermission("settings.update"), async (req, res, next) => {
  try {
    const mappingType = String(req.params.mappingRole || "").trim().toUpperCase();
    if (!BRANCH_MAPPING_CATALOG[mappingType]) throw new ValidationError("Unsupported financial mapping role.");
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
    const accounts = await financialMappingCompatibility.listEligibleAccounts({
      models,
      companyId: req.companyId,
      branchId,
      mappingType,
    });
    return res.status(200).json({
      success: true,
      data: {
        mappingRole: mappingType,
        accounts,
      },
    });
  } catch (error) { return next(error); }
});

router.put("/financial/branch-mappings/:mappingRole", authMiddleware, requireBusinessPermission("settings.update", { touch: true }), async (req, res, next) => {
  try {
    const mappingType = String(req.params.mappingRole || "").trim().toUpperCase();
    const mappingDefinition = BRANCH_MAPPING_CATALOG[mappingType];
    if (!mappingDefinition) throw new ValidationError("Unsupported financial mapping role.");
    const branchId = await resolveAuthorizedBranchId(req, req.body?.branchId || req.headers["x-branch-id"], { required: true });
    const data = await models.sequelize.transaction(async (transaction) => {
      const account = await financialMappingCompatibility.assertMappingAccountCompatibility({
        models,
        companyId: req.companyId,
        branchId,
        mappingType,
        accountId: req.body?.accountId,
        transaction,
        lock: true,
      });
      const rows = await models.BranchFinancialMapping.findAll({
        where: { companyId: req.companyId, branchId, mappingType, channel: null },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (rows.length > 1) throw new ConflictError("The Branch mapping is ambiguous.");
      if (rows.length) {
        await rows[0].update({ accountId: account.id, isActive: true, updatedBy: req.user?.id || null }, { transaction });
        return rows[0];
      }
      return models.BranchFinancialMapping.create({
        id: `BFM-${require("crypto").randomUUID()}`,
        companyId: req.companyId,
        branchId,
        mappingType,
        channel: null,
        accountId: account.id,
        isActive: true,
        createdBy: req.user?.id || null,
        updatedBy: req.user?.id || null,
      }, { transaction });
    });
    await auditFinancialConfiguration(req, "financial_branch_mapping.updated", data.id);
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.get("/reports/income-statement", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (!from || !to || !isValidYmd(from) || !isValidYmd(to) || from > to) throw new ValidationError("A valid report period is required.");
    const data = await financialReportingService.incomeStatement({ companyId: req.companyId, branchId, from, to });
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.get("/reports/balance-sheet", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
    const asOf = req.query.asOf ? String(req.query.asOf) : null;
    if (!asOf || !isValidYmd(asOf)) throw new ValidationError("A valid as-of date is required.");
    const data = await financialReportingService.balanceSheet({ companyId: req.companyId, branchId, asOf });
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});
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

// POS universal search is a bounded, read-only projection over sale candidates.
// Checkout and pricing remain the authoritative validators; this route never
// exposes acquisition cost or mutates inventory.
router.get("/pos/search", authMiddleware, requireAnyBusinessPermission(["pos.view", "pos.sell"]), async (req, res, next) => {
  try {
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
    const query = String(req.query.query || req.query.search || "").trim();
    const requestedLimit = Number(req.query.limit || 20);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 20, 1), 50);
    const type = String(req.query.type || "all");
    const includeUnavailableExact = String(req.query.includeUnavailableExact || "true") === "true";
    const exactWhere = query ? {
      [Op.or]: [
        { id: query },
        { barcode: query },
      ],
    } : null;
    const fuzzyWhere = query ? {
      [Op.or]: [
        { barcode: { [Op.iLike]: `%${query}%` } },
        { name: { [Op.iLike]: `%${query}%` } },
        { description: { [Op.iLike]: `%${query}%` } },
        { inventoryProfile: { [Op.iLike]: `%${query}%` } },
      ],
    } : {};
    const productWhere = {
      companyId: req.companyId,
      branchId,
      isActive: true,
      ...(query ? {
        [Op.or]: [
          { id: query },
          { productCode: query },
          { productName: { [Op.iLike]: `%${query}%` } },
          { description: { [Op.iLike]: `%${query}%` } },
        ],
      } : {}),
      ...(type !== "all" && type !== "gold-weight" ? { stockType: type } : {}),
      quantityAvailable: { [Op.gt]: 0 },
    };
    const assetWhere = {
      companyId: req.companyId,
      branchId,
      parentAssetId: { [Op.is]: null },
      ...(query ? fuzzyWhere : {}),
      ...(type !== "all" ? { type } : {}),
      operationalStatus: { [Op.in]: ["AVAILABLE", "available"] },
    };
    const [products, assets] = await Promise.all([
      models.Product.findAll({
        where: productWhere,
        attributes: ["id", "productCode", "productName", "description", "karat", "stockType", "branchId", "quantityAvailable", "averageUnitWeight", "salePrice", "isActive"],
        order: [["productName", "ASC"], ["id", "ASC"]],
        limit,
      }),
      models.Asset.findAll({
        where: assetWhere,
        attributes: ["id", "name", "description", "barcode", "inventoryProfile", "operationalStatus", "condition", "branchId", "grossWeight", "netWeight", "karat", "price", "type"],
        order: [["name", "ASC"], ["id", "ASC"]],
        limit,
      }),
    ]);
    const exactAsset = query && includeUnavailableExact
      ? await models.Asset.findOne({
        where: { companyId: req.companyId, branchId, ...(exactWhere || {}) },
        attributes: ["id", "name", "description", "barcode", "inventoryProfile", "operationalStatus", "condition", "branchId", "grossWeight", "netWeight", "karat", "price", "type"],
      })
      : null;
    const exactProduct = query && includeUnavailableExact
      ? await models.Product.findOne({
        where: { companyId: req.companyId, branchId, isActive: true, [Op.or]: [{ id: query }, { productCode: query }] },
        attributes: ["id", "productCode", "productName", "description", "karat", "stockType", "branchId", "quantityAvailable", "averageUnitWeight", "salePrice", "isActive"],
      })
      : null;
    const seen = new Set();
    const result = [];
    const pricingCache = { rates: new Map(), snapshots: new Map() };
    const resolveSearchAssetPrice = async (asset) => {
      const profile = asset.inventoryProfile || asset.profile;
      // Pearl Jewellery accepts the persisted explicit Asset.price as its
      // selling-price authority. An invalid optional policy must not turn a
      // valid positive Asset.price into an unavailable POS result.
      if (profile === "PEARL_JEWELLERY") {
        const explicitAssetPrice = Number(asset.price);
        if (Number.isFinite(explicitAssetPrice) && explicitAssetPrice > 0) {
          return { value: explicitAssetPrice, unavailable: false };
        }
      }
      if (!goldSalePricingService.isSalePricingProfile(profile)) {
        return { value: Number(asset.price || 0), unavailable: false };
      }
      try {
        const sellingGoldRate = goldSalePricingService.isGoldSaleProfile(profile)
          ? await goldSalePricingService.resolveCanonicalSellingGoldRate({
            models,
            companyId: req.companyId,
            currency: "AED",
            karat: asset.karat,
            cache: pricingCache,
          })
          : null;
        const pricing = await goldSalePricingService.calculateGoldSalePriceForAsset({
          asset,
          models,
          companyId: req.companyId,
          itemInput: { sellingGoldRate },
          configuredVatRate: null,
        });
        const value = Number(pricing?.finalSalePrice ?? pricing?.invoicePrice ?? 0);
        return { value: Number.isFinite(value) && value > 0 ? value : 0, unavailable: !(Number.isFinite(value) && value > 0) };
      } catch (_) {
        return { value: 0, unavailable: true };
      }
    };
    const addProduct = (product, unavailable = false) => {
      if (seen.has(`product:${product.id}`)) return;
      seen.add(`product:${product.id}`);
      result.push({
        id: product.id,
        isProduct: true,
        code: product.productCode,
        name: product.productName,
        type: product.stockType || "product",
        karat: product.karat,
        grossWeight: Number(product.averageUnitWeight || 0),
        price: Number(product.salePrice || 0),
        available: Number(product.quantityAvailable || 0),
        sold: 0,
        branchId: product.branchId,
        unavailable,
        availabilityReason: unavailable ? "PRODUCT_UNAVAILABLE" : null,
        rawItem: {
          id: product.id,
          productCode: product.productCode,
          productName: product.productName,
          description: product.description,
          karat: product.karat,
          stockType: product.stockType,
          branchId: product.branchId,
          quantityAvailable: product.quantityAvailable,
          averageUnitWeight: product.averageUnitWeight,
          salePrice: product.salePrice,
          isActive: product.isActive,
        },
      });
    };
    const addAsset = (asset, unavailable = false, resolvedPrice = null, priceUnavailable = false) => {
      if (seen.has(`asset:${asset.id}`)) return;
      seen.add(`asset:${asset.id}`);
      result.push({
        id: asset.id,
        isProduct: false,
        code: asset.barcode || asset.id,
        name: asset.name,
        type: asset.type || asset.inventoryProfile || "asset",
        profile: asset.inventoryProfile,
        karat: asset.karat,
        grossWeight: Number(asset.grossWeight || asset.netWeight || 0),
        price: Number(resolvedPrice ?? asset.price ?? 0),
        available: unavailable ? 0 : 1,
        sold: unavailable ? 1 : 0,
        branchId: asset.branchId,
        unavailable,
        availabilityReason: unavailable
          ? `ASSET_${String(asset.operationalStatus || "UNAVAILABLE").toUpperCase()}`
          : (priceUnavailable ? "ASSET_PRICE_UNAVAILABLE" : null),
        rawItem: {
          id: asset.id,
          name: asset.name,
          description: asset.description,
          barcode: asset.barcode,
          inventoryProfile: asset.inventoryProfile,
          operationalStatus: asset.operationalStatus,
          condition: asset.condition,
          branchId: asset.branchId,
          grossWeight: asset.grossWeight,
          netWeight: asset.netWeight,
          karat: asset.karat,
          price: asset.price,
          type: asset.type,
        },
      });
    };
    // Product rows remain available to non-final legacy scope, but they are
    // never a physical-stock projection for the Owner-approved final client
    // profiles. The helper is server-owned because Product has no inventory
    // profile column in the legacy schema; explicit profile/stockType values
    // are resolved here before the result is exposed.
    if (exactProduct && !inventoryMasterPolicy.isFinalClientInventoryProduct(exactProduct) && Number(exactProduct.quantityAvailable || 0) <= 0) addProduct(exactProduct, true);
    if (exactAsset) {
      const exactUnavailable = String(exactAsset.operationalStatus || "").toUpperCase() !== "AVAILABLE";
      const exactPrice = exactUnavailable ? { value: null, unavailable: false } : await resolveSearchAssetPrice(exactAsset);
      addAsset(exactAsset, exactUnavailable, exactPrice.value, exactPrice.unavailable);
    }
    products
      .filter((product) => !inventoryMasterPolicy.isFinalClientInventoryProduct(product))
      .forEach((product) => addProduct(product));
    const pricedAssets = await Promise.all(assets.map(async (asset) => ({ asset, price: await resolveSearchAssetPrice(asset) })));
    pricedAssets.forEach(({ asset, price }) => addAsset(asset, false, price.value, price.unavailable));
    return res.status(200).json({ success: true, items: result.slice(0, limit), data: { items: result.slice(0, limit), total: result.length, limit, query, branchId } });
  } catch (error) {
    return next(error);
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

function assertFinalClientSupplierReceiveContract({ body = {}, items = [] } = {}) {
  const assessment = inventoryMasterPolicy.assessFinalClientSupplierReceive({ body, items });
  if (assessment.rejectLegacy) {
    throw new AppError(
      "Final client inventory profiles require the canonical V2 per-piece Supplier Receive path.",
      422,
      "FINAL_CLIENT_PROFILE_V2_REQUIRED"
    );
  }
  return assessment;
}

router.post(["/purchase-orders/receive", "/supplier-purchases/receive"], authMiddleware, requireBusinessPermission("suppliers.create", { touch: true }), async (req, res, next) => {
  const body = req.body || {};
  let items = Array.isArray(body.items) && body.items.length ? body.items : [{
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
  let receiveContract;
  try {
    cgpLegacyIsolation.assertSupplierReceiveDoesNotMasqueradeAsCgp({ body, items });
    assertFinalClientSupplierReceiveContract({ body, items });
    receiveContract = supplierReceiveContractService.assertCanonicalReceiveInput({
      body,
      items,
      requestBranchId: req.branchId,
      headerBranchId: req.headers["x-branch-id"],
    });
  } catch (error) {
    return next(error);
  }

  const idempotencyKey = req.headers["idempotency-key"] || body.idempotencyKey;
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لاستلام المشتريات" });
  }
  const idemScope = "purchase.receive";
  const idemRequestHash = idempotencyService.hashRequest(idemScope, body);
  const t = await models.sequelize.transaction();
  try {
    const supplierId = body.supplierId;
    const branchId = receiveContract.branchId;
    const paymentMethod = body.paymentMethod || "credit";
    const paidAmount = Number(body.paidAmount) || 0;
    const now = new Date();
    const dateStr = (body.purchaseDate || body.date || now.toISOString().slice(0, 10));
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

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

    const canonicalLocations = await supplierReceiveContractService.resolveAndCanonicalizeLocations({
      models,
      companyId: req.companyId,
      branchId: branch.id,
      body,
      items,
      transaction: t,
    });
    items = canonicalLocations.items;
    items = items.map((item) => ({ ...item, taxTreatment: item.taxTreatment || receiveContract.taxTreatment, taxContext: item.taxContext || body.taxContext }));

    // Claim only after supplier, branch, and active database Location checks
    // have passed. Invalid requests therefore cannot reserve/poison a key.
    const idemClaim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash, transaction: t });
    if (!idemClaim.claimed) {
      try { await t.rollback(); } catch (_) { /* transaction already aborted by the unique violation */ }
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const idemRequest = idemClaim.request;

    const normalizedItems = items.map((item, index) => {
      const quantity = Number(item.quantity);
      const weightPerUnit = Number(item.weightPerUnit ?? item.grossWeight ?? item.weight);
      const unitCost = Number(item.unitCost ?? item.cost ?? item.unitPrice);
      const karat = item.karat == null || item.karat === "" ? null : Number(item.karat);
      const profileHint = String(item.profile || item.inventoryProfile || item.perPiece?.[0]?.profile || item.perPiece?.[0]?.inventoryProfile || "").trim().toUpperCase();
      const validKarats = profileHint === "GOLD_BY_PIECE"
        ? new Set(goldByPieceProfileService.KARATS)
        : new Set([14, 18, 21, 22, 24]);

      if (!item.name) throw new ValidationError(`اسم البند رقم ${index + 1} مطلوب`);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError(`كمية البند رقم ${index + 1} غير صحيحة`);
      if (!Number.isInteger(quantity)) throw new ValidationError(`كمية البند رقم ${index + 1} يجب أن تكون رقمًا صحيحًا`);
      if (!Number.isFinite(weightPerUnit) || weightPerUnit <= 0) throw new ValidationError(`وزن الوحدة للبند رقم ${index + 1} غير صحيح`);
      const isV2PieceItem = body.inventoryV2 === true || Array.isArray(item.perPiece);
      if (!Number.isFinite(unitCost) || unitCost < 0 || (!isV2PieceItem && unitCost === 0)) throw new ValidationError(`سعر التكلفة للبند رقم ${index + 1} غير صحيح`);
      if (karat !== null && !validKarats.has(karat)) throw new ValidationError(`عيار البند رقم ${index + 1} غير صحيح`);
      if (!isV2PieceItem && unitCost === 0) {
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
        location: item.location || null,
        karat,
        purity
      };
    });

    // Inventory Master V2 has an explicit serialized-piece contract.  It is
    // deliberately opt-in for compatibility, but once requested it cannot
    // fall back to Product quantity stock or inferred repeated item data.
    const settings = await settingsService.getCompanySettings(req.companyId, { transaction: t });
    const companyTaxPolicy = await companyTaxPolicyService.getCompanyTaxPolicy(req.companyId, { transaction: t });
    const requestedTaxTreatment = receiveContract.taxTreatment;
    let taxSnapshot = null;
    if (requestedTaxTreatment) {
      const legacyRcmRequested = Boolean(body.isRcm || body.isDRC || body.reverseVat || body.useReverseCharge);
      if (body.taxTreatment && requestedTaxTreatment === "REVERSE_CHARGE" && !legacyRcmRequested) {
        body.isRcm = true;
      }
      if (body.taxTreatment && requestedTaxTreatment !== "REVERSE_CHARGE" && legacyRcmRequested) {
        throw new ValidationError("Tax treatment conflicts with the reverse-charge request.");
      }
      if (requestedTaxTreatment === "STANDARD_VAT") {
        if (settings.vatEnabled === false) throw new ValidationError("STANDARD_VAT is unavailable while company VAT is disabled.");
        body.applyVat = true;
        body.vatRate = companyTaxPolicy.vatRate;
      } else if (requestedTaxTreatment === "REVERSE_CHARGE") {
        body.isRcm = true;
        body.rcmRate = companyTaxPolicy.vatRate;
        body.vatRate = companyTaxPolicy.vatRate;
      } else {
        body.applyVat = false;
        body.isRcm = false;
      }
    }
    const inventoryV2Target = body.inventoryV2 === true || normalizedItems.some((item) => Array.isArray(item.perPiece));
    if (inventoryV2Target) {
      if (normalizedItems.some((item) => item.productCode || item.productId)) {
        throw new ValidationError("Inventory V2 receipt must not use Product identity for physical pieces.");
      }
      const vatRateDefault = await goldValuationService.resolveConfiguredVatRate({ models, companyId: req.companyId, transaction: t });
      const canonicalGoldRateCache = { rates: new Map(), snapshots: new Map() };
      const permissionService = require("../services/permission.service");
      let purchaseRatePermissionChecked = false;
      let purchaseRatePermissionAllowed = false;
      const canOverridePurchaseRate = async () => {
        if (!purchaseRatePermissionChecked) {
          purchaseRatePermissionAllowed = await permissionService.userHasPermission(req.user, "inventory.adjust");
          purchaseRatePermissionChecked = true;
        }
        return purchaseRatePermissionAllowed;
      };
      const canonicalizeSupplierGoldRates = async (item) => {
        if (!Array.isArray(item.perPiece)) return item;
        const perPiece = await Promise.all(item.perPiece.map(async (piece, pieceIndex) => {
          const profile = String(piece.profile || piece.inventoryProfile || "").trim().toUpperCase();
          if (profile === "GOLD_BY_PIECE") {
            if (!Object.prototype.hasOwnProperty.call(piece, "stoneWeight")) throw new ValidationError("Gold By Piece stoneWeight is required; zero is valid.");
            const selectedKarat = goldByPieceProfileService.validateWeights(piece).karat;
            const reference = await goldByPieceProfileService.resolveRate({ companyId: req.companyId, currency: "AED", karat: selectedKarat, rateType: "GLOBAL", now });
            const requested = piece.goldValuation?.purchaseGoldRate ?? piece.purchaseGoldRate;
            const hasRequested = requested !== undefined && requested !== null && String(requested).trim() !== "";
            let approvedPurchaseRate = reference.rate;
            let purchaseRateSource = "GOLD_CENTER_GLOBAL_SPOT";
            let overrideMetadata = null;
            if (hasRequested) {
              let requestedDecimal;
              try { requestedDecimal = new Decimal(String(requested)); } catch { throw new ValidationError("Purchase gold rate must be a valid number."); }
              if (!requestedDecimal.isFinite() || requestedDecimal.lte(0)) throw new ValidationError("Purchase gold rate must be positive.");
              if (!requestedDecimal.eq(new Decimal(reference.rate))) {
                if (!(await canOverridePurchaseRate())) throw new ForbiddenError("Purchase gold-rate override requires inventory.adjust permission.");
                const reason = piece.purchaseRateOverrideReason ?? piece.goldValuation?.purchaseRateOverrideReason ?? body.purchaseRateOverrideReason;
                if (!reason || !String(reason).trim()) throw new ValidationError("Purchase gold-rate override reason is required.");
                approvedPurchaseRate = requestedDecimal.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
                purchaseRateSource = "MANUAL_OVERRIDE";
                overrideMetadata = { referenceRate: reference.rate, approvedRate: approvedPurchaseRate, reason: String(reason).trim(), actorId: req.user?.id || null };
              }
            }
            const input = {
              ...piece,
              karat: selectedKarat,
              vatRate: piece.goldValuation?.vatRate ?? piece.vatRate ?? (settings.vatEnabled === false ? 0 : settings.purchaseVatRate ?? settings.vatRate),
              currentVatRate: piece.goldValuation?.currentVatRate ?? piece.currentVatRate ?? (settings.vatEnabled === false ? 0 : settings.vatRate),
              purchaseGoldRate: approvedPurchaseRate,
              currentGoldRate: reference.rate,
              makingPerGram: piece.goldValuation?.makingPerGram ?? piece.makingPerGram,
              currentMakingPerGram: piece.goldValuation?.currentMakingPerGram ?? piece.currentMakingPerGram ?? piece.goldValuation?.makingPerGram ?? piece.makingPerGram,
              markupPercent: piece.pricing?.markupPercent ?? piece.markupPercent,
              maximumDiscountPercent: piece.pricing?.maximumDiscountPercent ?? piece.maximumDiscountPercent,
            };
            const calculation = goldByPieceProfileService.calculate({
              input,
              settings,
              purchaseRate: approvedPurchaseRate,
              currentRate: reference.rate,
              purchaseRateSnapshot: { ...reference, rate: approvedPurchaseRate, source: purchaseRateSource, override: overrideMetadata },
              currentRateSnapshot: reference,
            });
            if (!calculation.sale) throw new ValidationError("Gold By Piece markupPercent is required for the server pricing contract.");
            return {
              ...piece,
              purchaseCost: calculation.purchase.totalPurchaseCost,
              unitCost: calculation.purchase.totalPurchaseCost,
              goldValue: calculation.purchase.goldValue,
              makingPerGram: calculation.purchase.makingPerGram,
              makingTotal: calculation.purchase.makingTotal,
              purchaseGoldRate: approvedPurchaseRate,
              goldRateSource: purchaseRateSource,
              vatRate: calculation.purchase.vatRate,
              vatBase: calculation.purchase.vatBase,
              vatAmount: calculation.purchase.vatAmount,
              currentValuation: { rateSource: "GOLD_CENTER_GLOBAL_SPOT", goldRate: reference.rate, goldValue: calculation.current.goldValue, makingValue: calculation.current.makingValue, certificateValue: 0, componentValue: 0, vatRate: calculation.current.vatRate, vatRateSource: "SETTINGS_DEFAULT", vatBase: calculation.current.vatBase, vatAmount: calculation.current.vatAmount, totalValue: calculation.current.totalValue },
              pricing: { ...(piece.pricing || {}), markupPercent: calculation.sale.markupPercent, maximumDiscountPercent: calculation.sale.maximumDiscountPercent, minimumSellingPrice: calculation.sale.minAllowedSellingPrice, manualPriceAllowed: false },
              goldValuation: { ...(piece.goldValuation || {}), purchaseGoldRate: approvedPurchaseRate, currentGoldRate: reference.rate, makingPerGram: calculation.purchase.makingPerGram, currentMakingPerGram: calculation.current.makingPerGram, vatRate: calculation.purchase.vatRate, currentVatRate: calculation.current.vatRate, purchaseRateType: "GLOBAL", currentRateType: "GLOBAL", rateSnapshot: calculation.gold.purchaseRateSnapshot },
              __gbpCalculation: calculation,
              ...(overrideMetadata ? { __purchaseRateOverride: { ...overrideMetadata, approvedPurchaseRate } } : {}),
            };
          }
          if (!["GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K"].includes(profile)) return piece;
          const referenceRate = await goldSalePricingService.resolveCanonicalSellingGoldRate({
            models,
            companyId: req.companyId,
            currency: settings.currency || "AED",
            karat: piece.karat,
            cache: canonicalGoldRateCache,
            transaction: t,
          });
          const requested = piece.goldValuation?.purchaseGoldRate;
          const hasRequested = requested !== undefined && requested !== null && String(requested).trim() !== "";
          let approvedPurchaseRate = referenceRate;
          let purchaseRateSource = "GOLD_CENTER";
          if (hasRequested) {
            let requestedDecimal;
            try { requestedDecimal = new Decimal(String(requested)); } catch { throw new ValidationError("Purchase gold rate must be a valid number."); }
            if (!requestedDecimal.isFinite() || requestedDecimal.lt(0)) throw new ValidationError("Purchase gold rate must be a non-negative number.");
            if (!requestedDecimal.eq(new Decimal(String(referenceRate)))) {
              if (!(await canOverridePurchaseRate())) throw new ForbiddenError("Purchase gold-rate override requires inventory.adjust permission.");
              const reason = piece.purchaseRateOverrideReason ?? piece.goldValuation?.purchaseRateOverrideReason ?? body.purchaseRateOverrideReason;
              if (!reason || !String(reason).trim()) throw new ValidationError("Purchase gold-rate override reason is required.");
              approvedPurchaseRate = requestedDecimal.toFixed(8);
              purchaseRateSource = "MANUAL_OVERRIDE";
              piece.__purchaseRateOverride = Object.freeze({ referenceRate, approvedPurchaseRate, reason: String(reason).trim(), pieceIndex });
            }
          }
          return {
            ...piece,
              goldValuation: {
                ...(piece.goldValuation || {}),
                purchaseGoldRate: approvedPurchaseRate,
                currentGoldRate: referenceRate,
                // GBW purchase/current VAT are server-effective settings when
                // the operator did not explicitly provide a rate. The client
                // may display this value, but cannot become the authority.
                vatRate: piece.goldValuation?.vatRate ?? (settings.vatEnabled === false ? 0 : settings.vatRate),
                currentVatRate: piece.goldValuation?.currentVatRate ?? (settings.vatEnabled === false ? 0 : settings.vatRate),
                purchaseRateSource,
                currentRateSource: "GOLD_CENTER",
            },
          };
        }));
        return { ...item, perPiece };
      };
      const rateAwareItems = await Promise.all(normalizedItems.map(canonicalizeSupplierGoldRates));
      normalizedItems.splice(0, normalizedItems.length, ...rateAwareItems);
      let rawPieceSets;
      try {
        const diamondMasterData = await loadDiamondMasterData(req.companyId, t);
        rawPieceSets = inventoryV2Runtime.requireV2ReceiptPieces(normalizedItems, { vatRateDefault, diamondMasterData });
        const gemMasterData = await loadGemStoneMasterData(req.companyId, t);
        const pearlMasterData = await loadPearlJewelleryMasterData(req.companyId, t);
        const loosePearlMasterData = await loadLoosePearlMasterData(req.companyId, t);
        rawPieceSets = await Promise.all(rawPieceSets.map(async (pieces) => Promise.all(pieces.map(async (diamondPiece) => {
          if (diamondPiece.profile !== diamondJewelleryProfileService.PROFILE) return diamondPiece;
          const diamondPreview = await diamondJewelleryProfileService.calculatePreview({
            companyId: req.companyId,
            input: diamondPiece,
            settings,
            taxPolicy: companyTaxPolicy,
            masterData: diamondMasterData,
          });
          if (!diamondPreview.sale?.priceAccepted) throw new ValidationError("DIAMOND_SALE_PRICE_BELOW_MINIMUM");
          // Diamond Jewellery has two distinct economic snapshots.  The
          // historical purchase base is the Supplier V2 pre-tax cost input;
          // the current valuation is display/valuation evidence and must not
          // become the PO or accounting cost.  Resolve both server-side so a
          // client cannot turn an inclusive preview total into a second tax
          // base or replace current values with historical values.
          const historicalBase = diamondPreview.historicalPurchase.purchaseBasePreTax;
          const current = diamondPreview.currentCost;
          return Object.freeze({
            ...diamondPiece,
            purchaseCost: historicalBase,
            unitCost: historicalBase,
            goldValue: diamondPreview.historicalPurchase.goldValue,
            makingTotal: diamondPreview.historicalPurchase.makingTotal,
            componentCost: diamondPreview.historicalPurchase.diamondCost,
            vatBase: historicalBase,
            currentValuation: {
              rateSource: "GOLD_CENTER_GLOBAL_SPOT",
              goldRate: diamondPreview.gold.currentRate,
              goldValue: current.goldValue,
              makingValue: current.makingValue,
              certificateValue: "0.00000000",
              componentValue: current.diamondValue,
              vatRate: current.vatRate,
              vatRateSource: "TAX_ENGINE",
              vatBase: current.currentValuationBasePreTax,
              vatAmount: current.vatAmount,
              totalValue: current.currentValuationTotalTaxInclusive,
            },
          });
        }))));
        rawPieceSets = await Promise.all(rawPieceSets.map(async (pieces) => Promise.all(pieces.map(async (piece) => {
          if (piece.profile !== gemStoneJewelleryProfileService.PROFILE) return piece;
          return gemStoneJewelleryProfileService.calculateReceiptPiece({ companyId: req.companyId, input: piece, settings, taxPolicy: companyTaxPolicy, masterData: gemMasterData, requireSalePrice: true });
        }))));
        rawPieceSets = await Promise.all(rawPieceSets.map(async (pieces) => Promise.all(pieces.map(async (piece) => {
          if (piece.profile !== pearlJewelleryProfileService.PROFILE) return piece;
          return pearlJewelleryProfileService.calculateReceiptPiece({ companyId: req.companyId, input: piece, taxPolicy: companyTaxPolicy, masterData: pearlMasterData.masters, pearlSizes: pearlMasterData.pearlSizes, requireSalePrice: true });
        }))));
        rawPieceSets = await Promise.all(rawPieceSets.map(async (pieces) => Promise.all(pieces.map(async (piece) => {
          if (piece.profile !== loosePearlProfileService.PROFILE) return piece;
          return loosePearlProfileService.calculateReceiptPiece({ input: piece, taxPolicy: companyTaxPolicy, masters: loosePearlMasterData.masters, pearlSizes: loosePearlMasterData.pearlSizes, requireSalePrice: true });
        }))));
      } catch (error) {
        throw new ValidationError(error.message || "Inventory V2 receipt piece validation failed.");
      }
      // Resolve the selected canonical Pearl Size while the receipt transaction
      // is still open.  The normalized component stores the approved display
      // value, not an unchecked free-text value from the Receive form.
      const pieceSets = await Promise.all(rawPieceSets.map(async (pieces) => Promise.all(pieces.map(async (piece) => {
        if (piece.profile !== "LOOSE_PEARL") return piece;
        if (!piece.looseDetails?.pearlSizeId && !piece.looseDetails?.pearlSize) return piece;
        const master = await pearlSizeMasterDataService.requireActive({
          models, companyId: req.companyId,
          pearlSizeId: piece.looseDetails?.pearlSizeId,
          pearlSize: piece.looseDetails?.pearlSize,
          transaction: t,
        });
        return Object.freeze({ ...piece, looseDetails: Object.freeze({ ...piece.looseDetails, pearlSize: master.displayValue, pearlSizeId: master.id, pearlSizeMaster: master }) });
      }))));
      normalizedItems.forEach((item, itemIndex) => {
        const pieces = pieceSets[itemIndex];
        item.v2Pieces = pieces;
        const isGoldByPiece = pieces.some((piece) => piece.profile === "GOLD_BY_PIECE");
        const exactItemCost = pieces.reduce((sum, piece) => sum.plus(piece.purchaseCost || 0), new Decimal(0));
        const exactItemWeight = pieces.reduce((sum, piece) => sum.plus(piece.grossWeight || 0), new Decimal(0));
        item.totalCost = (isGoldByPiece ? exactItemCost : exactItemCost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
        item.unitCost = item.totalCost / pieces.length;
        item.cost = item.unitCost;
        item.totalWeight = (isGoldByPiece ? exactItemWeight : exactItemWeight.toDecimalPlaces(4, Decimal.ROUND_HALF_UP)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
        item.weightPerUnit = item.totalWeight / pieces.length;
      });
    }

    const purchaseTotals = supplierAcquisitionPreviewService.calculateTotals({ normalizedItems, body, settings, inventoryV2Target });
    const { goodsTotal, totalWeight, total, taxBase: taxBaseSnap, vatRate: vatRateSnap,
      inputVatAmount: inputVatSnap, taxIncluded: taxIncludedSnap, isRecoverable: isRecoverableSnap,
      isRcm: isRcmSnap, rcmVatAmount: rcmVatSnap, rcmRate: rcmRateSnap,
      remainingAmount, paymentStatus } = purchaseTotals;
    const vatRequested = (body.isRcm || body.isDRC || body.reverseVat || body.useReverseCharge || body.applyVat === true) && settings.vatEnabled !== false;

    if (requestedTaxTreatment) {
      const snapshotTaxableBase = ["ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"].includes(requestedTaxTreatment)
        ? goodsTotal
        : taxBaseSnap;
      taxSnapshot = transactionTaxContextService.buildImmutableTaxSnapshot({
        requestedTaxTreatment,
        companyPolicy: companyTaxPolicy,
        rcmContext: transactionTaxContextService.rcmContextFromBody(body),
        taxableBase: snapshotTaxableBase,
        vatAmount: isRcmSnap ? rcmVatSnap : inputVatSnap,
        roundingScale: normalizedItems.some((item) => (item.v2Pieces || []).some((piece) => piece.profile === "GOLD_BY_PIECE")) ? 8 : 2,
      });
      const calculatedAmount = Number(taxSnapshot.vatAmount || 0);
      const persistedAmount = Number(isRcmSnap ? rcmVatSnap : inputVatSnap) || 0;
      if (Math.abs(calculatedAmount - persistedAmount) > 0.00000001) {
        throw new ValidationError("Server tax calculation does not reconcile with the purchase tax total.");
      }
    }

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
      taxTreatment: requestedTaxTreatment,
      taxSnapshot,
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
      if (item.productCode && !inventoryV2Target) {
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
        for (let qtyIndex = 0; qtyIndex < item.quantity; qtyIndex++) {
          const v2Piece = inventoryV2Target ? item.v2Pieces[qtyIndex] : null;
          // Recoverable V2 input VAT is a tax receivable, not Asset book cost.
          // The immutable purchase revision retains the gross source evidence;
          // the operational Asset/COGS cost remains the canonical net basis.
          const preTaxV2Piece = ["LOOSE_DIAMOND", "LOOSE_GEMSTONE", "LOOSE_PEARL", "GEMSTONE_JEWELLERY", "PEARL_JEWELLERY"].includes(v2Piece?.profile);
          const effectiveCost = v2Piece
            ? (preTaxV2Piece ? Number(v2Piece.purchaseCost) : (isRecoverableSnap && !isRcmSnap ? Number(v2Piece.purchaseCost) - Number(v2Piece.vat?.vatAmount || 0) : v2Piece.purchaseCost))
            : capUnitCost;
          const assetSnap = await governSnapshot(goldCostService.buildGoldCostSnapshot({
            goldCostSource, weight: v2Piece?.weights?.netGoldWeight ?? perUnitGoldWeight, karat: v2Piece?.karat ?? itemKarat,
            perGram: itemPerGram, currentCost: effectiveCost,
          }), item, itemIndex);
          const sequence = item.quantity > 1 ? `-${qtyIndex + 1}` : "";
          const assetId = item.quantity === 1 && item.assetId
            ? item.assetId
            : `AST-PUR-${Date.now()}-${itemIndex + 1}-${qtyIndex + 1}-${Math.random().toString(36).slice(2, 6)}`;
          const barcodeIdentity = await barcodeIdentityService.generateBarcodeForAsset({
            companyId: req.companyId,
            assetType: v2Piece?.type || item.type,
            inventoryCode: v2Piece?.inventoryCode || item.inventoryCode,
            itemCode: v2Piece?.itemCode || item.itemCode,
            karat: v2Piece?.karat ?? item.karat,
            inventorySubtype: v2Piece?.inventorySubtype || item.inventorySubtype,
            inventoryProfile: v2Piece?.profile || item.inventoryProfile || item.profile,
            transaction: t,
          });
          const asset = await models.Asset.create({
            id: assetId,
            companyId: req.companyId,
            name: v2Piece?.name || (item.quantity > 1 ? `${item.name} ${qtyIndex + 1}` : item.name),
            type: v2Piece?.type || item.type,
            category: v2Piece?.category || item.category,
            karat: v2Piece?.karat ?? item.karat ?? null,
            purity: v2Piece?.weights?.purityRatio ?? item.purity ?? null,
            grossWeight: v2Piece?.grossWeight ?? item.weightPerUnit,
            netWeight: v2Piece?.weights?.netGoldWeight ?? v2Piece?.grossWeight ?? item.netWeight,
            goldWeight: ["LOOSE_DIAMOND", "LOOSE_GEMSTONE", "LOOSE_PEARL"].includes(v2Piece?.profile) ? null : (v2Piece?.weights?.netGoldWeight ?? v2Piece?.grossWeight ?? item.goldWeight ?? item.netWeight),
            price: inventoryV2PriceMappingService.resolveAssetSellingPrice({ piece: v2Piece, item }),
            // Phase 15G — capitalised book cost (legacy unless non-recoverable VAT).
            cost: effectiveCost,
            branch: branch.name,
            branchId: branch.id,
            location: v2Piece?.location || item.location || "",
            locationId: v2Piece?.locationId || null,
            status: "available",
            ...barcodeIdentity,
            inventorySubtype: v2Piece?.inventorySubtype || inventoryV2Runtime.legacySubtypeForProfile(v2Piece?.profile) || item.inventorySubtype || null,
            metadataSchemaVersion: v2Piece?.metadataSchemaVersion || item.metadataSchemaVersion || 1,
            metadata: v2Piece ? {
              ...(v2Piece.metadata || item.metadata || {}),
              profileContract: {
                goldColor: v2Piece.goldColor,
                supplierReference: v2Piece.supplierReference,
                locationId: v2Piece.locationId,
                rfid: v2Piece.rfid,
                certificate: v2Piece.certificate,
              },
            } : (item.metadata || {}),
            source: "supplier_purchase",
            notes: [v2Piece?.notes, item.notes, body.notes, `Supplier: ${supplier.name}`, `Purchase: ${purchaseOrderId}`, drcNote].filter(Boolean).join(" | "),
            ...(v2Piece ? {
              inventoryProfile: v2Piece.profile,
              operationalStatus: "AVAILABLE",
              condition: v2Piece.condition,
              conditionClassification: v2Piece.condition === null ? "V2_PROFILE_NULLABLE" : "V2_EXPLICIT",
              tagState: "PENDING",
              tagStateClassification: "V2_RECEIPT_INITIAL",
              description: v2Piece.description,
              brand: v2Piece.brand || null,
              model: v2Piece.model || null,
              modelNumber: v2Piece.modelNumber || null,
              supplierId: supplier.id,
              purchaseDate: dateStr,
              createdBy: req.user?.id || null,
              updatedBy: req.user?.id || null,
            } : {}),
            // Phase 15E snapshot + Phase 15F governed override (legacy Asset.cost
            // unchanged).
            ...assetSnap
          }, { transaction: t });
          createdAssets.push(asset.toJSON());

          // A purchase-rate override is an authorized acquisition decision,
          // not a silent client-controlled field.  Keep the immutable
          // evidence in the canonical audit chain; never persist the
          // transport-only marker on Asset metadata.
          if (v2Piece?.__purchaseRateOverride) {
            const override = v2Piece.__purchaseRateOverride;
            await auditService.record(req.companyId, {
              action: "supplier_purchase_rate.override",
              description: `Supplier gold purchase rate override approved for asset ${asset.id}`,
              user: actor,
              userId: req.user?.id || null,
              place: branch.name,
              branch: branch.name,
              sourceDocument: purchaseOrderId,
              severity: "warning",
              before: JSON.stringify({
                assetId: asset.id,
                profile: v2Piece.profile,
                karat: v2Piece.karat,
                referenceRate: override.referenceRate,
              }),
              after: JSON.stringify({
                assetId: asset.id,
                approvedPurchaseRate: override.approvedPurchaseRate,
                reason: override.reason,
                source: "MANUAL_OVERRIDE",
              }),
              requiredPermission: "inventory.adjust",
              requestedOperation: "supplier_purchase_rate_override",
              authorizationResult: "allowed",
              operatorReason: override.reason,
            }, { transaction: t });
          }

          const receiptEvent = v2Piece
            ? await inventoryV2Runtime.recordAssetEvent({
              models, transaction: t, asset: asset.toJSON(),
              context: { companyId: req.companyId, branchId: branch.id, branchName: branch.name, actorId: req.user?.id || null, actorName: actor, occurredAt: now },
              eventType: "PURCHASE_RECEIVED", newStatus: "AVAILABLE", sourceType: "PURCHASE_ORDER", sourceId: purchaseOrderId,
              note: `Received V2 Asset from supplier ${supplier.name} under PO ${purchaseOrderId}`, idempotencyKey: `${idempotencyKey}:${assetId}`,
            })
            : await models.AssetEvent.create({
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
          if (v2Piece) {
            const evidenceContext = { companyId: req.companyId, branchId: branch.id, branchName: branch.name, supplierId: supplier.id, purchaseDate: dateStr, currency: settings.currency, vatRateDefault: settings.purchaseVatRate ?? settings.vatRate ?? null, actorId: req.user?.id || null, actorName: actor, occurredAt: now };
            await inventoryV2Runtime.persistReceiptEvidence({ models, transaction: t, asset: asset.toJSON(), poItem: poItem.toJSON(), piece: v2Piece, pieceIndex: qtyIndex, context: evidenceContext });
            await inventoryV2Runtime.recordMovement({ models, transaction: t, asset: asset.toJSON(), context: evidenceContext, movementType: "PURCHASE_RECEIVE", sourceType: "PURCHASE_ORDER", sourceId: purchaseOrderId, eventId: receiptEvent.id, toBranchId: branch.id, toLocationId: asset.locationId || null });
          }
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
        tax: { taxBase: taxBaseSnap, vatRate: vatRateSnap, inputVatAmount: inputVatSnap, taxIncluded: taxIncludedSnap, isRecoverable: isRecoverableSnap, isRcm: isRcmSnap, rcmVatAmount: rcmVatSnap, rcmRate: rcmRateSnap, taxTreatment: requestedTaxTreatment, taxSnapshot }
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

    // 3. Amount + account validation. Supplier settlement is always 2DP AED;
    // the PO/tax economic history remains 8DP and is not used as the payment
    // authority.
    const amount = supplierPaymentState.round2(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError("Payment amount must be a finite number greater than zero.");
    }
    const account = normalizeTreasuryAccount(b.account, "account");
    const paymentBranchId = po.branchId || req.branchId;
    const treasuryAccount = await resolveTreasuryAccount(req.companyId, paymentBranchId, account, { transaction: t });
    const supplierPayableAccount = await financialAccountResolver.resolveRequiredBranchFinancialAccount({
      companyId: req.companyId,
      branchId: paymentBranchId,
      mappingRole: "SUPPLIER_PAYABLE",
      transaction: t,
    });
    const date = b.date && isValidYmd(String(b.date)) ? String(b.date) : new Date().toISOString().slice(0, 10);
    if (b.date && !isValidYmd(String(b.date))) {
      throw new ValidationError("Invalid 'date' (expected YYYY-MM-DD).");
    }

    // 4. Posted AP from the canonical purchase journal, then effective
    // allocations (payments minus append-only reversals), all at 2DP.
    const payableMap = await supplierPaymentState.postedPayableByReference(models, req.companyId, [po.id], t);
    const originalPayable = payableMap.get(po.id);
    if (!Number.isFinite(originalPayable)) {
      throw new AppError("The posted supplier payable amount is unavailable for this purchase order.", 422, "POSTED_AP_AMOUNT_REQUIRED");
    }
    const paidMap = await supplierPaymentState.paidByReference(models, req.companyId, [po.id], t);
    const paidSoFarBefore = supplierPaymentState.round2(paidMap.get(po.id) || 0);
    const remainingBefore = supplierPaymentState.round2(originalPayable - paidSoFarBefore);

    // 5. Overpayment / nothing-due guards.
    if (remainingBefore <= 0) {
      throw new ValidationError(`Purchase order ${po.id} is already fully paid (paid ${paidSoFarBefore} of ${originalPayable}).`);
    }
    if (amount > remainingBefore) {
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
      counterAccountCode: supplierPayableAccount.code,
      description: b.note ? String(b.note) : `سداد للمورّد عن أمر الشراء ${po.id}`,
      reference: po.id,
      branch: po.branch || req.branchId || "Main Branch",
      branchId: paymentBranchId,
      date,
      createdBy: actor,
      status: "posted",
      idempotencyKey: String(idempotencyKey),
    }, { transaction: t });

    const journalEntry = await postingService.postCashEntry(cashTx.toJSON(), actor, {
      transaction: t,
      treasuryAccountId: treasuryAccount.id,
      counterAccountId: supplierPayableAccount.id,
    });
    await cashTx.update({ journalEntryId: journalEntry.id }, { transaction: t });

    const paidSoFarAfter = supplierPaymentState.round2(paidSoFarBefore + amount);
    const remainingAfter = supplierPaymentState.round2(originalPayable - paidSoFarAfter);

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
      before: JSON.stringify({ purchaseOrderId: po.id, supplierId: po.supplierId, originalPayable, paidSoFarBefore, remainingBefore }),
      after: JSON.stringify({ purchaseOrderId: po.id, supplierId: po.supplierId, amount, paidSoFarAfter, remainingAfter, cashTransactionId: cashTx.id, journalEntryId: journalEntry.id }),
    }, { transaction: t });

    // Reference-only supplier due (never used for the computation, never written).
    const supplierRow = await models.Supplier.findByPk(po.supplierId, { transaction: t });

    const output = {
      purchaseOrder: { id: po.id, supplierId: po.supplierId, total: po.total, originalPayable },
      payment: {
        id: cashTx.id,
        amount,
        account,
        category: "supplier_purchase",
        reference: po.id,
        journalEntryId: journalEntry.id,
        idempotencyKey: String(idempotencyKey),
      },
      originalPayable,
      paid: paidSoFarAfter,
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

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIER PAYMENT REVERSAL — append-only financial reversal.
// The original cash transaction and journal remain immutable. A new cash_in
// transaction and balanced cash_transaction journal reverse Dr AP / Cr Cash
// into Dr Cash / Cr AP. The reversal journal links to the original via the
// existing JournalEntry.reversalOf field; payment state and statement consume
// the reversal as an effective negative allocation.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/purchase-orders/:poId/payments/:paymentId/reverse", authMiddleware, requireBusinessPermission("treasury.update", { touch: true }), async (req, res, next) => {
  const b = req.body || {};
  const idempotencyKey = req.headers["idempotency-key"] || b.idempotencyKey;
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    return next(new ValidationError("Idempotency-Key header is required for supplier payment reversals."));
  }
  const reason = String(b.reason || "").trim();
  if (!reason) return next(new ValidationError("A reason is required to reverse a supplier payment."));

  const idemScope = "purchase.payment.reversal";
  const idemRequestHash = idempotencyService.hashRequest(idemScope, b, req.params);
  const t = await models.sequelize.transaction();
  try {
    const idemClaim = await idempotencyService.claim({
      models,
      companyId: req.companyId,
      scope: idemScope,
      key: idempotencyKey,
      requestHash: idemRequestHash,
      transaction: t,
    });
    if (!idemClaim.claimed) {
      try { await t.rollback(); } catch (_) { /* aborted by unique violation */ }
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: idempotencyKey, requestHash: idemRequestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
      return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
    }
    const idemRequest = idemClaim.request;

    const po = await models.PurchaseOrder.findOne({
      where: { id: req.params.poId, companyId: req.companyId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!po) throw new NotFoundError("Purchase order not found.");
    const supplier = await models.Supplier.findOne({ where: { id: po.supplierId, companyId: req.companyId }, transaction: t });
    if (!supplier) throw new NotFoundError("Supplier for this purchase order was not found.");

    const payment = await models.CashTransaction.findOne({
      where: {
        id: req.params.paymentId,
        companyId: req.companyId,
        type: "cash_out",
        category: "supplier_purchase",
        reference: po.id,
      },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!payment) throw new NotFoundError("Supplier payment was not found for this purchase order.");
    if (payment.status !== "posted") throw new ConflictError("Only posted supplier payments can be reversed.");
    if (!payment.journalEntryId) throw new AppError("Supplier payment has no posted journal.", 422, "SUPPLIER_PAYMENT_JOURNAL_REQUIRED");

    const originalJournal = await models.JournalEntry.findOne({
      where: { id: payment.journalEntryId, companyId: req.companyId, sourceType: "cash_transaction", sourceId: payment.id },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!originalJournal || originalJournal.status !== "posted") {
      throw new ConflictError("Supplier payment journal is not currently reversible.");
    }
    if (supplierPaymentState.round2(originalJournal.totalDebit) !== supplierPaymentState.round2(originalJournal.totalCredit)) {
      throw new ValidationError("An unbalanced supplier payment journal cannot be reversed.");
    }
    const existingReversal = await models.JournalEntry.findOne({
      where: { companyId: req.companyId, reversalOf: originalJournal.id },
      transaction: t,
    });
    if (existingReversal) throw new ConflictError("This supplier payment has already been reversed.");

    const paymentBranchId = payment.branchId || req.branchId;
    await resolveAuthorizedBranchId(req, paymentBranchId, { required: true, transaction: t });
    const account = normalizeTreasuryAccount(payment.account, "account");
    const treasuryAccount = await resolveTreasuryAccount(req.companyId, paymentBranchId, account, { transaction: t });
    const supplierPayableAccount = await financialAccountResolver.resolveRequiredBranchFinancialAccount({
      companyId: req.companyId,
      branchId: paymentBranchId,
      mappingRole: "SUPPLIER_PAYABLE",
      transaction: t,
    });

    const payableMap = await supplierPaymentState.postedPayableByReference(models, req.companyId, [po.id], t);
    const originalPayable = payableMap.get(po.id);
    if (!Number.isFinite(originalPayable)) throw new AppError("The posted supplier payable amount is unavailable.", 422, "POSTED_AP_AMOUNT_REQUIRED");
    const paidMap = await supplierPaymentState.paidByReference(models, req.companyId, [po.id], t);
    const paidBefore = supplierPaymentState.round2(paidMap.get(po.id) || 0);
    const reversalAmount = supplierPaymentState.round2(payment.amount);
    if (reversalAmount <= 0 || reversalAmount > paidBefore) {
      throw new ConflictError("Supplier payment reversal would produce an invalid effective allocation.");
    }

    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const reversalTx = await models.CashTransaction.create({
      id: `TX-REV-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId: req.companyId,
      type: "cash_in",
      account,
      amount: reversalAmount,
      category: "supplier_payment_reversal",
      counterAccountCode: supplierPayableAccount.code,
      description: `عكس سداد المورد ${payment.id} عن أمر الشراء ${po.id}: ${reason}`,
      reference: po.id,
      branch: payment.branch || po.branch || req.branchId || "Main Branch",
      branchId: paymentBranchId,
      date: new Date().toISOString().slice(0, 10),
      createdBy: actor,
      status: "posted",
      idempotencyKey: String(idempotencyKey),
    }, { transaction: t });

    const reversalJournal = await postingService.postCashEntry(reversalTx.toJSON(), actor, {
      transaction: t,
      treasuryAccountId: treasuryAccount.id,
      counterAccountId: supplierPayableAccount.id,
    });
    // postCashEntry/postEntry returns a plain JSON journal snapshot. Re-load
    // the persisted row inside the same transaction before attaching the
    // reversal lineage; changing the global posting-service return contract
    // would broaden this focused reversal fix to unrelated callers.
    const persistedReversalJournal = await models.JournalEntry.findOne({
      where: { id: reversalJournal.id, companyId: req.companyId, sourceType: "cash_transaction", sourceId: reversalTx.id },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!persistedReversalJournal) throw new AppError("Reversal journal was not persisted.", 500, "SUPPLIER_REVERSAL_JOURNAL_REQUIRED");
    await persistedReversalJournal.update({ reversalOf: originalJournal.id }, { transaction: t });
    await reversalTx.update({ journalEntryId: reversalJournal.id }, { transaction: t });

    const paidAfter = supplierPaymentState.round2(paidBefore - reversalAmount);
    const outstandingAfter = supplierPaymentState.round2(originalPayable - paidAfter);
    await auditService.record(req.companyId, {
      action: "supplier.payment.reversal",
      description: `Supplier payment reversal ${payment.id} for PO ${po.id}`,
      user: actor,
      userId: req.user ? req.user.id : null,
      place: payment.branch || po.branch,
      branch: payment.branch || po.branch,
      sourceDocument: po.id,
      severity: "info",
      before: JSON.stringify({ purchaseOrderId: po.id, supplierId: po.supplierId, paymentId: payment.id, originalPayable, paidBefore, outstandingBefore: supplierPaymentState.round2(originalPayable - paidBefore) }),
      after: JSON.stringify({ purchaseOrderId: po.id, supplierId: po.supplierId, paymentId: payment.id, reversalPaymentId: reversalTx.id, reversalJournalId: reversalJournal.id, amount: reversalAmount, reason, paidAfter, outstandingAfter }),
    }, { transaction: t });

    const output = {
      purchaseOrder: { id: po.id, supplierId: po.supplierId, originalPayable },
      originalPayment: { id: payment.id, amount: reversalAmount, journalEntryId: originalJournal.id },
      reversal: { id: reversalTx.id, amount: reversalAmount, journalEntryId: reversalJournal.id, reversalOf: originalJournal.id, reason, idempotencyKey: String(idempotencyKey) },
      paid: paidAfter,
      remainingAfter: outstandingAfter,
    };
    const idemResponseBody = { success: true, data: output, meta: { supplierDueUpdated: false, paymentReversal: true } };
    await idempotencyService.succeed({ request: idemRequest, statusCode: 201, responseBody: idemResponseBody, transaction: t });
    await t.commit();

    emitEntityChanged(req.companyId, { entity: "Treasury", action: "create", id: reversalTx.id, related: { supplierId: po.supplierId, purchaseOrderId: po.id, reversedPaymentId: payment.id } });
    emitEntityChanged(req.companyId, { entity: "Accounting", action: "create", id: reversalJournal.id, related: { supplierId: po.supplierId, purchaseOrderId: po.id, reversedPaymentId: payment.id } });
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
    const taxPolicy = await companyTaxPolicyService.getCompanyTaxPolicy(req.companyId);
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
        reservationExpiryWarningHours: normalized.reservationExpiryWarningHours,
        taxPolicy
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

const TAX_POLICY_INPUT_KEYS = new Set([
  "vatRegistered",
  "vatRate",
  "vatEnabled",
  "enabledTaxTreatments",
  "defaultTaxTreatment",
  "preciousGoodsRcmEnabled",
]);

function hasTaxPolicyInput(body) {
  return Object.keys(body || {}).some((key) => TAX_POLICY_INPUT_KEYS.has(key));
}

function isTaxPolicyOnlyInput(body) {
  const keys = Object.keys(body || {});
  return keys.length > 0 && keys.every((key) => TAX_POLICY_INPUT_KEYS.has(key));
}

async function hasFrozenTaxPolicyAuthority(user) {
  if (!user) return false;
  if (user.accountType === "super_admin" || ["admin", "owner", "accountant"].includes(user.role)) return true;
  const roles = await permissionService.getUserRoles(user);
  return roles.some((role) => role.isAdmin === true || ["admin", "owner", "accountant"].includes(role.slug));
}

const authorizeSettingsUpdate = async (req, _res, next) => {
  try {
    const canUpdateAllSettings = await permissionService.userHasPermission(req.user, "settings.update");
    if (canUpdateAllSettings) {
      if (hasTaxPolicyInput(req.body) && !(await hasFrozenTaxPolicyAuthority(req.user))) {
        return next(new ForbiddenError("Tax policy changes require Admin, Owner, or Accounting authority."));
      }
      return next();
    }

    // Accounting has settings.view but not the broad settings.update grant in
    // the immutable catalog. Permit only a tax-policy-only payload here.
    if (isTaxPolicyOnlyInput(req.body) && await hasFrozenTaxPolicyAuthority(req.user)) return next();

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

    let taxPolicyUpdate = null;
    if (hasTaxPolicyInput(body)) {
      if (!isTaxPolicyOnlyInput(body) && !(await permissionService.userHasPermission(req.user, "settings.update"))) {
        throw new ForbiddenError("Accounting tax-policy writes cannot be mixed with general settings changes.");
      }
      taxPolicyUpdate = await companyTaxPolicyService.updateCompanyTaxPolicy({
        companyId: req.companyId,
        patch: body,
      });
    }

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

    const settingKeys = ["language", "theme", "vatRate", "goldKaratDefaults", "goldPricingMode", "accountingByKarat", "invoicePrefix", "invoiceNumbering", "dateFormat", "decimalPrecision", "print", "notifications", "lowStockThreshold", "receipt", "allowZeroDownPayment", "paymentMethods", "installmentEnabled", "installmentDefaultFrequency", "installmentMaxCount", "installmentMinDownPaymentPercent", "barcode", "reservationAdvancesAccountId", "vatEnabled", "purchaseVatRate", "purchaseTaxIncludedDefault", "purchaseVatRecoverableDefault", "inputVatAccountCode", "rcmOutputAccountCode", "goldCostSource", "goldCostWeightBasis", "allowGoldCostOverride", "goldCostOverridePermission", "nonRecoverableVatCapitalization", "reservationExpiryWarningHours"].filter((key) => !companyTaxPolicyService.POLICY_SETTING_KEYS.includes(key));
    for (const key of settingKeys) {
      if (body[key] === undefined) continue;
      const [row, created] = await models.Setting.findOrCreate({
        where: { companyId: req.companyId, key },
        defaults: { companyId: req.companyId, key, value: body[key] }
      });
      if (!created) await row.update({ value: body[key] });
    }

    if (taxPolicyUpdate) {
      const actor = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.id;
      const before = JSON.stringify(taxPolicyUpdate.before);
      const after = JSON.stringify(taxPolicyUpdate.after);
      if (taxPolicyUpdate.before.vatRegistered !== taxPolicyUpdate.after.vatRegistered) {
        await auditService.record(req.companyId, {
          action: "company.vat_registration.updated",
          description: "Company VAT registration status updated",
          user: actor,
          userId: req.user.id,
          place: req.branchId || "System",
          sourceDocument: "company-tax-policy",
          severity: "info",
          before,
          after,
        });
      }
      await auditService.record(req.companyId, {
        action: "company.tax_policy.updated",
        description: "Company tax policy updated",
        user: actor,
        userId: req.user.id,
        place: req.branchId || "System",
        sourceDocument: "company-tax-policy",
        severity: "info",
        before,
        after,
      });
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
    const customer = await requireBranchCustomerResource({ companyId: req.companyId, branchId: req.branchId, customerId });

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
    const customer = await requireBranchCustomerResource({ companyId: req.companyId, branchId: req.branchId, customerId });

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
    // 1. Customer must be available in the authenticated effective branch. Never modified.
    const customer = await requireBranchCustomerResource({ companyId: req.companyId, branchId: req.branchId, customerId: req.params.id });

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
    const customer = await requireBranchCustomerResource({ companyId: req.companyId, branchId: req.branchId, customerId: req.params.id });

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
    const customer = await requireBranchCustomerResource({ companyId: req.companyId, branchId: req.branchId, customerId: req.params.id });

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
    const customer = await requireBranchCustomerResource({ companyId: req.companyId, branchId: req.branchId, customerId: req.params.id });

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

  if (Object.prototype.hasOwnProperty.call(body, "accountCode")) throw new ValidationError("حساب الإيداع يحدده الخادم حسب طريقة الدفع.");

  const currency = String(body.currency || defaultCurrency || "AED").trim().toUpperCase().slice(0, 8) || "AED";
  const date = body.date ? String(body.date).trim() : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new ValidationError("تاريخ الإيداع يجب أن يكون بصيغة YYYY-MM-DD");
  }

  const description = String(body.description || "Customer deposit").trim().slice(0, 255);
  const reference = body.reference == null ? null : String(body.reference).trim().slice(0, 120) || null;
  return {
    amount,
    currency,
    paymentMethod,
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

  if (Object.prototype.hasOwnProperty.call(body, "accountCode")) throw new ValidationError("حساب رد الرصيد يحدده الخادم حسب طريقة الدفع.");

  const currency = String(body.currency || defaultCurrency || "AED").trim().toUpperCase().slice(0, 8) || "AED";
  const date = body.date ? String(body.date).trim() : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new ValidationError("تاريخ رد الرصيد يجب أن يكون بصيغة YYYY-MM-DD");
  }

  const description = String(body.description || "Customer credit refund").trim().slice(0, 255);
  const reference = body.reference == null ? null : String(body.reference).trim().slice(0, 120) || null;
  return {
    amount,
    currency,
    paymentMethod,
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

// Historical installment overpayment remediation: derives the exact overage
// from the immutable original collection history. The client supplies only the
// original payment reference; no client amount or Treasury movement is allowed.
router.post("/installment-collections/:paymentId/reclassify-overpayment", authMiddleware, requireBusinessPermission("accounting.post", { touch: true }), async (req, res, next) => {
  try {
    const effectiveBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"] || req.branchId, { required: true });
    const originalPaymentId = String(req.params.paymentId || "").trim();
    if (!originalPaymentId) throw new ValidationError("Original collection event is required.");
    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "Idempotency-Key is required for overpayment reclassification." });
    }
    const idemScope = "installment.overpayment_reclassification";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, {
      companyId: req.companyId,
      branchId: effectiveBranchId,
      originalPaymentId,
    }, req.params);
    const actor = { id: req.user?.id || null, name: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System" };
    let idemResponseBody = null;
    try {
      await models.sequelize.transaction(async (t) => {
        const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope: idemScope, key: String(idempotencyKey).trim(), requestHash: idemRequestHash, transaction: t });
        if (!claim.claimed) {
          const duplicate = new Error("__IDEM_DUPLICATE__");
          duplicate.__idemDuplicate = true;
          throw duplicate;
        }
        const result = await installmentOverpaymentReclassificationService.reclassifyInstallmentOverpayment({
          models,
          companyId: req.companyId,
          branchId: effectiveBranchId,
          originalPaymentId,
          transaction: t,
          actor,
        });
        idemResponseBody = {
          success: true,
          data: {
            customerCreditTransaction: result.creditRow,
            source: "installment_overpayment_reclassification",
            treasuryDelta: "0.0000",
          },
        };
        await idempotencyService.succeed({ request: claim.request, statusCode: 201, responseBody: idemResponseBody, transaction: t });
      });
    } catch (error) {
      if (error?.__idemDuplicate) {
        const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: idemScope, key: String(idempotencyKey).trim(), requestHash: idemRequestHash });
        if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
        return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
      }
      throw error;
    }
    emitEntityChanged(req.companyId, {
      entity: "CustomerCreditTransaction",
      action: "installment-overpayment-reclassification",
      id: idemResponseBody?.data?.customerCreditTransaction?.id,
      branchId: effectiveBranchId,
    });
    return res.status(201).json(idemResponseBody);
  } catch (error) {
    next(error);
  }
});

// Historical installment precision remediation. The client supplies only the
// immutable original Payment reference. The service derives and validates the
// exact mismatch, mapped Treasury account, AR account, and correction Journal;
// no Treasury row or original financial row is rewritten.
router.post("/installment-collections/:paymentId/remediate-precision", authMiddleware, requireBusinessPermission("accounting.post", { touch: true }), async (req, res, next) => {
  try {
    const effectiveBranchId = await resolveAuthorizedBranchId(req, req.headers["x-branch-id"] || req.branchId, { required: true });
    const originalPaymentId = String(req.params.paymentId || "").trim();
    if (!originalPaymentId) throw new ValidationError("Original collection event is required.");
    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "Idempotency-Key is required for installment precision remediation." });
    }

    const idemScope = "installment.precision_remediation";
    const reason = String(req.body?.reason || "").trim().slice(0, 200);
    const idemRequestHash = idempotencyService.hashRequest(idemScope, {
      companyId: req.companyId,
      branchId: effectiveBranchId,
      originalPaymentId,
      reason,
    }, req.params);
    const actor = { id: req.user?.id || null, name: req.user ? `${req.user.firstName} ${req.user.lastName}` : "System" };
    let idemResponseBody = null;
    try {
      await models.sequelize.transaction(async (t) => {
        const claim = await idempotencyService.claim({
          models,
          companyId: req.companyId,
          scope: idemScope,
          key: String(idempotencyKey).trim(),
          requestHash: idemRequestHash,
          transaction: t,
        });
        if (!claim.claimed) {
          const duplicate = new Error("__IDEM_DUPLICATE__");
          duplicate.__idemDuplicate = true;
          throw duplicate;
        }

        const result = await installmentPrecisionRemediationService.remediateInstallmentPrecision({
          models,
          companyId: req.companyId,
          branchId: effectiveBranchId,
          originalPaymentId,
          transaction: t,
          actor,
        });
        idemResponseBody = {
          success: true,
          data: {
            ...result,
            reason: "installment precision remediation",
          },
        };
        await idempotencyService.succeed({ request: claim.request, statusCode: 201, responseBody: idemResponseBody, transaction: t });
      });
    } catch (error) {
      if (error?.__idemDuplicate) {
        const prior = await idempotencyService.resolveExisting({
          models,
          companyId: req.companyId,
          scope: idemScope,
          key: String(idempotencyKey).trim(),
          requestHash: idemRequestHash,
        });
        if (prior.state === "replay") return res.status(prior.statusCode || 200).json(prior.responseBody);
        return res.status(prior.statusCode || 409).json({ success: false, message: prior.message });
      }
      throw error;
    }

    emitEntityChanged(req.companyId, {
      entity: "JournalEntry",
      action: "installment-precision-remediation",
      id: idemResponseBody?.data?.journalEntryId,
      branchId: effectiveBranchId,
    });
    return res.status(201).json(idemResponseBody);
  } catch (error) {
    next(error);
  }
});

router.post("/customers/:id/credit/deposit", authMiddleware, requireBusinessPermission("treasury.update", { touch: true }), async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const payload = normalizeCustomerDepositPayload(req, settings.currency || "AED");
    const effectiveBranchId = await resolveAuthorizedBranchId(req, req.body?.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لإيداع رصيد دائن للعميل" });
    }

    const idemScope = "customer.credit_deposit";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, {
      customerId: req.params.id,
      companyId: req.companyId,
      branchId: effectiveBranchId,
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

        const branch = await resolveAuthorizedBranch(req, effectiveBranchId, { required: true, transaction: t });
        const customer = await requireBranchCustomerResource({ companyId: req.companyId, branchId: branch.id, customerId: req.params.id, transaction: t, lock: true });
        const depositAccount = await companyBootstrapService.resolveSystemAccountRole(req.companyId, branch.id, companyBootstrapService.SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY, t);
        const treasuryAccount = await resolveTreasuryAccount(req.companyId, branch.id, payload.paymentMethod, { transaction: t });
        if (customer.status && customer.status !== "active") {
          throw new ValidationError("لا يمكن تسجيل إيداع لعميل غير نشط");
        }

        const cashTransaction = await models.CashTransaction.create({
          id: `CT-CDEP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: req.companyId,
          type: "cash_in",
          account: payload.paymentMethod,
          amount: payload.amount,
          category: "customer_credit_deposit",
          counterAccountCode: depositAccount.code,
          description: payload.description,
          reference: payload.reference || customer.id,
          branch: branch.name,
          branchId: branch.id,
          date: payload.date,
          createdBy: actorId,
          status: "posted",
          idempotencyKey: idempotencyKey || null,
        }, { transaction: t });

        const creditRow = await customerCreditService.recordCreditIn({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          branchId: branch.id,
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
            treasurySource: payload.paymentMethod,
            depositAccountId: depositAccount.id,
          },
          transaction: t,
          glPosting: {
            enabled: true,
            debitAccountId: treasuryAccount.id,
            creditAccountId: depositAccount.id,
            customerDepositAccountId: depositAccount.id,
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
          place: branch.name,
          branch: branch.name,
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
      branchId: effectiveBranchId,
      related: { customerId: req.params.id },
    });
    emitEntityChanged(req.companyId, {
      entity: "CashTransaction",
      action: "customer-credit-deposit",
      id: idemResponseBody?.data?.cashTransaction?.id,
      branchId: effectiveBranchId,
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
    const effectiveBranchId = await resolveAuthorizedBranchId(req, req.body?.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey;
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      return res.status(400).json({ success: false, message: "مفتاح منع التكرار (Idempotency-Key) مطلوب لرد الرصيد الدائن للعميل" });
    }

    const idemScope = "customer.credit_refund";
    const idemRequestHash = idempotencyService.hashRequest(idemScope, {
      customerId: req.params.id,
      companyId: req.companyId,
      branchId: effectiveBranchId,
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

        const branch = await resolveAuthorizedBranch(req, effectiveBranchId, { required: true, transaction: t });
        const customer = await requireBranchCustomerResource({ companyId: req.companyId, branchId: branch.id, customerId: req.params.id, transaction: t, lock: true });
        const depositAccount = await companyBootstrapService.resolveSystemAccountRole(req.companyId, branch.id, companyBootstrapService.SYSTEM_ACCOUNT_ROLES.CUSTOMER_DEPOSIT_LIABILITY, t);
        const treasuryAccount = await resolveTreasuryAccount(req.companyId, branch.id, payload.paymentMethod, { transaction: t });
        if (customer.status && customer.status !== "active") {
          throw new ValidationError("لا يمكن رد رصيد لعميل غير نشط");
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
          counterAccountCode: depositAccount.code,
          description: payload.description,
          reference: payload.reference || customer.id,
          branch: branch.name,
          branchId: branch.id,
          date: payload.date,
          createdBy: actorId,
          status: "posted",
          idempotencyKey: idempotencyKey || null,
        }, { transaction: t });

        const creditRow = await customerCreditService.recordCreditOut({
          models,
          companyId: req.companyId,
          customerId: customer.id,
          branchId: branch.id,
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
            treasurySource: payload.paymentMethod,
            depositAccountId: depositAccount.id,
          },
          transaction: t,
          glPosting: {
            enabled: true,
            debitAccountId: depositAccount.id,
            creditAccountId: treasuryAccount.id,
            customerDepositAccountId: depositAccount.id,
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
          place: branch.name,
          branch: branch.name,
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
      branchId: effectiveBranchId,
      related: { customerId: req.params.id },
    });
    emitEntityChanged(req.companyId, {
      entity: "CashTransaction",
      action: "customer-credit-refund",
      id: idemResponseBody?.data?.cashTransaction?.id,
      branchId: effectiveBranchId,
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

// Monetary collection values are stored as DECIMAL(15,4). Keep installment
// validation in integer ten-thousandths so a binary floating-point tolerance
// can never accept more than the persisted outstanding amount.
const MONEY_TEN_THOUSANDTHS = 10000n;
const MONEY_DECIMAL_15_4 = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
function moneyToTenThousandths(value) {
  const text = String(value ?? "").trim();
  if (!MONEY_DECIMAL_15_4.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * MONEY_TEN_THOUSANDTHS + BigInt(`${fraction}0000`.slice(0, 4));
}
function moneyFromTenThousandths(units) {
  const whole = units / MONEY_TEN_THOUSANDTHS;
  const fraction = (units % MONEY_TEN_THOUSANDTHS).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}
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

router.get("/accounts/:id/statement", authMiddleware, requireBusinessPermission("accounting.view"), async (req, res, next) => {
  try {
    // 1. Account must exist within the tenant. Never modified.
    const account = await models.Account.findOne({
      where: { id: req.params.id, companyId: req.companyId },
    });
    if (!account) throw new NotFoundError("Account not found.");

    // 2. Validate the optional date window.
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.headers["x-branch-id"], { required: true });
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
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId, { required: true });
    if (from && !isValidYmd(from)) throw new ValidationError("Invalid 'from' date (expected YYYY-MM-DD).");
    if (to && !isValidYmd(to)) throw new ValidationError("Invalid 'to' date (expected YYYY-MM-DD).");
    if (from && to && from > to) throw new ValidationError("'from' must not be after 'to'.");
    await ledgerReportingService.assertReportableLedgerIntegrity({ companyId: req.companyId, branchId });

    const [cashAccount, bankAccount] = await Promise.all([
      resolveTreasuryAccount(req.companyId, branchId, "cash"),
      resolveTreasuryAccount(req.companyId, branchId, "bank"),
    ]);
    const accountSpecs = [
      { key: "cash", code: cashAccount.code, accountId: cashAccount.id, label: "Cash Treasury" },
      { key: "bank", code: bankAccount.code, accountId: bankAccount.id, label: "Bank Account" },
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
          accountRoles: ["CASH_TREASURY", "BANK_ACCOUNT"],
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
    // Phase 17B/settlement closure — state is based on the posted AP line and
    // effective 2DP payment allocations, never the raw 8DP PO total.
    const paidMap = await supplierPaymentState.paidByReference(models, req.companyId, pos.map((p) => p.id));
    const payableMap = await supplierPaymentState.postedPayableByReference(models, req.companyId, pos.map((p) => p.id));
    const historyMap = await supplierPaymentState.paymentHistoryByReference(models, req.companyId, pos.map((p) => p.id));
    const items = pos.map((p) => ({
      ...p.toJSON(),
      ...supplierPaymentState.computePoPaymentState(p, paidMap.get(p.id) || 0, payableMap.get(p.id) || 0),
      paymentHistory: historyMap.get(p.id) || [],
    }));
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

    // 5. Source 2 — supplier payments and append-only reversals, linked to THIS
    //    supplier via reference -> PO id. We resolve POs with paranoid:false so
    //    a soft-deleted order still maps its payment evidence to the supplier.
    const payTx = await models.CashTransaction.findAll({
      where: {
        companyId: req.companyId,
        [Op.or]: [
          { type: "cash_out", category: "supplier_purchase" },
          { type: "cash_in", category: "supplier_payment_reversal" },
        ],
      },
      attributes: ["id", "amount", "reference", "date", "createdAt", "description", "type", "category"],
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

    const postedPayableMap = await supplierPaymentState.postedPayableByReference(models, req.companyId, pos.map((p) => p.id));

    // 6. Unify into ledger rows. Supplier-payable convention: a receipt raises
    //    what we owe (credit); a payment lowers it (debit); a reversal reopens it.
    const rowsAll = [];
    for (const po of pos) {
      const amount = supplierPaymentState.round2(postedPayableMap.get(po.id) || 0);
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
      const amount = supplierPaymentState.round2(tx.amount);
      const isReversal = tx.type === "cash_in" && tx.category === "supplier_payment_reversal";
      rowsAll.push({
        id: `TX-${tx.id}`,
        type: isReversal ? "supplier_payment_reversal" : "supplier_payment",
        sourceId: tx.id,
        sourceNumber: tx.reference || tx.id,
        date: (tx.date || "").slice(0, 10),
        createdAt: tx.createdAt,
        description: tx.description || `سداد للمورّد (${tx.reference})`,
        debit: isReversal ? 0 : amount,
        credit: isReversal ? amount : 0,
        sortType: isReversal ? "2_reversal" : "1_payment",
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
      const delta = supplierPaymentState.round2(r.credit - r.debit);
      if (from && r.date < from) {
        openingBalance = supplierPaymentState.round2(openingBalance + delta);
        continue;
      }
      if (to && r.date > to) continue;
      periodRows.push({ ...r, delta });
    }

    let running = openingBalance;
    const withRunning = periodRows.map((r) => {
      running = supplierPaymentState.round2(running + r.delta);
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
    const supplierDueReference = supplierPaymentState.round2(supplier.due);
    const difference = supplierPaymentState.round2(supplierDueReference - closingBalance);

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

router.post("/suppliers/:id/documents", authMiddleware, requireAnyBusinessPermission(["suppliers.update"], { touch: true }), uploadMiddleware.single("file"), async (req, res, next) => {
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
    const hasPermission = await permissionService.userHasAnyPermission(req.user, ["suppliers.update"]);
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

router.delete("/suppliers/:id/documents/:docId", authMiddleware, requireAnyBusinessPermission(["suppliers.update"], { touch: true }), async (req, res, next) => {
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
    const hasPermission = await permissionService.userHasAnyPermission(req.user, ["suppliers.update"]);
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
    const { assetIds = [], discount = 0, makingCharge = 0, makingChargePerGram = null, stoneValue = 0 } = req.body || {};
    const branchId = await resolveAuthorizedBranchId(req, req.body?.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });

    const products = await models.Product.findAll({
      where: { id: assetIds, companyId: req.companyId, branchId }
    });

    const assets = await models.Asset.findAll({
      where: { id: assetIds, companyId: req.companyId, branchId }
    });

    const settings = await settingsService.getCompanySettings(req.companyId);
    const canonicalGoldRateCache = { rates: new Map(), snapshots: new Map() };
    const itemsMap = new Map();
    const dynamicGoldAssetIds = new Set();
    let dynamicGoldSubtotal = 0;
    let dynamicGoldTax = 0;
    let dynamicGoldMakingTotal = 0;
    products.forEach(p => itemsMap.set(p.id, { price: Number(p.salePrice) || 0, cost: Number(p.unitCost) || 0 }));
    for (const asset of assets) {
      let price = Number(asset.price) || 0;
      const profile = asset.inventoryProfile || asset.profile;
      if (["CGP_CUSTOMER_GOLD_PURCHASE", "GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K"].includes(profile)) {
        const sellingGoldRate = await goldSalePricingService.resolveCanonicalSellingGoldRate({
          models,
          companyId: req.companyId,
          currency: settings.currency || "AED",
          karat: asset.karat,
          cache: canonicalGoldRateCache,
        });
        const pricing = await goldSalePricingService.calculateGoldSalePriceForAsset({
          asset,
          models,
          companyId: req.companyId,
          itemInput: {
            ...((profile === "GOLD_BY_WEIGHT_JEWELLERY" || profile === "GOLD_BAR_24K") ? { sellingGoldRate } : {}),
            sellingGoldRate,
            makingChargePerGram: makingChargePerGram === null || makingChargePerGram === "" ? 0 : makingChargePerGram,
          },
          configuredVatRate: settings.vatRate,
        });
        dynamicGoldAssetIds.add(asset.id);
        // The canonical gold pricing service already includes making and
        // certificate retail charges in subtotal.  Do not fall back to the
        // persisted acquisition Asset.price.
        price = Number(pricing?.subtotal || pricing?.goldValue || 0);
        dynamicGoldSubtotal += price;
        dynamicGoldTax += Number(pricing?.vatAmount || 0);
        dynamicGoldMakingTotal += Number(pricing?.makingTotal || 0);
      }
      itemsMap.set(asset.id, { price, cost: Number(asset.cost) || 0 });
    }

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

    const totalMakingCharge = makingChargePerGram !== null && makingChargePerGram !== undefined && makingChargePerGram !== ""
      ? assets.filter((asset) => !dynamicGoldAssetIds.has(asset.id)).reduce((sum, asset) => sum + Number(calculateMakingChargeTotal({ itemWeightGrams: asset.grossWeight, makingChargePerGram })), 0)
      : Number(makingCharge) || 0;
    // Dynamic gold lines already include their profile-authoritative making
    // amount in basePrice; expose it without adding it again to the tax base.
    const reportedTotalMakingCharge = dynamicGoldMakingTotal + totalMakingCharge;

    // Gold line VAT is already resolved by the canonical profile calculator:
    // 24K taxes certificate only, while weight jewellery taxes its subtotal.
    // Non-gold lines continue through the shared settings VAT calculation.
    const vatRatePercent = Number(settings.vatRate) || 0;
    const nonGoldSubtotal = Math.max(0, basePrice - dynamicGoldSubtotal);
    const taxBase = Math.max(0, basePrice + totalMakingCharge + Number(stoneValue) - Number(discount));
    const nonGoldTaxBase = Math.max(0, nonGoldSubtotal + totalMakingCharge + Number(stoneValue) - Number(discount));
    const tax = dynamicGoldAssetIds.size
      ? Math.round((dynamicGoldTax + (nonGoldTaxBase * vatRatePercent / 100)) * 10000) / 10000
      : salesService.computeTotals({
          subtotal: basePrice,
          makingCharge: totalMakingCharge,
          stoneValue: Number(stoneValue),
          discount: Number(discount),
          vatRatePercent,
        }).tax;
    const total = Math.round((taxBase + tax) * 10000) / 10000;
    const rawJournalPreview = postingService.previewInvoiceLines({
      total, tax, subtotal: taxBase, cost,
      paymentMethod: req.body.paymentMethod || "Cash",
      status: req.body.status || (["installment", "deposit"].includes(String(req.body.paymentMethod || "").toLowerCase()) ? "partial" : "paid")
    });
    // The preview is read-only, but its account labels/codes must come from the
    // same branch-scoped resolver used by posting.  The client never supplies
    // account IDs, names, COGS, or inventory values as financial authority.
    const journalPreview = {
      ...rawJournalPreview,
      lines: await Promise.all(rawJournalPreview.lines.map(async (line) => {
        const account = await financialAccountResolver.resolvePostingAccount({
          companyId: req.companyId,
          branchId,
          accountCode: line.account.code,
        });
        return { ...line, account: { code: account.code, name: account.nameAr || account.name } };
      })),
    };

    // Top-level fields for direct front-end binding + nested data envelope.
    const payload = {
      subtotal: String(taxBase),
      tax: String(tax),
      total: String(total),
      makingChargePerGram: makingChargePerGram === null || makingChargePerGram === undefined || makingChargePerGram === "" ? null : String(makingChargePerGram),
      makingCharge: String(reportedTotalMakingCharge),
      totalMakingCharge: String(reportedTotalMakingCharge),
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
  // Compatibility adapter only; the former route-local sale/return writes
  // below are retained temporarily as unreachable historical reference.
  return executeLegacyInstantInvoiceAdapter(req, res, next);

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
        // The legacy body remains only for response/history compatibility.
        // The reachable adapter above owns the Asset sale transition.
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
    const profile = asset.inventoryProfile || asset.profile;
    const makingCharge = it.makingChargePerGram !== undefined && it.makingChargePerGram !== null && it.makingChargePerGram !== ""
      ? profile === "GOLD_BY_WEIGHT_JEWELLERY"
        ? Number(calculateGoldByWeightMakingTotal({
            netGoldWeight: asset.netGoldWeight ?? asset.netWeight ?? asset.goldWeight,
            makingChargePerGram: it.makingChargePerGram,
          }))
        : Number(calculateMakingChargeTotal({ itemWeightGrams: asset.grossWeight, makingChargePerGram: it.makingChargePerGram }))
      : (Number(it.makingCharge) || 0);
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
      makingCharge,
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
    const draftMakingCharge = body.makingChargePerGram !== undefined && body.makingChargePerGram !== null && body.makingChargePerGram !== ""
      ? itemRows.reduce((sum, row) => sum + (Number(row.makingCharge) || 0), 0)
      : (Number(body.makingCharge) || 0);
    const draftServerTotals = draftIsSale
      ? salesService.computeTotals({
          subtotal: itemRows.reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.quantity) || 1), 0),
          makingCharge: draftMakingCharge,
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
      makingCharge: draftMakingCharge,
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
      if (body.makingChargePerGram !== undefined && body.makingChargePerGram !== null && body.makingChargePerGram !== "") {
        await invoice.update({ makingCharge: itemRows.reduce((sum, row) => sum + (Number(row.makingCharge) || 0), 0) }, { transaction: t });
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
    const customerContactSnapshot = buildCustomerContactSnapshot(customer);
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
      ...customerContactSnapshot,
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
        if (asset.inventoryProfile) await inventoryV2Runtime.linkInvoiceAsset({
          models, transaction: t, invoiceItemId: v.di.id, asset: asset.toJSON(), companyId: req.companyId, ordinal: 1,
          quoteSnapshot: { price: v.price, discount: v.di.discount, makingCharge: v.di.makingCharge, stoneValue: v.di.stoneValue, vatRate: totals.vatRate, cost: v.cost, invoiceId: invoice.id },
        });
        await inventoryV2Runtime.transitionAsset({
          models, transaction: t, asset,
          context: { companyId: req.companyId, branchId, branchName: branchRecord.name, actorId: commandActor.technicalUserId || req.user?.id || null, actorName: actor, occurredAt: new Date() },
          toStatus: "SOLD", eventType: "SALE", movementType: "SALE", sourceType: "INVOICE", sourceId: invoice.id,
          note: `Sold under posted draft invoice ${invoice.id}`, idempotencyKey: `invoice-post:${invoice.id}:${asset.id}`,
        });
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

    if (TAX_POLICY_INPUT_KEYS.has(req.params.key)) {
      if (!(await hasFrozenTaxPolicyAuthority(req.user))) {
        throw new ForbiddenError("Tax policy changes require Admin, Owner, or Accounting authority.");
      }
      const taxPolicyUpdate = await companyTaxPolicyService.updateCompanyTaxPolicy({
        companyId: req.companyId,
        patch: { [req.params.key]: value },
      });
      const before = JSON.stringify(taxPolicyUpdate.before);
      const after = JSON.stringify(taxPolicyUpdate.after);
      if (req.params.key === "vatRegistered" && taxPolicyUpdate.before.vatRegistered !== taxPolicyUpdate.after.vatRegistered) {
        await auditService.record(req.companyId, {
          action: "company.vat_registration.updated",
          description: "Company VAT registration status updated",
          user: req.user ? `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() : "System",
          userId: req.user ? req.user.id : null,
          place: req.branchId || "System",
          sourceDocument: "company-tax-policy",
          severity: "info",
          before,
          after,
        });
      }
      await auditService.record(req.companyId, {
        action: "company.tax_policy.updated",
        description: "Company tax policy updated",
        user: req.user ? `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() : "System",
        userId: req.user ? req.user.id : null,
        place: req.branchId || "System",
        sourceDocument: "company-tax-policy",
        severity: "info",
        before,
        after,
      });
      const persistedValue = taxPolicyUpdate.after[req.params.key];
      return res.status(200).json({ success: true, key: req.params.key, value: persistedValue, data: persistedValue });
    }

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
    const c = await requireBranchCustomerResource({ companyId: req.companyId, branchId: req.branchId, customerId: req.params.id });
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
  const now = new Date();
  const currentWhere = { currency, karat: k, approvalStatus: "APPROVED", validFrom: { [Op.lte]: now }, validUntil: { [Op.gt]: now } };
  let row = await models.GoldPrice.findOne({ where: { ...currentWhere, companyId }, order: [["updated_at", "DESC"]] });
  if (!row) row = await models.GoldPrice.findOne({ where: { ...currentWhere, companyId: null }, order: [["updated_at", "DESC"]] });
  return row;
}

// Effective per-gram rate for a karat: an existing approved/manual Gold Center
// record remains compatible for legacy fixing flows; otherwise the lower
// calculator uses the canonical provider-neutral market reference.
async function effectiveKaratPrice(companyId, currency, karat) {
  const override = await findLatestGoldPrice(companyId, currency, karat);
  if (override) return parseFloat(override.pricePerGram);
  const reference = await goldCenterReferencePriceService.getReferenceRate(companyId, currency, parseInt(karat));
  return reference.rate;
}

// Derived per-gram karat prices (from the live feed) merged with any manual
// daily fixings stored in gold_prices (manual overrides win).
router.get("/gold/karat-prices", authMiddleware, async (req, res, next) => {
  try {
    const currency = req.query.currency || "AED";
    const snapshot = await goldCenterReferencePriceService.getReferenceSnapshot(req.companyId, currency);
    const cache = { rates: new Map(), snapshots: new Map() };
    const prices = await Promise.all(goldCenterReferencePriceService.REFERENCE_KARATS.map(async (karat) => {
      try {
        const rate = await goldSalePricingService.resolveCanonicalSellingGoldRate({
          models,
          companyId: req.companyId,
          currency,
          karat,
          cache,
        });
        const reference = snapshot.prices.find((row) => Number(row.karat) === karat) || { karat, purity: karat / 24, currency: String(currency).toUpperCase() };
        return { ...reference, pricePerGram: Number(rate), source: "GOLD_CENTER" };
      } catch (_) {
        return null;
      }
    }));
    const canonicalSnapshot = { ...snapshot, prices: prices.filter(Boolean) };
    // Keep the response envelope and field names for existing consumers while
    // ensuring displayed rates equal the exact server-side sale authority.
    return res.status(200).json({ success: true, ...canonicalSnapshot, data: canonicalSnapshot });
  } catch (error) {
    next(error);
  }
});

// Manually fix (lock) today's per-gram price for one or more karats.
router.post("/gold/karat-prices", authMiddleware, requireBusinessPermission("gold.update", { touch: true }), async (req, res, next) => {
  try {
    const currency = req.body.currency || "AED";
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";
    const entries = Array.isArray(req.body.prices) ? req.body.prices : [];
    if (!entries.length) {
      return res.status(422).json({ success: false, message: "لا توجد أسعار للحفظ" });
    }
    const transaction = await models.sequelize.transaction();
    const saved = [];
    const auditChanges = [];
    try {
      for (const e of entries) {
        const karat = parseInt(e.karat);
        const newPrice = Number(e.pricePerGram);
        const prev = await findLatestGoldPrice(req.companyId, currency, karat);
        const row = await goldPriceApprovalService.createPendingPrice({
          context: { companyId: req.companyId, branchId: req.branchId, user: req.user },
          input: { karat, pricePerGram: newPrice, currency, source: e.source || "manual", validFrom: e.validFrom, validUntil: e.validUntil },
          transaction,
        });
        saved.push(row.toJSON());
        auditChanges.push({ karat, oldPrice: prev ? Number(prev.pricePerGram) : null, newPrice });
      }
      await auditService.record(req.companyId, {
        action: "gold_price.pending_created",
        description: `Pending Gold Center prices created (${currency}): ${auditChanges.map((c) => `${c.karat}K ${c.oldPrice ?? "-"}→${c.newPrice}`).join(", ")}`,
        user: actor,
        userId: req.user ? req.user.id : null,
        place: req.branchId || "System",
        sourceDocument: "gold-prices",
        severity: "info",
        before: JSON.stringify(auditChanges.map((c) => ({ karat: c.karat, pricePerGram: c.oldPrice }))),
        after: JSON.stringify(auditChanges.map((c) => ({ karat: c.karat, pricePerGram: c.newPrice, approvalStatus: "PENDING" }))),
      }, { transaction });
      await transaction.commit();
      return res.status(201).json({ success: true, items: saved, data: { items: saved } });
    } catch (error) {
      if (!transaction.finished) await transaction.rollback();
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// An executable economic price is a separate authorized Gold Center action;
// creating a manual/imported price never makes it executable by itself.
router.post("/gold/karat-prices/:id/approve", authMiddleware, requireBusinessPermission("gold.approve_price", { touch: true }), async (req, res, next) => {
  const transaction = await models.sequelize.transaction();
  try {
    const result = await goldPriceApprovalService.approvePrice({
      context: { companyId: req.companyId, branchId: req.branchId, user: req.user },
      priceId: Number(req.params.id),
      transaction,
    });
    await transaction.commit();
    return res.status(result.replayed ? 200 : 201).json({ success: true, replayed: result.replayed, data: result.price.toJSON() });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
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
      makingChargePerGram: Number(req.body.makingChargePerGram ?? req.body.makingCharge) || 0,
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

    // Decimal(15,4) collection contract: parse the submitted value exactly
    // once. A request with more than four fractional digits is invalid rather
    // than silently rounded into a different posted amount.
    const requestedAmountUnits = moneyToTenThousandths(req.body.amount);
    if (requestedAmountUnits === null || requestedAmountUnits <= 0n) {
      return res.status(422).json({ success: false, message: "Payment amount must be greater than zero" });
    }
    const amount = moneyFromTenThousandths(requestedAmountUnits);
    const method = req.body.paymentMethod || "Cash";
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : "System";

    const newPaid = parseFloat(inst.paidAmount || 0) + amount;
    const status = newPaid >= parseFloat(inst.amount) - 0.01 ? "paid" : "partial";
    const payDate = new Date().toISOString().slice(0, 10);

    // Treasury account mirrors the GL cash account chosen by
    // postInstallmentPayment uses the selected Branch bank/cash mapping so the treasury
    // log row lands on the same account the journal debits.
    const m = String(method).toLowerCase();
    const treasuryAccount =
      m.includes("card") || m.includes("bank") || m.includes("شبك") || m.includes("تحويل") ? "bank" : "cash";

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

        // Re-read and lock the authoritative aggregate before deriving its
        // outstanding amount. Concurrent collections for this installment now
        // serialize here, so the second request observes the first commit.
        const lockedInst = await models.Installment.findOne({
          where: { id: req.params.id, companyId: req.companyId },
          transaction: t,
          lock: { level: t.LOCK.UPDATE, of: models.Installment }
        });
        if (!lockedInst) throw new NotFoundError("القسط غير موجود");
        if (lockedInst.status === "paid") throw new ConflictError("القسط مدفوع بالفعل");

        const installmentAmountUnits = moneyToTenThousandths(lockedInst.amount);
        const paidAmountUnits = moneyToTenThousandths(lockedInst.paidAmount || 0);
        if (installmentAmountUnits === null || paidAmountUnits === null) {
          throw new AppError("Installment monetary state is invalid.", 409, "INSTALLMENT_MONETARY_STATE_INVALID");
        }
        const outstandingUnits = installmentAmountUnits - paidAmountUnits;
        if (outstandingUnits <= 0n) throw new ConflictError("القسط مدفوع بالفعل");
        if (requestedAmountUnits > outstandingUnits) {
          throw new AppError(
            "Overpayment rejected: amount exceeds the authoritative outstanding balance.",
            422,
            "INSTALLMENT_COLLECTION_AMOUNT_EXCEEDS_OUTSTANDING"
          );
        }
        const newPaidUnits = paidAmountUnits + requestedAmountUnits;
        const newPaid = moneyFromTenThousandths(newPaidUnits);
        const status = newPaidUnits >= installmentAmountUnits ? "paid" : "partial";

        const invoice = await models.Invoice.findOne({
          where: { id: lockedInst.invoiceId, companyId: req.companyId },
          transaction: t,
          lock: { level: t.LOCK.UPDATE, of: models.Invoice }
        });
        if (!invoice) throw new NotFoundError("الفاتورة المرتبطة بالقسط غير موجودة");
        // Installments retain a display-only `branch` label. Financial posting must
        // use the persisted, Company-scoped invoice Branch identifier instead.
        const branchId = await resolveAuthorizedBranchId(req, invoice.branchId, { required: true, transaction: t });
        await salesOperatorPolicy.assertSalesOperatorPolicy(req, "sales.installment.collect", {
          branchId,
          transaction: t
        });

        const customerId = lockedInst.customerId || invoice.customerId;
        const customer = customerId
          ? await models.Customer.findOne({
              where: { id: customerId, companyId: req.companyId },
              transaction: t,
              lock: { level: t.LOCK.UPDATE, of: models.Customer }
            })
          : null;
        if (customerId && !customer) throw new NotFoundError("العميل المرتبط بالقسط غير موجود");

        const invoiceRemainingUnits = moneyToTenThousandths(invoice.remainingAmount || 0);
        const invoicePaidUnits = moneyToTenThousandths(invoice.paidAmount || 0);
        const customerBalanceUnits = customer ? moneyToTenThousandths(customer.balance || 0) : null;
        if (invoiceRemainingUnits === null || invoicePaidUnits === null || (customer && customerBalanceUnits === null)) {
          throw new AppError("Financial monetary state is invalid.", 409, "FINANCIAL_MONETARY_STATE_INVALID");
        }

        await lockedInst.update({
          paidAmount: newPaid,
          status,
          paidDate: payDate,
          idempotencyKey: idempotencyKey || lockedInst.idempotencyKey
        }, { transaction: t });

        await invoice.update({
          remainingAmount: moneyFromTenThousandths(invoiceRemainingUnits > requestedAmountUnits ? invoiceRemainingUnits - requestedAmountUnits : 0n),
          paidAmount: moneyFromTenThousandths(invoicePaidUnits + requestedAmountUnits)
        }, { transaction: t });

        if (customer) {
          await customer.update({
            balance: moneyFromTenThousandths(customerBalanceUnits > requestedAmountUnits ? customerBalanceUnits - requestedAmountUnits : 0n)
          }, { transaction: t });
        }

        installmentPayment = await models.Payment.create({
          id: `PAY-INST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: lockedInst.companyId,
          branchId,
          invoiceId: lockedInst.invoiceId,
          paymentMethod: method,
          amount,
          reference: req.body.reference || `Installment #${lockedInst.sequence}`,
          date: payDate,
          notes: req.body.notes || `تحصيل قسط ${lockedInst.id}`,
          receivedByEmployeeId: commandActor.employeeId || null
        }, { transaction: t });

        journalEntry = await postingService.postInstallmentPayment(
          lockedInst.toJSON(), amount, method, actor, {
            transaction: t,
            branchId,
            collectionEventId: installmentPayment.id
          }
        );

        await models.CashTransaction.create({
          id: `TX-INST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          companyId: lockedInst.companyId,
          type: "cash_in",
          account: treasuryAccount,
          amount,
          category: "تحصيل قسط",
          description: `تحصيل قسط ${lockedInst.id} — فاتورة ${lockedInst.invoiceId}`,
          reference: lockedInst.invoiceId,
          branch: lockedInst.branch || "Main Branch",
          branchId,
          date: payDate,
          createdBy: req.user ? req.user.id : "System",
          status: "posted",
          journalEntryId: journalEntry ? journalEntry.id : null
        }, { transaction: t });

        await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
          action: "sales.installment.collect",
          description: `Collected installment ${lockedInst.id} for invoice ${lockedInst.invoiceId}`,
          user: actor,
          userId: req.user ? req.user.id : null,
          place: lockedInst.branch || branchId || null,
          branch: lockedInst.branch || branchId || null,
          sourceDocument: lockedInst.invoiceId,
          severity: "info",
          after: JSON.stringify({
            installmentId: lockedInst.id,
            invoiceId: lockedInst.invoiceId,
            paymentId: installmentPayment.id,
            amount,
            status,
            journalEntryId: journalEntry ? journalEntry.id : null
          })
        }, commandActor), { transaction: t });

        // Persist the success response for idempotent replay BEFORE commit.
        const out = lockedInst.toJSON();
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
    const branchId = await resolveAuthorizedBranchId(req, req.query.branchId || req.query.branch, { required: true });
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
        const treasuryAccount = await financialAccountResolver.resolveRequiredBranchFinancialAccount({
          companyId: req.companyId,
          branchId: branch.id,
          mappingRole: account === "bank" ? "BANK_ACCOUNT" : "CASH_TREASURY",
          transaction: t,
        });
        const toTreasuryAccount = toAccount
          ? await financialAccountResolver.resolveRequiredBranchFinancialAccount({
            companyId: req.companyId,
            branchId: branch.id,
            mappingRole: toAccount === "bank" ? "BANK_ACCOUNT" : "CASH_TREASURY",
            transaction: t,
          })
          : null;
        let counterAccount = null;
        if (type !== "transfer") {
          counterAccount = b.counterAccountCode
            ? await assertActiveAccountCode(req.companyId, b.counterAccountCode, { transaction: t })
            : await financialAccountResolver.resolveRequiredBranchFinancialAccount({
              companyId: req.companyId,
              branchId: branch.id,
              mappingRole: type === "cash_out" ? "DEFAULT_EXPENSE" : "OTHER_INCOME",
              transaction: t,
            });
          const counterCompatible = type === "cash_out"
            ? counterAccount.type === "expense" && counterAccount.nature === "debit" && counterAccount.isPosting === true
            : counterAccount.type === "revenue" && counterAccount.nature === "credit" && counterAccount.isPosting === true;
          if (!counterCompatible) {
            throw new AppError(
              "The selected counter account is incompatible with the treasury posting direction.",
              422,
              "FINANCIAL_MAPPING_ACCOUNT_INCOMPATIBLE",
            );
          }
        }
        if (counterAccount && (
          String(counterAccount.id) === String(treasuryAccount.id) ||
          String(counterAccount.id) === String(toTreasuryAccount?.id || "")
        )) {
          throw new ValidationError("counterAccountCode must not resolve to the selected treasury account.");
        }
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
        const journalEntry = await postingService.postCashEntry(tx.toJSON(), actor, {
          transaction: t,
          treasuryAccountId: treasuryAccount.id,
          toTreasuryAccountId: toTreasuryAccount?.id || null,
          counterAccountId: counterAccount?.id || null,
        });
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
    const branch = await resolveAuthorizedBranch(req, b.branchId || req.headers["x-branch-id"] || req.branchId, { required: true });
    const treasuryAccount = await resolveTreasuryAccount(req.companyId, branch.id, account);

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
      accountId: treasuryAccount.id,
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
