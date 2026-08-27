"use strict";

// CGP-IMP-06 acceptance creates exactly one explicitly marked posted source
// event and invokes only GOLD_CENTER by that event id. It never dispatches.
const assert = require("assert/strict");
const Decimal = require("decimal.js");
const { Op, QueryTypes } = require("sequelize");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const MARKER = "ACCEPTANCE_TEST_CGP_IMP06";
process.env.DATABASE_URL = "";
process.env.DB_NAME = ACCEPTANCE_DATABASE;
const models = require("../src/models");
const draftService = require("../src/services/gold-purchase-draft.service");
const posting = require("../src/services/cgp-posting.service");
const consumer = require("../src/services/cgp-gold-center-consumer.service");
const prices = require("../src/services/gold-price-approval.service");
const permissions = require("../src/services/permission.service");

async function target() { const r = await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }); assert.equal(r[0]?.db, ACCEPTANCE_DATABASE); }
async function count(sql, replacements = {}) { const r = await models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }); return Number(r[0]?.count || 0); }
async function tableCount(name) { const r = await models.sequelize.query("SELECT to_regclass(:name) AS name", { replacements: { name }, type: QueryTypes.SELECT }); return r[0]?.name ? count(`SELECT count(*)::int AS count FROM ${name}`) : 0; }
function money(v) { return new Decimal(v).toFixed(4); }

async function context() {
  for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" }, order: [["id", "ASC"]] }); if (!customer) continue;
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] }); if (!branch) continue;
    const price = await models.GoldPrice.findOne({ where: { companyId: company.id, currency: company.currency || "AED", karat: 21, approvalStatus: "APPROVED", validFrom: { [Op.lte]: new Date() }, validUntil: { [Op.gt]: new Date() } }, order: [["approvedAt", "DESC"], ["id", "DESC"]] }); if (!price) continue;
    for (const user of await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] })) {
      const actor = user.toJSON();
      if (await permissions.userHasPermission(actor, posting.POST_PERMISSION)) return { company: company.toJSON(), branch: branch.toJSON(), customer: customer.toJSON(), user: actor };
    }
  }
  throw new Error("CGP_IMP06_ACCEPTANCE_CONTEXT_NOT_FOUND");
}
async function sourceEvent(ctx) {
  const found = await models.CustomerGoldPurchaseDocument.findOne({ where: { notes: { [Op.like]: `${MARKER}%` } }, order: [["createdAt", "ASC"]] });
  if (found) { const e = await models.OutboxEvent.findOne({ where: { aggregateId: found.id, eventType: consumer.EVENT_TYPE } }); assert.ok(e); return { document: found.toJSON(), event: e.toJSON() }; }
  await target(); const tx = await models.sequelize.transaction();
  try {
    const created = await draftService.create("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, { branchId: ctx.branch.id, customerId: ctx.customer.id, transactionDate: "2026-08-09", currency: ctx.company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:GOLD_CENTER_CORE_EVENT`, items: [{ goldType: "acceptance-cgp-gold-center-one-piece", karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "8.000000", stoneWeight: "0.200000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }] }, tx);
    const validated = await draftService.validate("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, created.id, created.version, tx);
    const posted = await posting.post({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:POST`, transaction: tx });
    await tx.commit(); return { document: posted.document, event: posted.outboxEvent };
  } catch (e) { if (!tx.finished) await tx.rollback(); throw e; }
}
async function effectCounts(eventId) { return { core: await count("SELECT count(*)::int AS count FROM gold_core_events WHERE source_event_id=:eventId", { eventId }), receipt: await count("SELECT count(*)::int AS count FROM processed_events WHERE consumer_name='GOLD_CENTER' AND event_id=:eventId", { eventId }), integration: await count("SELECT count(*)::int AS count FROM integration_statuses WHERE consumer_name='GOLD_CENTER' AND source_event_id=:eventId", { eventId }), assets: await tableCount("assets"), journals: await tableCount("journal_entries"), lines: await tableCount("journal_lines"), cash: await tableCount("cash_transactions"), treasury: await tableCount("treasury_transactions"), liabilities: await tableCount("customer_financial_liabilities"), pools: await tableCount("customer_gold_pools"), inventoryPools: await tableCount("inventory_gold_pools"), prices: await tableCount("gold_prices") }; }
async function protectedHistory() {
  const ids = await models.sequelize.query(`SELECT DISTINCT o.event_id AS "eventId" FROM outbox_events o JOIN customer_gold_purchase_documents d ON d.id=o.aggregate_id JOIN cgp_pricing_snapshots s ON s.cgp_document_id=d.id WHERE o.event_type=:type AND o.event_version=1 AND s.approved_price_id IS NULL UNION SELECT event_id FROM outbox_events WHERE correlation_id LIKE 'ACCEPTANCE_TEST_CGP_IMP04:%' OR correlation_id LIKE 'ACCEPTANCE_TEST_CGP_IMP05:%'`, { replacements: { type: consumer.EVENT_TYPE }, type: QueryTypes.SELECT });
  assert.ok(ids.length >= 24, "historical and prior IMP events must exist"); const values = ids.map((x) => x.eventId);
  assert.equal(await count("SELECT count(*)::int AS count FROM gold_core_events WHERE source_event_id IN(:values)", { values }), 0, "prior events must remain unconsumed by Gold Center");
  assert.equal(await count("SELECT count(*)::int AS count FROM processed_events WHERE consumer_name='GOLD_CENTER' AND event_id IN(:values)", { values }), 0);
}
async function nonPostedRejected() {
  const draft = await models.CustomerGoldPurchaseDocument.findOne({ where: { businessStatus: { [Op.ne]: "POSTED" } }, order: [["createdAt", "ASC"]] }); assert.ok(draft, "existing unposted CGP document required for non-posted gate");
  const fake = { eventId: "NONPOSTED_TEST", eventType: consumer.EVENT_TYPE, eventVersion: 1, aggregateId: draft.id, payload: { eventId: "NONPOSTED_TEST", eventType: consumer.EVENT_TYPE, eventVersion: 1, aggregate: { type: "CustomerGoldPurchaseDocument", id: draft.id, companyId: draft.companyId, branchId: draft.branchId, customerId: draft.customerId, currency: draft.currency }, pricing: { lines: [{}] } } };
  const { payload, aggregate } = consumer.assertExactEvent(fake);
  await models.sequelize.transaction(async (transaction) => { await assert.rejects(() => consumer.assertPostedFacts({ event: fake, payload, aggregate, transaction }), /requires an immutable posted document/); });
}
async function main() {
  await target(); const ctx = await context(); await protectedHistory(); const source = await sourceEvent(ctx); const eventId = source.event.eventId;
  const before = await effectCounts(eventId);
  // The fixture is intentionally single-use. Once previously consumed, a
  // replay is the correct behavior; verify its durable state read-only.
  if (before.core === 1) {
    assert.equal(before.receipt, 1); assert.equal(before.integration, 1);
    console.log("CGP_IMP_06_GOLD_CENTER_CORE_EVENT: PASS"); console.log("CGP_IMP_06_VERIFY_EXISTING: PASS"); return;
  }
  await assert.rejects(() => consumer.consumePostedEvent({ eventId, failureInjector: ({ stage }) => { if (stage === "after_gold_core_event") throw new Error("CGP_IMP06_FORCED_ROLLBACK"); } }), /CGP_IMP06_FORCED_ROLLBACK/);
  assert.deepEqual(await effectCounts(eventId), before, "failure after append must roll back core event, receipt, and integration");
  assert.throws(() => consumer.assertExactEvent({ ...source.event, payload: { ...source.event.payload, aggregate: { ...source.event.payload.aggregate, id: "tampered" } } }), /immutable Gold Center evidence/);
  await nonPostedRejected(); assert.deepEqual(await effectCounts(eventId), before, "negative tests must not create effects");
  await target(); const raced = await Promise.all([consumer.consumePostedEvent({ eventId }), consumer.consumePostedEvent({ eventId })]);
  assert.equal(raced.filter((x) => !x.replayed).length, 1); assert.equal(raced.filter((x) => x.replayed).length, 1);
  const first = raced.find((x) => !x.replayed); const core = first.goldCoreEvent; assert.ok(core?.id);
  assert.equal(core.eventType, "CUSTOMER_GOLD_ACQUISITION_RECORDED"); assert.equal(core.sourceEventId, eventId); assert.equal(core.sourcePartyType, "CUSTOMER"); assert.equal(core.sourcePartyId, source.document.customerId);
  const p = core.payload; assert.equal(p.totalAcquisitionValue, money(source.document.totalGoldValue)); assert.equal(p.monetaryFormula, "NET_WEIGHT_X_APPROVED_KARAT_RATE"); assert.equal(p.purityApplication, "EXACTLY_ONCE_AS_PURE_GOLD_EVIDENCE");
  for (const line of p.items) { assert.equal(new Decimal(line.grossWeight).minus(line.stoneWeight).toFixed(6), line.netWeight); assert.equal(new Decimal(line.netWeight).mul(line.purityFactor).toFixed(6), line.pureGoldWeight); const snapshot = await models.CgpPricingSnapshot.findByPk(line.pricingSnapshotId); assert.ok(snapshot); assert.equal(line.acquisitionValue, money(snapshot.lineGoldValue)); assert.notEqual(line.acquisitionValue, money(new Decimal(snapshot.lineGoldValue).mul(snapshot.purityFactor)), "monetary value must not apply purity twice"); }
  await assert.rejects(() => models.GoldCoreEvent.update({ currency: "USD" }, { where: { id: core.id } }), /immutable/);
  await assert.rejects(() => models.GoldCoreEvent.destroy({ where: { id: core.id } }), /immutable/);
  const after = await effectCounts(eventId); assert.equal(after.core, 1); assert.equal(after.receipt, 1); assert.equal(after.integration, 1);
  for (const key of ["assets", "journals", "lines", "cash", "treasury", "liabilities", "pools", "inventoryPools", "prices"]) assert.equal(after[key], before[key], `Gold Center consumer must not mutate ${key}`);
  const replay = await consumer.consumePostedEvent({ eventId }); assert.equal(replay.replayed, true); assert.deepEqual(await effectCounts(eventId), after);
  await protectedHistory();
  const integrity = (await models.sequelize.query(`SELECT (SELECT count(*)::int FROM gold_core_events e LEFT JOIN outbox_events o ON o.event_id=e.source_event_id WHERE o.event_id IS NULL) AS "orphanSource", (SELECT count(*)::int FROM gold_core_events e LEFT JOIN customer_gold_purchase_documents d ON d.id=e.source_document_id WHERE d.id IS NULL) AS "orphanDocument", (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS "unbalanced"`, { type: QueryTypes.SELECT }))[0];
  assert.deepEqual(integrity, { orphanSource: 0, orphanDocument: 0, unbalanced: 0 });
  console.log("CGP_IMP_06_GOLD_CENTER_CORE_EVENT: PASS"); console.log("CGP_IMP_06_EXACTLY_ONCE_CONCURRENCY: PASS"); console.log("CGP_IMP_06_NO_POSITION_COUNTERPARTY_ACCOUNTING_INVENTORY_EFFECT: PASS"); console.log("CGP_IMP_06_IMMUTABILITY_AND_INTEGRITY: PASS");
}
main().catch((e) => { console.error(e.stack || e); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
