"use strict";

// The table below is Gold Center's narrow immutable source of truth.  It is
// deliberately not a Position, Counterparty, liability, settlement, or read
// projection, and all appends flow through this service.
const crypto = require("crypto");
const models = require("../models");
const { ValidationError } = require("../utils/errors");

const EVENT_TYPE = "CUSTOMER_GOLD_ACQUISITION_RECORDED";
const EVENT_VERSION = 1;
const REVERSAL_EVENT_TYPE = "CUSTOMER_GOLD_ACQUISITION_REVERSED";

function requireTransaction(transaction) {
  if (!transaction) throw new ValidationError("Gold Center append requires a caller transaction", { transaction: ["required"] });
}

async function appendCustomerGoldAcquisition({ transaction, sourceEvent, document, payload } = {}) {
  requireTransaction(transaction);
  if (!sourceEvent?.eventId || !document?.id || !payload?.items?.length) {
    throw new ValidationError("Gold Center core event requires immutable source facts");
  }
  const existing = await models.GoldCoreEvent.findOne({ where: { sourceEventId: sourceEvent.eventId }, transaction, lock: transaction.LOCK.UPDATE });
  if (existing) return { created: false, event: existing };
  const event = await models.GoldCoreEvent.create({
    id: `GCE:${crypto.randomUUID()}`,
    eventType: EVENT_TYPE,
    eventVersion: EVENT_VERSION,
    sourceEventId: sourceEvent.eventId,
    sourceEventType: sourceEvent.eventType,
    sourceEventVersion: Number(sourceEvent.eventVersion),
    sourceDocumentId: document.id,
    sourceDocumentNumber: document.draftNumber,
    postingReference: document.postingReference,
    companyId: document.companyId,
    branchId: document.branchId,
    sourcePartyType: "CUSTOMER",
    sourcePartyId: document.customerId,
    currency: document.currency,
    payload,
    occurredAt: sourceEvent.occurredAt,
    correlationId: sourceEvent.correlationId,
    causationId: sourceEvent.causationId || null,
  }, { transaction });
  return { created: true, event };
}

async function appendCustomerGoldReversal({ transaction, sourceEvent, document, originalEvent, reversalRequest } = {}) {
  requireTransaction(transaction);
  if (!sourceEvent?.eventId || !document?.id || !originalEvent?.id || !reversalRequest?.id) throw new ValidationError("Gold Center reversal requires immutable source lineage");
  const existing = await models.GoldCoreEvent.findOne({ where: { sourceEventId: sourceEvent.eventId }, transaction, lock: transaction.LOCK.UPDATE });
  if (existing) return { created: false, event: existing };
  const originalPayload = originalEvent.payload || {};
  const event = await models.GoldCoreEvent.create({
    id: `GCE:${crypto.randomUUID()}`,
    eventType: REVERSAL_EVENT_TYPE,
    eventVersion: EVENT_VERSION,
    sourceEventId: sourceEvent.eventId,
    sourceEventType: sourceEvent.eventType,
    sourceEventVersion: Number(sourceEvent.eventVersion),
    sourceDocumentId: document.id,
    sourceDocumentNumber: document.draftNumber,
    postingReference: document.postingReference,
    companyId: document.companyId,
    branchId: document.branchId,
    sourcePartyType: "CUSTOMER",
    sourcePartyId: document.customerId,
    currency: document.currency,
    payload: { ...originalPayload, reversalOfGoldCoreEventId: originalEvent.id, reversalRequestId: reversalRequest.id, originalPostedEventId: reversalRequest.postedEventId, compensationEventId: sourceEvent.eventId, pricingSnapshotReuse: true, currentPriceLookup: false },
    occurredAt: sourceEvent.occurredAt,
    correlationId: sourceEvent.correlationId,
    causationId: sourceEvent.causationId || reversalRequest.postedEventId,
  }, { transaction });
  return { created: true, event };
}

module.exports = { EVENT_TYPE, EVENT_VERSION, REVERSAL_EVENT_TYPE, appendCustomerGoldAcquisition, appendCustomerGoldReversal };
