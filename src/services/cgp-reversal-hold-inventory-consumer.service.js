"use strict";

// Explicit event-id Inventory projection for CGP reversal hold.  There is no
// global dispatcher and this consumer has no financial or Gold Center effect.
const models = require("../models");
const inventory = require("./inventory-v2-runtime.service");
const hold = require("./cgp-reversal-hold.service");
const { consumeExactlyOnce } = require("./processed-event.service");
const { ensureIntegrationStatus, transitionIntegrationStatus, INTEGRATION_STATUS } = require("./integration-status.service");
const { AppError, ConflictError, ValidationError } = require("../utils/errors");

const CONSUMER_NAME = "INVENTORY";

function assertExactEvent(event) {
  if (!event || event.eventType !== hold.EVENT_TYPE || Number(event.eventVersion) !== hold.EVENT_VERSION) throw new ValidationError("Only CustomerGoldPurchaseReversalHoldRequestedEvent v1 is supported");
  const payload = event.payload || {};
  if (payload.eventId !== event.eventId || payload.eventType !== hold.EVENT_TYPE || Number(payload.eventVersion) !== hold.EVENT_VERSION || payload.aggregate?.id !== event.aggregateId) {
    throw new AppError("CGP reversal hold event is not canonical", 409, "CGP_REVERSAL_HOLD_EVENT_INVALID");
  }
  return payload;
}

async function consumeHoldEvent({ eventId } = {}) {
  if (!String(eventId || "").trim()) throw new ValidationError("CGP reversal hold consumer requires an explicit eventId", { eventId: ["required"] });
  return models.sequelize.transaction(async (transaction) => {
    const event = await models.OutboxEvent.findOne({ where: { eventId: String(eventId) }, transaction, lock: transaction.LOCK.UPDATE });
    const payload = assertExactEvent(event);
    const result = await consumeExactlyOnce({ transaction, consumerName: CONSUMER_NAME, event: event.toJSON(), effect: async () => {
      const request = await models.CgpReversalRequest.findOne({ where: { id: payload.aggregate.id, companyId: payload.aggregate.companyId, branchId: payload.aggregate.branchId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!request) throw new AppError("CGP reversal hold request not found", 409, "CGP_REVERSAL_HOLD_REQUEST_NOT_FOUND");
      if (!["REQUESTED", "HOLD_PENDING"].includes(request.status)) throw new ConflictError("CGP reversal request is not holdable");
      const ids = [...new Set(payload.assetIds || [])].sort();
      if (!ids.length || ids.length !== (payload.assetIds || []).length) throw new AppError("CGP reversal hold Asset set is invalid", 409, "CGP_REVERSAL_HOLD_ASSET_SET_INVALID");
      const assets = await models.Asset.findAll({ where: { id: ids, companyId: request.companyId }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
      if (assets.length !== ids.length) throw new AppError("CGP reversal hold Asset set is incomplete", 409, "CGP_REVERSAL_HOLD_ASSET_SET_INCOMPLETE");
      const integrationResult = await ensureIntegrationStatus({ transaction, sourceEventId: event.eventId, aggregateType: event.aggregateType, aggregateId: event.aggregateId, consumerName: CONSUMER_NAME, correlationId: event.correlationId });
      await transitionIntegrationStatus({ transaction, status: integrationResult.status, nextStatus: INTEGRATION_STATUS.PROCESSING });
      const context = inventory.createCgpReversalHoldTransitionContext({ companyId: request.companyId, branchId: request.branchId, branchName: assets[0]?.branch || "CGP reversal hold", actorId: request.requestedBy, actorName: "CGP Reversal Hold Inventory Consumer", occurredAt: new Date() });
      for (const asset of assets) {
        if (asset.branchId !== request.branchId || asset.source !== "customer_gold_purchase" || asset.inventoryProfile !== "CGP_CUSTOMER_GOLD_PURCHASE" || !["AVAILABLE", "PENDING_INTEGRATION"].includes(inventory.operationalStatusOf(asset))) {
          throw new AppError("CGP reversal hold requires safe source-linked Assets", 409, "CGP_REVERSAL_HOLD_ASSET_NOT_SAFE");
        }
      }
      for (const asset of assets) await inventory.transitionAsset({ models, transaction, assetId: asset.id, context, toStatus: "REVERSAL_PENDING", eventType: "CGP_REVERSAL_HOLD", movementType: "CGP_REVERSAL_HOLD", sourceType: "CGP_REVERSAL_REQUEST", sourceId: request.id, note: request.reason, idempotencyKey: `CGP_REVERSAL_HOLD:${event.eventId}:${asset.id}` });
      await request.update({ status: "HELD", heldAt: new Date() }, { transaction });
      await transitionIntegrationStatus({ transaction, status: integrationResult.status, nextStatus: INTEGRATION_STATUS.SUCCEEDED });
    } });
    const request = await models.CgpReversalRequest.findOne({ where: { id: payload.aggregate.id }, transaction });
    const integration = await models.IntegrationStatus.findOne({ where: { sourceEventId: event.eventId, consumerName: CONSUMER_NAME }, transaction });
    return { replayed: !result.processed, eventId: event.eventId, request: request?.toJSON() || null, integration: integration?.toJSON() || null, receipt: result.receipt?.toJSON?.() || result.receipt || null };
  });
}

module.exports = { CONSUMER_NAME, consumeHoldEvent, assertExactEvent };
