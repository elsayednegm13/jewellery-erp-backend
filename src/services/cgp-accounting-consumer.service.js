"use strict";

// CGP-IMP-05 is intentionally an explicit event-id consumer.  It never scans
// or dispatches the outbox and it has no authority over inventory, treasury,
// settlement, Gold Center, CRM, or asset operational state.
const Decimal = require("decimal.js");
const crypto = require("crypto");
const models = require("../models");
const postingService = require("./posting.service");
const auditService = require("./audit.service");
const { resolveRequiredSemanticAccount } = require("./financial-account-resolver.service");
const { consumeExactlyOnce } = require("./processed-event.service");
const { ensureIntegrationStatus, transitionIntegrationStatus, INTEGRATION_STATUS } = require("./integration-status.service");
const { AppError, ConflictError, NotFoundError, ValidationError } = require("../utils/errors");
const { assertSnapshotPricingProvenance } = require("./cgp-pricing-provenance.service");

const CONSUMER_NAME = "ACCOUNTING";
const EVENT_TYPE = "CustomerGoldPurchasePostedEvent";
const EVENT_VERSION = 1;
const JOURNAL_SOURCE_TYPE = "CUSTOMER_GOLD_PURCHASE_ACCOUNTING_RECOGNITION";
const LIABILITY_SOURCE_TYPE = "CUSTOMER_GOLD_PURCHASE_POSTED";

function amountText(value) {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.lte(0) || decimal.decimalPlaces() > 4) {
    throw new ValidationError("CGP final purchase value must be a positive DECIMAL(20,4)", { totalPayableToCustomer: ["invalid"] });
  }
  return decimal.toFixed(4);
}

function sameText(actual, expected, code) {
  if (String(actual ?? "") !== String(expected ?? "")) {
    throw new AppError("CGP posted event does not match immutable purchase evidence", 409, code);
  }
}

function sameDecimal(actual, expected, code) {
  try {
    if (new Decimal(actual).eq(new Decimal(expected))) return;
  } catch { /* use canonical mismatch error */ }
  throw new AppError("CGP posted event numeric facts do not match immutable purchase evidence", 409, code);
}

function assertExactEvent(event) {
  if (!event) throw new NotFoundError("CGP posted event not found");
  if (event.eventType !== EVENT_TYPE || Number(event.eventVersion) !== EVENT_VERSION) {
    throw new ValidationError("Only CustomerGoldPurchasePostedEvent v1 can be consumed by Accounting", {
      eventType: [EVENT_TYPE], eventVersion: [String(EVENT_VERSION)],
    });
  }
  const payload = event.payload || {};
  const aggregate = payload.aggregate || {};
  sameText(payload.eventId, event.eventId, "CGP_EVENT_ID_MISMATCH");
  sameText(payload.eventType, EVENT_TYPE, "CGP_EVENT_TYPE_MISMATCH");
  sameText(payload.eventVersion, EVENT_VERSION, "CGP_EVENT_VERSION_MISMATCH");
  sameText(aggregate.type, "CustomerGoldPurchaseDocument", "CGP_EVENT_AGGREGATE_TYPE_MISMATCH");
  sameText(aggregate.id, event.aggregateId, "CGP_EVENT_AGGREGATE_ID_MISMATCH");
  if (!Array.isArray(payload.pricing?.lines) || payload.pricing.lines.length === 0) {
    throw new ValidationError("CGP posted event has no immutable pricing lines");
  }
  return { payload, aggregate };
}

async function assertPostedFacts({ event, payload, aggregate, transaction }) {
  const document = await models.CustomerGoldPurchaseDocument.findOne({
    where: { id: aggregate.id, companyId: aggregate.companyId }, transaction, lock: transaction.LOCK.UPDATE,
  });
  if (!document) throw new NotFoundError("CGP posted document not found for Accounting recognition");
  if (document.businessStatus !== "POSTED" || !document.postedAt || !document.postedBy || !document.postingReference) {
    throw new ConflictError("CGP Accounting recognition requires an immutable posted document");
  }
  sameText(document.branchId, aggregate.branchId, "CGP_DOCUMENT_BRANCH_MISMATCH");
  sameText(document.customerId, aggregate.customerId, "CGP_DOCUMENT_CUSTOMER_MISMATCH");
  sameText(document.currency, aggregate.currency, "CGP_DOCUMENT_CURRENCY_MISMATCH");
  // Event v1 intentionally carries its canonical eventId, not a duplicate
  // postingReference field.  The posting service defines them as the same
  // immutable identifier, so validate that relationship against the record.
  sameText(document.postingReference, event.eventId, "CGP_DOCUMENT_POSTING_REFERENCE_MISMATCH");
  sameText(document.postingMetadata?.eventId, event.eventId, "CGP_DOCUMENT_POSTING_EVENT_MISMATCH");
  sameDecimal(document.totalGoldValue, payload.pricing.totalGoldValue, "CGP_DOCUMENT_TOTAL_GOLD_VALUE_MISMATCH");
  sameDecimal(document.totalPayableToCustomer, payload.pricing.totalPayableToCustomer, "CGP_DOCUMENT_FINAL_PURCHASE_VALUE_MISMATCH");
  sameDecimal(payload.pricing.totalPayableToCustomer, payload.pricing.totalGoldValue, "CGP_EVENT_PAYABLE_VALUE_MISMATCH");

  const snapshots = await models.CgpPricingSnapshot.findAll({
    where: { cgpDocumentId: document.id, companyId: document.companyId, branchId: document.branchId },
    order: [["cgpItemId", "ASC"]], transaction, lock: transaction.LOCK.UPDATE,
  });
  if (snapshots.length !== payload.pricing.lines.length) {
    throw new AppError("CGP posted event line count does not match immutable pricing snapshots", 409, "CGP_EVENT_SNAPSHOT_COUNT_MISMATCH");
  }
  const eventLines = new Map(payload.pricing.lines.map((line) => [String(line.cgpItemId), line]));
  if (eventLines.size !== snapshots.length) {
    throw new AppError("CGP posted event pricing item identifiers are invalid", 409, "CGP_EVENT_SNAPSHOT_IDENTIFIERS_INVALID");
  }
  let snapshotTotal = new Decimal(0);
  for (const snapshot of snapshots) {
    assertSnapshotPricingProvenance(snapshot);
    const line = eventLines.get(String(snapshot.cgpItemId));
    if (!line) throw new AppError("CGP posted event is missing an immutable pricing line", 409, "CGP_EVENT_SNAPSHOT_MISSING");
    for (const field of ["priceSource", "priceVersion", "currency", "rateBasis"]) sameText(line[field], snapshot[field], `CGP_EVENT_SNAPSHOT_${field.toUpperCase()}_MISMATCH`);
    for (const field of ["karat", "purityFactor", "grossWeight", "stoneWeight", "netWeight", "pureGoldWeight", "approvedKaratRate", "lineGoldValue", "calculationVersion"]) {
      sameDecimal(line[field], snapshot[field], `CGP_EVENT_SNAPSHOT_${field.toUpperCase()}_MISMATCH`);
    }
    snapshotTotal = snapshotTotal.plus(snapshot.lineGoldValue);
  }
  sameDecimal(snapshotTotal.toFixed(4), document.totalPayableToCustomer, "CGP_DOCUMENT_SNAPSHOT_TOTAL_MISMATCH");
  return { document: document.toJSON(), finalPurchaseValue: amountText(document.totalPayableToCustomer) };
}

async function recognizeAccounting({ transaction, event, document, finalPurchaseValue, failureInjector }) {
  const inventoryAccount = await resolveRequiredSemanticAccount({
    companyId: document.companyId, branchId: document.branchId, roleCode: "INVENTORY_ASSET", transaction,
  });
  const creditorAccount = await resolveRequiredSemanticAccount({
    companyId: document.companyId, branchId: document.branchId, roleCode: "CUSTOMER_CREDITOR", transaction,
  });
  const journal = await postingService.postEntry(document.companyId, {
    transaction,
    branchId: document.branchId,
    sourceType: JOURNAL_SOURCE_TYPE,
    sourceId: event.eventId,
    postedBy: `system:cgp-accounting:${document.postedBy}`,
    date: document.transactionDate,
    precision: 4,
    description: `إثبات شراء ذهب عميل — ${document.draftNumber}`,
  }, [
    { accountId: inventoryAccount.id, debit: finalPurchaseValue, credit: "0.0000", description: `مخزون شراء ذهب عميل ${document.draftNumber}` },
    { accountId: creditorAccount.id, debit: "0.0000", credit: finalPurchaseValue, description: `ذمم دائنة للعميل ${document.draftNumber}` },
  ]);
  if (typeof failureInjector === "function") await failureInjector({ stage: "after_journal", journal, event, document, finalPurchaseValue });
  const liability = await models.CustomerFinancialLiability.create({
    id: `CFL:${crypto.randomUUID()}`,
    companyId: document.companyId,
    branchId: document.branchId,
    customerId: document.customerId,
    sourceType: LIABILITY_SOURCE_TYPE,
    sourceDocumentId: document.id,
    sourceEventId: event.eventId,
    journalEntryId: journal.id,
    currency: document.currency,
    originalAmount: finalPurchaseValue,
    outstandingAmount: finalPurchaseValue,
    settledAmount: "0.0000",
    status: "OPEN",
    recognizedAt: new Date(),
    correlationId: event.correlationId,
    causationId: event.causationId || null,
  }, { transaction });
  if (typeof failureInjector === "function") await failureInjector({ stage: "after_liability", journal, liability: liability.toJSON(), event, document, finalPurchaseValue });
  await auditService.record(document.companyId, {
    action: "cgp.accounting.recognized",
    description: `CGP posted event ${event.eventId} recognized as inventory and customer creditor liability`,
    user: "CGP Accounting Consumer",
    userId: document.postedBy,
    place: document.branchId,
    branch: document.branchId,
    correlationId: event.correlationId,
    sourceDocument: document.postingReference,
    severity: "info",
    after: JSON.stringify({ eventId: event.eventId, journalEntryId: journal.id, customerFinancialLiabilityId: liability.id, finalPurchaseValue }),
  }, { transaction });
  return { journal, liability: liability.toJSON(), inventoryAccount: inventoryAccount.toJSON(), creditorAccount: creditorAccount.toJSON() };
}

async function consumePostedEvent({ eventId, failureInjector = null } = {}) {
  if (!eventId || !String(eventId).trim()) throw new ValidationError("CGP Accounting consumer requires an explicit eventId", { eventId: ["required"] });
  return models.sequelize.transaction(async (transaction) => {
    const event = await models.OutboxEvent.findOne({ where: { eventId: String(eventId) }, transaction, lock: transaction.LOCK.UPDATE });
    const { payload, aggregate } = assertExactEvent(event);
    const facts = await assertPostedFacts({ event, payload, aggregate, transaction });
    const exactEvent = event.toJSON();
    let durable = null;
    const result = await consumeExactlyOnce({
      transaction,
      consumerName: CONSUMER_NAME,
      event: exactEvent,
      effect: async () => {
        const integrationResult = await ensureIntegrationStatus({
          transaction, sourceEventId: event.eventId, aggregateType: event.aggregateType,
          aggregateId: event.aggregateId, consumerName: CONSUMER_NAME, correlationId: event.correlationId,
        });
        const integration = integrationResult.status;
        await transitionIntegrationStatus({ transaction, status: integration, nextStatus: INTEGRATION_STATUS.PROCESSING });
        durable = await recognizeAccounting({ transaction, event: exactEvent, document: facts.document, finalPurchaseValue: facts.finalPurchaseValue, failureInjector });
        await transitionIntegrationStatus({ transaction, status: integration, nextStatus: INTEGRATION_STATUS.SUCCEEDED });
      },
    });
    if (!result.processed) {
      durable = {
        journal: (await models.JournalEntry.findOne({ where: { companyId: facts.document.companyId, sourceType: JOURNAL_SOURCE_TYPE, sourceId: event.eventId }, transaction }))?.toJSON() || null,
        liability: (await models.CustomerFinancialLiability.findOne({ where: { sourceEventId: event.eventId }, transaction }))?.toJSON() || null,
      };
    }
    const integration = await models.IntegrationStatus.findOne({ where: { sourceEventId: event.eventId, consumerName: CONSUMER_NAME }, transaction });
    return { replayed: !result.processed, eventId: event.eventId, finalPurchaseValue: facts.finalPurchaseValue, ...durable, receipt: result.receipt?.toJSON?.() || result.receipt || null, integration: integration?.toJSON() || null };
  });
}

module.exports = {
  CONSUMER_NAME,
  EVENT_TYPE,
  EVENT_VERSION,
  JOURNAL_SOURCE_TYPE,
  LIABILITY_SOURCE_TYPE,
  assertExactEvent,
  assertPostedFacts,
  consumePostedEvent,
};
