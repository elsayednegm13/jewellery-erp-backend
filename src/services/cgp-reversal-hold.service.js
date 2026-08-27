"use strict";

// CGP-IMP-10A request side: creates only immutable reversal-hold intent and a
// transactional outbox event.  Inventory owns the physical state mutation.
const crypto = require("crypto");
const models = require("../models");
const permissionService = require("./permission.service");
const outboxService = require("./outbox.service");
const availability = require("./cgp-availability-evaluator.service");
const { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } = require("../utils/errors");

const REVERSE_PERMISSION = "gold_purchase.cgp.reverse";
const EVENT_TYPE = "CustomerGoldPurchaseReversalHoldRequestedEvent";
const EVENT_VERSION = 1;

function stableId(prefix) { return `${prefix}:${crypto.randomUUID()}`; }
function requiredText(value, field, max = 2000) {
  const text = String(value || "").trim();
  if (!text || text.length > max) throw new ValidationError(`${field} is required`, { [field]: ["required"] });
  return text;
}
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function assertPermission(context) {
  if (!context?.user?.id) throw new ForbiddenError("CGP reversal requires an authenticated user");
  if (!(await permissionService.userHasPermission(context.user, REVERSE_PERMISSION))) throw new ForbiddenError(`${REVERSE_PERMISSION} is required`);
}

async function sourceAssets({ document, transaction }) {
  const rows = await models.sequelize.query(`SELECT ao.asset_id AS "assetId"
    FROM asset_origins ao
    JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id
    WHERE i.document_id=:documentId AND ao.company_id=:companyId
    ORDER BY ao.asset_id ASC FOR UPDATE`, {
    replacements: { documentId: document.id, companyId: document.companyId }, transaction,
    type: models.sequelize.QueryTypes.SELECT,
  });
  if (!rows.length) throw new AppError("Posted CGP has no Inventory Asset for reversal", 409, "CGP_REVERSAL_PRE_INVENTORY_CANCELLATION_NOT_IN_SCOPE");
  const assets = await models.Asset.findAll({ where: { id: rows.map((row) => row.assetId), companyId: document.companyId }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
  if (assets.length !== rows.length) throw new AppError("CGP Asset lineage is incomplete", 409, "CGP_REVERSAL_ASSET_LINEAGE_INCOMPLETE");
  for (const asset of assets) {
    if (asset.branchId !== document.branchId || asset.source !== "customer_gold_purchase" || asset.inventoryProfile !== "CGP_CUSTOMER_GOLD_PURCHASE") {
      throw new AppError("CGP Asset lineage does not match its posted document", 409, "CGP_REVERSAL_ASSET_LINEAGE_INVALID");
    }
  }
  return assets;
}

async function requestHold({ context, cgpDocumentId, reason, idempotencyKey, correlationId = null, causationId = null, transaction } = {}) {
  if (!transaction) throw new ValidationError("CGP reversal hold requires a transaction", { transaction: ["required"] });
  if (!context?.companyId || !context?.branchId) throw new AppError("CGP reversal company and branch context are required", 422, "CGP_REVERSAL_CONTEXT_REQUIRED");
  await assertPermission(context);
  const textReason = requiredText(reason, "reason");
  const key = requiredText(idempotencyKey, "idempotencyKey", 191);
  const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { id: cgpDocumentId, companyId: context.companyId, branchId: context.branchId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!document) throw new NotFoundError("CGP document not found");
  if (document.businessStatus !== "POSTED") throw new ConflictError("CGP reversal hold requires a posted document");
  const postedEvent = await models.OutboxEvent.findOne({ where: { aggregateType: "CustomerGoldPurchaseDocument", aggregateId: document.id, eventType: "CustomerGoldPurchasePostedEvent", eventVersion: 1 }, transaction, lock: transaction.LOCK.UPDATE });
  if (!postedEvent) throw new AppError("CGP posted event is required", 409, "CGP_REVERSAL_POSTED_EVENT_REQUIRED");
  const snapshots = await models.CgpPricingSnapshot.count({ where: { cgpDocumentId: document.id, companyId: document.companyId, branchId: document.branchId }, transaction });
  if (!snapshots) throw new AppError("CGP pricing snapshots are required", 409, "CGP_REVERSAL_PRICING_SNAPSHOTS_REQUIRED");
  const assets = await sourceAssets({ document, transaction });
  const active = await models.CgpReversalRequest.findOne({ where: { cgpDocumentId: document.id }, transaction, lock: transaction.LOCK.UPDATE });
  const requestHash = hash({ cgpDocumentId: document.id, reason: textReason, assetIds: assets.map((asset) => asset.id) });
  if (active) {
    if (active.idempotencyKey === key && active.requestHash === requestHash) return { replayed: true, request: active.toJSON(), holdEventId: active.metadata?.holdEventId || null };
    throw new ConflictError("An active or held CGP reversal request already exists");
  }
  const requestId = stableId("CGPR");
  const eventId = stableId("EVT:CGP_REVERSAL_HOLD");
  const now = new Date();
  const correlation = String(correlationId || eventId);
  const request = await models.CgpReversalRequest.create({
    id: requestId, companyId: document.companyId, branchId: document.branchId, cgpDocumentId: document.id,
    postedEventId: postedEvent.eventId, status: "HOLD_PENDING", reason: textReason, idempotencyKey: key,
    requestHash, correlationId: correlation, causationId: causationId || postedEvent.eventId,
    requestedBy: context.user.id, requestedAt: now,
    metadata: { contract: "CGP_IMP_10A_HOLD_V1", assetIds: assets.map((asset) => asset.id), holdEventId: eventId },
  }, { transaction });
  await outboxService.enqueueEvent({ transaction, event: {
    eventId, eventType: EVENT_TYPE, eventVersion: EVENT_VERSION, aggregateType: "CgpReversalRequest", aggregateId: requestId,
    occurredAt: now, correlationId: correlation, causationId: causationId || postedEvent.eventId,
    payload: { eventId, eventType: EVENT_TYPE, eventVersion: EVENT_VERSION, aggregate: { type: "CgpReversalRequest", id: requestId, companyId: document.companyId, branchId: document.branchId, cgpDocumentId: document.id, postedEventId: postedEvent.eventId }, assetIds: assets.map((asset) => asset.id), reason: textReason },
  } });
  return { replayed: false, request: request.toJSON(), holdEventId: eventId };
}

// No finalizer is exposed in IMP10A.  This explicit negative gate documents
// that HELD does not authorize business REVERSED or any compensation action.
function assertFinalizationPreconditions() {
  throw new AppError("CGP reversal finalization is not in scope until all compensation integrations succeed", 409, "CGP_REVERSAL_FINALIZATION_PRECONDITIONS_REQUIRED");
}

module.exports = { REVERSE_PERMISSION, EVENT_TYPE, EVENT_VERSION, requestHold, assertFinalizationPreconditions, sourceAssets };
