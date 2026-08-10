"use strict";

// CGP-IMP-10A controlled acceptance proof.  The only committed fixture is a
// one-piece posted CGP source ending at HELD/REVERSAL_PENDING.  It never
// finalizes a reversal or invokes a global dispatcher.
const assert = require("assert/strict");
const path = require("path");
const { Op, QueryTypes } = require("sequelize");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const DB = "darfus_erp_inventory_rehearsal_20260804_160500z";
const MARKER = "ACCEPTANCE_TEST_CGP_IMP10A";
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
const runtime = require("../src/services/inventory-v2-runtime.service");

async function target() { const rows = await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }); assert.equal(rows[0]?.db, DB, "CGP-IMP-10A refuses a non-acceptance database"); }
async function count(sql, replacements = {}) { const rows = await models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }); return Number(rows[0]?.count || 0); }
async function context() {
  for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" } });
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true } });
    const price = await models.GoldPrice.findOne({ where: { companyId: company.id, currency: company.currency || "AED", karat: 21, approvalStatus: "APPROVED", validFrom: { [Op.lte]: new Date() }, validUntil: { [Op.gt]: new Date() } } });
    if (!customer || !branch || !price) continue;
    for (const user of await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] })) {
      const actor = user.toJSON();
      if (await permissions.userHasPermission(actor, posting.POST_PERMISSION) && await permissions.userHasPermission(actor, hold.REVERSE_PERMISSION)) return { company: company.toJSON(), customer: customer.toJSON(), branch: branch.toJSON(), user: actor };
    }
  }
  throw new Error("CGP_IMP10A_ACCEPTANCE_CONTEXT_NOT_FOUND");
}
async function fixture(ctx) {
  const existing = await models.CustomerGoldPurchaseDocument.findOne({ where: { notes: { [Op.like]: `${MARKER}%` } }, order: [["createdAt", "ASC"]] });
  if (existing) {
    const posted = await models.OutboxEvent.findOne({ where: { aggregateId: existing.id, eventType: posting.POSTED_EVENT_TYPE } });
    const request = await models.CgpReversalRequest.findOne({ where: { cgpDocumentId: existing.id } });
    assert.ok(posted && request, "existing IMP10A fixture is incomplete"); return { document: existing, posted, request };
  }
  await target();
  const created = await models.sequelize.transaction(async (transaction) => {
    const d = await draft.create("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, {
      branchId: ctx.branch.id, customerId: ctx.customer.id, transactionDate: "2026-08-10", currency: ctx.company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:REVERSAL_HOLD_ONLY`,
      items: [{ goldType: "acceptance-cgp-imp10a-piece", karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "9.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }],
    }, transaction);
    const validated = await draft.validate("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, d.id, d.version, transaction);
    return posting.post({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:POST`, transaction });
  });
  const eventId = created.outboxEvent.eventId;
  await inventoryConsumer.consumePostedEvent({ eventId });
  await accountingConsumer.consumePostedEvent({ eventId });
  await goldConsumer.consumePostedEvent({ eventId });
  await availability.evaluateAvailability({ eventId });
  const unauthorized = { ...ctx.user, accountType: "branch_shell", role: "employee" };
  await assert.rejects(() => models.sequelize.transaction((transaction) => hold.requestHold({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, user: unauthorized }, cgpDocumentId: created.document.id, reason: "unauthorized test", idempotencyKey: `${MARKER}:UNAUTHORIZED`, transaction })), /gold_purchase\.cgp\.reverse/);
  const requested = await models.sequelize.transaction((transaction) => hold.requestHold({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, cgpDocumentId: created.document.id, reason: "Acceptance-only reversal hold; no financial compensation", idempotencyKey: `${MARKER}:HOLD`, correlationId: `${MARKER}:HOLD`, transaction }));
  const posted = await models.OutboxEvent.findOne({ where: { eventId } });
  const request = await models.CgpReversalRequest.findByPk(requested.request.id);
  return { document: created.document, posted, request };
}
async function effects(documentId, holdEventId) { return {
  assets: await count("SELECT count(*)::int count FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=:documentId", { documentId }),
  holdEvents: await count("SELECT count(*)::int count FROM asset_events WHERE source_id IN (SELECT id FROM cgp_reversal_requests WHERE cgp_document_id=:documentId) AND event_type='CGP_REVERSAL_HOLD'", { documentId }),
  holdMovements: await count("SELECT count(*)::int count FROM inventory_asset_movements WHERE source_id IN (SELECT id FROM cgp_reversal_requests WHERE cgp_document_id=:documentId) AND movement_type='CGP_REVERSAL_HOLD'", { documentId }),
  receipt: await count("SELECT count(*)::int count FROM processed_events WHERE consumer_name='INVENTORY' AND event_id=:eventId", { eventId: holdEventId }),
  integration: await count("SELECT count(*)::int count FROM integration_statuses WHERE consumer_name='INVENTORY' AND source_event_id=:eventId AND status='SUCCEEDED'", { eventId: holdEventId }),
  reversalJournals: await count("SELECT count(*)::int count FROM journal_entries WHERE source_id IN (SELECT id FROM cgp_reversal_requests WHERE cgp_document_id=:documentId)", { documentId }),
  reversalTreasury: await count("SELECT count(*)::int count FROM cash_transactions WHERE reference IN (SELECT id FROM cgp_reversal_requests WHERE cgp_document_id=:documentId)", { documentId }),
  reversalGold: await count("SELECT count(*)::int count FROM gold_core_events WHERE source_event_id=:eventId", { eventId: holdEventId }),
  reversalCrm: await count("SELECT count(*)::int count FROM customer_transaction_history WHERE source_event_id=:eventId", { eventId: holdEventId }),
}; }
async function verifyExisting() {
  await target();
  const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { notes: { [Op.like]: `${MARKER}%` } } }); assert.ok(document && ["POSTED", "REVERSED"].includes(document.businessStatus));
  const request = await models.CgpReversalRequest.findOne({ where: { cgpDocumentId: document.id } }); assert.ok(request && ["HELD", "COMPLETED"].includes(request.status));
  const holdEventId = request.metadata?.holdEventId; const rows = await models.sequelize.query("SELECT a.id,a.barcode,a.operational_status AS status FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=:documentId", { replacements: { documentId: document.id }, type: QueryTypes.SELECT });
  assert.equal(rows.length, 1); assert.equal(rows[0].status, document.businessStatus === "REVERSED" ? "REVERSED" : "REVERSAL_PENDING"); assert.ok(String(rows[0].barcode || "").trim());
  const e = await effects(document.id, holdEventId); assert.deepEqual(e, { assets: 1, holdEvents: 1, holdMovements: 1, receipt: 1, integration: 1, reversalJournals: document.businessStatus === "REVERSED" ? 1 : 0, reversalTreasury: 0, reversalGold: 0, reversalCrm: 0 });
  if (document.businessStatus === "POSTED") assert.throws(() => hold.assertFinalizationPreconditions(), (error) => error?.errorCode === "CGP_REVERSAL_FINALIZATION_PRECONDITIONS_REQUIRED");
  else {
    assert.equal(document.draftNumber, "CGPD-000071", "only the authorised IMP10 fixture may have advanced");
    assert.equal(request.status, "COMPLETED");
    assert.equal(await count("SELECT count(*)::int count FROM cgp_reversal_compensations WHERE reversal_request_id=:requestId", { requestId: request.id }), 2);
    assert.equal(await count("SELECT count(*)::int count FROM outbox_events WHERE event_type='CustomerGoldPurchaseReversedEvent' AND payload->>'reversalRequestId'=:requestId", { requestId: request.id }), 1);
  }
  console.log("CGP_IMP_10A_VERIFY_EXISTING: PASS");
}
async function main() {
  if (process.argv.includes("--verify-existing")) return verifyExisting();
  await target(); const ctx = await context(); const data = await fixture(ctx); const request = await models.CgpReversalRequest.findByPk(data.request.id); const holdEventId = request.metadata.holdEventId;
  const before = await effects(data.document.id, holdEventId); assert.equal(before.holdEvents, 0);
  const raced = await Promise.all([holdConsumer.consumeHoldEvent({ eventId: holdEventId }), holdConsumer.consumeHoldEvent({ eventId: holdEventId })]);
  assert.equal(raced.filter((x) => !x.replayed).length, 1); assert.equal(raced.filter((x) => x.replayed).length, 1);
  const assetRows = await models.sequelize.query("SELECT a.* FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=:documentId", { replacements: { documentId: data.document.id }, type: QueryTypes.SELECT });
  assert.equal(assetRows.length, 1); assert.equal(assetRows[0].operational_status, "REVERSAL_PENDING");
  await models.sequelize.transaction(async (transaction) => assert.rejects(() => runtime.transitionAsset({ models, transaction, assetId: assetRows[0].id, context: { companyId: data.document.companyId, branchId: data.document.branchId }, toStatus: "AVAILABLE", eventType: "UNSAFE", movementType: "UNSAFE", sourceType: "UNSAFE", sourceId: data.document.id }), /INVENTORY_V2_INVALID_STATE_TRANSITION/));
  await verifyExisting();
  const integrity = (await models.sequelize.query("SELECT (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS unbalanced,(SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines,(SELECT count(*)::int FROM assets WHERE barcode IS NULL OR btrim(barcode)='') AS blank_barcodes", { type: QueryTypes.SELECT }))[0]; assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, blank_barcodes: 0 });
  console.log(JSON.stringify({ document: data.document.draftNumber, documentId: data.document.id, postedEventId: data.posted.eventId, reversalRequestId: data.request.id, holdEventId, assetId: assetRows[0].id, barcode: assetRows[0].barcode }));
  console.log("CGP_IMP_10A_REVERSAL_HOLD: PASS");
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
