"use strict";

// Controlled acceptance proof for the Accounting consumer.  It creates one
// explicitly marked posted event and calls only the ACCOUNTING consumer by its
// exact id; it never invokes the dispatcher or any other consumer.
const assert = require("assert/strict");
const Decimal = require("decimal.js");
const { Op, QueryTypes } = require("sequelize");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const MARKER = "ACCEPTANCE_TEST_CGP_IMP05";
process.env.DATABASE_URL = "";
process.env.DB_NAME = ACCEPTANCE_DATABASE;
const models = require("../src/models");
const draftService = require("../src/services/gold-purchase-draft.service");
const cgpPosting = require("../src/services/cgp-posting.service");
const consumer = require("../src/services/cgp-accounting-consumer.service");
const { resolveRequiredSemanticAccount } = require("../src/services/financial-account-resolver.service");
const priceService = require("../src/services/gold-price-approval.service");
const permissionService = require("../src/services/permission.service");

async function requireAcceptanceTarget() {
  const rows = await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT });
  assert.equal(rows[0]?.db, ACCEPTANCE_DATABASE, "CGP-IMP-05 verifier refuses a non-acceptance database");
}

async function findContext() {
  for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" }, order: [["id", "ASC"]] });
    if (!customer) continue;
    const branches = await models.Branch.findAll({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] });
    for (const user of await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] })) {
      const actor = user.toJSON();
      if (await permissionService.userHasPermission(actor, cgpPosting.POST_PERMISSION) && await permissionService.userHasPermission(actor, priceService.GOLD_PRICE_APPROVAL_PERMISSION)) {
        for (const branch of branches) {
          const roles = await models.SystemAccountRole.findAll({ where: { companyId: company.id, branchId: branch.id, roleCode: ["INVENTORY_ASSET", "CUSTOMER_CREDITOR"] } });
          if (new Set(roles.map((role) => role.roleCode)).size === 2) return { company: company.toJSON(), branch: branch.toJSON(), customer: customer.toJSON(), user: actor };
        }
      }
    }
  }
  throw new Error("CGP_IMP05_ACCEPTANCE_CONTEXT_NOT_FOUND");
}

async function requireApprovedPrice(context) {
  const price = await models.GoldPrice.findOne({
    where: { companyId: context.company.id, currency: context.company.currency || "AED", karat: 21, approvalStatus: "APPROVED", validFrom: { [Op.lte]: new Date() }, validUntil: { [Op.gt]: new Date() } },
    order: [["approvedAt", "DESC"], ["id", "DESC"]],
  });
  assert.ok(price, "CGP-IMP-05 requires an approved active 21K acceptance price");
}

async function createAndPostOnePiece(context) {
  await requireAcceptanceTarget();
  const existing = await models.CustomerGoldPurchaseDocument.findAll({ where: { notes: { [Op.like]: `${MARKER}%` } }, order: [["createdAt", "ASC"]] });
  for (const document of existing) {
    const roles = await models.SystemAccountRole.findAll({ where: { companyId: document.companyId, branchId: document.branchId, roleCode: ["INVENTORY_ASSET", "CUSTOMER_CREDITOR"] } });
    if (new Set(roles.map((role) => role.roleCode)).size !== 2) continue;
    assert.equal(document.businessStatus, "POSTED", "existing CGP-IMP-05 document must be posted");
    const outbox = await models.OutboxEvent.findOne({ where: { aggregateId: document.id, eventType: consumer.EVENT_TYPE } });
    const snapshots = await models.CgpPricingSnapshot.findAll({ where: { cgpDocumentId: document.id }, order: [["cgpItemId", "ASC"]] });
    assert.ok(outbox && snapshots.length === 1, "existing CGP-IMP-05 event evidence is incomplete");
    return { document: document.toJSON(), postedEvent: outbox.payload, outboxEvent: outbox.toJSON(), pricingSnapshots: snapshots.map((snapshot) => snapshot.toJSON()) };
  }
  const transaction = await models.sequelize.transaction();
  try {
    const created = await draftService.create("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, {
      branchId: context.branch.id, customerId: context.customer.id, transactionDate: "2026-08-09",
      currency: context.company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:ACCOUNTING_EVENT`,
      items: [{ goldType: "acceptance-cgp-accounting-one-piece", karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "9.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }],
    }, transaction);
    const validated = await draftService.validate("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, created.id, created.version, transaction);
    const posted = await cgpPosting.post({ context: { companyId: context.company.id, branchId: context.branch.id, user: context.user }, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:POST`, transaction });
    await transaction.commit();
    return posted;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function count(sql, replacements = {}) {
  const rows = await models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  return Number(rows[0]?.count || 0);
}

function assertMoney(actual, expected, message) {
  assert.equal(new Decimal(actual).toFixed(4), new Decimal(expected).toFixed(4), message);
}

async function countExistingTable(tableName) {
  const exists = await models.sequelize.query("SELECT to_regclass(:tableName) AS name", { replacements: { tableName }, type: QueryTypes.SELECT });
  if (!exists[0]?.name) return 0;
  // Calls below use fixed internal table identifiers, never input from a user.
  return count(`SELECT count(*)::int AS count FROM ${tableName}`);
}

async function immutableBaselines(eventId) {
  return {
    assets: await countExistingTable("assets"),
    assetEvents: await countExistingTable("asset_events"),
    assetMovements: await countExistingTable("inventory_asset_movements"),
    cash: await countExistingTable("cash_transactions"),
    treasury: await countExistingTable("treasury_transactions"),
    customerPools: await countExistingTable("customer_gold_pools"),
    inventoryPools: await countExistingTable("inventory_gold_pools"),
    customerCredits: await countExistingTable("customer_credit_transactions"),
    journalsForEvent: await count("SELECT count(*)::int AS count FROM journal_entries WHERE source_id=:eventId", { eventId }),
    liabilitiesForEvent: await count("SELECT count(*)::int AS count FROM customer_financial_liabilities WHERE source_event_id=:eventId", { eventId }),
    receiptsForEvent: await count("SELECT count(*)::int AS count FROM processed_events WHERE consumer_name='ACCOUNTING' AND event_id=:eventId", { eventId }),
    integrationsForEvent: await count("SELECT count(*)::int AS count FROM integration_statuses WHERE consumer_name='ACCOUNTING' AND source_event_id=:eventId", { eventId }),
  };
}

async function assertHistoricalUntouched() {
  const original = await models.sequelize.query(`SELECT DISTINCT o.event_id AS "eventId"
    FROM outbox_events o JOIN customer_gold_purchase_documents d ON d.id=o.aggregate_id
    JOIN cgp_pricing_snapshots s ON s.cgp_document_id=d.id
    WHERE o.event_type=:eventType AND o.event_version=1 AND s.approved_price_id IS NULL`, { replacements: { eventType: consumer.EVENT_TYPE }, type: QueryTypes.SELECT });
  const imp04 = await models.sequelize.query(`SELECT o.event_id AS "eventId" FROM outbox_events o
    WHERE o.correlation_id LIKE 'ACCEPTANCE_TEST_CGP_IMP04:%' AND o.event_type=:eventType`, { replacements: { eventType: consumer.EVENT_TYPE }, type: QueryTypes.SELECT });
  const ids = [...new Set([...original, ...imp04].map((row) => row.eventId))];
  assert.ok(ids.length >= 22, "expected original historical events plus the three known CGP-IMP-04 events");
  if (!ids.length) return;
  assert.equal(await count("SELECT count(*)::int AS count FROM processed_events WHERE consumer_name='ACCOUNTING' AND event_id IN(:ids)", { ids }), 0, "historical and CGP-IMP-04 events must remain unconsumed by Accounting");
  assert.equal(await count("SELECT count(*)::int AS count FROM integration_statuses WHERE consumer_name='ACCOUNTING' AND source_event_id IN(:ids)", { ids }), 0, "historical and CGP-IMP-04 events must retain no Accounting integration state");
  assert.equal(await count("SELECT count(*)::int AS count FROM customer_financial_liabilities WHERE source_event_id IN(:ids)", { ids }), 0, "historical and CGP-IMP-04 events must retain no financial liability");
}

async function assertMissingMappingFailsClosed(context, eventId) {
  await requireAcceptanceTarget();
  const transaction = await models.sequelize.transaction();
  try {
    const role = await models.SystemAccountRole.findOne({ where: { companyId: context.company.id, branchId: context.branch.id, roleCode: "CUSTOMER_CREDITOR" }, transaction, lock: transaction.LOCK.UPDATE });
    assert.ok(role, "acceptance context must contain CUSTOMER_CREDITOR mapping");
    await role.destroy({ transaction });
    await assert.rejects(
      () => resolveRequiredSemanticAccount({ companyId: context.company.id, branchId: context.branch.id, roleCode: "CUSTOMER_CREDITOR", transaction }),
      /FINANCIAL_MAPPING_REQUIRED|required financial mapping/i,
    );
  } finally {
    if (!transaction.finished) await transaction.rollback();
  }
}

async function main() {
  await requireAcceptanceTarget();
  const context = await findContext();
  await requireApprovedPrice(context);
  await assertHistoricalUntouched();
  const posted = await createAndPostOnePiece(context);
  const eventId = posted.outboxEvent.eventId;
  assert.equal(posted.outboxEvent.eventType, consumer.EVENT_TYPE);
  assert.equal(posted.outboxEvent.status, "PENDING");
  assert.equal(posted.pricingSnapshots.length, 1);
  assertMoney(posted.document.totalPayableToCustomer, posted.postedEvent.pricing.totalPayableToCustomer);
  const before = await immutableBaselines(eventId);
  // A prior acceptance run may already have consumed this single protected
  // fixture. Verify its durable facts instead of incorrectly treating a
  // replay as a fresh failure-injection path.
  if (before.receiptsForEvent === 1) {
    assert.equal(before.journalsForEvent, 1); assert.equal(before.liabilitiesForEvent, 1); assert.equal(before.integrationsForEvent, 1);
    console.log("CGP_IMP_05_ACCOUNTING_RECOGNITION: PASS"); console.log("CGP_IMP_05_VERIFY_EXISTING: PASS"); return;
  }

  await assert.rejects(() => consumer.consumePostedEvent({ eventId, failureInjector: ({ stage }) => { if (stage === "after_journal") throw new Error("CGP_IMP05_FORCED_ROLLBACK"); } }), /CGP_IMP05_FORCED_ROLLBACK/);
  assert.deepEqual(await immutableBaselines(eventId), before, "forced post-journal failure must roll back every Accounting durable effect");

  assert.throws(() => consumer.assertExactEvent({ eventId, eventType: consumer.EVENT_TYPE, eventVersion: 1, aggregateId: posted.document.id, payload: { eventId, eventType: consumer.EVENT_TYPE, eventVersion: 1, aggregate: { type: "CustomerGoldPurchaseDocument", id: "tampered" }, pricing: { lines: [{}] } } }), /immutable purchase evidence/i);
  await assertMissingMappingFailsClosed(context, eventId);
  assert.deepEqual(await immutableBaselines(eventId), before, "negative mapping test must be rolled back atomically");

  await requireAcceptanceTarget();
  const raced = await Promise.allSettled([consumer.consumePostedEvent({ eventId }), consumer.consumePostedEvent({ eventId })]);
  assert.equal(raced.filter((entry) => entry.status === "fulfilled").length, 2, "same event concurrent calls must both resolve");
  const raceValues = raced.map((entry) => entry.value);
  assert.equal(raceValues.filter((value) => value.replayed === false).length, 1, "exactly one concurrent Accounting consumer may create durable facts");
  assert.equal(raceValues.filter((value) => value.replayed === true).length, 1, "concurrent loser must be an idempotent replay");
  const result = raceValues.find((value) => !value.replayed);
  assertMoney(result.finalPurchaseValue, posted.document.totalPayableToCustomer, "Accounting amount must come from immutable final purchase value");
  assert.ok(result.journal?.id && result.liability?.id);
  assert.equal(result.liability.status, "OPEN");
  assertMoney(result.liability.originalAmount, result.finalPurchaseValue);
  assertMoney(result.liability.outstandingAmount, result.finalPurchaseValue);
  assertMoney(result.liability.settledAmount, "0.0000");

  const journalRows = await models.sequelize.query(`SELECT je.id, je.total_debit AS "totalDebit", je.total_credit AS "totalCredit", jl.account_code AS "accountCode", jl.debit, jl.credit
    FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id
    WHERE je.source_type=:sourceType AND je.source_id=:eventId ORDER BY jl.id`, { replacements: { sourceType: consumer.JOURNAL_SOURCE_TYPE, eventId }, type: QueryTypes.SELECT });
  assert.equal(journalRows.length, 2);
  assert.equal(new Set(journalRows.map((row) => row.accountCode)).size, 2);
  assert.ok(journalRows.some((row) => new Decimal(row.debit).eq(result.finalPurchaseValue) && new Decimal(row.credit).eq(0)), "Inventory must be debited exactly once");
  assert.ok(journalRows.some((row) => new Decimal(row.credit).eq(result.finalPurchaseValue) && new Decimal(row.debit).eq(0)), "Customer creditor must be credited exactly once");
  assert.ok(journalRows.every((row) => new Decimal(row.totalDebit).eq(row.totalCredit) && new Decimal(row.totalDebit).eq(result.finalPurchaseValue)));
  assert.equal(await models.CustomerFinancialLiability.count({ where: { sourceEventId: eventId } }), 1);
  assert.equal(await models.ProcessedEvent.count({ where: { consumerName: "ACCOUNTING", eventId } }), 1);
  assert.equal(await models.IntegrationStatus.count({ where: { consumerName: "ACCOUNTING", sourceEventId: eventId, status: "SUCCEEDED" } }), 1);
  assert.equal(await models.OutboxEvent.count({ where: { eventId, status: "PENDING" } }), 1, "consumer must not dispatch or mutate the outbox event");

  const afterFirst = await immutableBaselines(eventId);
  const replay = await consumer.consumePostedEvent({ eventId });
  assert.equal(replay.replayed, true);
  assert.deepEqual(await immutableBaselines(eventId), afterFirst, "idempotent replay must not duplicate durable effects");
  for (const key of ["assets", "assetEvents", "assetMovements", "cash", "treasury", "customerPools", "inventoryPools", "customerCredits"]) {
    assert.equal(afterFirst[key], before[key], `Accounting consumer must not mutate ${key}`);
  }
  await assertHistoricalUntouched();

  const integrity = (await models.sequelize.query(`SELECT
    (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS "unbalancedJournals",
    (SELECT count(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS "orphanJournalLines",
    (SELECT count(*)::int FROM customer_financial_liabilities l LEFT JOIN journal_entries je ON je.id=l.journal_entry_id WHERE je.id IS NULL) AS "orphanLiabilityJournals",
    (SELECT count(*)::int FROM customer_financial_liabilities l LEFT JOIN outbox_events o ON o.event_id=l.source_event_id WHERE o.event_id IS NULL) AS "orphanLiabilityEvents"`, { type: QueryTypes.SELECT }))[0];
  assert.deepEqual(integrity, { unbalancedJournals: 0, orphanJournalLines: 0, orphanLiabilityJournals: 0, orphanLiabilityEvents: 0 });
  console.log("CGP_IMP_05_ACCOUNTING_CONSUMER: PASS");
  console.log("CGP_IMP_05_CUSTOMER_FINANCIAL_LIABILITY: PASS");
  console.log("CGP_IMP_05_IDEMPOTENCY_CONCURRENCY: PASS");
  console.log("CGP_IMP_05_NO_PAYMENT_TREASURY_GOLD_CRM_ASSET_EFFECT: PASS");
  console.log("CGP_IMP_05_INTEGRITY: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
