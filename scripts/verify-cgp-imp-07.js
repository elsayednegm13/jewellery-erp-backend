"use strict";

// Acceptance proof for the CGP-IMP-07 availability hard gate.  It creates one
// marked two-piece source, calls only the three explicit consumers, and never
// dispatches the Outbox.
const assert = require("assert/strict");
const { Op, QueryTypes } = require("sequelize");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const MARKER = "ACCEPTANCE_TEST_CGP_IMP07";
process.env.DATABASE_URL = "";
process.env.DB_NAME = ACCEPTANCE_DATABASE;
const models = require("../src/models");
const draftService = require("../src/services/gold-purchase-draft.service");
const posting = require("../src/services/cgp-posting.service");
const prices = require("../src/services/gold-price-approval.service");
const permissions = require("../src/services/permission.service");
const inventory = require("../src/services/cgp-inventory-consumer.service");
const accounting = require("../src/services/cgp-accounting-consumer.service");
const gold = require("../src/services/cgp-gold-center-consumer.service");
const evaluator = require("../src/services/cgp-availability-evaluator.service");
const runtime = require("../src/services/inventory-v2-runtime.service");
const audit = require("../src/services/audit.service");

async function target() {
  const rows = await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT });
  assert.equal(rows[0]?.db, ACCEPTANCE_DATABASE, "acceptance target must be proven in this process");
}
async function count(sql, replacements = {}) { const rows = await models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }); return Number(rows[0]?.count || 0); }
async function context() {
  for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" } });
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true } });
    const price = await models.GoldPrice.findOne({ where: { companyId: company.id, currency: company.currency || "AED", karat: 21, approvalStatus: "APPROVED", validFrom: { [Op.lte]: new Date() }, validUntil: { [Op.gt]: new Date() } } });
    if (!customer || !branch || !price) continue;
    for (const user of await models.User.findAll({ where: { companyId: company.id } })) {
      if (await permissions.userHasPermission(user.toJSON(), posting.POST_PERMISSION)) return { company: company.toJSON(), branch: branch.toJSON(), customer: customer.toJSON(), user: user.toJSON() };
    }
  }
  throw new Error("CGP_IMP07_ACCEPTANCE_CONTEXT_NOT_FOUND");
}
async function source(ctx) {
  const existing = await models.CustomerGoldPurchaseDocument.findOne({ where: { notes: { [Op.like]: `${MARKER}%` } }, order: [["createdAt", "ASC"]] });
  if (existing) {
    const event = await models.OutboxEvent.findOne({ where: { aggregateId: existing.id, eventType: evaluator.EVENT_TYPE } });
    assert.ok(event, "existing acceptance source must retain its posted event");
    return { document: existing.toJSON(), event: event.toJSON() };
  }
  await target();
  return models.sequelize.transaction(async (transaction) => {
    const created = await draftService.create("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, {
      branchId: ctx.branch.id, customerId: ctx.customer.id, transactionDate: "2026-08-09", currency: ctx.company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:TWO_PIECE_HARD_GATE`,
      items: [
        { goldType: "acceptance-cgp-gate-piece-a", karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "8.000000", stoneWeight: "0.200000", proposedRate: "999.0000", referenceMarketRate: "888.0000" },
        { goldType: "acceptance-cgp-gate-piece-b", karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "6.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" },
      ],
    }, transaction);
    const validated = await draftService.validate("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, created.id, created.version, transaction);
    const posted = await posting.post({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:POST`, transaction });
    return { document: posted.document, event: posted.outboxEvent };
  });
}
async function assetsFor(eventId) { return models.sequelize.query(`SELECT a.id,a.operational_status AS "operationalStatus",a.barcode,ao.cgp_item_id AS "cgpItemId" FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id WHERE a.metadata->>'postingEventId'=:eventId ORDER BY a.id`, { replacements: { eventId }, type: QueryTypes.SELECT }); }
async function effects(eventId) { return {
  assets: (await assetsFor(eventId)).length,
  inventoryReceipt: await count("SELECT count(*)::int AS count FROM processed_events WHERE consumer_name='INVENTORY' AND event_id=:eventId", { eventId }),
  accountingReceipt: await count("SELECT count(*)::int AS count FROM processed_events WHERE consumer_name='ACCOUNTING' AND event_id=:eventId", { eventId }),
  goldReceipt: await count("SELECT count(*)::int AS count FROM processed_events WHERE consumer_name='GOLD_CENTER' AND event_id=:eventId", { eventId }),
  journals: await count("SELECT count(*)::int AS count FROM journal_entries WHERE source_type=:sourceType AND source_id=:eventId", { sourceType: accounting.JOURNAL_SOURCE_TYPE, eventId }),
  liabilities: await count("SELECT count(*)::int AS count FROM customer_financial_liabilities WHERE source_event_id=:eventId", { eventId }),
  goldEvents: await count("SELECT count(*)::int AS count FROM gold_core_events WHERE source_event_id=:eventId", { eventId }),
  stateEvents: await count("SELECT count(*)::int AS count FROM asset_events WHERE source_id=:eventId AND event_type='CGP_INTEGRATION_AVAILABLE'", { eventId }),
  movements: await count("SELECT count(*)::int AS count FROM inventory_asset_movements WHERE source_id=:eventId AND movement_type='CGP_INTEGRATION_AVAILABLE'", { eventId }),
}; }
async function expectReject(fn, expectedCode) {
  await assert.rejects(fn, (error) => error?.errorCode === expectedCode || String(error?.message || "").includes(expectedCode));
}
async function rollbackGate(fn) { await target(); await models.sequelize.transaction(async (transaction) => { try { await fn(transaction); } finally { throw new Error("CGP_IMP07_ROLLBACK_TEST"); } }).catch((e) => { if (!String(e.message).includes("CGP_IMP07_ROLLBACK_TEST")) throw e; }); }
async function main() {
  await target(); const ctx = await context(); const src = await source(ctx); const eventId = src.event.eventId;
  assert.equal((await models.CustomerGoldPurchaseItem.count({ where: { documentId: src.document.id } })), 2, "one source must contain exactly two physical pieces");
  let staged = await effects(eventId);
  if (!staged.inventoryReceipt) {
    await expectReject(() => evaluator.evaluateAvailability({ eventId }), "CGP_AVAILABILITY_INVENTORY_STATUS_REQUIRED");
    await target(); const inv = await inventory.consumePostedEvent({ eventId }); assert.equal(inv.replayed, false); assert.equal(inv.assets.length, 2);
  }
  let rows = await assetsFor(eventId); assert.equal(rows.length, 2); assert.equal(new Set(rows.map((r) => r.cgpItemId)).size, 2); assert.equal(new Set(rows.map((r) => r.barcode)).size, 2); if (!staged.inventoryReceipt) assert.ok(rows.every((r) => r.operationalStatus === "PENDING_INTEGRATION"));
  staged = await effects(eventId);
  if (!staged.accountingReceipt) {
    await expectReject(() => evaluator.evaluateAvailability({ eventId }), "CGP_AVAILABILITY_ACCOUNTING_STATUS_REQUIRED");
    await target(); const acc = await accounting.consumePostedEvent({ eventId }); assert.equal(acc.replayed, false);
  }
  staged = await effects(eventId);
  if (!staged.goldReceipt) {
    await expectReject(() => evaluator.evaluateAvailability({ eventId }), "CGP_AVAILABILITY_GOLD_CENTER_STATUS_REQUIRED");
    await target(); const gc = await gold.consumePostedEvent({ eventId }); assert.equal(gc.replayed, false);
  }
  rows = await assetsFor(eventId); const pendingAtGate = rows.every((r) => r.operationalStatus === "PENDING_INTEGRATION");
  const beforeFailure = await effects(eventId);
  if (pendingAtGate) {
    await expectReject(() => evaluator.evaluateAvailability({ eventId, failureInjector: ({ transitioned }) => { if (transitioned.length === 1) throw new Error("CGP_IMP07_FORCED_ROLLBACK"); } }), "CGP_IMP07_FORCED_ROLLBACK");
    assert.deepEqual(await effects(eventId), beforeFailure, "failed evaluator must roll back all asset state effects");
    rows = await assetsFor(eventId); assert.ok(rows.every((r) => r.operationalStatus === "PENDING_INTEGRATION"));
  } else assert.equal(beforeFailure.stateEvents, 2, "an already accepted source must retain exactly two legal availability transitions");
  // Status-only / processed-only / domain-only evidence cannot pass the gate.
  await rollbackGate(async (transaction) => { await models.sequelize.query("DELETE FROM asset_origins WHERE cgp_item_id IN (SELECT id FROM customer_gold_purchase_items WHERE document_id=:documentId)", { replacements: { documentId: src.document.id }, transaction }); await expectReject(() => evaluator.requireInventory({ event: src.event, document: src.document, transaction }), "CGP_AVAILABILITY_INVENTORY_LINEAGE_REQUIRED"); });
  await rollbackGate(async (transaction) => { await models.sequelize.query("DELETE FROM integration_statuses WHERE consumer_name='INVENTORY' AND source_event_id=:eventId", { replacements: { eventId }, transaction }); await expectReject(() => evaluator.requireInventory({ event: src.event, document: src.document, transaction }), "CGP_AVAILABILITY_INVENTORY_STATUS_REQUIRED"); });
  await rollbackGate(async (transaction) => { await models.sequelize.query("DELETE FROM processed_events WHERE consumer_name='INVENTORY' AND event_id=:eventId", { replacements: { eventId }, transaction }); await expectReject(() => evaluator.requireInventory({ event: src.event, document: src.document, transaction }), "CGP_AVAILABILITY_INVENTORY_STATUS_REQUIRED"); });
  await rollbackGate(async (transaction) => { await models.sequelize.query("DELETE FROM audit_logs WHERE company_id=:companyId AND action='cgp.posted' AND source_document=:sourceDocument AND correlation_id=:correlationId", { replacements: { companyId: src.document.companyId, sourceDocument: src.document.draftNumber, correlationId: src.event.correlationId }, transaction }); await expectReject(() => evaluator.loadPosted({ event: src.event, transaction }), "CGP_AVAILABILITY_AUDIT_REQUIRED"); });
  assert.throws(() => accounting.assertExactEvent({ ...src.event, payload: { ...src.event.payload, aggregate: { ...src.event.payload.aggregate, id: "cross-source" } } }), /immutable purchase evidence/);
  const financialBefore = await effects(eventId);
  await target(); const raced = await Promise.all([evaluator.evaluateAvailability({ eventId }), evaluator.evaluateAvailability({ eventId })]);
  assert.equal(raced.filter((r) => !r.replayed).length, pendingAtGate ? 1 : 0); assert.equal(raced.filter((r) => r.replayed).length, pendingAtGate ? 1 : 2);
  rows = await assetsFor(eventId); assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.operationalStatus === "AVAILABLE"));
  const after = await effects(eventId); assert.equal(after.stateEvents, 2); assert.equal(after.movements, 2); assert.equal(after.journals, financialBefore.journals); assert.equal(after.liabilities, financialBefore.liabilities); assert.equal(after.goldEvents, financialBefore.goldEvents);
  const replay = await evaluator.evaluateAvailability({ eventId }); assert.equal(replay.replayed, true); assert.deepEqual(await effects(eventId), after);
  await models.sequelize.transaction(async (transaction) => {
    const sample = await models.Asset.findByPk(rows[0].id, { transaction });
    const pendingFacade = { ...sample.toJSON(), operationalStatus: "PENDING_INTEGRATION", status: "pending_integration" };
    // The canonical transition entrypoint now re-reads the locked database
    // row.  A caller-supplied stale PENDING facade cannot authorize a second
    // availability transition after the durable row is already AVAILABLE.
    await assert.rejects(() => runtime.transitionAsset({ models, transaction, asset: pendingFacade, context: { companyId: src.document.companyId, branchId: src.document.branchId }, toStatus: "AVAILABLE", eventType: "UNSAFE_TEST", movementType: "UNSAFE_TEST", sourceType: "UNSAFE_TEST", sourceId: eventId }), /INVENTORY_V2_INVALID_STATE_TRANSITION:AVAILABLE:AVAILABLE/);
  });
  const outbox = await models.OutboxEvent.findOne({ where: { eventId } }); assert.equal(outbox.status, "PENDING", "IMP-07 must not dispatch source Outbox");
  const integrity = (await models.sequelize.query(`SELECT (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS unbalanced,(SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines,(SELECT count(*)::int FROM assets WHERE barcode IS NULL OR btrim(barcode)='') AS blank_barcodes`, { type: QueryTypes.SELECT }))[0];
  assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, blank_barcodes: 0 }); assert.equal((await audit.verifyChain(src.document.companyId)).valid, true);
  console.log("CGP_IMP_07_AVAILABLE_HARD_GATE: PASS"); console.log("CGP_IMP_07_EXACT_EVENT_ONLY: PASS"); console.log("CGP_IMP_07_ONE_PIECE_ONE_ASSET: PASS"); console.log("CGP_IMP_07_IDEMPOTENCY_CONCURRENCY_ROLLBACK: PASS"); console.log("CGP_IMP_07_NO_GLOBAL_DISPATCH_OR_NEW_FINANCIAL_EFFECT: PASS");
}
main().catch((e) => { console.error(e.stack || e); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
