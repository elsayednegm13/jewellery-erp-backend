"use strict";

// CGP-IMP-10: explicit-event compensation.  No global dispatcher, Treasury
// recovery, or mutation of original posting facts is permitted here.
const crypto = require("crypto");
const Decimal = require("decimal.js");
const models = require("../models");
const outbox = require("./outbox.service");
const posting = require("./posting.service");
const audit = require("./audit.service");
const resolver = require("./financial-account-resolver.service");
const goldStore = require("./gold-core-event-store.service");
const inventory = require("./inventory-v2-runtime.service");
const permissions = require("./permission.service");
const { AppError, ConflictError, ValidationError } = require("../utils/errors");

const COMPENSATION_EVENT = "CustomerGoldPurchaseReversalRequestedEvent";
const FINAL_EVENT = "CustomerGoldPurchaseReversedEvent";
const VERSION = 1;
const ACCOUNTING = "ACCOUNTING";
const GOLD = "GOLD_CENTER";
const id = (prefix) => `${prefix}:${crypto.randomUUID()}`;
const fixed = (value) => new Decimal(value || 0).toFixed(4);
const exact = (a, b, code) => { if (!new Decimal(a).eq(new Decimal(b))) throw new AppError("CGP reversal financial evidence is inconsistent", 409, code); };
async function assertReverseAuthority(context) {
  if (!context?.user?.id || !(await permissions.userHasPermission(context.user, "gold_purchase.cgp.reverse"))) throw new AppError("gold_purchase.cgp.reverse is required", 403, "CGP_REVERSAL_PERMISSION_REQUIRED");
}

async function lockedRequest({ requestId, transaction }) {
  const request = await models.CgpReversalRequest.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!request) throw new AppError("CGP reversal request was not found", 404, "CGP_REVERSAL_REQUEST_NOT_FOUND");
  const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { id: request.cgpDocumentId, companyId: request.companyId, branchId: request.branchId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!document || document.businessStatus !== "POSTED" || request.status !== "HELD") throw new ConflictError("CGP reversal compensation requires a held posted document");
  const assets = await models.Asset.findAll({ where: { id: request.metadata?.assetIds || [], companyId: request.companyId }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
  if (!assets.length || assets.length !== (request.metadata?.assetIds || []).length || assets.some((asset) => inventory.operationalStatusOf(asset) !== "REVERSAL_PENDING")) throw new AppError("CGP reversal Assets are not safely held", 409, "CGP_REVERSAL_ASSET_HOLD_REQUIRED");
  return { request, document, assets };
}

async function beginCompensation({ requestId, actorId, context, transaction }) {
  await assertReverseAuthority(context);
  const { request, document, assets } = await lockedRequest({ requestId, transaction });
  const eventId = request.compensationEventId || `EVT:CGP_REVERSAL:${request.id}`;
  if (!request.compensationEventId) {
    await outbox.enqueueEvent({ transaction, event: { eventId, eventType: COMPENSATION_EVENT, eventVersion: VERSION, aggregateType: "CgpReversalRequest", aggregateId: request.id, occurredAt: new Date(), correlationId: request.correlationId, causationId: request.postedEventId, payload: { eventId, eventType: COMPENSATION_EVENT, eventVersion: VERSION, reversalRequestId: request.id, cgpDocumentId: document.id, cgpDocumentNumber: document.draftNumber, postedEventId: request.postedEventId, companyId: request.companyId, branchId: request.branchId, customerId: document.customerId, assetIds: assets.map((asset) => asset.id), actorId } } });
    await request.update({ status: "COMPENSATING", compensationEventId: eventId }, { transaction });
  }
  return { request: request.toJSON(), eventId, document: document.toJSON(), assets: assets.map((asset) => asset.toJSON()) };
}

async function reversalEvent({ eventId, transaction }) {
  const event = await models.OutboxEvent.findOne({ where: { eventId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!event || event.eventType !== COMPENSATION_EVENT || Number(event.eventVersion) !== VERSION) throw new AppError("CGP reversal compensation event is invalid", 409, "CGP_REVERSAL_COMPENSATION_EVENT_INVALID");
  const request = await models.CgpReversalRequest.findByPk(event.aggregateId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!request || request.status !== "COMPENSATING" || request.compensationEventId !== event.eventId) throw new ConflictError("CGP reversal request is not compensating");
  const document = await models.CustomerGoldPurchaseDocument.findByPk(request.cgpDocumentId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!document || document.businessStatus !== "POSTED") throw new ConflictError("CGP reversal document is not posted");
  return { event, request, document };
}

async function settlementFacts({ document, transaction }) {
  const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: document.id, sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED" }, transaction, lock: transaction.LOCK.UPDATE });
  if (!liability) throw new AppError("Original CGP customer creditor is required", 409, "CGP_REVERSAL_ACCOUNTING_LINEAGE_UNRESOLVED");
  const original = new Decimal(document.totalPayableToCustomer);
  exact(liability.originalAmount, original, "CGP_REVERSAL_ORIGINAL_AMOUNT_MISMATCH");
  const [rows] = await models.sequelize.query(`SELECT COALESCE(sum(a.amount),0)::numeric AS paid, count(*)::int AS count
    FROM financial_settlement_allocations a JOIN financial_settlements s ON s.id=a.settlement_id
    WHERE a.customer_financial_liability_id=:liabilityId AND s.status='EXECUTED'`, { replacements: { liabilityId: liability.id }, transaction });
  const paid = new Decimal(rows[0].paid || 0); if (paid.lt(0) || paid.gt(original)) throw new AppError("CGP reversal settlement allocations are inconsistent", 409, "CGP_REVERSAL_SETTLEMENT_ALLOCATION_MISMATCH");
  return { liability, original, paid, outstanding: original.minus(paid), allocationCount: Number(rows[0].count || 0) };
}

async function compensateAccounting({ eventId, context, failureInjector = null }) {
  await assertReverseAuthority(context);
  return models.sequelize.transaction(async (transaction) => {
    const { event, request, document } = await reversalEvent({ eventId, transaction });
    const existing = await models.CgpReversalCompensation.findOne({ where: { reversalRequestId: request.id, domain: ACCOUNTING }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing) return { replayed: true, compensation: existing.toJSON() };
    const facts = await settlementFacts({ document, transaction });
    const acquisition = await models.JournalEntry.findOne({ where: { companyId: document.companyId, sourceType: "CUSTOMER_GOLD_PURCHASE_ACCOUNTING_RECOGNITION", sourceId: request.postedEventId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!acquisition || !new Decimal(acquisition.totalDebit).eq(acquisition.totalCredit) || !new Decimal(acquisition.totalDebit).eq(facts.original)) throw new AppError("Original CGP acquisition Journal is invalid", 409, "CGP_REVERSAL_ACCOUNTING_JOURNAL_DEFECT");
    const inventoryAccount = await resolver.resolveRequiredSemanticAccount({ companyId: document.companyId, branchId: document.branchId, roleCode: "INVENTORY_ASSET", transaction });
    const creditor = await resolver.resolveRequiredSemanticAccount({ companyId: document.companyId, branchId: document.branchId, roleCode: "CUSTOMER_CREDITOR", transaction });
    const receivable = facts.paid.gt(0) ? await resolver.resolveRequiredSemanticAccount({ companyId: document.companyId, branchId: document.branchId, roleCode: "ACCOUNTS_RECEIVABLE", transaction }) : null;
    const lines = [];
    if (facts.outstanding.gt(0)) lines.push({ accountId: creditor.id, debit: fixed(facts.outstanding), credit: "0.0000", description: "CGP reversal customer creditor" });
    if (facts.paid.gt(0)) lines.push({ accountId: receivable.id, debit: fixed(facts.paid), credit: "0.0000", description: "CGP reversal customer receivable" });
    lines.push({ accountId: inventoryAccount.id, debit: "0.0000", credit: fixed(facts.original), description: "CGP reversal inventory asset" });
    const journal = await posting.postEntry(document.companyId, { transaction, branchId: document.branchId, sourceType: "CUSTOMER_GOLD_PURCHASE_REVERSAL_COMPENSATION", sourceId: request.id, postedBy: `system:cgp-reversal:${request.requestedBy}`, date: new Date().toISOString().slice(0,10), precision: 4, description: `تعويض عكس شراء ذهب عميل — ${document.draftNumber}` }, lines);
    if (failureInjector) await failureInjector({ stage: "after_journal", journal });
    // The existing sub-ledger invariant is outstanding + settled = original.
    // REVERSED closes the creditor without pretending that Treasury repaid the
    // customer: actual paid evidence remains immutable in compensation
    // metadata and only that amount becomes Accounts Receivable.
    await facts.liability.update({ outstandingAmount: "0.0000", settledAmount: fixed(facts.original), status: "REVERSED" }, { transaction });
    const compensation = await models.CgpReversalCompensation.create({ id: id("CGRC"), reversalRequestId: request.id, domain: ACCOUNTING, compensationEventId: event.eventId, journalEntryId: journal.id, amount: fixed(facts.original), status: "SUCCEEDED", metadata: { originalAcquisitionAmount: fixed(facts.original), paidAmount: fixed(facts.paid), outstandingCreditorAmount: fixed(facts.outstanding), allocationCount: facts.allocationCount, receivableAmount: fixed(facts.paid) } }, { transaction });
    await audit.record(document.companyId, { action: "cgp.reversal.accounting.compensated", description: `CGP reversal accounting compensation ${document.draftNumber}`, user: "CGP reversal Accounting", userId: request.requestedBy, place: document.branchId, branch: document.branchId, correlationId: request.correlationId, after: JSON.stringify({ requestId: request.id, journalEntryId: journal.id }) }, { transaction });
    return { replayed: false, compensation: compensation.toJSON(), journal: journal?.toJSON?.() || journal };
  });
}

async function compensateGold({ eventId, context, failureInjector = null }) {
  await assertReverseAuthority(context);
  return models.sequelize.transaction(async (transaction) => {
    const { event, request, document } = await reversalEvent({ eventId, transaction });
    const existing = await models.CgpReversalCompensation.findOne({ where: { reversalRequestId: request.id, domain: GOLD }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing) return { replayed: true, compensation: existing.toJSON() };
    const original = await models.GoldCoreEvent.findOne({ where: { sourceEventId: request.postedEventId, sourceDocumentId: document.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!original) throw new AppError("Original CGP Gold acquisition event is required", 409, "CGP_REVERSAL_GOLD_COMPENSATION_DEFECT");
    const created = await goldStore.appendCustomerGoldReversal({ transaction, sourceEvent: event.toJSON(), document: document.toJSON(), originalEvent: original.toJSON(), reversalRequest: request.toJSON() });
    if (failureInjector) await failureInjector({ stage: "after_gold", event: created.event });
    const compensation = await models.CgpReversalCompensation.create({ id: id("CGRC"), reversalRequestId: request.id, domain: GOLD, compensationEventId: event.eventId, goldCoreEventId: created.event.id, amount: fixed(document.totalGoldValue), status: "SUCCEEDED", metadata: { originalGoldCoreEventId: original.id, pricingSnapshotReference: original.payload?.items?.map((x) => x.pricingSnapshotId) || [] } }, { transaction });
    return { replayed: !created.created, compensation: compensation.toJSON(), goldEvent: created.event?.toJSON?.() || created.event };
  });
}

async function finalize({ requestId, actorId, context, transaction = null, failureInjector = null }) {
  await assertReverseAuthority(context);
  const run = async (t) => {
    const request = await models.CgpReversalRequest.findByPk(requestId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!request) throw new AppError("CGP reversal request was not found", 404, "CGP_REVERSAL_REQUEST_NOT_FOUND");
    if (request.status === "COMPLETED") return { replayed: true, request: request.toJSON() };
    if (request.status !== "COMPENSATING") throw new ConflictError("CGP reversal request is not ready to finalize");
    const document = await models.CustomerGoldPurchaseDocument.findByPk(request.cgpDocumentId, { transaction: t, lock: t.LOCK.UPDATE });
    const hard = await models.CgpReversalCompensation.findAll({ where: { reversalRequestId: request.id, status: "SUCCEEDED" }, order: [["domain","ASC"]], transaction: t, lock: t.LOCK.UPDATE });
    if (hard.length !== 2 || !hard.find((x)=>x.domain===ACCOUNTING) || !hard.find((x)=>x.domain===GOLD)) throw new AppError("CGP reversal hard compensations are incomplete", 409, "CGP_REVERSAL_FINALIZER_GATE_DEFECT");
    const ids = [...(request.metadata?.assetIds || [])].sort(); const assets = await models.Asset.findAll({ where: { id: ids, companyId: request.companyId }, order: [["id","ASC"]], transaction: t, lock: t.LOCK.UPDATE });
    if (!document || document.businessStatus !== "POSTED" || assets.length !== ids.length || assets.some((a)=>inventory.operationalStatusOf(a)!=="REVERSAL_PENDING")) throw new AppError("CGP reversal finalizer state is invalid", 409, "CGP_REVERSAL_INVENTORY_FINALIZATION_DEFECT");
    const transitionContext = inventory.createCgpReversalFinalizeTransitionContext({ companyId: request.companyId, branchId: request.branchId, branchName: assets[0]?.branch || "CGP reversal finalizer", actorId, actorName: "CGP Reversal Finalizer", occurredAt: new Date() });
    for (const asset of assets) await inventory.transitionAsset({ models, transaction: t, assetId: asset.id, context: transitionContext, toStatus: "REVERSED", eventType: "CGP_REVERSAL_FINALIZED", movementType: "CGP_REVERSAL_FINALIZED", sourceType: "CGP_REVERSAL_REQUEST", sourceId: request.id, idempotencyKey: `CGP_REVERSAL_FINAL:${request.id}:${asset.id}` });
    if (failureInjector) await failureInjector({ stage: "after_assets", assets });
    const finalEventId = `EVT:CGP_REVERSED:${request.id}`;
    await document.update({ businessStatus: "REVERSED" }, { transaction: t });
    await request.update({ status: "COMPLETED", completedAt: new Date(), completedBy: actorId }, { transaction: t });
    await outbox.enqueueEvent({ transaction: t, event: { eventId: finalEventId, eventType: FINAL_EVENT, eventVersion: VERSION, aggregateType: "CustomerGoldPurchaseDocument", aggregateId: document.id, occurredAt: new Date(), correlationId: request.correlationId, causationId: request.compensationEventId, payload: { eventId: finalEventId, eventType: FINAL_EVENT, eventVersion: VERSION, cgpDocumentId: document.id, cgpDocumentNumber: document.draftNumber, companyId: document.companyId, branchId: document.branchId, customerId: document.customerId, reversalRequestId: request.id, originalPostedEventId: request.postedEventId, accountingCompensationReference: hard.find((x)=>x.domain===ACCOUNTING).journalEntryId, goldCompensationReference: hard.find((x)=>x.domain===GOLD).goldCoreEventId, assetIds: ids, originalAcquisitionAmount: hard.find((x)=>x.domain===ACCOUNTING).metadata.originalAcquisitionAmount, paidAmount: hard.find((x)=>x.domain===ACCOUNTING).metadata.paidAmount, receivableAmount: hard.find((x)=>x.domain===ACCOUNTING).metadata.receivableAmount, pricingSnapshotReference: hard.find((x)=>x.domain===GOLD).metadata.pricingSnapshotReference || [] } } });
    await audit.record(document.companyId, { action: "cgp.reversal.finalized", description: `CGP reversal finalized ${document.draftNumber}`, user: "CGP Reversal Finalizer", userId: actorId, place: document.branchId, branch: document.branchId, correlationId: request.correlationId, after: JSON.stringify({ requestId: request.id, finalEventId }) }, { transaction: t });
    return { replayed: false, request: request.toJSON(), document: document.toJSON(), finalEventId };
  };
  return transaction ? run(transaction) : models.sequelize.transaction(run);
}

module.exports = { COMPENSATION_EVENT, FINAL_EVENT, VERSION, beginCompensation, compensateAccounting, compensateGold, finalize, settlementFacts };
