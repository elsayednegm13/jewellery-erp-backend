"use strict";

// CGP-IMP-10: CRM is deliberately a soft, retryable projection of the final
// reversal event.  It never owns or rolls back Accounting, Gold, Inventory,
// the document, or the reversal request.
const crypto = require("crypto");
const models = require("../models");
const { consumeExactlyOnce } = require("./processed-event.service");
const { ensureIntegrationStatus, transitionIntegrationStatus, INTEGRATION_STATUS } = require("./integration-status.service");
const { AppError, ConflictError, ValidationError } = require("../utils/errors");

const CONSUMER_NAME = "CRM";
const EVENT_TYPE = "CustomerGoldPurchaseReversedEvent";
const EVENT_VERSION = 1;

function assertFinalEvent(event) {
  const payload = event?.payload || {};
  if (!event || event.eventType !== EVENT_TYPE || Number(event.eventVersion) !== EVENT_VERSION || payload.eventId !== event.eventId || !payload.reversalRequestId || !payload.cgpDocumentId || !payload.companyId || !payload.branchId || !payload.customerId) {
    throw new ValidationError("Only CustomerGoldPurchaseReversedEvent v1 can be consumed by CGP CRM reversal");
  }
  return payload;
}

async function consumeReversedEvent({ eventId, failureInjector = null } = {}) {
  if (!String(eventId || "").trim()) throw new ValidationError("CGP reversal CRM consumer requires an explicit eventId", { eventId: ["required"] });
  return models.sequelize.transaction(async (transaction) => {
    const event = await models.OutboxEvent.findOne({ where: { eventId: String(eventId) }, transaction, lock: transaction.LOCK.UPDATE });
    const payload = assertFinalEvent(event);
    const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { id: payload.cgpDocumentId, companyId: payload.companyId, branchId: payload.branchId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!document || document.businessStatus !== "REVERSED") throw new ConflictError("CGP CRM reversal projection requires a finalized reversed document");
    let durable;
    const result = await consumeExactlyOnce({ transaction, consumerName: CONSUMER_NAME, event: event.toJSON(), effect: async () => {
      const created = await ensureIntegrationStatus({ transaction, sourceEventId: event.eventId, aggregateType: event.aggregateType, aggregateId: event.aggregateId, consumerName: CONSUMER_NAME, correlationId: event.correlationId });
      await transitionIntegrationStatus({ transaction, status: created.status, nextStatus: INTEGRATION_STATUS.PROCESSING });
      const common = { companyId: document.companyId, branchId: document.branchId, customerId: document.customerId, sourceDocumentType: "CustomerGoldPurchaseDocument", sourceDocumentId: document.id, sourceDocumentNumber: document.draftNumber, sourceEventId: event.eventId, occurredAt: event.occurredAt };
      const history = await models.CustomerTransactionHistory.create({ id: `CTH:${crypto.randomUUID()}`, ...common, transactionType: "CUSTOMER_GOLD_PURCHASE_REVERSAL", sourceDomain: "SALES", currency: document.currency, amount: payload.originalAcquisitionAmount, status: "REVERSED", metadata: { reversalRequestId: payload.reversalRequestId, originalPostedEventId: payload.originalPostedEventId, correlationId: event.correlationId } }, { transaction });
      if (failureInjector) await failureInjector({ stage: "after_history", history: history.toJSON() });
      const timeline = await models.CustomerTimeline.create({ id: `CTL:${crypto.randomUUID()}`, ...common, eventType: "CUSTOMER_GOLD_PURCHASE_REVERSED", summary: `Customer Gold Purchase Reversed ${document.draftNumber}`, metadata: { reversalRequestId: payload.reversalRequestId, status: "REVERSED" } }, { transaction });
      if (failureInjector) await failureInjector({ stage: "after_timeline", history: history.toJSON(), timeline: timeline.toJSON() });
      durable = { history: history.toJSON(), timeline: timeline.toJSON() };
      await transitionIntegrationStatus({ transaction, status: created.status, nextStatus: INTEGRATION_STATUS.SUCCEEDED });
    } });
    if (!result.processed) durable = { history: await models.CustomerTransactionHistory.findOne({ where: { sourceEventId: event.eventId }, transaction }), timeline: await models.CustomerTimeline.findOne({ where: { sourceEventId: event.eventId }, transaction }) };
    return { replayed: !result.processed, eventId: event.eventId, ...durable };
  });
}

module.exports = { CONSUMER_NAME, EVENT_TYPE, EVENT_VERSION, assertFinalEvent, consumeReversedEvent };
