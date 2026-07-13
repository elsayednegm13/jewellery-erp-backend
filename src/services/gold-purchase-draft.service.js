const crypto = require("crypto");
const Decimal = require("decimal.js");
const { Op } = require("sequelize");
const models = require("../models");
const auditService = require("./audit.service");
const permissionService = require("./permission.service");
const measurement = require("./gold-purchase-measurement.service");
const { normalizeCurrencyCode } = require("../utils/currency");
const { AppError, ValidationError, NotFoundError, ConflictError, ForbiddenError } = require("../utils/errors");

const CONFIG = {
  cgp: {
    Document: models.CustomerGoldPurchaseDocument,
    Item: models.CustomerGoldPurchaseItem,
    prefix: "CGPD",
    refKey: "customerId",
    Reference: models.Customer,
    dateKey: "transactionDate",
    includeAlias: "customer"
  },
  igp: {
    Document: models.InvestmentGoldPurchaseDocument,
    Item: models.InvestmentGoldPurchaseItem,
    prefix: "IGPD",
    refKey: "supplierId",
    Reference: models.Supplier,
    dateKey: "purchaseDate",
    includeAlias: "supplier"
  }
};

const actorName = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "System";

const LEGACY_READ = { cgp: "sales.view", igp: "suppliers.view" };

async function accessProfile(kind, context, { reviewer = false } = {}) {
  const names = new Set(await permissionService.getUserPermissionNames(context.user));
  const prefix = `gold_purchase.${kind}`;
  const dedicated = names.has(`${prefix}.view`);
  if (dedicated) {
    if (names.has(`${prefix}.view_all`)) return { mode: "all", dedicated: true, names };
    if (names.has(`${prefix}.view_branch`)) return { mode: "branch", dedicated: true, names };
    if (!reviewer && names.has(`${prefix}.view_own`)) return { mode: "own", dedicated: true, names };
    throw new ForbiddenError(reviewer ? "Approval requires branch or company visibility" : "Gold Purchase visibility scope is required");
  }
  if (!reviewer && names.has(LEGACY_READ[kind])) return { mode: "branch", dedicated: false, names };
  throw new ForbiddenError("Gold Purchase view permission is required");
}

function scopeWhere(context, profile) {
  const where = { companyId: context.companyId };
  if (profile.mode === "branch" || profile.mode === "own") where.branchId = context.branchId;
  if (profile.mode === "own") where.createdBy = context.user.id;
  return where;
}

function assertMutable(document) {
  if (["submitted", "approved"].includes(document.status)) {
    throw new AppError("Submitted and approved Gold Purchase documents are immutable", 409, "DOCUMENT_IMMUTABLE");
  }
}
const roundMoney = (value, field) => {
  if (value === null || value === undefined || value === "") return null;
  try {
    const n = new Decimal(value);
    if (!n.isFinite() || n.lt(0)) throw new Error();
    return n.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  } catch { throw new ValidationError(`${field} must be a non-negative decimal`, { [field]: ["invalid_decimal"] }); }
};

function parseVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new ValidationError("Expected version is required", { version: ["invalid_version"] });
  return version;
}

function normalizeItem(kind, item, lineNumber) {
  if (!item || typeof item !== "object") throw new ValidationError("Each gold line must be an object");
  if (!String(item.goldType || "").trim()) throw new ValidationError("Gold type is required", { goldType: ["required"] });
  const calculated = measurement.calculate(item);
  const common = {
    lineNumber,
    goldType: String(item.goldType).trim(),
    ...calculated,
    referenceMarketRate: roundMoney(item.referenceMarketRate, "referenceMarketRate"),
    notes: item.notes ? String(item.notes) : null
  };
  if (kind === "cgp") {
    return {
      ...common,
      proposedRate: roundMoney(item.proposedRate, "proposedRate"),
      deductionMetadata: item.deductionMetadata && typeof item.deductionMetadata === "object" ? item.deductionMetadata : {}
    };
  }

  const investmentType = String(item.investmentType || "").toLowerCase();
  if (!new Set(["physical", "bullion"]).has(investmentType)) {
    throw new ValidationError("Only physical and bullion investment types are supported", { investmentType: ["unsupported_investment_type"] });
  }
  let bullionIdentityType = item.bullionIdentityType ? String(item.bullionIdentityType).toLowerCase() : null;
  let serialNumber = item.serialNumber ? String(item.serialNumber).trim() : null;
  let lotNumber = item.lotNumber ? String(item.lotNumber).trim() : null;
  if (investmentType === "physical") {
    bullionIdentityType = null; serialNumber = null; lotNumber = null;
  } else if (bullionIdentityType === "serialized_unit") {
    if (!serialNumber) throw new ValidationError("Serialized bullion requires a serial number", { serialNumber: ["required"] });
    lotNumber = null;
  } else if (bullionIdentityType === "bullion_lot") {
    if (!lotNumber) throw new ValidationError("Bullion lot requires a lot number", { lotNumber: ["required"] });
    serialNumber = null;
  } else {
    throw new ValidationError("Bullion identity type must be serialized_unit or bullion_lot", { bullionIdentityType: ["invalid"] });
  }
  const quantity = new Decimal(item.quantity ?? 1);
  if (!quantity.isFinite() || quantity.lte(0)) throw new ValidationError("Quantity must be positive", { quantity: ["must_be_positive"] });
  if (bullionIdentityType === "serialized_unit" && !quantity.eq(1)) throw new ValidationError("Serialized bullion quantity must be one", { quantity: ["serialized_unit_must_equal_one"] });
  return {
    ...common,
    investmentType,
    bullionIdentityType,
    serialNumber,
    lotNumber,
    quantity: quantity.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
    proposedPurchaseRate: roundMoney(item.proposedPurchaseRate, "proposedPurchaseRate"),
    proposedCharges: roundMoney(item.proposedCharges, "proposedCharges"),
    proposedDiscount: roundMoney(item.proposedDiscount, "proposedDiscount"),
    taxModeMetadata: item.taxModeMetadata && typeof item.taxModeMetadata === "object" ? item.taxModeMetadata : {}
  };
}

async function validateHeader(kind, companyId, branchId, body, transaction) {
  const cfg = CONFIG[kind];
  const company = await models.Company.findByPk(companyId, { transaction });
  if (!company) throw new ValidationError("Company is not available");
  const branch = await models.Branch.findOne({ where: { id: branchId, companyId, isActive: true }, transaction });
  if (!branch) throw new ValidationError("Branch is not available", { branchId: ["invalid_or_unavailable"] });
  const refId = body[cfg.refKey];
  const reference = await cfg.Reference.findOne({ where: { id: refId, companyId, status: "active" }, transaction });
  if (!reference) throw new ValidationError(`${cfg.refKey.replace("Id", "")} is not available`, { [cfg.refKey]: ["invalid_or_unavailable"] });
  const currency = normalizeCurrencyCode(body.currency || company.currency);
  if (currency !== normalizeCurrencyCode(company.currency)) throw new ValidationError("Currency is not configured for this company", { currency: ["unsupported"] });
  const exchangeRate = new Decimal(body.exchangeRate ?? 1);
  if (!exchangeRate.isFinite() || exchangeRate.lte(0)) throw new ValidationError("Exchange rate must be positive", { exchangeRate: ["must_be_positive"] });
  const date = body[cfg.dateKey];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new ValidationError(`${cfg.dateKey} is required`, { [cfg.dateKey]: ["invalid_date"] });
  if (!Array.isArray(body.items) || body.items.length === 0) throw new ValidationError("At least one gold line is required", { items: ["required"] });
  return { branch, reference, currency, exchangeRate: exchangeRate.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8) };
}

async function nextDraftNumber(kind, companyId, transaction) {
  const cfg = CONFIG[kind];
  await models.sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:lockKey))", { replacements: { lockKey: `gold-purchase:${kind}:${companyId}` }, transaction });
  const rows = await cfg.Document.findAll({ where: { companyId }, attributes: ["draftNumber"], paranoid: false, transaction });
  let max = 0;
  for (const row of rows) {
    const match = new RegExp(`^${cfg.prefix}-(\\d+)$`).exec(row.draftNumber || "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${cfg.prefix}-${String(max + 1).padStart(6, "0")}`;
}

async function checkIdentities(companyId, items, excludeDocumentId, transaction) {
  for (const item of items) {
    const or = [];
    if (item.serialNumber) or.push({ serialNumber: item.serialNumber });
    if (item.lotNumber) or.push({ lotNumber: item.lotNumber });
    if (!or.length) continue;
    const where = { companyId, [Op.or]: or };
    if (excludeDocumentId) where.documentId = { [Op.ne]: excludeDocumentId };
    if (await models.InvestmentGoldPurchaseItem.findOne({ where, transaction })) {
      throw new ValidationError("Bullion serial or lot reference is already in use", { bullionIdentity: ["duplicate"] });
    }
  }
}

function serialize(document) {
  const value = document.toJSON();
  value.voided = Boolean(value.voidedAt);
  value.items = (value.items || []).sort((a, b) => a.lineNumber - b.lineNumber);
  return value;
}

async function create(kind, context, body, transaction) {
  const cfg = CONFIG[kind];
  const branchId = body.branchId || context.branchId;
  if (branchId !== context.branchId) throw new ForbiddenError("Requested branch is outside the authenticated scope");
  const validated = await validateHeader(kind, context.companyId, branchId, body, transaction);
  const items = body.items.map((item, index) => normalizeItem(kind, item, index + 1));
  if (kind === "igp") await checkIdentities(context.companyId, items, null, transaction);
  const draftNumber = await nextDraftNumber(kind, context.companyId, transaction);
  const id = `${cfg.prefix}:${context.companyId}:${crypto.randomUUID()}`;
  const document = await cfg.Document.create({
    id, companyId: context.companyId, branchId, draftNumber,
    [cfg.refKey]: body[cfg.refKey], [cfg.dateKey]: body[cfg.dateKey],
    ...(kind === "igp" ? { supplierReference: body.supplierReference || null } : {}),
    currency: validated.currency, exchangeRate: validated.exchangeRate, status: "draft", version: 1,
    notes: body.notes || null, createdBy: context.user.id, updatedBy: context.user.id,
    revisionNumber: 1, rootDocumentId: id
  }, { transaction });
  await cfg.Item.bulkCreate(items.map((item) => ({ ...item, id: `${id}:L${item.lineNumber}`, companyId: context.companyId, documentId: id, version: 1 })), { transaction });
  const full = await cfg.Document.findByPk(id, { include: [{ model: cfg.Item, as: "items" }, { model: cfg.Reference, as: cfg.includeAlias, attributes: ["id", "name"] }, { model: models.Branch, as: "branch", attributes: ["id", "name"] }], transaction });
  await auditService.record(context.companyId, { action: `${kind}.draft.created`, description: `${kind.toUpperCase()} draft ${draftNumber} created`, user: actorName(context.user), userId: context.user.id, branch: validated.branch.name, sourceDocument: draftNumber, after: JSON.stringify({ id, draftNumber, version: 1, itemCount: items.length }) }, { transaction });
  return serialize(full);
}

async function findScoped(kind, context, id, transaction, { includeVoided = false, lock = false } = {}) {
  const cfg = CONFIG[kind];
  const profile = await accessProfile(kind, context);
  const where = { id, ...scopeWhere(context, profile) };
  if (!includeVoided) where.voidedAt = null;
  // PostgreSQL cannot apply FOR UPDATE to the nullable side of the outer joins
  // used by the response projection. Lock the draft header first, then load its
  // related display data inside the same transaction.
  if (lock) {
    const lockedHeader = await cfg.Document.findOne({
      where,
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!lockedHeader) throw new NotFoundError("Gold Purchase draft not found");
  }
  const document = await cfg.Document.findOne({ where, include: [{ model: cfg.Item, as: "items", required: false }, { model: cfg.Reference, as: cfg.includeAlias, attributes: ["id", "name"] }, { model: models.Branch, as: "branch", attributes: ["id", "name"] }], transaction });
  if (!document) throw new NotFoundError("Gold Purchase draft not found");
  return document;
}

async function update(kind, context, id, body, transaction) {
  const cfg = CONFIG[kind];
  const document = await findScoped(kind, context, id, transaction, { lock: true });
  assertMutable(document);
  const expectedVersion = parseVersion(body.version);
  if (document.version !== expectedVersion) throw new ConflictError("Gold Purchase draft version conflict");
  const merged = { ...document.toJSON(), ...body, branchId: document.branchId, [cfg.refKey]: body[cfg.refKey] || document[cfg.refKey], [cfg.dateKey]: body[cfg.dateKey] || document[cfg.dateKey], items: body.items || document.items.map((i) => i.toJSON()) };
  const validated = await validateHeader(kind, context.companyId, document.branchId, merged, transaction);
  const items = merged.items.map((item, index) => normalizeItem(kind, item, index + 1));
  if (kind === "igp") await checkIdentities(context.companyId, items, document.id, transaction);
  const before = { version: document.version, status: document.status, items: document.items.map((i) => i.toJSON()) };
  // Items are an owned draft aggregate, so replacement is atomic with the
  // header update. The before image is retained in the immutable audit event;
  // keeping soft-deleted rows would also retain their unique line numbers and
  // prevent a valid edit from recreating line 1.
  await cfg.Item.destroy({ where: { documentId: document.id }, transaction, force: true });
  await cfg.Item.bulkCreate(items.map((item) => ({ ...item, id: `${document.id}:L${item.lineNumber}:${crypto.randomUUID()}`, companyId: context.companyId, documentId: document.id, version: expectedVersion + 1 })), { transaction });
  await document.update({
    [cfg.refKey]: merged[cfg.refKey], [cfg.dateKey]: merged[cfg.dateKey],
    ...(kind === "igp" ? { supplierReference: merged.supplierReference || null } : {}),
    currency: validated.currency, exchangeRate: validated.exchangeRate, notes: merged.notes || null,
    status: "draft", validatedAt: null, validatedBy: null, version: expectedVersion + 1, updatedBy: context.user.id
  }, { transaction });
  await auditService.record(context.companyId, { action: `${kind}.draft.updated`, description: `${kind.toUpperCase()} draft ${document.draftNumber} updated`, user: actorName(context.user), userId: context.user.id, branch: validated.branch.name, sourceDocument: document.draftNumber, before: JSON.stringify(before), after: JSON.stringify({ version: document.version, status: "draft", itemCount: items.length }) }, { transaction });
  return serialize(await findScoped(kind, context, id, transaction));
}

async function validate(kind, context, id, expectedVersion, transaction) {
  const cfg = CONFIG[kind];
  const document = await findScoped(kind, context, id, transaction, { lock: true });
  assertMutable(document);
  const version = parseVersion(expectedVersion);
  if (document.version !== version) throw new ConflictError("Gold Purchase draft version conflict");
  if (document.status === "validated") throw new ConflictError("Gold Purchase draft is already validated");
  const branch = await models.Branch.findByPk(document.branchId, { transaction });
  await document.update({ status: "validated", validatedAt: new Date(), validatedBy: context.user.id, updatedBy: context.user.id, version: version + 1 }, { transaction });
  await auditService.record(context.companyId, { action: `${kind}.draft.validated`, description: `${kind.toUpperCase()} draft ${document.draftNumber} validated`, user: actorName(context.user), userId: context.user.id, branch: branch?.name, sourceDocument: document.draftNumber, before: JSON.stringify({ status: "draft", version }), after: JSON.stringify({ status: "validated", version: version + 1 }) }, { transaction });
  return serialize(await findScoped(kind, context, id, transaction));
}

async function voidDraft(kind, context, id, body, transaction) {
  const document = await findScoped(kind, context, id, transaction, { lock: true });
  assertMutable(document);
  const version = parseVersion(body.version);
  if (document.version !== version) throw new ConflictError("Gold Purchase draft version conflict");
  const reason = String(body.reason || "").trim();
  if (!reason) throw new ValidationError("Void reason is required", { reason: ["required"] });
  const branch = await models.Branch.findByPk(document.branchId, { transaction });
  await document.update({ voidedAt: new Date(), voidedBy: context.user.id, voidReason: reason, updatedBy: context.user.id, version: version + 1 }, { transaction });
  await auditService.record(context.companyId, { action: `${kind}.draft.voided`, description: `${kind.toUpperCase()} draft ${document.draftNumber} voided`, user: actorName(context.user), userId: context.user.id, branch: branch?.name, sourceDocument: document.draftNumber, before: JSON.stringify({ version, voided: false }), after: JSON.stringify({ version: version + 1, voided: true, reason }) }, { transaction });
  return serialize(await findScoped(kind, context, id, transaction, { includeVoided: true }));
}

function pagination(query) {
  const parse = (value, fallback, name) => {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(String(value)) || Number(value) < 1) throw new ValidationError(`Invalid ${name}`, { [name]: ["positive_integer_required"] });
    return Number(value);
  };
  const page = parse(query.page, 1, "page");
  const limit = parse(query.limit, 50, "limit");
  if (limit > 100) throw new ValidationError("Limit exceeds maximum", { limit: ["maximum_100"] });
  return { page, limit, offset: (page - 1) * limit };
}

async function list(kind, context, query, includeVoided) {
  const cfg = CONFIG[kind];
  const { page, limit, offset } = pagination(query);
  const profile = await accessProfile(kind, context);
  if (query.branchId && profile.mode !== "all" && query.branchId !== context.branchId) {
    return { items: [], pagination: { total: 0, page, limit, pages: 0 }, filters: { ...query } };
  }
  if (query.branchId && profile.mode === "all") {
    const available = await models.Branch.findOne({ where: { id: query.branchId, companyId: context.companyId } });
    if (!available) return { items: [], pagination: { total: 0, page, limit, pages: 0 }, filters: { ...query } };
  }
  const where = { ...scopeWhere(context, profile) };
  if (query.branchId) where.branchId = query.branchId;
  if (!includeVoided) where.voidedAt = null;
  for (const key of ["status", "draftNumber", cfg.refKey]) if (query[key]) where[key] = query[key];
  if (query.dateFrom || query.dateTo) where[cfg.dateKey] = { ...(query.dateFrom ? { [Op.gte]: query.dateFrom } : {}), ...(query.dateTo ? { [Op.lte]: query.dateTo } : {}) };
  const itemWhere = {};
  if (query.karat) itemWhere.karat = query.karat;
  if (kind === "igp") for (const key of ["investmentType", "bullionIdentityType", "serialNumber", "lotNumber"]) if (query[key]) itemWhere[key] = query[key];
  const hasItemFilter = Object.keys(itemWhere).length > 0;
  const result = await cfg.Document.findAndCountAll({
    where,
    include: [{ model: cfg.Item, as: "items", where: itemWhere, required: hasItemFilter }, { model: cfg.Reference, as: cfg.includeAlias, attributes: ["id", "name"] }, { model: models.Branch, as: "branch", attributes: ["id", "name"] }],
    distinct: true, order: [[cfg.dateKey, "DESC"], ["createdAt", "DESC"], ["id", "ASC"]], limit, offset
  });
  return { items: result.rows.map(serialize), pagination: { total: result.count, page, limit, pages: Math.ceil(result.count / limit) }, filters: { ...query } };
}

module.exports = { CONFIG, create, update, validate, voidDraft, findScoped, list, serialize, normalizeItem, validateHeader, nextDraftNumber, parseVersion, accessProfile, scopeWhere, actorName };
