"use strict";

const assetMetadataService = require("./asset-metadata.service");
const auditService = require("./audit.service");
const commandActorContext = require("./command-actor-context.service");
const idempotencyService = require("./idempotency.service");
const inventoryV2Runtime = require("./inventory-v2-runtime.service");
const { AppError, NotFoundError } = require("../utils/errors");

const IDEMPOTENCY_SCOPE = "inventory-v2.asset-revision";
const GENERAL_ALLOWED_FIELDS = Object.freeze(["name", "description", "category", "brand", "notes"]);
const GENERAL_ALLOWED_SET = new Set(GENERAL_ALLOWED_FIELDS);
const DEDICATED_FIELDS = new Set([
  "barcode", "rfid", "type", "inventoryProfile", "inventoryCode", "itemCode", "karat", "karatCode",
  "grossWeight", "netWeight", "goldWeight", "netGoldWeight", "price", "cost", "finalPurchaseCost",
  "status", "operationalStatus", "branch", "branchId", "location", "locationId", "tax", "vat", "valuation",
  "sellingPrice", "salePrice", "purchaseCost", "makingCharge", "components", "stoneDetails", "pearlDetails"
]);

function stableValue(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return stableValue(left) === stableValue(right);
}

function valueType(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date) return "datetime";
  if (Array.isArray(value) || typeof value === "object") return "structured";
  return "string";
}

function fail(code, message, statusCode = 422, details = null) {
  throw new AppError(message, statusCode, code, details);
}

function normalizeRequest(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("REVISION_REQUEST_INVALID", "Revision request must be an object.");
  const changes = body.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) {
    fail("REVISION_CHANGES_REQUIRED", "At least one revision change is required.");
  }
  const changeKeys = Object.keys(changes);
  const dedicated = changeKeys.filter((key) => DEDICATED_FIELDS.has(key));
  if (dedicated.length) fail("REVISION_DEDICATED_OPERATION_REQUIRED", "This field requires its dedicated operation.", 422, { fields: dedicated });
  const unknown = changeKeys.filter((key) => !GENERAL_ALLOWED_SET.has(key));
  if (unknown.length) fail("REVISION_FIELD_NOT_ALLOWED", "One or more revision fields are not allowed.", 422, { fields: unknown });
  for (const key of changeKeys) {
    const value = changes[key];
    if (value !== null && typeof value !== "string") {
      fail("REVISION_VALUE_TYPE_INVALID", `Revision field ${key} must be a string or null.`, 422, { field: key });
    }
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) fail("REVISION_REASON_REQUIRED", "Revision reason is required.");
  if (reason.length > 2000) fail("REVISION_REASON_TOO_LONG", "Revision reason is too long.");
  const sourceOperation = typeof body.sourceOperation === "string" ? body.sourceOperation.trim() : "";
  if (!sourceOperation) fail("REVISION_SOURCE_OPERATION_REQUIRED", "Revision sourceOperation is required.");
  if (sourceOperation.length > 120) fail("REVISION_SOURCE_OPERATION_TOO_LONG", "Revision sourceOperation is too long.");
  const sourceReference = body.sourceReference === undefined || body.sourceReference === null ? null : String(body.sourceReference).trim();
  if (sourceReference && sourceReference.length > 255) fail("REVISION_SOURCE_REFERENCE_TOO_LONG", "Revision sourceReference is too long.");
  const expectedUpdatedAt = body.expectedUpdatedAt;
  if (!expectedUpdatedAt || Number.isNaN(new Date(expectedUpdatedAt).getTime())) {
    fail("REVISION_CONCURRENT_CONFLICT", "A valid expectedUpdatedAt precondition is required.", 409);
  }
  return { changes, reason, sourceOperation, sourceReference, expectedUpdatedAt };
}

function normalizeChanges(changes) {
  // Reuse the current Asset metadata validation/normalization contract after
  // revision-specific type and allowlist checks above.
  return assetMetadataService.normalize(changes);
}

async function resolveBranch({ models, req, transaction }) {
  if (!req.companyId) fail("COMPANY_CONTEXT_REQUIRED", "Company context is required.", 422);
  const branchId = String(req.branchId || req.headers["x-branch-id"] || "").trim();
  if (!branchId) fail("REVISION_BRANCH_CONTEXT_REQUIRED", "An authorized active branch is required.", 422);
  const branch = await models.Branch.findOne({ where: { id: branchId, companyId: req.companyId, isActive: true }, transaction });
  if (!branch) fail("REVISION_BRANCH_SCOPE_FORBIDDEN", "The selected branch is invalid or outside the company scope.", 403);
  return branch;
}

async function loadScopedAsset({ models, req, assetId, branchId, transaction, lock = false }) {
  const asset = await models.Asset.findOne({
    where: { id: assetId, companyId: req.companyId },
    transaction,
    ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!asset) throw new NotFoundError("Asset not found.");
  if (!asset.branchId || String(asset.branchId) !== String(branchId)) fail("ASSET_SCOPE_INVALID", "Asset is outside the authorized branch scope.", 403);
  if (!asset.inventoryProfile || !asset.operationalStatus) fail("ASSET_SCOPE_INVALID", "Asset is not an Inventory V2 asset.", 403);
  return asset;
}

function actorSummary(actor) {
  return {
    technicalUserId: actor.technicalUserId || null,
    employeeId: actor.employeeId || null,
    employeeCode: actor.employeeCode || null,
    employeeName: actor.employeeName || null,
    operatorSessionId: actor.operatorSessionId || null,
  };
}

function revisionProjection(revision, changes, actor) {
  return {
    revisionId: revision.id,
    assetId: revision.assetId,
    revisionNo: revision.revisionNo,
    reason: revision.reason,
    occurredAt: revision.occurredAt,
    sourceOperation: revision.sourceOperation,
    sourceReference: revision.sourceReference,
    changes: changes.map((change) => ({
      fieldKey: change.fieldKey,
      oldValue: change.oldValue,
      newValue: change.newValue,
      valueType: change.valueType,
      authorityType: change.authorityType,
      dedicatedOperationReference: change.dedicatedOperationReference,
    })),
    actor: actorSummary(actor),
  };
}

async function createAssetRevision({ models, req, assetId, body }) {
  const input = normalizeRequest(body);
  const branch = await resolveBranch({ models, req });
  const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
  if (!idempotencyKey) fail("REVISION_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for an Asset Revision.");
  if (idempotencyKey.length > 191) fail("REVISION_IDEMPOTENCY_KEY_TOO_LONG", "Idempotency-Key is too long.");
  const requestHash = idempotencyService.hashRequest(IDEMPOTENCY_SCOPE, body, { assetId });
  const transaction = await models.sequelize.transaction();
  try {
    const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope: IDEMPOTENCY_SCOPE, key: idempotencyKey, requestHash, transaction });
    if (!claim.claimed) {
      await transaction.rollback();
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope: IDEMPOTENCY_SCOPE, key: idempotencyKey, requestHash });
      if (prior.state === "replay") return { statusCode: prior.statusCode || 201, body: prior.responseBody };
      return { statusCode: prior.statusCode || 409, body: { success: false, code: "REVISION_IDEMPOTENCY_CONFLICT", errorCode: "REVISION_IDEMPOTENCY_CONFLICT", message: prior.message } };
    }

    const asset = await loadScopedAsset({ models, req, assetId, branchId: branch.id, transaction, lock: true });
    if (new Date(input.expectedUpdatedAt).getTime() !== new Date(asset.updatedAt).getTime()) fail("REVISION_CONCURRENT_CONFLICT", "Asset changed after the client snapshot; reload before revising.", 409);
    const normalizedChanges = normalizeChanges(input.changes);
    const effectiveChanges = Object.keys(normalizedChanges).filter((fieldKey) => !valuesEqual(asset[fieldKey], normalizedChanges[fieldKey]));
    if (!effectiveChanges.length) fail("REVISION_NO_EFFECTIVE_CHANGE", "The revision does not change any Asset metadata.");

    const latest = await models.AssetRevision.findOne({ where: { assetId: asset.id }, order: [["revisionNo", "DESC"], ["id", "DESC"]], transaction, lock: transaction.LOCK.UPDATE });
    const revisionNo = Number(latest?.revisionNo || 0) + 1;
    const occurredAt = new Date();
    const actor = commandActorContext.fromRequest(req);
    const revisionId = inventoryV2Runtime.newId("ASREV");
    const oldValues = Object.fromEntries(effectiveChanges.map((key) => [key, asset[key]]));
    const newValues = Object.fromEntries(effectiveChanges.map((key) => [key, normalizedChanges[key]]));
    await asset.update({ ...newValues, updatedBy: actor.technicalUserId || null }, { transaction });
    const revision = await models.AssetRevision.create({
      id: revisionId, assetId: asset.id, companyId: req.companyId, branchId: branch.id, revisionNo,
      reason: input.reason, sourceOperation: input.sourceOperation, sourceReference: input.sourceReference,
      technicalUserId: actor.technicalUserId || null, employeeId: actor.employeeId || null,
      operatorSessionId: actor.operatorSessionId || null, occurredAt, idempotencyScope: IDEMPOTENCY_SCOPE,
      idempotencyKey, requestHash,
    }, { transaction });
    const changes = [];
    for (const fieldKey of effectiveChanges) {
      changes.push(await models.AssetRevisionChange.create({
        id: inventoryV2Runtime.newId("ASREVCHG"), revisionId, fieldKey, oldValue: oldValues[fieldKey],
        newValue: newValues[fieldKey], valueType: valueType(newValues[fieldKey]),
        authorityType: "GENERAL_REVISION_CHANGE", dedicatedOperationReference: null,
      }, { transaction }));
    }
    const event = await inventoryV2Runtime.recordAssetEvent({
      models, transaction, asset: asset.toJSON(),
      context: { companyId: req.companyId, branchId: branch.id, branchName: branch.name,
        actorId: actor.technicalUserId || null, actorName: actor.technicalUserName || "System",
        employeeCode: actor.employeeCode || null, operatorSessionId: actor.operatorSessionId || null, occurredAt },
      eventType: "ASSET_REVISION_RECORDED", oldStatus: asset.operationalStatus, newStatus: asset.operationalStatus,
      sourceType: "ASSET_REVISION", sourceId: revisionId, note: input.reason, idempotencyKey,
      oldContextExtra: { changes: oldValues }, newContextExtra: { changes: newValues, revisionNo },
    });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "inventory_v2.asset_revision_recorded",
      description: `Asset ${asset.id} metadata revision ${revisionNo} recorded.`, sourceDocument: revisionId,
      branch: branch.name, requiredPermission: "inventory.revision.create",
      requestedOperation: "inventory_v2.asset_revision_create", authorizationResult: "allowed",
      after: JSON.stringify({ revisionId, assetId: asset.id, revisionNo, changes: effectiveChanges, eventId: event.id }),
    }), { transaction });
    const responseBody = { success: true, replayed: false, data: revisionProjection(revision, changes, actor) };
    await idempotencyService.succeed({ request: claim.request, statusCode: 201, responseBody, transaction });
    await transaction.commit();
    return { statusCode: 201, body: responseBody };
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function listAssetRevisions({ models, req, assetId, page = 1, limit = 50 }) {
  const branch = await resolveBranch({ models, req });
  await loadScopedAsset({ models, req, assetId, branchId: branch.id });
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));
  const result = await models.AssetRevision.findAndCountAll({
    where: { assetId, companyId: req.companyId, branchId: branch.id },
    include: [{ model: models.AssetRevisionChange, as: "changes", attributes: ["id"] }], distinct: true,
    order: [["revisionNo", "DESC"], ["id", "DESC"]], limit: safeLimit, offset: (safePage - 1) * safeLimit,
  });
  const items = result.rows.map((revision) => ({
    revisionId: revision.id, assetId: revision.assetId, revisionNo: revision.revisionNo,
    occurredAt: revision.occurredAt, reason: revision.reason, sourceOperation: revision.sourceOperation,
    actor: actorSummary({ technicalUserId: revision.technicalUserId, employeeId: revision.employeeId, operatorSessionId: revision.operatorSessionId }),
    changeCount: revision.changes?.length || 0,
  }));
  return { items, page: safePage, limit: safeLimit, total: result.count, totalPages: Math.ceil(result.count / safeLimit) };
}

async function getAssetRevision({ models, req, assetId, revisionId }) {
  const branch = await resolveBranch({ models, req });
  await loadScopedAsset({ models, req, assetId, branchId: branch.id });
  const revision = await models.AssetRevision.findOne({
    where: { id: revisionId, assetId, companyId: req.companyId, branchId: branch.id },
    include: [{ model: models.AssetRevisionChange, as: "changes", order: [["fieldKey", "ASC"]] }],
  });
  if (!revision) throw new NotFoundError("Asset revision not found.");
  return revisionProjection(revision, revision.changes || [], {
    technicalUserId: revision.technicalUserId, employeeId: revision.employeeId, operatorSessionId: revision.operatorSessionId,
  });
}

module.exports = {
  IDEMPOTENCY_SCOPE, GENERAL_ALLOWED_FIELDS, DEDICATED_FIELDS, stableValue, valuesEqual,
  normalizeRequest, createAssetRevision, listAssetRevisions, getAssetRevision,
};
