"use strict";

// A deliberately soft, exact-event CRM projection. It has no authority over
// customer financial balance, the Invoice, Assets, Accounting, or Gold Center.
const crypto = require("crypto");
const Decimal = require("decimal.js");
const models = require("../models");
const { consumeExactlyOnce } = require("./processed-event.service");
const { ensureIntegrationStatus, transitionIntegrationStatus, INTEGRATION_STATUS } = require("./integration-status.service");
const { AppError, ConflictError, NotFoundError, ValidationError } = require("../utils/errors");

const CONSUMER_NAME = "CRM";
const EVENT_TYPE = "CustomerGoldPurchasePostedEvent";
const EVENT_VERSION = 1;
const TRANSACTION_TYPE = "CUSTOMER_GOLD_PURCHASE";
const TIMELINE_EVENT_TYPE = "CUSTOMER_GOLD_PURCHASE_POSTED";

function same(actual, expected, code) { if (String(actual ?? "") !== String(expected ?? "")) throw new AppError("CGP CRM projection does not match immutable posted evidence", 409, code); }
function amount(actual, expected, code) { try { if (new Decimal(actual).eq(new Decimal(expected))) return; } catch {} throw new AppError("CGP CRM amount does not match immutable posted evidence", 409, code); }
function assertExactEvent(event) {
  if (!event) throw new NotFoundError("CGP posted event not found");
  if (event.eventType !== EVENT_TYPE || Number(event.eventVersion) !== EVENT_VERSION) throw new ValidationError("Only CustomerGoldPurchasePostedEvent v1 can be consumed by CRM");
  const payload = event.payload || {}, aggregate = payload.aggregate || {};
  same(payload.eventId, event.eventId, "CGP_CRM_EVENT_ID_MISMATCH"); same(payload.eventType, EVENT_TYPE, "CGP_CRM_EVENT_TYPE_MISMATCH"); same(payload.eventVersion, EVENT_VERSION, "CGP_CRM_EVENT_VERSION_MISMATCH");
  same(aggregate.type, "CustomerGoldPurchaseDocument", "CGP_CRM_AGGREGATE_TYPE_MISMATCH"); same(aggregate.id, event.aggregateId, "CGP_CRM_AGGREGATE_ID_MISMATCH");
  if (!Array.isArray(payload.pricing?.lines) || !payload.pricing.lines.length) throw new ValidationError("CGP posted event has no immutable pricing lines");
  return { payload, aggregate };
}
async function loadPostedFacts({ event, payload, aggregate, transaction }) {
  const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { id: aggregate.id, companyId: aggregate.companyId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!document) throw new NotFoundError("CGP posted document not found for CRM projection");
  if (document.businessStatus !== "POSTED" || !document.postedAt || !document.postingReference) throw new ConflictError("CGP CRM projection requires an immutable posted document");
  for (const key of ["branchId", "customerId", "currency"]) same(document[key], aggregate[key], `CGP_CRM_DOCUMENT_${key.toUpperCase()}_MISMATCH`);
  same(document.postingReference, event.eventId, "CGP_CRM_POSTING_REFERENCE_MISMATCH"); same(document.postingMetadata?.eventId, event.eventId, "CGP_CRM_POSTING_EVENT_MISMATCH");
  amount(document.totalPayableToCustomer, payload.pricing.totalPayableToCustomer, "CGP_CRM_POSTED_AMOUNT_MISMATCH");
  const customer = await models.Customer.findOne({ where: { id: document.customerId, companyId: document.companyId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!customer) throw new AppError("CGP CRM document Customer is invalid", 409, "CGP_CRM_CUSTOMER_INVALID");
  const branch = await models.Branch.findOne({ where: { id: document.branchId, companyId: document.companyId, isActive: true }, transaction });
  if (!branch) throw new AppError("CGP CRM document Branch is invalid", 409, "CGP_CRM_BRANCH_INVALID");
  return { document: document.toJSON(), customer: customer.toJSON(), itemCount: payload.pricing.lines.length, amount: new Decimal(document.totalPayableToCustomer).toFixed(4) };
}
async function project({ transaction, event, facts, failureInjector }) {
  const common = { companyId: facts.document.companyId, branchId: facts.document.branchId, customerId: facts.document.customerId, sourceDocumentType: "CustomerGoldPurchaseDocument", sourceDocumentId: facts.document.id, sourceEventId: event.eventId, occurredAt: facts.document.postedAt };
  const history = await models.CustomerTransactionHistory.create({ id: `CTH:${crypto.randomUUID()}`, ...common, transactionType: TRANSACTION_TYPE, sourceDomain: "SALES", sourceDocumentNumber: facts.document.draftNumber, currency: facts.document.currency, amount: facts.amount, status: "POSTED", metadata: { itemCount: facts.itemCount, sourceBusinessStatus: "POSTED", correlationId: event.correlationId } }, { transaction });
  if (typeof failureInjector === "function") await failureInjector({ stage: "after_history", history: history.toJSON() });
  const timeline = await models.CustomerTimeline.create({ id: `CTL:${crypto.randomUUID()}`, ...common, eventType: TIMELINE_EVENT_TYPE, summary: `Customer Gold Purchase Posted ${facts.document.draftNumber}`, metadata: { transactionType: TRANSACTION_TYPE, currency: facts.document.currency, amount: facts.amount, itemCount: facts.itemCount, status: "POSTED" } }, { transaction });
  if (typeof failureInjector === "function") await failureInjector({ stage: "after_timeline", history: history.toJSON(), timeline: timeline.toJSON() });
  return { history: history.toJSON(), timeline: timeline.toJSON() };
}
async function consumePostedEvent({ eventId, failureInjector = null } = {}) {
  if (!String(eventId || "").trim()) throw new ValidationError("CGP CRM consumer requires an explicit eventId", { eventId: ["required"] });
  return models.sequelize.transaction(async (transaction) => {
    const event = await models.OutboxEvent.findOne({ where: { eventId: String(eventId) }, transaction, lock: transaction.LOCK.UPDATE });
    const { payload, aggregate } = assertExactEvent(event); const facts = await loadPostedFacts({ event, payload, aggregate, transaction }); const exactEvent = event.toJSON(); let durable;
    const result = await consumeExactlyOnce({ transaction, consumerName: CONSUMER_NAME, event: exactEvent, effect: async () => {
      const created = await ensureIntegrationStatus({ transaction, sourceEventId: event.eventId, aggregateType: event.aggregateType, aggregateId: event.aggregateId, consumerName: CONSUMER_NAME, correlationId: event.correlationId });
      if (!created.status) throw new ConflictError("CGP CRM integration status conflict");
      await transitionIntegrationStatus({ transaction, status: created.status, nextStatus: INTEGRATION_STATUS.PROCESSING });
      durable = await project({ transaction, event: exactEvent, facts, failureInjector });
      await transitionIntegrationStatus({ transaction, status: created.status, nextStatus: INTEGRATION_STATUS.SUCCEEDED });
    }});
    if (!result.processed) durable = { history: (await models.CustomerTransactionHistory.findOne({ where: { companyId: facts.document.companyId, sourceEventId: event.eventId }, transaction }))?.toJSON() || null, timeline: (await models.CustomerTimeline.findOne({ where: { companyId: facts.document.companyId, sourceEventId: event.eventId }, transaction }))?.toJSON() || null };
    const integration = await models.IntegrationStatus.findOne({ where: { sourceEventId: event.eventId, consumerName: CONSUMER_NAME }, transaction });
    return { replayed: !result.processed, eventId: event.eventId, ...durable, receipt: result.receipt?.toJSON?.() || result.receipt || null, integration: integration?.toJSON() || null };
  });
}
module.exports = { CONSUMER_NAME, EVENT_TYPE, EVENT_VERSION, TRANSACTION_TYPE, TIMELINE_EVENT_TYPE, assertExactEvent, loadPostedFacts, consumePostedEvent };
