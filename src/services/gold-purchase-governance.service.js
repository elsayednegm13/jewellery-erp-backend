const crypto = require("crypto");
const { Op } = require("sequelize");
const models = require("../models");
const draftService = require("./gold-purchase-draft.service");
const permissionService = require("./permission.service");
const auditService = require("./audit.service");
const { AppError, ValidationError, NotFoundError, ForbiddenError } = require("../utils/errors");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonical(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hashSnapshot(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");
}

function snapshotFor(kind, document, documentVersion, submittedBy) {
  const cfg = draftService.CONFIG[kind];
  const value = draftService.serialize(document);
  return canonical({
    schemaVersion: 1,
    aggregateType: kind,
    documentId: value.id,
    documentNumber: value.draftNumber,
    companyId: value.companyId,
    branchId: value.branchId,
    reference: { type: cfg.refKey.replace("Id", ""), id: value[cfg.refKey], name: value[cfg.includeAlias]?.name || null },
    documentDate: value[cfg.dateKey],
    supplierReference: kind === "igp" ? value.supplierReference || null : undefined,
    currency: value.currency,
    exchangeRate: String(value.exchangeRate),
    notes: value.notes || null,
    revisionNumber: value.revisionNumber || 1,
    rootDocumentId: value.rootDocumentId || value.id,
    supersedesDocumentId: value.supersedesDocumentId || null,
    createdBy: value.createdBy,
    submittedBy,
    documentVersion,
    items: (value.items || []).map((item) => {
      const copy = { ...item };
      delete copy.createdAt;
      delete copy.updatedAt;
      delete copy.deletedAt;
      return copy;
    })
  });
}

const fail = (message, code) => { throw new AppError(message, 409, code); };

async function assertAction(kind, context, action, { reviewer = false } = {}) {
  const permission = `gold_purchase.${kind}.${action}`;
  if (!(await permissionService.userHasPermission(context.user, permission))) throw new ForbiddenError(`${permission} is required`);
  return draftService.accessProfile(kind, context, { reviewer });
}

async function audit(kind, context, document, action, before, after, transaction) {
  const branch = await models.Branch.findByPk(document.branchId, { transaction });
  await auditService.record(context.companyId, {
    action: `${kind}.draft.${action}`,
    description: `${kind.toUpperCase()} ${document.draftNumber} ${action.replaceAll("_", " ")}`,
    user: draftService.actorName(context.user), userId: context.user.id,
    branch: branch?.name, sourceDocument: document.draftNumber,
    before: JSON.stringify(before), after: JSON.stringify(after)
  }, { transaction });
}

async function submit(kind, context, id, body, transaction) {
  await assertAction(kind, context, "submit");
  const document = await draftService.findScoped(kind, context, id, transaction, { lock: true });
  const version = draftService.parseVersion(body.version);
  if (document.version !== version) fail("Gold Purchase document version conflict", "STATE_CONFLICT");
  const pending = await models.GoldPurchaseApprovalRequest.findOne({ where: { documentId: id, approvalStatus: "pending" }, transaction, lock: transaction.LOCK.UPDATE });
  if (pending) fail("An approval is already pending", "APPROVAL_ALREADY_PENDING");
  if (document.voidedAt) fail("Voided Gold Purchase document cannot be submitted", "DOCUMENT_NOT_VALIDATED");
  if (document.status !== "validated") fail("Only a validated Gold Purchase document can be submitted", document.status === "approved" ? "DOCUMENT_ALREADY_APPROVED" : "DOCUMENT_NOT_VALIDATED");

  const snapshot = snapshotFor(kind, document, version, context.user.id);
  const approval = await models.GoldPurchaseApprovalRequest.create({
    id: `GPAR:${context.companyId}:${crypto.randomUUID()}`,
    companyId: context.companyId, branchId: document.branchId, aggregateType: kind,
    documentId: id, documentVersion: version, approvalStatus: "pending",
    submittedSnapshot: snapshot, submittedSnapshotHash: hashSnapshot(snapshot),
    requestedBy: context.user.id, requestedAt: new Date(), version: 1
  }, { transaction });
  await document.update({ status: "submitted", submittedAt: approval.requestedAt, submittedBy: context.user.id, currentApprovalRequestId: approval.id, updatedBy: context.user.id, version: version + 1 }, { transaction });
  await audit(kind, context, document, "submitted", { status: "validated", version }, { status: "submitted", version: version + 1, approvalRequestId: approval.id, snapshotHash: approval.submittedSnapshotHash }, transaction);
  return { document: draftService.serialize(await draftService.findScoped(kind, context, id, transaction)), approvalRequest: approval.toJSON() };
}

async function review(kind, context, id, body, decision, transaction) {
  await assertAction(kind, context, decision === "approved" ? "approve" : "reject", { reviewer: true });
  const document = await draftService.findScoped(kind, context, id, transaction, { lock: true });
  const version = draftService.parseVersion(body.version);
  if (document.version !== version) fail("Gold Purchase document version conflict", "STATE_CONFLICT");
  if (document.status !== "submitted" || !document.currentApprovalRequestId) fail("Gold Purchase document is not submitted", "DOCUMENT_NOT_SUBMITTED");
  const approval = await models.GoldPurchaseApprovalRequest.findOne({ where: { id: document.currentApprovalRequestId, companyId: context.companyId, documentId: id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!approval || approval.approvalStatus !== "pending") fail("Approval request is not pending", "APPROVAL_NOT_PENDING");
  if (approval.version !== draftService.parseVersion(body.approvalVersion)) fail("Approval request version conflict", "STATE_CONFLICT");
  if (context.user.id === document.createdBy || context.user.id === approval.requestedBy) fail("Creator or submitter cannot review their own Gold Purchase", "SELF_APPROVAL_FORBIDDEN");
  const reason = String(body.reason || "").trim();
  if (decision === "rejected" && !reason) throw new ValidationError("Rejection reason is required", { reason: ["required"] });
  const currentSnapshot = snapshotFor(kind, document, approval.documentVersion, approval.requestedBy);
  if (hashSnapshot(currentSnapshot) !== approval.submittedSnapshotHash) fail("Submitted Gold Purchase snapshot does not match", "SNAPSHOT_MISMATCH");

  const now = new Date();
  await approval.update({ approvalStatus: decision, reviewedBy: context.user.id, reviewedAt: now, reviewReason: reason || null, version: approval.version + 1 }, { transaction });
  if (decision === "approved") {
    await document.update({ status: "approved", approvedAt: now, approvedBy: context.user.id, currentApprovalRequestId: null, updatedBy: context.user.id, version: version + 1 }, { transaction });
  } else {
    await document.update({ status: "draft", validatedAt: null, validatedBy: null, submittedAt: null, submittedBy: null, currentApprovalRequestId: null, lastRejectedAt: now, lastRejectedBy: context.user.id, lastRejectionReason: reason, updatedBy: context.user.id, version: version + 1 }, { transaction });
  }
  await audit(kind, context, document, decision, { status: "submitted", version, approvalRequestId: approval.id }, { status: decision === "approved" ? "approved" : "draft", version: version + 1, approvalRequestId: approval.id, reason: reason || null }, transaction);
  return { document: draftService.serialize(await draftService.findScoped(kind, context, id, transaction)), approvalRequest: approval.toJSON() };
}

async function createRevision(kind, context, id, body, transaction) {
  await assertAction(kind, context, "create");
  const source = await draftService.findScoped(kind, context, id, transaction, { lock: true });
  const version = draftService.parseVersion(body.version);
  if (source.version !== version) fail("Gold Purchase document version conflict", "STATE_CONFLICT");
  if (source.status !== "approved" || source.voidedAt) fail("Revision source must be an approved Gold Purchase document", "REVISION_SOURCE_NOT_APPROVED");
  const cfg = draftService.CONFIG[kind];
  const sourceValue = draftService.serialize(source);
  const createBody = {
    branchId: source.branchId, [cfg.refKey]: source[cfg.refKey], [cfg.dateKey]: source[cfg.dateKey],
    ...(kind === "igp" ? { supplierReference: source.supplierReference || null } : {}),
    currency: source.currency, exchangeRate: source.exchangeRate, notes: source.notes,
    items: sourceValue.items.map((item) => ({ ...item }))
  };
  const created = await draftService.create(kind, { ...context, branchId: source.branchId }, createBody, transaction);
  const revision = await cfg.Document.findByPk(created.id, { transaction, lock: transaction.LOCK.UPDATE });
  await revision.update({ revisionNumber: (source.revisionNumber || 1) + 1, supersedesDocumentId: source.id, rootDocumentId: source.rootDocumentId || source.id }, { transaction });
  await audit(kind, context, source, "revision_created", { status: "approved", version }, { revisionId: revision.id, revisionNumber: revision.revisionNumber }, transaction);
  return draftService.serialize(await draftService.findScoped(kind, { ...context, branchId: source.branchId }, revision.id, transaction));
}

async function visibleApprovalTypes(context) {
  const names = new Set(await permissionService.getUserPermissionNames(context.user));
  const result = [];
  for (const kind of ["cgp", "igp"]) {
    const prefix = `gold_purchase.${kind}`;
    if (!names.has(`${prefix}.view`) || (!names.has(`${prefix}.approve`) && !names.has(`${prefix}.reject`))) continue;
    if (names.has(`${prefix}.view_all`)) result.push({ kind, mode: "all" });
    else if (names.has(`${prefix}.view_branch`)) result.push({ kind, mode: "branch" });
  }
  return result;
}

function parsePagination(query) {
  const parse = (value, fallback, name) => {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(String(value)) || Number(value) < 1) throw new ValidationError(`Invalid ${name}`, { [name]: ["positive_integer_required"] });
    return Number(value);
  };
  const page = parse(query.page, 1, "page");
  const limit = parse(query.limit, 50, "limit");
  if (limit > 100) throw new ValidationError("Limit exceeds maximum", { limit: ["maximum_100"] });
  return { page, limit };
}

async function listApprovals(context, query = {}) {
  const types = await visibleApprovalTypes(context);
  if (!types.length) throw new ForbiddenError("Gold Purchase approval permission is required");
  const { page, limit } = parsePagination(query);
  if (query.aggregateType && !["cgp", "igp"].includes(query.aggregateType)) throw new ValidationError("Invalid aggregate type", { aggregateType: ["invalid"] });
  if (query.approvalStatus && !["pending", "approved", "rejected", "superseded"].includes(query.approvalStatus)) throw new ValidationError("Invalid approval status", { approvalStatus: ["invalid"] });
  for (const field of ["dateFrom", "dateTo"]) if (query[field] && !/^\d{4}-\d{2}-\d{2}$/.test(String(query[field]))) throw new ValidationError(`Invalid ${field}`, { [field]: ["invalid_date"] });
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) throw new ValidationError("Invalid approval date range", { dateFrom: ["must_not_exceed_date_to"] });
  const where = { companyId: context.companyId, aggregateType: { [Op.in]: types.map((entry) => entry.kind) } };
  if (query.aggregateType) where.aggregateType = query.aggregateType;
  if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
  if (query.requestedBy) where.requestedBy = query.requestedBy;
  if (query.dateFrom || query.dateTo) where.requestedAt = { ...(query.dateFrom ? { [Op.gte]: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}), ...(query.dateTo ? { [Op.lte]: new Date(`${query.dateTo}T23:59:59.999Z`) } : {}) };
  const rows = await models.GoldPurchaseApprovalRequest.findAll({ where, order: [["requestedAt", "DESC"], ["id", "ASC"]] });
  const visible = rows.filter((row) => {
    const type = types.find((entry) => entry.kind === row.aggregateType);
    if (!type || (type.mode === "branch" && row.branchId !== context.branchId)) return false;
    if (query.branchId && row.branchId !== query.branchId) return false;
    const snapshot = row.submittedSnapshot || {};
    if (query.documentNumber && snapshot.documentNumber !== query.documentNumber) return false;
    if (query.customerId && !(row.aggregateType === "cgp" && snapshot.reference?.id === query.customerId)) return false;
    if (query.supplierId && !(row.aggregateType === "igp" && snapshot.reference?.id === query.supplierId)) return false;
    return true;
  });
  const start = (page - 1) * limit;
  return { items: visible.slice(start, start + limit).map((row) => row.toJSON()), pagination: { total: visible.length, page, limit, pages: Math.ceil(visible.length / limit) }, filters: { ...query } };
}

async function getApproval(context, id) {
  const types = await visibleApprovalTypes(context);
  if (!types.length) throw new ForbiddenError("Gold Purchase approval permission is required");
  const row = await models.GoldPurchaseApprovalRequest.findOne({ where: { id, companyId: context.companyId } });
  const type = row && types.find((entry) => entry.kind === row.aggregateType);
  if (!row || !type || (type.mode === "branch" && row.branchId !== context.branchId)) throw new NotFoundError("Gold Purchase approval request not found");
  return row.toJSON();
}

async function history(kind, context, documentId) {
  await draftService.findScoped(kind, context, documentId, null, { includeVoided: true });
  return models.GoldPurchaseApprovalRequest.findAll({ where: { companyId: context.companyId, aggregateType: kind, documentId }, order: [["requestedAt", "ASC"], ["id", "ASC"]] }).then((rows) => rows.map((row) => row.toJSON()));
}

module.exports = { submit, review, createRevision, listApprovals, getApproval, history, hashSnapshot, snapshotFor, assertAction };
