"use strict";

// Explicit, synchronous consumer only.  It never scans/dispatches the
// outbox and never touches Inventory, Accounting, CRM, settlement, or a Gold
// Position/Counterparty projection.
const Decimal = require("decimal.js");
const models = require("../models");
const eventStore = require("./gold-core-event-store.service");
const { consumeExactlyOnce } = require("./processed-event.service");
const { ensureIntegrationStatus, transitionIntegrationStatus, INTEGRATION_STATUS } = require("./integration-status.service");
const { AppError, ConflictError, NotFoundError, ValidationError } = require("../utils/errors");

const CONSUMER_NAME = "GOLD_CENTER";
const EVENT_TYPE = "CustomerGoldPurchasePostedEvent";
const EVENT_VERSION = 1;

function sameText(actual, expected, code) {
  if (String(actual ?? "") !== String(expected ?? "")) throw new AppError("CGP posted event does not match immutable Gold Center evidence", 409, code);
}
function sameDecimal(actual, expected, code) {
  try { if (new Decimal(actual).eq(new Decimal(expected))) return; } catch { /* canonical mismatch */ }
  throw new AppError("CGP posted event numeric facts do not match immutable Gold Center evidence", 409, code);
}
function fixed(value, places, code) {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.lt(0)) throw new AppError("CGP Gold Center evidence is invalid", 409, code);
  return decimal.toFixed(places);
}
function assertExactEvent(event) {
  if (!event) throw new NotFoundError("CGP posted event not found");
  if (event.eventType !== EVENT_TYPE || Number(event.eventVersion) !== EVENT_VERSION) {
    throw new ValidationError("Only CustomerGoldPurchasePostedEvent v1 can be consumed by Gold Center", { eventType: [EVENT_TYPE], eventVersion: [String(EVENT_VERSION)] });
  }
  const payload = event.payload || {}; const aggregate = payload.aggregate || {};
  sameText(payload.eventId, event.eventId, "CGP_EVENT_ID_MISMATCH");
  sameText(payload.eventType, EVENT_TYPE, "CGP_EVENT_TYPE_MISMATCH");
  sameText(payload.eventVersion, EVENT_VERSION, "CGP_EVENT_VERSION_MISMATCH");
  sameText(aggregate.type, "CustomerGoldPurchaseDocument", "CGP_EVENT_AGGREGATE_TYPE_MISMATCH");
  sameText(aggregate.id, event.aggregateId, "CGP_EVENT_AGGREGATE_ID_MISMATCH");
  if (!Array.isArray(payload.pricing?.lines) || !payload.pricing.lines.length) throw new ValidationError("CGP posted event has no immutable pricing lines");
  return { payload, aggregate };
}
async function assertPostedFacts({ event, payload, aggregate, transaction }) {
  const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { id: aggregate.id, companyId: aggregate.companyId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!document) throw new NotFoundError("CGP posted document not found for Gold Center recognition");
  if (document.businessStatus !== "POSTED" || !document.postedAt || !document.postedBy || !document.postingReference) throw new ConflictError("CGP Gold Center recognition requires an immutable posted document");
  for (const field of ["branchId", "customerId", "currency"]) sameText(document[field], aggregate[field], `CGP_DOCUMENT_${field.toUpperCase()}_MISMATCH`);
  sameText(document.postingReference, event.eventId, "CGP_DOCUMENT_POSTING_REFERENCE_MISMATCH");
  sameText(document.postingMetadata?.eventId, event.eventId, "CGP_DOCUMENT_POSTING_EVENT_MISMATCH");
  sameDecimal(document.totalGoldValue, payload.pricing.totalGoldValue, "CGP_DOCUMENT_TOTAL_GOLD_VALUE_MISMATCH");
  sameDecimal(document.totalPayableToCustomer, payload.pricing.totalPayableToCustomer, "CGP_DOCUMENT_FINAL_PURCHASE_VALUE_MISMATCH");
  const snapshots = await models.CgpPricingSnapshot.findAll({ where: { cgpDocumentId: document.id, companyId: document.companyId, branchId: document.branchId }, order: [["cgpItemId", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
  if (snapshots.length !== payload.pricing.lines.length) throw new AppError("CGP posted event line count does not match immutable pricing snapshots", 409, "CGP_EVENT_SNAPSHOT_COUNT_MISMATCH");
  const lines = new Map(payload.pricing.lines.map((line) => [String(line.cgpItemId), line]));
  let value = new Decimal(0);
  const items = [];
  for (const snapshot of snapshots) {
    const line = lines.get(String(snapshot.cgpItemId));
    if (!line) throw new AppError("CGP posted event is missing immutable Gold Center line evidence", 409, "CGP_EVENT_SNAPSHOT_MISSING");
    for (const field of ["priceSource", "priceVersion", "currency", "rateBasis"]) sameText(line[field], snapshot[field], `CGP_EVENT_SNAPSHOT_${field.toUpperCase()}_MISMATCH`);
    for (const field of ["karat", "purityFactor", "grossWeight", "stoneWeight", "netWeight", "pureGoldWeight", "approvedKaratRate", "lineGoldValue", "calculationVersion"]) sameDecimal(line[field], snapshot[field], `CGP_EVENT_SNAPSHOT_${field.toUpperCase()}_MISMATCH`);
    const net = new Decimal(snapshot.netWeight); const purity = new Decimal(snapshot.purityFactor);
    sameDecimal(new Decimal(snapshot.grossWeight).minus(snapshot.stoneWeight), net, "CGP_NET_WEIGHT_FORMULA_MISMATCH");
    sameDecimal(net.mul(purity), snapshot.pureGoldWeight, "CGP_PURE_GOLD_9999_FORMULA_MISMATCH");
    value = value.plus(snapshot.lineGoldValue);
    items.push({ cgpItemId: snapshot.cgpItemId, grossWeight: fixed(snapshot.grossWeight, 6, "CGP_GROSS_WEIGHT_INVALID"), stoneWeight: fixed(snapshot.stoneWeight, 6, "CGP_STONE_WEIGHT_INVALID"), netWeight: fixed(snapshot.netWeight, 6, "CGP_NET_WEIGHT_INVALID"), karat: fixed(snapshot.karat, 6, "CGP_KARAT_INVALID"), purityFactor: fixed(snapshot.purityFactor, 6, "CGP_PURITY_INVALID"), pureGoldWeight: fixed(snapshot.pureGoldWeight, 6, "CGP_PURE_GOLD_INVALID"), approvedKaratRate: fixed(snapshot.approvedKaratRate, 4, "CGP_RATE_INVALID"), acquisitionValue: fixed(snapshot.lineGoldValue, 4, "CGP_VALUE_INVALID"), priceSource: snapshot.priceSource, priceVersion: snapshot.priceVersion, priceTimestamp: new Date(snapshot.priceTimestamp).toISOString(), pricingSnapshotId: snapshot.id, rateBasis: snapshot.rateBasis });
  }
  sameDecimal(value.toFixed(4), document.totalGoldValue, "CGP_DOCUMENT_SNAPSHOT_TOTAL_MISMATCH");
  return { document: document.toJSON(), items, totalGoldValue: fixed(value, 4, "CGP_TOTAL_VALUE_INVALID") };
}
function buildCorePayload({ event, payload, facts }) {
  return { sourceEventId: event.eventId, sourceEventType: event.eventType, sourceEventVersion: Number(event.eventVersion), sourceDocumentId: facts.document.id, sourceDocumentNumber: facts.document.draftNumber, postingReference: facts.document.postingReference, companyId: facts.document.companyId, branchId: facts.document.branchId, sourcePartyType: "CUSTOMER", sourcePartyId: facts.document.customerId, currency: facts.document.currency, postedAt: new Date(facts.document.postedAt).toISOString(), occurredAt: new Date(event.occurredAt).toISOString(), correlationId: event.correlationId, causationId: event.causationId || null, rateBasis: payload.pricing.rateBasis, monetaryFormula: "NET_WEIGHT_X_APPROVED_KARAT_RATE", purityApplication: "EXACTLY_ONCE_AS_PURE_GOLD_EVIDENCE", totalAcquisitionValue: facts.totalGoldValue, items: facts.items };
}
async function consumePostedEvent({ eventId, failureInjector = null } = {}) {
  if (!eventId || !String(eventId).trim()) throw new ValidationError("CGP Gold Center consumer requires an explicit eventId", { eventId: ["required"] });
  return models.sequelize.transaction(async (transaction) => {
    const event = await models.OutboxEvent.findOne({ where: { eventId: String(eventId) }, transaction, lock: transaction.LOCK.UPDATE });
    const { payload, aggregate } = assertExactEvent(event);
    const facts = await assertPostedFacts({ event, payload, aggregate, transaction });
    const exactEvent = event.toJSON(); let durable = null;
    const result = await consumeExactlyOnce({ transaction, consumerName: CONSUMER_NAME, event: exactEvent, effect: async () => {
      const integrationResult = await ensureIntegrationStatus({ transaction, sourceEventId: event.eventId, aggregateType: event.aggregateType, aggregateId: event.aggregateId, consumerName: CONSUMER_NAME, correlationId: event.correlationId });
      if (!integrationResult.status) throw new ConflictError("CGP Gold Center integration status conflict");
      await transitionIntegrationStatus({ transaction, status: integrationResult.status, nextStatus: INTEGRATION_STATUS.PROCESSING });
      durable = await eventStore.appendCustomerGoldAcquisition({ transaction, sourceEvent: exactEvent, document: facts.document, payload: buildCorePayload({ event: exactEvent, payload, facts }) });
      if (typeof failureInjector === "function") await failureInjector({ stage: "after_gold_core_event", event: exactEvent, document: facts.document, goldCoreEvent: durable.event.toJSON() });
      await transitionIntegrationStatus({ transaction, status: integrationResult.status, nextStatus: INTEGRATION_STATUS.SUCCEEDED });
    }});
    if (!result.processed) durable = { created: false, event: await models.GoldCoreEvent.findOne({ where: { sourceEventId: event.eventId }, transaction }) };
    const integration = await models.IntegrationStatus.findOne({ where: { sourceEventId: event.eventId, consumerName: CONSUMER_NAME }, transaction });
    return { replayed: !result.processed, eventId: event.eventId, goldCoreEvent: durable.event?.toJSON?.() || durable.event || null, receipt: result.receipt?.toJSON?.() || result.receipt || null, integration: integration?.toJSON?.() || null };
  });
}
module.exports = { CONSUMER_NAME, EVENT_TYPE, EVENT_VERSION, assertExactEvent, assertPostedFacts, buildCorePayload, consumePostedEvent };
