"use strict";

const { Op, QueryTypes } = require("sequelize");
const models = require("../models");
const { AppError } = require("../utils/errors");

const ACTIVE_INVOICE_TYPES = Object.freeze([
  "sale",
  "return",
  "exchange",
  "installment",
  "deposit",
]);

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
    displayNumberField: "gift_vouchers.code",
    businessModule: "gift_vouchers",
    partyType: "CUSTOMER",
    status: "SUPPORTED_LATER",
    adapter: null,
    reason: "Gift Voucher is a separate liability source and has no proven invoice projection adapter in D1.",
    canViewDetail: false,
    canPrint: false,
  }),
  customer_gold_purchase: Object.freeze({
    sourceType: "customer_gold_purchase",
    sourceTable: "customer_gold_purchase_documents",
    sourceIdField: "customer_gold_purchase_documents.id",
    displayNumberField: "customer_gold_purchase_documents.draft_number",
    businessModule: "customer_gold_purchase",
    partyType: "CUSTOMER",
    status: "SUPPORTED_LATER",
    adapter: null,
    extensionPoint: "CGP_ADAPTER",
    reason: "CGP remains its own aggregate; the client invoice projection is the separate E-stage adapter.",
    canViewDetail: false,
    canPrint: false,
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
  if (!entry || entry.status !== "SUPPORTED_NOW" || entry.adapter !== "invoice") {
    throw projectionError(
      PROJECTION_ERROR_CODES.UNSUPPORTED_SOURCE_TYPE,
      422,
      "The requested source type is not available in the D1 projection foundation.",
      { sourceType: String(sourceType || ""), registryStatus: entry?.status || "UNKNOWN" },
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
  const entry = assertActiveSourceType(row.type);
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
    currency: asText(row.currency) || null,
    subtotal: asText(row.subtotal),
    discountTotal: asText(row.discount),
    taxTotal: asText(row.tax),
    grandTotal: asText(row.total),
    paymentStatus: asText(row.status),
    businessStatus: asText(row.postingStatus),
    createdBy: attribution.createdByEmployeeId,
    createdAt: row.createdAt || null,
    sourceModule: entry.businessModule,
    operatorAttribution: attribution,
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
  ];
}

async function loadRelatedReadModel(invoice, companyId) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const itemIds = items.map((item) => item.id).filter((id) => id !== undefined && id !== null);
  const assetLinks = itemIds.length
    ? await models.sequelize.query(
      `SELECT invoice_item_id AS "invoiceItemId", asset_id AS "assetId", ordinal,
              quote_snapshot AS "quoteSnapshot", cost_snapshot_revision_id AS "costSnapshotRevisionId",
              mapping_classification AS "mappingClassification"
         FROM invoice_item_asset_links
        WHERE company_id = :companyId AND invoice_item_id IN (:itemIds)
        ORDER BY invoice_item_id, ordinal`,
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
  const entry = assertActiveSourceType(sourceType);
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
  const invoice = await findInvoiceForScope({ sourceType, sourceId, companyId, branchId });
  try {
    const related = await loadRelatedReadModel(invoice, companyId);
    return buildInvoiceProjection({ invoice, ...related });
  } catch (error) {
    if (error?.errorCode?.startsWith("PROJECTION_")) throw error;
    throw projectionError(PROJECTION_ERROR_CODES.MAPPING_FAILED, 500, "The invoice source could not be mapped to the D1 projection contract.");
  }
}

function normalizeTypeList(filters = {}) {
  const raw = filters.sourceTypes || filters.sourceType || "";
  const requested = Array.isArray(raw) ? raw : String(raw).split(",").map((value) => value.trim()).filter(Boolean);
  if (!requested.length) return [...ACTIVE_INVOICE_TYPES];
  for (const type of requested) assertActiveSourceType(type);
  return [...new Set(requested.map((type) => String(type).toLowerCase()))];
}

async function listSummaries({ companyId, branchId, filters = {} }) {
  const page = Math.max(Number.parseInt(filters.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(filters.pageSize, 10) || 25, 1), 100);
  const types = normalizeTypeList(filters);
  const where = { companyId, type: { [Op.in]: types } };
  if (branchId) where.branchId = branchId;
  const conditions = [];
  const search = String(filters.search || "").trim();
  if (search) conditions.push({ [Op.or]: [{ id: { [Op.iLike]: `%${search}%` } }, { invoiceNumber: { [Op.iLike]: `%${search}%` } }] });
  if (filters.partyId) conditions.push({ customerId: String(filters.partyId).trim() });
  if (filters.partyName) conditions.push({ customerName: { [Op.iLike]: `%${String(filters.partyName).trim()}%` } });
  if (filters.employeeId) conditions.push({ [Op.or]: [{ createdByEmployeeId: String(filters.employeeId) }, { finalizedByEmployeeId: String(filters.employeeId) }] });
  if (filters.paymentStatus) conditions.push({ status: String(filters.paymentStatus).trim() });
  if (filters.businessStatus) conditions.push({ postingStatus: String(filters.businessStatus).trim() });
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
    order: [["createdAt", "DESC"]],
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
      supportsFutureEmployeeFilter: true,
      readOnly: true,
    },
  };
}

function registryForResponse() {
  return Object.values(SOURCE_REGISTRY).map((entry) => ({ ...entry }));
}

module.exports = {
  ACTIVE_INVOICE_TYPES,
  PROJECTION_ERROR_CODES,
  SOURCE_REGISTRY,
  assertActiveSourceType,
  buildInvoiceProjection,
  getDetail,
  getSourceEntry,
  listSummaries,
  mapInvoiceLine,
  mapInvoiceSummary,
  projectionReference,
  registryForResponse,
};

