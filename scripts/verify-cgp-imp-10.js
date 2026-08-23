"use strict";

// CGP-IMP-10 controlled acceptance proof.  It is deliberately explicit about
// each event consumer; it never claims an outbox backlog or starts a global
// dispatcher.  --cases is restricted to a disposable clone.  --controlled
// advances the single authorised CGPD-000071 continuation fixture.
const assert = require("node:assert/strict");
const path = require("path");
const { Op, QueryTypes } = require("sequelize");
const Decimal = require("decimal.js");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const DB = String(process.env.CGP_IMP10_DB || ACCEPTANCE).trim();
const CLONE = /^darfus_erp_cgp_imp10_(?:test|race)_[a-z0-9_]+$/;
const casesMode = process.argv.includes("--cases");
const controlledMode = process.argv.includes("--controlled");
const verifyMode = process.argv.includes("--verify-existing");
if ((casesMode ? 1 : 0) + (controlledMode ? 1 : 0) + (verifyMode ? 1 : 0) !== 1) throw new Error("CGP_IMP10_MODE_REQUIRED");
if (casesMode && !CLONE.test(DB)) throw new Error("CGP_IMP10_CASES_CLONE_REQUIRED");
if ((controlledMode || verifyMode) && DB !== ACCEPTANCE) throw new Error("CGP_IMP10_CONTROLLED_ACCEPTANCE_REQUIRED");
process.env.DATABASE_URL = ""; process.env.DB_NAME = DB;
const models = require("../src/models");
const draft = require("../src/services/gold-purchase-draft.service");
const posting = require("../src/services/cgp-posting.service");
const permissions = require("../src/services/permission.service");
const inventoryConsumer = require("../src/services/cgp-inventory-consumer.service");
const accountingConsumer = require("../src/services/cgp-accounting-consumer.service");
const goldConsumer = require("../src/services/cgp-gold-center-consumer.service");
const availability = require("../src/services/cgp-availability-evaluator.service");
const hold = require("../src/services/cgp-reversal-hold.service");
const holdConsumer = require("../src/services/cgp-reversal-hold-inventory-consumer.service");
const reversal = require("../src/services/cgp-reversal-compensation.service");
const crm = require("../src/services/cgp-reversal-crm-consumer.service");
const settlements = require("../src/services/financial-settlement.service");
const approvalPolicy = require("../src/services/financial-approval-policy.service");

const MARKER = "ACCEPTANCE_TEST_CGP_IMP10";
async function target() { const rows = await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }); assert.equal(rows[0]?.db, DB, "CGP-IMP-10 refuses a non-authorised database"); }
async function count(sql, replacements = {}) { return Number((await models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }))[0]?.count || 0); }
async function context() {
  for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true } });
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" } });
    const price = await models.GoldPrice.findOne({ where: { companyId: company.id, currency: company.currency || "AED", karat: 21, approvalStatus: "APPROVED", validFrom: { [Op.lte]: new Date() }, validUntil: { [Op.gt]: new Date() } } });
    if (!branch || !customer || !price || await models.BranchFinancialMapping.count({ where: { companyId: company.id, branchId: branch.id, isActive: true } }) < 11) continue;
    for (const user of await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] })) {
      const actor = user.toJSON();
      if (await permissions.userHasPermission(actor, posting.POST_PERMISSION) && await permissions.userHasPermission(actor, hold.REVERSE_PERMISSION)) return { company: company.toJSON(), branch: branch.toJSON(), customer: customer.toJSON(), user: actor };
    }
  }
  throw new Error("CGP_IMP10_CONTEXT_NOT_FOUND");
}
function c(ctx) { return { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }; }
async function createPosted(ctx, label, items = 1) {
  const made = await models.sequelize.transaction(async (transaction) => {
    const d = await draft.create("cgp", c(ctx), { branchId: ctx.branch.id, customerId: ctx.customer.id, transactionDate: "2026-08-10", currency: ctx.company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:${label}`, items: Array.from({ length: items }, (_, i) => ({ goldType: `${MARKER}-${label}-${i + 1}`, karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "8.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" })) }, transaction);
    const validated = await draft.validate("cgp", c(ctx), d.id, d.version, transaction);
    return posting.post({ context: c(ctx), id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:${label}:POST`, transaction });
  });
  const eventId = made.outboxEvent.eventId;
  await inventoryConsumer.consumePostedEvent({ eventId }); await accountingConsumer.consumePostedEvent({ eventId }); await goldConsumer.consumePostedEvent({ eventId }); await availability.evaluateAvailability({ eventId });
  return { document: await models.CustomerGoldPurchaseDocument.findByPk(made.document.id), postedEventId: eventId };
}
async function holdDocument(ctx, document, label) {
  const requested = await models.sequelize.transaction((transaction) => hold.requestHold({ context: c(ctx), cgpDocumentId: document.id, reason: `${MARKER}:${label}`, idempotencyKey: `${MARKER}:${label}:HOLD`, correlationId: `${MARKER}:${label}:HOLD`, transaction }));
  await holdConsumer.consumeHoldEvent({ eventId: requested.holdEventId });
  return models.CgpReversalRequest.findByPk(requested.request.id);
}
async function settle(ctx, liability, legs, label) {
  const method = legs.length === 2 ? "MIXED" : legs[0].method;
  const total = legs.reduce((sum, leg) => sum.plus(leg.amount), new Decimal(0)).toFixed(4);
  const policy = await models.sequelize.transaction((transaction) => approvalPolicy.createFinancialApprovalPolicy({ models, context: { companyId: ctx.company.id, actorId: ctx.user.id }, input: { operationType: settlements.OPERATION_TYPE, branchId: ctx.branch.id, currency: liability.currency, paymentMethod: method, minAmount: total, maxAmount: total, approvalRequired: false, priority: 900, effectiveFrom: new Date(Date.now() - 60000), effectiveTo: new Date(Date.now() + 600000), description: `${MARKER}:${label}`, metadata: { acceptanceOnly: true, marker: MARKER } }, transaction }));
  try {
    return await settlements.executeCustomerPayoutSettlement({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, actorId: ctx.user.id }, input: { liabilityId: liability.id, idempotencyKey: `${MARKER}:${label}:SETTLE`, legs, testMarker: `${MARKER}:${label}` } });
  } finally {
    await models.sequelize.transaction((transaction) => approvalPolicy.deactivateFinancialApprovalPolicy({ models, context: { companyId: ctx.company.id, actorId: ctx.user.id }, policyId: policy.id, transaction }));
  }
}
async function snapshot(requestId) { return { treasury: await count("SELECT count(*)::int count FROM cash_transactions WHERE reference=:requestId", { requestId }), journal: await count("SELECT count(*)::int count FROM journal_entries WHERE source_type='CUSTOMER_GOLD_PURCHASE_REVERSAL_COMPENSATION' AND source_id=:requestId", { requestId }), gold: await count("SELECT count(*)::int count FROM gold_core_events g JOIN cgp_reversal_compensations c ON c.gold_core_event_id=g.id WHERE c.reversal_request_id=:requestId", { requestId }), final: await count("SELECT count(*)::int count FROM outbox_events WHERE event_type='CustomerGoldPurchaseReversedEvent' AND payload->>'reversalRequestId'=:requestId", { requestId }) }; }
async function complete(ctx, request, { failure = null, crmFailure = false } = {}) {
  const started = await models.sequelize.transaction((transaction) => reversal.beginCompensation({ requestId: request.id, actorId: ctx.user.id, context: c(ctx), transaction }));
  const eventId = started.eventId;
  if (failure === "ACCOUNTING") { await assert.rejects(() => reversal.compensateAccounting({ eventId, context: c(ctx), failureInjector: () => { throw new Error("INJECT_ACCOUNTING"); } }), /INJECT_ACCOUNTING/); await assert.rejects(() => reversal.finalize({ requestId: request.id, actorId: ctx.user.id, context: c(ctx) }), /hard compensations are incomplete/); return { eventId, blocked: "ACCOUNTING" }; }
  const accounting = await reversal.compensateAccounting({ eventId, context: c(ctx) });
  const accountingReplay = await reversal.compensateAccounting({ eventId, context: c(ctx) }); assert.equal(accountingReplay.replayed, true);
  if (failure === "GOLD") { await assert.rejects(() => reversal.compensateGold({ eventId, context: c(ctx), failureInjector: () => { throw new Error("INJECT_GOLD"); } }), /INJECT_GOLD/); await assert.rejects(() => reversal.finalize({ requestId: request.id, actorId: ctx.user.id, context: c(ctx) }), /hard compensations are incomplete/); const gold = await reversal.compensateGold({ eventId, context: c(ctx) }); return { eventId, accounting, gold, blocked: "GOLD" }; }
  const gold = await reversal.compensateGold({ eventId, context: c(ctx) });
  if (failure === "FINAL") { await assert.rejects(() => reversal.finalize({ requestId: request.id, actorId: ctx.user.id, context: c(ctx), failureInjector: () => { throw new Error("INJECT_FINAL"); } }), /INJECT_FINAL/); const retried = await reversal.finalize({ requestId: request.id, actorId: ctx.user.id, context: c(ctx) }); return { eventId, accounting, gold, finalized: retried }; }
  const finalized = await reversal.finalize({ requestId: request.id, actorId: ctx.user.id, context: c(ctx) });
  const replay = await reversal.finalize({ requestId: request.id, actorId: ctx.user.id, context: c(ctx) }); assert.equal(replay.replayed, true);
  if (crmFailure) { await assert.rejects(() => crm.consumeReversedEvent({ eventId: finalized.finalEventId, failureInjector: () => { throw new Error("INJECT_CRM"); } }), /INJECT_CRM/); }
  const projection = await crm.consumeReversedEvent({ eventId: finalized.finalEventId }); const crmReplay = await crm.consumeReversedEvent({ eventId: finalized.finalEventId }); assert.equal(crmReplay.replayed, true);
  return { eventId, accounting, gold, finalized, projection };
}
async function assertFinal(documentId, requestId, expectedAssets, paid) {
  const document = await models.CustomerGoldPurchaseDocument.findByPk(documentId); const request = await models.CgpReversalRequest.findByPk(requestId);
  assert.equal(document.businessStatus, "REVERSED"); assert.equal(request.status, "COMPLETED");
  assert.equal(await count("SELECT count(*)::int count FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=:documentId AND a.operational_status='REVERSED'", { documentId }), expectedAssets);
  assert.equal(await count("SELECT count(*)::int count FROM journal_entries WHERE source_type='CUSTOMER_GOLD_PURCHASE_REVERSAL_COMPENSATION' AND source_id=:requestId", { requestId }), 1);
  assert.equal(await count("SELECT count(*)::int count FROM journal_entries WHERE source_type='CUSTOMER_GOLD_PURCHASE_REVERSAL_COMPENSATION' AND source_id=:requestId AND total_debit<>total_credit", { requestId }), 0);
  assert.equal(await count("SELECT count(*)::int count FROM customer_financial_liabilities WHERE source_document_id=:documentId AND outstanding_amount<>0", { documentId }), 0);
  const comp = await models.CgpReversalCompensation.findOne({ where: { reversalRequestId: requestId, domain: "ACCOUNTING" } }); assert.equal(String(comp.metadata.receivableAmount), paid);
  const effect = await snapshot(requestId); assert.deepEqual(effect, { treasury: 0, journal: 1, gold: 1, final: 1 });
}
async function controlled() {
  const ctx = await context(); const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { draftNumber: "CGPD-000071" } }); assert.ok(document); const request = await models.CgpReversalRequest.findOne({ where: { cgpDocumentId: document.id } }); assert.equal(document.businessStatus, "POSTED"); assert.equal(request.status, "HELD");
  const assets = await count("SELECT count(*)::int count FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=:documentId AND a.operational_status='REVERSAL_PENDING'", { documentId: document.id }); assert.ok(assets > 0);
  const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: document.id, sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED" } }); const paid = (await models.sequelize.query("SELECT COALESCE(sum(a.amount),0)::numeric paid FROM financial_settlement_allocations a JOIN financial_settlements s ON s.id=a.settlement_id WHERE a.customer_financial_liability_id=:id AND s.status='EXECUTED'", { replacements: { id: liability.id }, type: QueryTypes.SELECT }))[0].paid; assert.equal(String(paid), "0");
  const done = await complete(ctx, request, { crmFailure: true }); await assertFinal(document.id, request.id, assets, "0.0000");
  console.log(JSON.stringify({ document: document.draftNumber, requestId: request.id, originalAcquisitionAmount: document.totalPayableToCustomer, paidAmount: paid, finalEventId: done.finalized.finalEventId, assets })); console.log("CGP_IMP_10_CONTROLLED: PASS");
}
async function verifyExisting() {
  const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { draftNumber: "CGPD-000071" } }); assert.ok(document && document.businessStatus === "REVERSED");
  const request = await models.CgpReversalRequest.findOne({ where: { cgpDocumentId: document.id } }); assert.ok(request && request.status === "COMPLETED");
  assert.equal(await count("SELECT count(*)::int count FROM cgp_reversal_compensations WHERE reversal_request_id=:id AND status='SUCCEEDED'", { id: request.id }), 2);
  assert.equal(await count("SELECT count(*)::int count FROM journal_entries WHERE source_type='CUSTOMER_GOLD_PURCHASE_REVERSAL_COMPENSATION' AND source_id=:id AND total_debit=total_credit", { id: request.id }), 1);
  assert.equal(await count("SELECT count(*)::int count FROM gold_core_events WHERE source_event_id=:id AND event_type='CUSTOMER_GOLD_ACQUISITION_REVERSED'", { id: request.compensationEventId }), 1);
  assert.equal(await count("SELECT count(*)::int count FROM outbox_events WHERE event_type='CustomerGoldPurchaseReversedEvent' AND payload->>'reversalRequestId'=:id", { id: request.id }), 1);
  assert.equal(await count("SELECT count(*)::int count FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=:id AND a.operational_status='REVERSED'", { id: document.id }), 1);
  assert.equal(await count("SELECT count(*)::int count FROM cash_transactions WHERE reference=:id", { id: request.id }), 0);
  assert.equal(await count("SELECT count(*)::int count FROM customer_transaction_history WHERE source_event_id='EVT:CGP_REVERSED:' || :id", { id: request.id }), 1);
  console.log("CGP_IMP_10_VERIFY_EXISTING: PASS");
}
async function cases() {
  const ctx = await context(); const cases = [
    { name: "UNPAID", legs: null, paid: "0.0000", assets: 1 },
    { name: "PARTIAL", legs: [{ method: "CASH", amount: "1.0000" }], paid: "1.0000", assets: 1 },
    { name: "FULL", legs: "FULL", paid: null, assets: 1 },
    { name: "MIXED", legs: [{ method: "CASH", amount: "1.0000" }, { method: "BANK_TRANSFER", amount: "1.0000", bankReference: `${MARKER}:MIXED` }], paid: "2.0000", assets: 2 },
  ]; const out = {};
  for (const spec of cases) { const made = await createPosted(ctx, spec.name, spec.assets); const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: made.document.id, sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED" } }); if (spec.legs === "FULL") { const amount = new Decimal(liability.outstandingAmount).toFixed(4); await settle(ctx, liability, [{ method: "CASH", amount }], spec.name); spec.paid = amount; } else if (spec.legs) await settle(ctx, liability, spec.legs, spec.name); const request = await holdDocument(ctx, made.document, spec.name); const done = await complete(ctx, request); await assertFinal(made.document.id, request.id, spec.assets, spec.paid); out[spec.name] = { document: made.document.draftNumber, paid: spec.paid, requestId: request.id, finalEventId: done.finalized.finalEventId }; }
  const failAccounting = await createPosted(ctx, "FAIL_ACCOUNTING"); const rA = await holdDocument(ctx, failAccounting.document, "FAIL_ACCOUNTING"); await complete(ctx, rA, { failure: "ACCOUNTING" });
  const failGold = await createPosted(ctx, "FAIL_GOLD"); const rG = await holdDocument(ctx, failGold.document, "FAIL_GOLD"); const goldRetried = await complete(ctx, rG, { failure: "GOLD" }); const finalGold = await reversal.finalize({ requestId: rG.id, actorId: ctx.user.id, context: c(ctx) }); await crm.consumeReversedEvent({ eventId: finalGold.finalEventId });
  const failFinal = await createPosted(ctx, "FAIL_FINAL", 2); const rF = await holdDocument(ctx, failFinal.document, "FAIL_FINAL"); const finalRetried = await complete(ctx, rF, { failure: "FINAL" }); await crm.consumeReversedEvent({ eventId: finalRetried.finalized.finalEventId }); await assertFinal(failFinal.document.id, rF.id, 2, "0.0000");
  console.log(JSON.stringify({ database: DB, cases: out, failureRetry: { accountingBlocked: rA.id, goldRetried: goldRetried.eventId, finalRetried: finalRetried.eventId } })); console.log("CGP_IMP_10_CASES: PASS");
}
(async () => { await target(); if (controlledMode) await controlled(); else if (verifyMode) await verifyExisting(); else await cases(); })().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
