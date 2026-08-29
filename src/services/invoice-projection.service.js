"use strict";

const { Op, QueryTypes } = require("sequelize");
const models = require("../models");
const { AppError } = require("../utils/errors");
const { buildPaymentSummary } = require("./cgp-payment-summary");

const ACTIVE_INVOICE_TYPES = Object.freeze([
  "sale",
  "return",
  "exchange",
  "installment",
  "deposit",
]);
const CGP_SOURCE_TYPE = "customer_gold_purchase";
const GIFT_VOUCHER_SOURCE_TYPE = "gift_voucher";
const ACTIVE_PROJECTION_SOURCE_TYPES = Object.freeze([...ACTIVE_INVOICE_TYPES, CGP_SOURCE_TYPE, GIFT_VOUCHER_SOURCE_TYPE]);

const PROJECTION_ERROR_CODES = Object.freeze({
  UNSUPPORTED_SOURCE_TYPE: "PROJECTION_UNSUPPORTED_SOURCE_TYPE",
  SOURCE_NOT_FOUND: "PROJECTION_SOURCE_NOT_FOUND",
  SOURCE_FORBIDDEN: "PROJECTION_SOURCE_FORBIDDEN",
  SOURCE_MALFORMED: "PROJECTION_SOURCE_MALFORMED",
  MAPPING_FAILED: "PROJECTION_MAPPING_FAILED",
});

const SOURCE_REGISTRY = Object.freeze({
  sale: Object.freeze({
    sourceType: "sale",
    sourceTable: "invoices",
    sourceIdField: "invoices.id",
    displayNumberField: "invoices.invoice_number || invoices.id",
    businessModule: "sales",
    partyType: "CUSTOMER",
    status: "SUPPORTED_NOW",
    adapter: "invoice",
    canViewDetail: true,
    canPrint: true,
  }),
  return: Object.freeze({
    sourceType: "return",
    sourceTable: "invoices",
    sourceIdField: "invoices.id",
    displayNumberField: "invoices.invoice_number || invoices.id",
    businessModule: "sales_returns",
    partyType: "CUSTOMER",
    status: "SUPPORTED_NOW",
    adapter: "invoice",
    canViewDetail: true,
    canPrint: true,
  }),
  exchange: Object.freeze({
    sourceType: "exchange",
    sourceTable: "invoices",
    sourceIdField: "invoices.id",
    displayNumberField: "invoices.invoice_number || invoices.id",
    businessModule: "sales_exchanges",
    partyType: "CUSTOMER",
    status: "SUPPORTED_NOW",
    adapter: "invoice",
    canViewDetail: true,
    canPrint: true,
  }),
  installment: Object.freeze({
    sourceType: "installment",
    sourceTable: "invoices",
    sourceIdField: "invoices.id",
    displayNumberField: "invoices.invoice_number || invoices.id",
    businessModule: "sales_installments",
    partyType: "CUSTOMER",
    status: "SUPPORTED_NOW",
    adapter: "invoice",
    canViewDetail: true,
    canPrint: true,
  }),
  deposit: Object.freeze({
    sourceType: "deposit",
    sourceTable: "invoices",
    sourceIdField: "invoices.id",
    displayNumberField: "invoices.invoice_number || invoices.id",
    businessModule: "sales_deposits",
    partyType: "CUSTOMER",
    status: "SUPPORTED_NOW",
    adapter: "invoice",
    canViewDetail: true,
    canPrint: true,
  }),
  gift_voucher: Object.freeze({
    sourceType: "gift_voucher",
    sourceTable: "gift_vouchers",
    sourceIdField: "gift_vouchers.id",
    displayNumberField: "gift_vouchers.voucher_number",
    businessModule: "gift_vouchers",
    partyType: "CUSTOMER",
    status: "SUPPORTED_NOW",
    adapter: "gift_voucher",
    canViewDetail: true,
    canPrint: true,
  }),
  customer_gold_purchase: Object.freeze({
    sourceType: "customer_gold_purchase",
    sourceTable: "customer_gold_purchase_documents",
    sourceIdField: "customer_gold_purchase_documents.id",
    displayNumberField: "customer_gold_purchase_documents.draft_number",
    businessModule: "customer_gold_purchase",
    partyType: "CUSTOMER",
    status: "SUPPORTED_NOW",
    adapter: "customer_gold_purchase",
    canViewDetail: true,
    canPrint: true,
  }),
  purchase_order: Object.freeze({
    sourceType: "purchase_order",
    sourceTable: "purchase_orders",
    sourceIdField: "purchase_orders.id",
    displayNumberField: "purchase_orders.id",
    businessModule: "supplier_purchasing",
    partyType: "SUPPLIER",
    status: "NOT_AN_INVOICE",
    adapter: null,
    reason: "Supplier purchasing is a source family to map, not a Sales-domain invoice family.",
    canViewDetail: false,
    canPrint: false,
  }),
  repair: Object.freeze({
    sourceType: "repair",
    sourceTable: "invoices",
    sourceIdField: "invoices.id",
    displayNumberField: "invoices.invoice_number || invoices.id",
    businessModule: "repair",
    partyType: "CUSTOMER",
    status: "NOT_AN_INVOICE",
    adapter: null,
    reason: "Repair is present in the current Invoice enum but is not a client Invoice Search & Print family in D1.",
    canViewDetail: false,
    canPrint: false,
  }),
});

function projectionError(code, statusCode, message, details = null) {
  const error = new AppError(message, statusCode, code);
  error.details = details;
  return error;
}

function plain(value) {
  return value && typeof value.toJSON === "function" ? value.toJSON() : (value || {});
}

function asText(value) {
  return value === undefined || value === null ? null : String(value);
}

function employeeDisplayName(employee) {
  const row = plain(employee);
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return name || row.name || row.employeeCode || null;
}

function getSourceEntry(sourceType) {
  return SOURCE_REGISTRY[String(sourceType || "").trim().toLowerCase()] || null;
}

function assertActiveSourceType(sourceType) {
  const entry = getSourceEntry(sourceType);
  if (!entry || entry.status !== "SUPPORTED_NOW" || !entry.adapter) {
    throw projectionError(
      PROJECTION_ERROR_CODES.UNSUPPORTED_SOURCE_TYPE,
      422,
      "The requested source type is not available in the D1 projection foundation.",
      { sourceType: String(sourceType || ""), registryStatus: entry?.status || "UNKNOWN" },
    );
  }
  return entry;
}

function assertActiveInvoiceSourceType(sourceType) {
  const entry = assertActiveSourceType(sourceType);
  if (entry.adapter !== "invoice") {
    throw projectionError(
      PROJECTION_ERROR_CODES.UNSUPPORTED_SOURCE_TYPE,
      422,
      "The requested source type is not an Invoice source in the D1 projection foundation.",
      { sourceType: String(sourceType || ""), adapter: entry.adapter || null },
    );
  }
  return entry;
}

function projectionReference(entry, sourceId) {
  return `invoice:${entry.sourceType}:${String(sourceId)}`;
}

function employeeAttribution(invoice) {
  const createdByEmployee = plain(invoice.createdByEmployee);
  const finalizedByEmployee = plain(invoice.finalizedByEmployee);
  return {
    createdByEmployeeId: asText(invoice.createdByEmployeeId),
    createdByEmployeeName: employeeDisplayName(createdByEmployee),
    finalizedByEmployeeId: asText(invoice.finalizedByEmployeeId),
    finalizedByEmployeeName: employeeDisplayName(finalizedByEmployee),
  };
}

function invoiceDisplayStatus(invoice) {
  const row = plain(invoice);
  if (row.postingStatus === "cancelled" || row.status === "cancelled") return "cancelled";
  if (row.postingStatus === "draft") return "draft";
  if (row.type === "return" || row.status === "returned") return "returned";
  if (row.postingStatus === "posted" && row.status === "paid") return "closed";
  return "posted";
}

function cgpDisplayStatus(document, payment = null) {
  const row = plain(document);
  const businessStatus = String(cgpBusinessStatus(row) || "").toUpperCase();
  if (["CANCELLED", "REVERSED", "VOIDED"].includes(businessStatus)) return "cancelled";
  if (businessStatus === "DRAFT") return "draft";
  if (payment?.paymentStatus === "PAID") return "closed";
  return "posted";
}

function giftVoucherDisplayStatus(voucher) {
  const status = String(voucher?.status || "").trim().toLowerCase();
  if (status === "cancelled") return "cancelled";
  if (status === "redeemed" || status === "expired") return "closed";
  return "posted";
}

function assertGiftVoucherShape(voucher) {
  const row = plain(voucher);
  if (!row.id || !row.companyId || !row.voucherNumber || !row.voucherCode || !row.issueBranchId
      || row.faceValue === undefined || row.faceValue === null || !row.currency || !row.status || !row.issuedAt) {
    throw projectionError(
      PROJECTION_ERROR_CODES.SOURCE_MALFORMED,
      422,
      "The Gift Voucher source is incomplete for the read-only projection contract.",
      { required: ["id", "companyId", "voucherNumber", "voucherCode", "issueBranchId", "faceValue", "currency", "status", "issuedAt"], sourceId: row.id || null },
    );
  }
  return row;
}

function giftVoucherIsInBranchScope(voucher, branchId) {
  if (!branchId) return true;
  const row = plain(voucher);
  if (String(row.issueBranchId) === String(branchId)) return true;
  if (String(row.branchEligibilityMode || "").toUpperCase() === "ALL_BRANCHES") return true;
  return (Array.isArray(row.branchEligibilities) ? row.branchEligibilities : [])
    .some((eligibility) => String(plain(eligibility).branchId) === String(branchId));
}

function mapGiftVoucherPayment(payment) {
  const row = plain(payment);
  return {
    id: asText(row.id),
    invoiceId: asText(row.invoiceId),
    giftVoucherId: asText(row.giftVoucherId),
    method: asText(row.paymentMethod),
    amount: asText(row.amount),
    reference: asText(row.reference),
    date: asText(row.date),
    receivedByEmployeeId: asText(row.receivedByEmployeeId),
  };
}

function mapGiftVoucherSummary(voucher) {
  const row = assertGiftVoucherShape(voucher);
  const customer = plain(row.customer);
  const branch = plain(row.issueBranch);
  const entry = SOURCE_REGISTRY[GIFT_VOUCHER_SOURCE_TYPE];
  const faceValue = asText(row.faceValue);
  return {
    projectionReference: projectionReference(entry, row.id),
    sourceType: GIFT_VOUCHER_SOURCE_TYPE,
    sourceId: asText(row.id),
    displayNumber: asText(row.voucherNumber),
    voucherCode: asText(row.voucherCode),
    documentDate: row.issuedAt || null,
    companyId: asText(row.companyId),
    branchId: asText(row.issueBranchId),
    partyType: "CUSTOMER",
    partyId: asText(row.customerId),
    partyDisplayName: asText(customer.name),
    branchName: asText(branch.name) || asText(row.issueBranchId),
    currency: asText(row.currency),
    subtotal: faceValue,
    discountTotal: null,
    taxTotal: null,
    grandTotal: faceValue,
    paymentStatus: asText(row.status),
    businessStatus: asText(row.status),
    displayStatus: giftVoucherDisplayStatus(row),
    createdBy: asText(row.issuedByUserId),
    createdAt: row.createdAt || row.issuedAt || null,
    sourceModule: entry.businessModule,
    operatorAttribution: {
      createdByEmployeeId: asText(row.issuedByEmployeeId),
      createdByEmployeeName: null,
      finalizedByEmployeeId: null,
      finalizedByEmployeeName: null,
      createdByUserId: asText(row.issuedByUserId),
    },
    employeeName: null,
    voucherStatus: asText(row.status),
    issuedAt: row.issuedAt || null,
    activatedAt: row.activatedAt || null,
    redeemedAt: row.redeemedAt || null,
    branchEligibilityMode: asText(row.branchEligibilityMode),
    canViewDetail: entry.canViewDetail,
    canPrint: entry.canPrint,
  };
}

function mapGiftVoucherLine(voucher) {
  const row = assertGiftVoucherShape(voucher);
  return {
    lineReference: asText(row.id),
    itemReference: null,
    assetReference: null,
    description: "Gift Voucher",
    quantity: 1,
    unit: null,
    unitPrice: asText(row.faceValue),
    discount: null,
    tax: null,
    lineTotal: asText(row.faceValue),
    weight: null,
    karat: null,
    makingCharge: null,
    stoneValue: null,
    assetLinks: [],
  };
}

function buildGiftVoucherProjection({ voucher, payments = [], cashTransactions = [], journals = [], journalLines = [] }) {
  const row = assertGiftVoucherShape(voucher);
  const summary = mapGiftVoucherSummary(row);
  const faceValue = asText(row.faceValue);
  return {
    summary,
    lines: [mapGiftVoucherLine(row)],
    taxSummary: {
      subtotal: faceValue,
      discount: null,
      taxableBase: null,
      tax: null,
      vatRate: null,
      grandTotal: faceValue,
      source: "gift_vouchers.face_value",
      snapshotStatus: "NOT_APPLICABLE_SOURCE",
    },
    paymentSummary: {
      status: asText(row.status),
      statusSource: "gift_vouchers.status",
      rows: payments.map(mapGiftVoucherPayment),
      cashTransactions: cashTransactions.map((transaction) => {
        const item = plain(transaction);
        return {
          id: asText(item.id),
          type: asText(item.type),
          amount: asText(item.amount),
          reference: asText(item.reference),
          journalEntryId: asText(item.journalEntryId),
          status: asText(item.status),
          date: asText(item.date),
        };
      }),
      installments: [],
    },
    sourceLinks: {
      source: {
        sourceTable: "gift_vouchers",
        sourceType: GIFT_VOUCHER_SOURCE_TYPE,
        sourceId: summary.sourceId,
      },
      accounting: mapAccountingLinks(journals, journalLines),
      printEvents: (Array.isArray(row.printEvents) ? row.printEvents : []).map((event) => {
        const item = plain(event);
        return { id: asText(item.id), printKind: asText(item.printKind), printedAt: item.printedAt || null, branchId: asText(item.branchId) };
      }),
    },
    voucher: {
      id: summary.sourceId,
      voucherNumber: summary.displayNumber,
      voucherCode: summary.voucherCode,
      faceValue,
      currency: summary.currency,
      status: summary.voucherStatus,
      companyId: summary.companyId,
      customerId: summary.partyId,
      customerName: summary.partyDisplayName,
      issueBranchId: summary.branchId,
      branchName: summary.branchName,
      branchEligibilityMode: summary.branchEligibilityMode,
      issuedAt: summary.issuedAt,
      activatedAt: summary.activatedAt,
      redeemedAt: summary.redeemedAt,
      printEvents: (Array.isArray(row.printEvents) ? row.printEvents : []).map((event) => {
        const item = plain(event);
        return { id: asText(item.id), printKind: asText(item.printKind), printedAt: item.printedAt || null, branchId: asText(item.branchId) };
      }),
    },
    audit: {
      sourceCreatedAt: row.createdAt || row.issuedAt || null,
      sourceUpdatedAt: row.updatedAt || null,
      createdByEmployeeId: asText(row.issuedByEmployeeId),
      createdByUserId: asText(row.issuedByUserId),
      taxSnapshotStatus: "NOT_APPLICABLE_SOURCE",
      readOnly: true,
    },
  };
}

function assertInvoiceShape(invoice) {
  const row = plain(invoice);
  if (!row.id || !row.companyId || !row.type || !ACTIVE_INVOICE_TYPES.includes(String(row.type))) {
    throw projectionError(
      PROJECTION_ERROR_CODES.SOURCE_MALFORMED,
      422,
      "The source invoice is incomplete for the D1 projection contract.",
      { required: ["id", "companyId", "type"], sourceId: row.id || null },
    );
  }
  return row;
}

function mapInvoiceSummary(invoice) {
  const row = assertInvoiceShape(invoice);
  const entry = assertActiveInvoiceSourceType(row.type);
  const attribution = employeeAttribution(row);
  return {
    projectionReference: projectionReference(entry, row.id),
    sourceType: entry.sourceType,
    sourceId: asText(row.id),
    displayNumber: asText(row.invoiceNumber) || asText(row.id),
    documentDate: asText(row.date),
    companyId: asText(row.companyId),
    branchId: asText(row.branchId),
    partyType: "CUSTOMER",
    partyId: asText(row.customerId),
    partyDisplayName: asText(row.customerName),
    branchName: asText(row.branchRecord?.name) || asText(row.branchName) || asText(row.branch) || asText(row.branchId),
    currency: asText(row.currency) || null,
    subtotal: asText(row.subtotal),
    discountTotal: asText(row.discount),
    taxTotal: asText(row.tax),
    grandTotal: asText(row.total),
    paymentStatus: asText(row.status),
    businessStatus: asText(row.postingStatus),
    displayStatus: invoiceDisplayStatus(row),
    createdBy: attribution.createdByEmployeeId,
    createdAt: row.createdAt || null,
    sourceModule: entry.businessModule,
    operatorAttribution: attribution,
    employeeName: attribution.finalizedByEmployeeName || attribution.createdByEmployeeName || null,
    canViewDetail: entry.canViewDetail,
    canPrint: entry.canPrint,
  };
}

function mapInvoiceLine(item, assetLinks = []) {
  const row = plain(item);
  const links = assetLinks.filter((link) => String(link.invoiceItemId) === String(row.id));
  return {
    lineReference: asText(row.id),
    itemReference: asText(row.assetId),
    assetReference: asText(row.assetId),
    description: asText(row.name),
    quantity: row.quantity === undefined || row.quantity === null ? null : row.quantity,
    unit: null,
    unitPrice: asText(row.price),
    discount: asText(row.discount),
    tax: null,
    lineTotal: null,
    weight: asText(row.weight),
    karat: row.karat === undefined || row.karat === null ? null : row.karat,
    makingCharge: asText(row.makingCharge),
    stoneValue: asText(row.stoneValue),
    assetLinks: links.map((link) => ({
      invoiceItemId: asText(link.invoiceItemId),
      assetId: asText(link.assetId),
      barcode: asText(link.barcode),
      ordinal: link.ordinal === undefined || link.ordinal === null ? null : link.ordinal,
      mappingClassification: asText(link.mappingClassification),
      costSnapshotRevisionId: asText(link.costSnapshotRevisionId),
      quoteSnapshot: link.quoteSnapshot || null,
    })),
  };
}

function mapPaymentSummary(invoice, payments = [], cashTransactions = [], installments = []) {
  return {
    status: asText(invoice.status),
    statusSource: "invoices.status",
    rows: payments.map((payment) => {
      const row = plain(payment);
      return {
        id: asText(row.id),
        invoiceId: asText(row.invoiceId),
        method: asText(row.paymentMethod),
        amount: asText(row.amount),
        reference: asText(row.reference),
        date: asText(row.date),
        receivedByEmployeeId: asText(row.receivedByEmployeeId),
      };
    }),
    cashTransactions: cashTransactions.map((transaction) => {
      const row = plain(transaction);
      return {
        id: asText(row.id),
        type: asText(row.type),
        amount: asText(row.amount),
        reference: asText(row.reference),
        journalEntryId: asText(row.journalEntryId),
        status: asText(row.status),
        date: asText(row.date),
      };
    }),
    installments: installments.map((installment) => {
      const row = plain(installment);
      return {
        id: asText(row.id),
        sequence: row.sequence === undefined || row.sequence === null ? null : row.sequence,
        dueDate: asText(row.dueDate),
        amount: asText(row.amount),
        paidAmount: asText(row.paidAmount),
        status: asText(row.status),
        paidDate: asText(row.paidDate),
      };
    }),
  };
}

function mapAccountingLinks(journals = [], journalLines = []) {
  return journals.map((journal) => {
    const row = plain(journal);
    return {
      id: asText(row.id),
      sourceType: asText(row.sourceType),
      sourceId: asText(row.sourceId),
      status: asText(row.status),
      totalDebit: asText(row.totalDebit),
      totalCredit: asText(row.totalCredit),
      branchId: asText(row.branchId),
      lines: journalLines
        .filter((line) => String(line.journalEntryId) === String(row.id))
        .map((line) => {
          const item = plain(line);
          return {
            id: asText(item.id),
            accountCode: asText(item.accountCode),
            debit: asText(item.debit),
            credit: asText(item.credit),
          };
        }),
    };
  });
}

function buildInvoiceProjection({ invoice, assetLinks = [], journals = [], journalLines = [], cashTransactions = [] }) {
  const row = assertInvoiceShape(invoice);
  const summary = mapInvoiceSummary(row);
  const items = Array.isArray(row.items) ? row.items : [];
  const payments = Array.isArray(row.payments) ? row.payments : [];
  const installments = Array.isArray(row.installments) ? row.installments : [];
  const attribution = employeeAttribution(row);

  return {
    summary,
    lines: items.map((item) => mapInvoiceLine(item, assetLinks)),
    taxSummary: {
      subtotal: asText(row.subtotal),
      discount: asText(row.discount),
      taxableBase: null,
      tax: asText(row.tax),
      vatRate: asText(row.vatRate),
      grandTotal: asText(row.total),
      source: "invoices.tax + invoices.vat_rate",
      snapshotStatus: "HISTORICAL_DATA_GAP",
    },
    paymentSummary: mapPaymentSummary(row, payments, cashTransactions, installments),
    sourceLinks: {
      source: {
        sourceTable: "invoices",
        sourceType: summary.sourceType,
        sourceId: summary.sourceId,
      },
      relatedInvoiceId: asText(row.relatedInvoiceId),
      assetLinks: assetLinks.map((link) => ({
        invoiceItemId: asText(link.invoiceItemId),
        assetId: asText(link.assetId),
        barcode: asText(link.barcode),
        ordinal: link.ordinal === undefined || link.ordinal === null ? null : link.ordinal,
      })),
      accounting: mapAccountingLinks(journals, journalLines),
    },
    audit: {
      sourceCreatedAt: row.createdAt || null,
      sourceUpdatedAt: row.updatedAt || null,
      createdByEmployeeId: attribution.createdByEmployeeId,
      finalizedByEmployeeId: attribution.finalizedByEmployeeId,
      taxSnapshotStatus: "HISTORICAL_DATA_GAP",
      readOnly: true,
    },
  };
}

function invoiceInclude() {
  return [
    { model: models.InvoiceItem, as: "items", required: false },
    { model: models.Payment, as: "payments", required: false },
    { model: models.Installment, as: "installments", required: false },
    { model: models.Employee, as: "createdByEmployee", required: false },
    { model: models.Employee, as: "finalizedByEmployee", required: false },
    { model: models.Branch, as: "branchRecord", attributes: ["id", "name"], required: false },
  ];
}

function giftVoucherInclude({ customerName } = {}) {
  return [
    {
      model: models.Customer,
      as: "customer",
      attributes: ["id", "name"],
      required: Boolean(customerName),
      ...(customerName ? { where: { name: { [Op.iLike]: `%${customerName}%` } } } : {}),
    },
    { model: models.Branch, as: "issueBranch", attributes: ["id", "name"], required: false },
    { model: models.GiftVoucherBranchEligibility, as: "branchEligibilities", attributes: ["branchId"], required: false },
    { model: models.GiftVoucherPrintEvent, as: "printEvents", attributes: ["id", "printKind", "printedAt", "branchId"], required: false },
  ];
}

async function giftVoucherBranchScopeIds({ companyId, branchId }) {
  if (!branchId) return [];
  const rows = await models.GiftVoucherBranchEligibility.findAll({
    where: { branchId },
    attributes: ["voucherId"],
    raw: true,
  });
  return rows.map((row) => row.voucherId).filter(Boolean);
}

function applyGiftVoucherStatusFilter(where, status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "draft" || normalized === "returned") {
    where.id = { [Op.in]: [] };
  } else if (normalized === "cancelled") {
    where.status = "cancelled";
  } else if (normalized === "closed") {
    where.status = { [Op.in]: ["redeemed", "expired"] };
  } else if (normalized === "posted") {
    where.status = { [Op.in]: ["issued", "active", "distributed"] };
  }
}

async function listGiftVoucherSummaries({ companyId, branchId, filters = {} }) {
  const page = Math.max(Number.parseInt(filters.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(filters.pageSize, 10) || 25, 1), 100);
  const requestedBranchId = String(filters.branchId || "").trim();
  if (requestedBranchId && requestedBranchId !== "all" && branchId && requestedBranchId !== String(branchId)) {
    throw projectionError(PROJECTION_ERROR_CODES.SOURCE_FORBIDDEN, 403, "The requested branch is outside the authorized branch scope.");
  }

  const where = { companyId };
  if (branchId) {
    const eligibleIds = await giftVoucherBranchScopeIds({ companyId, branchId });
    const scope = [
      { issueBranchId: branchId },
      { branchEligibilityMode: "ALL_BRANCHES" },
    ];
    if (eligibleIds.length) scope.push({ id: { [Op.in]: eligibleIds } });
    where[Op.or] = scope;
  }
  const search = String(filters.search || "").trim();
  const conditions = [];
  if (search) {
    conditions.push({ [Op.or]: [
      { id: { [Op.iLike]: `%${search}%` } },
      { voucherNumber: { [Op.iLike]: `%${search}%` } },
      { voucherCode: { [Op.iLike]: `%${search}%` } },
    ] });
  }
  if (filters.partyId) conditions.push({ customerId: String(filters.partyId).trim() });
  if (filters.employeeId) conditions.push({ issuedByEmployeeId: String(filters.employeeId).trim() });
  if (filters.employee) {
    const employeeSearch = String(filters.employee).trim();
    const employees = await models.Employee.findAll({
      where: { companyId, [Op.or]: [
        { name: { [Op.iLike]: `%${employeeSearch}%` } },
        { employeeCode: { [Op.iLike]: `%${employeeSearch}%` } },
      ] },
      attributes: ["id"],
      raw: true,
    });
    conditions.push({ issuedByEmployeeId: { [Op.in]: employees.map((row) => row.id) } });
  }
  if (filters.status) applyGiftVoucherStatusFilter(where, filters.status);
  const dateFrom = String(filters.dateFrom || "").trim();
  const dateTo = String(filters.dateTo || "").trim();
  if (dateFrom || dateTo) {
    const range = {};
    if (dateFrom) range[Op.gte] = dateFrom;
    if (dateTo) range[Op.lte] = `${dateTo} 23:59:59.999`;
    conditions.push({ issuedAt: range });
  }
  if (conditions.length) where[Op.and] = conditions;

  const result = await models.GiftVoucher.findAndCountAll({
    where,
    include: giftVoucherInclude({ customerName: filters.partyName ? String(filters.partyName).trim() : "" }),
    distinct: true,
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return {
    items: result.rows.map(mapGiftVoucherSummary),
    page,
    pageSize,
    total: result.count,
    totalPages: Math.max(Math.ceil(result.count / pageSize), 1),
    filterContract: { sourceTypes: [GIFT_VOUCHER_SOURCE_TYPE], supportsEmployeeFilter: true, readOnly: true },
  };
}

async function getGiftVoucherDetail({ sourceId, companyId, branchId }) {
  const voucher = await models.GiftVoucher.findOne({
    where: { id: sourceId, companyId },
    include: giftVoucherInclude(),
  });
  if (!voucher) {
    const existing = await models.GiftVoucher.findOne({ where: { id: sourceId }, attributes: ["id", "companyId"], raw: true });
    if (existing && String(existing.companyId) !== String(companyId)) {
      throw projectionError(PROJECTION_ERROR_CODES.SOURCE_FORBIDDEN, 403, "The Gift Voucher is outside the authorized company scope.");
    }
    throw projectionError(PROJECTION_ERROR_CODES.SOURCE_NOT_FOUND, 404, "The Gift Voucher was not found.");
  }
  if (!giftVoucherIsInBranchScope(voucher, branchId)) {
    throw projectionError(PROJECTION_ERROR_CODES.SOURCE_FORBIDDEN, 403, "The Gift Voucher is outside the authorized branch scope.");
  }
  const [payments, cashTransactions, journals] = await Promise.all([
    models.Payment.findAll({ where: { companyId, giftVoucherId: voucher.id }, raw: true }),
    models.CashTransaction.findAll({ where: { companyId, reference: voucher.id }, raw: true }),
    models.JournalEntry.findAll({
      where: { companyId, sourceType: "gift_voucher_issue", sourceId: voucher.id },
      attributes: ["id", "companyId", "branchId", "sourceType", "sourceId", "status", "totalDebit", "totalCredit"],
      raw: true,
    }),
  ]);
  const journalIds = journals.map((journal) => journal.id);
  const journalLines = journalIds.length
    ? await models.JournalLine.findAll({
      where: { journalEntryId: { [Op.in]: journalIds } },
      attributes: ["id", "journalEntryId", "accountCode", "debit", "credit"],
      raw: true,
    })
    : [];
  return buildGiftVoucherProjection({ voucher, payments, cashTransactions, journals, journalLines });
}

async function loadRelatedReadModel(invoice, companyId) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const itemIds = items.map((item) => item.id).filter((id) => id !== undefined && id !== null);
  const assetLinks = itemIds.length
    ? await models.sequelize.query(
       `SELECT l.invoice_item_id AS "invoiceItemId", l.asset_id AS "assetId", a.barcode, l.ordinal,
               quote_snapshot AS "quoteSnapshot", cost_snapshot_revision_id AS "costSnapshotRevisionId",
               mapping_classification AS "mappingClassification"
          FROM invoice_item_asset_links l
          LEFT JOIN assets a ON a.id = l.asset_id
         WHERE l.company_id = :companyId AND l.invoice_item_id IN (:itemIds)
         ORDER BY l.invoice_item_id, l.ordinal`,
      { replacements: { companyId, itemIds }, type: QueryTypes.SELECT },
    )
    : [];
  const journals = await models.JournalEntry.findAll({
    where: { companyId, sourceType: "invoice", sourceId: invoice.id },
    attributes: ["id", "companyId", "branchId", "sourceType", "sourceId", "status", "totalDebit", "totalCredit"],
    raw: true,
  });
  const journalIds = journals.map((journal) => journal.id);
  const journalLines = journalIds.length
    ? await models.JournalLine.findAll({
      where: { journalEntryId: { [Op.in]: journalIds } },
      attributes: ["id", "journalEntryId", "accountCode", "debit", "credit"],
      raw: true,
    })
    : [];
  const cashTransactions = await models.CashTransaction.findAll({
    where: { companyId, reference: invoice.id },
    attributes: ["id", "type", "amount", "reference", "journalEntryId", "status", "date"],
    raw: true,
  });
  return { assetLinks, journals, journalLines, cashTransactions };
}

async function findInvoiceForScope({ sourceType, sourceId, companyId, branchId }) {
  const entry = assertActiveInvoiceSourceType(sourceType);
  const where = { id: sourceId, companyId, type: entry.sourceType };
  if (branchId) where.branchId = branchId;
  const invoice = await models.Invoice.findOne({ where, include: invoiceInclude() });
  if (invoice) return invoice;

  const existing = await models.Invoice.findOne({
    where: { id: sourceId, type: entry.sourceType },
    attributes: ["id", "companyId", "branchId"],
    raw: true,
  });
  if (existing && (String(existing.companyId) !== String(companyId) || (branchId && String(existing.branchId) !== String(branchId)))) {
    throw projectionError(PROJECTION_ERROR_CODES.SOURCE_FORBIDDEN, 403, "The source invoice is outside the authorized company or branch scope.");
  }
  throw projectionError(PROJECTION_ERROR_CODES.SOURCE_NOT_FOUND, 404, "The source invoice was not found.");
}

async function getDetail({ sourceType, sourceId, companyId, branchId }) {
  const entry = assertActiveSourceType(sourceType);
  if (entry.adapter === "customer_gold_purchase") {
    return getCgpDetail({ sourceId, companyId, branchId });
  }
  if (entry.adapter === "gift_voucher") {
    return getGiftVoucherDetail({ sourceId, companyId, branchId });
  }
  const invoice = await findInvoiceForScope({ sourceType, sourceId, companyId, branchId });
  try {
    const related = await loadRelatedReadModel(invoice, companyId);
    return buildInvoiceProjection({ invoice, ...related });
  } catch (error) {
    if (error?.errorCode?.startsWith("PROJECTION_")) throw error;
    throw projectionError(PROJECTION_ERROR_CODES.MAPPING_FAILED, 500, "The invoice source could not be mapped to the D1 projection contract.");
  }
}

function cgpBusinessStatus(row) {
  return asText(row.businessStatus) || asText(row.status);
}

function assertCgpShape(document) {
  const row = plain(document);
  if (!row.id || !row.companyId || !row.branchId || !row.draftNumber || !row.customerId || !cgpBusinessStatus(row)) {
    throw projectionError(
      PROJECTION_ERROR_CODES.SOURCE_MALFORMED,
      422,
      "The Customer Gold Purchase source is incomplete for the D1 projection contract.",
      { required: ["id", "companyId", "branchId", "draftNumber", "customerId", "businessStatus"], sourceId: row.id || null },
    );
  }
  return row;
}

function cgpPaymentFact(row, liability = null) {
  return buildPaymentSummary({
    originalAmount: row.totalPayableToCustomer || row.totalGoldValue,
    settledAmount: liability?.settledAmount,
    outstandingAmount: liability?.outstandingAmount,
    settlementPaidAmount: "0.0000",
  });
}

function mapCgpSummary(document, paymentFact = null) {
  const row = assertCgpShape(document);
  const customer = plain(row.customer);
  const payment = paymentFact || cgpPaymentFact(row);
  const actorUser = plain(row.createdByUser);
  const actorEmployee = plain(actorUser.defaultEmployee);
  const actorName = employeeDisplayName(actorEmployee)
    || [actorUser.firstName, actorUser.lastName].filter(Boolean).join(" ").trim()
    || null;
  const total = row.totalPayableToCustomer === null || row.totalPayableToCustomer === undefined
    ? row.totalGoldValue
    : row.totalPayableToCustomer;
  return {
    projectionReference: projectionReference(SOURCE_REGISTRY[CGP_SOURCE_TYPE], row.id),
    sourceType: CGP_SOURCE_TYPE,
    sourceId: asText(row.id),
    displayNumber: asText(row.draftNumber),
    documentDate: asText(row.transactionDate),
    companyId: asText(row.companyId),
    branchId: asText(row.branchId),
    partyType: "CUSTOMER",
    partyId: asText(row.customerId),
    partyDisplayName: asText(customer.name) || null,
    branchName: asText(row.branch?.name) || asText(row.branchName) || asText(row.branchId),
    currency: asText(row.currency),
    subtotal: asText(row.totalGoldValue),
    discountTotal: null,
    taxTotal: null,
    grandTotal: asText(total),
    paymentStatus: payment.paymentStatus,
    businessStatus: cgpBusinessStatus(row),
    displayStatus: cgpDisplayStatus(row, payment),
    createdBy: asText(row.createdBy),
    createdAt: row.createdAt || null,
    sourceModule: "customer_gold_purchase",
    operatorAttribution: {
      createdByEmployeeId: null,
      createdByEmployeeName: null,
      finalizedByEmployeeId: null,
      finalizedByEmployeeName: null,
      createdByUserId: asText(row.createdBy),
      postedByUserId: asText(row.postedBy),
    },
    employeeName: actorName,
    canViewDetail: true,
    canPrint: true,
  };
}

function mapCgpAssetLink(link) {
  return {
    cgpItemId: asText(link.cgpItemId),
    assetId: asText(link.assetId),
    ordinal: null,
    mappingClassification: "CGP_ORIGIN",
    sourceOrigin: "asset_origins",
    barcode: asText(link.barcode),
    status: asText(link.status),
    operationalStatus: asText(link.operationalStatus),
    branchId: asText(link.branchId),
  };
}

function mapCgpSettlementRow(row, index) {
  return {
    id: asText(row.legId || row.settlementId) + (row.legId ? "" : ":" + String(index + 1)),
    sourceId: asText(row.sourceDocumentId),
    method: asText(row.method),
    amount: asText(row.amount || row.totalAmount),
    reference: asText(row.bankReference) || asText(row.settlementId),
    date: asText(row.executedAt),
    settlementId: asText(row.settlementId),
    status: asText(row.status),
  };
}

function mapCgpCashTransaction(row) {
  const item = plain(row);
  return {
    id: asText(item.id),
    type: asText(item.type),
    amount: asText(item.amount),
    reference: asText(item.reference),
    journalEntryId: asText(item.journalEntryId),
    status: asText(item.status),
    date: asText(item.date),
  };
}

function mapCgpLine(item, snapshotsByItem, assetLinks) {
  const row = plain(item);
  const snapshot = snapshotsByItem.get(String(row.id)) || null;
  const links = assetLinks.filter((link) => String(link.cgpItemId) === String(row.id));
  const rate = snapshot?.approvedKaratRate ?? snapshot?.finalEffectiveRate ?? row.proposedRate ?? null;
  const lineValue = snapshot?.lineGoldValue ?? null;
  return {
    lineReference: asText(row.id),
    itemReference: asText(row.id),
    assetReference: asText(links[0]?.assetId),
    description: asText(row.goldType),
    quantity: null,
    unit: null,
    unitPrice: asText(rate),
    discount: null,
    tax: null,
    lineTotal: asText(lineValue),
    weight: asText(row.netWeight),
    karat: row.karat === undefined || row.karat === null ? null : row.karat,
    makingCharge: null,
    stoneValue: null,
    goldPurchase: {
      sourceItemId: asText(row.id),
      goldType: asText(row.goldType),
      grossWeight: asText(row.grossWeight),
      stoneWeight: asText(row.stoneWeight),
      netWeight: asText(row.netWeight),
      pureGoldWeight: asText(row.pureGoldWeight),
      fineness: asText(row.fineness),
      purityFactor: asText(row.purityFactor),
      referenceMarketRate: asText(row.referenceMarketRate),
      proposedRate: asText(row.proposedRate),
      rate: snapshot ? {
        value: asText(rate),
        source: asText(snapshot.priceSource),
        version: asText(snapshot.priceVersion),
        timestamp: snapshot.priceTimestamp || null,
        finalEffectiveRate: asText(snapshot.finalEffectiveRate),
        rateBasis: asText(snapshot.rateBasis),
        pricingMode: asText(snapshot.pricingMode),
        provider: asText(snapshot.provider),
        marketQuoteId: asText(snapshot.marketQuoteId),
        derivationMethod: asText(snapshot.derivationMethod),
      } : null,
      lineValue: asText(lineValue),
    },
    assetLinks: links.map(mapCgpAssetLink),
  };
}

function mapCgpPaymentSummary(row, liability, settlements, cashTransactions) {
  const fact = cgpPaymentFact(row, liability);
  return {
    status: fact.paymentStatus,
    statusSource: "customer_financial_liabilities + financial_settlements",
    rows: settlements.map(mapCgpSettlementRow),
    cashTransactions: cashTransactions.map(mapCgpCashTransaction),
    installments: [],
    originalAmount: fact.originalAmount,
    paidAmount: fact.paidAmount,
    outstandingAmount: fact.outstandingAmount,
    remainingAmount: fact.remainingAmount,
    paymentStatus: fact.paymentStatus,
  };
}

function cgpTaxSummary(row, summary) {
  return {
    subtotal: summary.subtotal,
    discount: null,
    taxableBase: null,
    tax: null,
    vatRate: null,
    grandTotal: summary.grandTotal,
    source: "customer_gold_purchase_documents.total_gold_value + total_payable_to_customer",
    snapshotStatus: "NOT_APPLICABLE_SOURCE",
    semantics: "CGP source has no tax fields; no tax is synthesized.",
  };
}

function buildCgpProjection({ document, snapshots = [], assetLinks = [], liability = null, settlements = [], cashTransactions = [], journals = [], journalLines = [] }) {
  const row = assertCgpShape(document);
  const items = Array.isArray(row.items) ? row.items : [];
  const paymentSummary = mapCgpPaymentSummary(row, liability, settlements, cashTransactions);
  const summary = mapCgpSummary(row, paymentSummary);
  const snapshotsByItem = new Map(snapshots.map((snapshot) => [String(snapshot.cgpItemId), snapshot]));
  const normalizedAssetLinks = assetLinks.map(mapCgpAssetLink);
  return {
    summary,
    lines: items.map((item) => mapCgpLine(item, snapshotsByItem, normalizedAssetLinks)),
    taxSummary: cgpTaxSummary(row, summary),
    paymentSummary,
    sourceLinks: {
      source: {
        sourceTable: "customer_gold_purchase_documents",
        sourceType: CGP_SOURCE_TYPE,
        sourceId: summary.sourceId,
      },
      relatedInvoiceId: null,
      assetLinks: normalizedAssetLinks,
      accounting: mapAccountingLinks(journals, journalLines),
      goldValuationEvidence: snapshots.map((snapshot) => ({
        cgpDocumentId: asText(snapshot.cgpDocumentId),
        cgpItemId: asText(snapshot.cgpItemId),
        priceSource: asText(snapshot.priceSource),
        priceVersion: asText(snapshot.priceVersion),
        priceTimestamp: snapshot.priceTimestamp || null,
        approvedKaratRate: asText(snapshot.approvedKaratRate),
        finalEffectiveRate: asText(snapshot.finalEffectiveRate),
        lineGoldValue: asText(snapshot.lineGoldValue),
        rateBasis: asText(snapshot.rateBasis),
        pricingMode: asText(snapshot.pricingMode),
        provider: asText(snapshot.provider),
        marketQuoteId: asText(snapshot.marketQuoteId),
      })),
    },
    audit: {
      sourceCreatedAt: row.createdAt || null,
      sourceUpdatedAt: row.updatedAt || null,
      createdByEmployeeId: null,
      finalizedByEmployeeId: null,
      createdByUserId: asText(row.createdBy),
      postedByUserId: asText(row.postedBy),
      taxSnapshotStatus: "NOT_APPLICABLE_SOURCE",
      readOnly: true,
    },
  };
}

async function findCgpForScope({ sourceId, companyId, branchId }) {
  const where = { id: sourceId, companyId };
  if (branchId) where.branchId = branchId;
  const document = await models.CustomerGoldPurchaseDocument.findOne({
    where,
    include: [
      { model: models.CustomerGoldPurchaseItem, as: "items", required: false },
      { model: models.Customer, as: "customer", attributes: ["id", "name"], required: false },
      { model: models.Branch, as: "branch", attributes: ["id", "name"], required: false },
    ],
  });
  if (document) return document;
  const existing = await models.CustomerGoldPurchaseDocument.findOne({
    where: { id: sourceId },
    attributes: ["id", "companyId", "branchId"],
    raw: true,
  });
  if (existing && (String(existing.companyId) !== String(companyId) || (branchId && String(existing.branchId) !== String(branchId)))) {
    throw projectionError(PROJECTION_ERROR_CODES.SOURCE_FORBIDDEN, 403, "The Customer Gold Purchase source is outside the authorized company or branch scope.");
  }
  throw projectionError(PROJECTION_ERROR_CODES.SOURCE_NOT_FOUND, 404, "The Customer Gold Purchase source was not found.");
}

async function loadCgpReadModel(document, companyId, branchId) {
  const row = plain(document);
  const items = Array.isArray(row.items) ? row.items : [];
  const itemIds = items.map((item) => item.id).filter(Boolean);
  const snapshots = await models.CgpPricingSnapshot.findAll({
    where: { cgpDocumentId: row.id, companyId, branchId },
    order: [["cgpItemId", "ASC"]],
    raw: true,
  });
  const liability = await models.CustomerFinancialLiability.findOne({
    where: { sourceDocumentId: row.id, companyId, branchId },
    raw: true,
  });
  const settlements = await models.sequelize.query(
    `SELECT s.id AS "settlementId", s.source_document_id AS "sourceDocumentId", s.total_amount AS "totalAmount", s.status, s.executed_at AS "executedAt", s.journal_entry_id AS "journalEntryId", l.id AS "legId", l.method, l.amount, l.bank_reference AS "bankReference", l.cash_transaction_id AS "cashTransactionId" FROM financial_settlements s LEFT JOIN financial_settlement_legs l ON l.settlement_id=s.id WHERE s.company_id=:companyId AND s.branch_id=:branchId AND s.source_document_id=:documentId ORDER BY s.executed_at DESC,l.id`,
    { replacements: { companyId, branchId, documentId: row.id }, type: QueryTypes.SELECT },
  );
  const cashIds = settlements.map((item) => item.cashTransactionId).filter(Boolean);
  const cashTransactions = cashIds.length
    ? await models.CashTransaction.findAll({ where: { id: { [Op.in]: cashIds } }, raw: true })
    : [];
  const assetLinks = itemIds.length
    ? await models.sequelize.query(
      `SELECT ao.cgp_item_id AS "cgpItemId", ao.asset_id AS "assetId", a.barcode, a.status, a.operational_status AS "operationalStatus", a.branch_id AS "branchId" FROM asset_origins ao JOIN assets a ON a.id=ao.asset_id WHERE ao.company_id=:companyId AND ao.branch_id=:branchId AND ao.origin_type='CUSTOMER_GOLD_PURCHASE' AND ao.cgp_item_id IN (:itemIds) ORDER BY ao.cgp_item_id,ao.asset_id`,
      { replacements: { companyId, branchId, itemIds }, type: QueryTypes.SELECT },
    )
    : [];
  const journalClauses = [];
  if (row.postingReference) journalClauses.push({ sourceType: "CUSTOMER_GOLD_PURCHASE_ACCOUNTING_RECOGNITION", sourceId: row.postingReference });
  if (liability?.journalEntryId) journalClauses.push({ id: liability.journalEntryId });
  const journals = journalClauses.length
    ? await models.JournalEntry.findAll({
      where: { companyId, [Op.or]: journalClauses },
      attributes: ["id", "companyId", "branchId", "sourceType", "sourceId", "status", "totalDebit", "totalCredit"],
      raw: true,
    })
    : [];
  const journalIds = journals.map((journal) => journal.id);
  const journalLines = journalIds.length
    ? await models.JournalLine.findAll({
      where: { journalEntryId: { [Op.in]: journalIds } },
      attributes: ["id", "journalEntryId", "accountCode", "debit", "credit"],
      raw: true,
    })
    : [];
  return { snapshots, assetLinks, liability, settlements, cashTransactions, journals, journalLines };
}

async function getCgpDetail({ sourceId, companyId, branchId }) {
  const document = await findCgpForScope({ sourceId, companyId, branchId });
  try {
    const related = await loadCgpReadModel(document, companyId, branchId);
    return buildCgpProjection({ document, ...related });
  } catch (error) {
    if (error?.errorCode?.startsWith("PROJECTION_")) throw error;
    throw projectionError(PROJECTION_ERROR_CODES.MAPPING_FAILED, 500, "The Customer Gold Purchase source could not be mapped to the D1 projection contract.");
  }
}

async function listCgpSummaries({ companyId, branchId, filters = {} }) {
  const page = Math.max(Number.parseInt(filters.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(filters.pageSize, 10) || 25, 1), 100);
  const where = { companyId };
  const requestedBranchId = String(filters.branchId || "").trim();
  if (requestedBranchId && requestedBranchId !== "all" && branchId && requestedBranchId !== String(branchId)) {
    throw projectionError(PROJECTION_ERROR_CODES.SOURCE_FORBIDDEN, 403, "The requested branch is outside the authorized branch scope.");
  }
  if (requestedBranchId && requestedBranchId !== "all") where.branchId = requestedBranchId;
  else if (branchId) where.branchId = branchId;
  const conditions = [];
  const search = String(filters.search || "").trim();
  if (search) conditions.push({ [Op.or]: [{ id: { [Op.iLike]: "%" + search + "%" } }, { draftNumber: { [Op.iLike]: "%" + search + "%" } }, { customerId: { [Op.iLike]: "%" + search + "%" } }] });
  if (filters.partyId) conditions.push({ customerId: String(filters.partyId).trim() });
  if (filters.businessStatus) conditions.push({ businessStatus: String(filters.businessStatus).trim().toUpperCase() });
  const status = String(filters.status || "").trim().toLowerCase();
  if (status === "draft") conditions.push({ businessStatus: "DRAFT" });
  if (status === "posted") conditions.push({ businessStatus: "POSTED" });
  if (status === "cancelled") conditions.push({ businessStatus: { [Op.in]: ["CANCELLED", "REVERSED", "VOIDED"] } });
  if (status === "closed" || status === "returned") conditions.push({ id: { [Op.in]: [] } });
  if (filters.employeeId || filters.employee) {
    const employeeWhere = { companyId };
    if (filters.employeeId) {
      employeeWhere.id = String(filters.employeeId).trim();
    } else {
      const employeeSearch = String(filters.employee).trim();
      employeeWhere[Op.or] = [
        { name: { [Op.iLike]: `%${employeeSearch}%` } },
        { employeeCode: { [Op.iLike]: `%${employeeSearch}%` } },
      ];
    }
    const employees = await models.Employee.findAll({
      where: employeeWhere,
      attributes: ["id"],
      raw: true,
    });
    const employeeIds = employees.map((row) => row.id);
    const users = employeeIds.length
      ? await models.User.findAll({
        where: { companyId, defaultEmployeeId: { [Op.in]: employeeIds } },
        attributes: ["id"],
        raw: true,
      })
      : [];
    conditions.push({ createdBy: { [Op.in]: users.map((row) => row.id) } });
  }
  if (filters.dateFrom || filters.dateTo) {
    const range = {};
    if (filters.dateFrom) range[Op.gte] = filters.dateFrom;
    if (filters.dateTo) range[Op.lte] = filters.dateTo;
    conditions.push({ transactionDate: range });
  }
  if (conditions.length) where[Op.and] = conditions;
  const result = await models.CustomerGoldPurchaseDocument.findAndCountAll({
    where,
    include: [
      { model: models.Customer, as: "customer", attributes: ["id", "name"], required: false },
      { model: models.Branch, as: "branch", attributes: ["id", "name"], required: false },
    ],
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const ids = result.rows.map((row) => row.id);
  const actorIds = result.rows.map((row) => plain(row).createdBy).filter(Boolean);
  const actors = actorIds.length
    ? await models.User.findAll({
      where: { companyId, id: { [Op.in]: actorIds } },
      include: [{ model: models.Employee, as: "defaultEmployee", required: false }],
      raw: false,
    })
    : [];
  const actorById = new Map(actors.map((row) => [String(row.id), plain(row)]));
  const liabilities = ids.length
    ? await models.CustomerFinancialLiability.findAll({ where: { companyId, sourceDocumentId: { [Op.in]: ids } }, raw: true })
    : [];
  const liabilityByDocument = new Map(liabilities.map((row) => [String(row.sourceDocumentId), row]));
  return {
    items: result.rows.map((row) => {
      const document = plain(row);
      document.createdByUser = actorById.get(String(document.createdBy)) || null;
      return mapCgpSummary(document, cgpPaymentFact(document, liabilityByDocument.get(String(row.id))));
    }),
    page,
    pageSize,
    total: result.count,
    totalPages: Math.max(Math.ceil(result.count / pageSize), 1),
    filterContract: { sourceTypes: [CGP_SOURCE_TYPE], supportsEmployeeFilter: true, readOnly: true },
  };
}

function normalizeTypeList(filters = {}) {
  const raw = filters.sourceTypes || filters.sourceType || "";
  const requested = Array.isArray(raw) ? raw : String(raw).split(",").map((value) => value.trim()).filter(Boolean);
  if (!requested.length) return [...ACTIVE_PROJECTION_SOURCE_TYPES];
  for (const type of requested) assertActiveSourceType(type);
  return [...new Set(requested.map((type) => String(type).toLowerCase()))];
}

async function listInvoiceSummaries({ companyId, branchId, filters = {} }) {
  const types = normalizeTypeList({ ...filters, sourceTypes: filters.sourceTypes || ACTIVE_INVOICE_TYPES })
    .filter((type) => ACTIVE_INVOICE_TYPES.includes(type));
  if (!types.length) return { items: [], total: 0 };
  const page = Math.max(Number.parseInt(filters.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(filters.pageSize, 10) || 25, 1), 100);
  const where = { companyId, type: { [Op.in]: types } };
  const requestedBranchId = String(filters.branchId || "").trim();
  if (requestedBranchId && requestedBranchId !== "all" && branchId && requestedBranchId !== String(branchId)) {
    throw projectionError(PROJECTION_ERROR_CODES.SOURCE_FORBIDDEN, 403, "The requested branch is outside the authorized branch scope.");
  }
  if (requestedBranchId && requestedBranchId !== "all") where.branchId = requestedBranchId;
  else if (branchId) where.branchId = branchId;
  const conditions = [];
  const search = String(filters.search || "").trim();
  if (search) conditions.push({ [Op.or]: [{ id: { [Op.iLike]: `%${search}%` } }, { invoiceNumber: { [Op.iLike]: `%${search}%` } }] });
  if (filters.partyId) conditions.push({ customerId: String(filters.partyId).trim() });
  if (filters.partyName) conditions.push({ customerName: { [Op.iLike]: `%${String(filters.partyName).trim()}%` } });
  if (filters.employeeId) conditions.push({ [Op.or]: [{ createdByEmployeeId: String(filters.employeeId) }, { finalizedByEmployeeId: String(filters.employeeId) }] });
  if (filters.employee) {
    const employeeSearch = String(filters.employee).trim();
    const employees = await models.Employee.findAll({
      where: { companyId, [Op.or]: [
        { name: { [Op.iLike]: `%${employeeSearch}%` } },
        { employeeCode: { [Op.iLike]: `%${employeeSearch}%` } },
      ] },
      attributes: ["id"],
      raw: true,
    });
    const employeeIds = employees.map((row) => row.id);
    conditions.push({ [Op.or]: [
      { createdByEmployeeId: { [Op.in]: employeeIds } },
      { finalizedByEmployeeId: { [Op.in]: employeeIds } },
    ] });
  }
  if (filters.paymentStatus) conditions.push({ status: String(filters.paymentStatus).trim() });
  if (filters.businessStatus) conditions.push({ postingStatus: String(filters.businessStatus).trim() });
  const status = String(filters.status || "").trim().toLowerCase();
  if (status === "draft") conditions.push({ postingStatus: "draft" });
  if (status === "cancelled") conditions.push({ [Op.or]: [{ postingStatus: "cancelled" }, { status: "cancelled" }] });
  if (status === "returned") conditions.push({ status: "returned" });
  if (status === "closed") conditions.push({ postingStatus: "posted", status: "paid" });
  if (status === "posted") conditions.push({ postingStatus: "posted", status: { [Op.ne]: "paid" } });
  const dateFrom = String(filters.dateFrom || "").trim();
  const dateTo = String(filters.dateTo || "").trim();
  if (dateFrom || dateTo) {
    const range = {};
    if (dateFrom) range[Op.gte] = dateFrom;
    if (dateTo) range[Op.lte] = `${dateTo} 23:59:59.999`;
    conditions.push({ date: range });
  }
  if (conditions.length) where[Op.and] = conditions;

  const result = await models.Invoice.findAndCountAll({
    where,
    include: invoiceInclude(),
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return {
    items: result.rows.map(mapInvoiceSummary),
    page,
    pageSize,
    total: result.count,
    totalPages: Math.max(Math.ceil(result.count / pageSize), 1),
    filterContract: {
      sourceTypes: types,
      supportsEmployeeFilter: true,
      readOnly: true,
    },
  };
}

async function listSummaries({ companyId, branchId, filters = {} }) {
  const page = Math.max(Number.parseInt(filters.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(filters.pageSize, 10) || 25, 1), 100);
  const types = normalizeTypeList(filters);
  const hasCgp = types.includes(CGP_SOURCE_TYPE);
  const hasGiftVoucher = types.includes(GIFT_VOUCHER_SOURCE_TYPE);
  const invoiceTypes = types.filter((type) => ACTIVE_INVOICE_TYPES.includes(type));

  if (hasGiftVoucher && !hasCgp && invoiceTypes.length === 0) {
    return listGiftVoucherSummaries({ companyId, branchId, filters: { ...filters, page, pageSize } });
  }

  if (hasCgp && !hasGiftVoucher && invoiceTypes.length === 0) {
    return listCgpSummaries({ companyId, branchId, filters: { ...filters, page, pageSize } });
  }

  if (!hasCgp && !hasGiftVoucher) {
    return listInvoiceSummaries({ companyId, branchId, filters: { ...filters, sourceTypes: invoiceTypes, page, pageSize } });
  }

  // Mixed reads are a compatibility surface for the future D2 search. Keep
  // both adapters read-only and paginate only after merging their stable
  // source projections; no source is copied into the other domain.
  const invoiceData = invoiceTypes.length
    ? await listInvoiceSummaries({
      companyId,
      branchId,
      filters: { ...filters, sourceTypes: invoiceTypes, page: 1, pageSize: 100 },
    })
    : { items: [], total: 0 };
  const cgpData = hasCgp
    ? await listCgpSummaries({
      companyId,
      branchId,
      filters: { ...filters, page: 1, pageSize: 100 },
    })
    : { items: [], total: 0 };
  const giftVoucherData = hasGiftVoucher
    ? await listGiftVoucherSummaries({
      companyId,
      branchId,
      filters: { ...filters, page: 1, pageSize: 100 },
    })
    : { items: [], total: 0 };
  const items = [...invoiceData.items, ...cgpData.items, ...giftVoucherData.items]
    .sort((left, right) => {
      const dateOrder = String(right.createdAt || right.documentDate || "").localeCompare(String(left.createdAt || left.documentDate || ""));
      if (dateOrder !== 0) return dateOrder;
      const sourceOrder = String(left.sourceType || "").localeCompare(String(right.sourceType || ""));
      return sourceOrder !== 0 ? sourceOrder : String(right.sourceId || "").localeCompare(String(left.sourceId || ""));
    });
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);
  return {
    items: paged,
    page,
    pageSize,
    total: invoiceData.total + cgpData.total + giftVoucherData.total,
    totalPages: Math.max(Math.ceil((invoiceData.total + cgpData.total + giftVoucherData.total) / pageSize), 1),
    filterContract: {
      sourceTypes: types,
      supportsEmployeeFilter: true,
      readOnly: true,
    },
  };
}

function registryForResponse() {
  return Object.values(SOURCE_REGISTRY).map((entry) => ({ ...entry }));
}

module.exports = {
  ACTIVE_INVOICE_TYPES,
  ACTIVE_PROJECTION_SOURCE_TYPES,
  CGP_SOURCE_TYPE,
  GIFT_VOUCHER_SOURCE_TYPE,
  PROJECTION_ERROR_CODES,
  SOURCE_REGISTRY,
  assertActiveSourceType,
  buildCgpProjection,
  buildGiftVoucherProjection,
  buildInvoiceProjection,
  cgpDisplayStatus,
  giftVoucherDisplayStatus,
  getCgpDetail,
  getDetail,
  getGiftVoucherDetail,
  getSourceEntry,
  listCgpSummaries,
  listGiftVoucherSummaries,
  giftVoucherIsInBranchScope,
  listSummaries,
  mapCgpLine,
  mapCgpSummary,
  mapInvoiceLine,
  mapInvoiceSummary,
  invoiceDisplayStatus,
  projectionReference,
  registryForResponse,
};
