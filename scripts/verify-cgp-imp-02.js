"use strict";

const assert = require("node:assert/strict");
const path = require("path");
const { QueryTypes } = require("sequelize");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const ISOLATED_DATABASE = String(process.env.CGP_IMP10A_REGRESSION_DB || "").trim();
const ISOLATED_PREFIX = /^darfus_erp_cgp_imp10a_regression_[a-z0-9_]+$/;
if (ISOLATED_DATABASE && !ISOLATED_PREFIX.test(ISOLATED_DATABASE)) throw new Error("CGP_IMP02_ISOLATED_DATABASE_INVALID");
const TARGET_DATABASE = ISOLATED_DATABASE || ACCEPTANCE_DATABASE;
// Bind model initialization and every verifier transaction to one explicit
// target.  A disposable clone is accepted only by the anchored regression
// prefix; the persistent database never qualifies.
delete process.env.DATABASE_URL;
process.env.DB_NAME = TARGET_DATABASE;

const models = require("../src/models");
const { enqueueEvent, markPublished, markRetryableFailure } = require("../src/services/outbox.service");
const { consumeExactlyOnce, recordProcessedEvent } = require("../src/services/processed-event.service");
const { ensureIntegrationStatus, transitionIntegrationStatus, INTEGRATION_STATUS } = require("../src/services/integration-status.service");
const PREFIX = "CGP-IMP-02:";
const FIXED_NOW = new Date("2026-08-09T12:00:00.000Z");

async function assertAcceptance(transaction) {
  const [rows] = await models.sequelize.query("SELECT current_database() AS db", { transaction });
  assert.equal(rows[0]?.db, TARGET_DATABASE, "CGP-IMP-02 mutation target must be acceptance or an approved isolated clone");
}

async function inAcceptanceTransaction(work) {
  return models.sequelize.transaction(async (transaction) => {
    await assertAcceptance(transaction);
    return work(transaction);
  });
}

function event(suffix, availableAt = FIXED_NOW) {
  return {
    eventId: `${PREFIX}${suffix}`,
    eventType: "Infrastructure.TestEvent",
    eventVersion: 1,
    aggregateType: "CGP_IMP_02_TEST",
    aggregateId: `AGG:${suffix}`,
    payload: { fixture: "acceptance-only", suffix },
    occurredAt: FIXED_NOW,
    availableAt,
    correlationId: `${PREFIX}CORR:${suffix}`,
    causationId: `${PREFIX}CAUSE:${suffix}`,
  };
}

async function cleanup() {
  await inAcceptanceTransaction(async (transaction) => {
    await models.sequelize.query("DELETE FROM processed_events WHERE event_id LIKE :prefix", { replacements: { prefix: `${PREFIX}%` }, transaction });
    await models.sequelize.query("DELETE FROM integration_statuses WHERE source_event_id LIKE :prefix", { replacements: { prefix: `${PREFIX}%` }, transaction });
    await models.sequelize.query("DELETE FROM outbox_events WHERE event_id LIKE :prefix", { replacements: { prefix: `${PREFIX}%` }, transaction });
  });
}

async function countFixtures() {
  const [rows] = await models.sequelize.query(`
    SELECT
      (SELECT count(*)::int FROM outbox_events WHERE event_id LIKE :prefix) AS outbox,
      (SELECT count(*)::int FROM processed_events WHERE event_id LIKE :prefix) AS processed,
      (SELECT count(*)::int FROM integration_statuses WHERE source_event_id LIKE :prefix) AS integration
  `, { replacements: { prefix: `${PREFIX}%` } });
  return rows[0];
}

async function snapshotNonFixtureOutbox() {
  const [rows] = await models.sequelize.query(`
    SELECT event_id, status, attempt_count, last_error, available_at,
           claimed_at, claimed_by, published_at, updated_at
      FROM outbox_events
     WHERE event_id NOT LIKE :prefix
     ORDER BY event_id ASC
  `, { replacements: { prefix: `${PREFIX}%` } });
  return rows;
}

// This verifier must never exercise the shared worker claim query: it owns
// only the deterministic CGP-IMP-02 event ID that it inserted itself.
async function claimExactFixtureEvent({ transaction, eventId, workerId, now = new Date(), sequelize = models.sequelize } = {}) {
  const [claimed] = await sequelize.query(`
    WITH candidate AS (
      SELECT id
        FROM outbox_events
       WHERE event_id = :eventId
         AND status IN ('PENDING', 'RETRYABLE_FAILED')
         AND available_at <= :now
       FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events AS event
       SET status = 'PROCESSING',
           claimed_at = :now,
           claimed_by = :workerId,
           updated_at = :now
      FROM candidate
     WHERE event.id = candidate.id
    RETURNING event.*
  `, {
    replacements: { eventId, workerId, now },
    type: QueryTypes.SELECT,
    transaction,
  });
  return claimed || null;
}

async function main() {
  await assertAcceptance();
  await cleanup();
  try {
    // A rollback leaves neither the business-side test effect nor its outbox row.
    await assert.rejects(models.sequelize.transaction(async (transaction) => {
      await assertAcceptance(transaction);
      await enqueueEvent({ transaction, event: event("ROLLBACK") });
      throw new Error("intentional rollback");
    }), /intentional rollback/);
    assert.equal((await countFixtures()).outbox, 0);

    const primary = await inAcceptanceTransaction((transaction) => enqueueEvent({ transaction, event: event("PRIMARY") }));
    await assert.rejects(inAcceptanceTransaction((transaction) => primary.update({ payload: { changed: true } }, { transaction })), /immutable/i);
    await assert.rejects(models.sequelize.transaction(async (transaction) => {
      await assertAcceptance(transaction);
      await enqueueEvent({ transaction, event: event("PRIMARY") });
    }));
    assert.equal(await models.OutboxEvent.count({ where: { eventId: primary.eventId } }), 1);
    await assert.rejects(inAcceptanceTransaction((transaction) => markPublished({ transaction, eventId: primary.eventId, workerId: "CGP-IMP-02-NO-CLAIM", now: FIXED_NOW })));

    const nonFixtureBefore = await snapshotNonFixtureOutbox();

    // Atomic exact-ID claim: two workers see one durable fixture winner only.
    const [claimA, claimB] = await Promise.all([
      inAcceptanceTransaction((transaction) => claimExactFixtureEvent({ transaction, eventId: primary.eventId, workerId: "CGP-IMP-02-WORKER-A", now: FIXED_NOW })),
      inAcceptanceTransaction((transaction) => claimExactFixtureEvent({ transaction, eventId: primary.eventId, workerId: "CGP-IMP-02-WORKER-B", now: FIXED_NOW })),
    ]);
    assert.equal([claimA, claimB].filter(Boolean).length, 1);
    const winningWorker = claimA ? "CGP-IMP-02-WORKER-A" : "CGP-IMP-02-WORKER-B";
    const failed = await inAcceptanceTransaction((transaction) => markRetryableFailure({ transaction, eventId: primary.eventId, workerId: winningWorker, error: "token=must-not-persist", now: FIXED_NOW }));
    assert.equal(failed.status, "RETRYABLE_FAILED");
    assert.equal(Number(failed.attempt_count), 1);
    assert.equal(failed.last_error.includes("must-not-persist"), false);
    const retryClaim = await inAcceptanceTransaction((transaction) => claimExactFixtureEvent({ transaction, eventId: primary.eventId, workerId: "CGP-IMP-02-WORKER-RETRY", now: new Date(failed.available_at.getTime() + 1) }));
    assert.equal(Boolean(retryClaim), true);
    const published = await inAcceptanceTransaction((transaction) => markPublished({ transaction, eventId: primary.eventId, workerId: "CGP-IMP-02-WORKER-RETRY", now: new Date(failed.available_at.getTime() + 2) }));
    assert.equal(published.event_id, primary.eventId);
    assert.equal(published.status, "PUBLISHED");
    assert.deepEqual(published.payload, event("PRIMARY").payload);

    await inAcceptanceTransaction((transaction) => enqueueEvent({ transaction, event: event("FUTURE", new Date(FIXED_NOW.getTime() + 60000)) }));
    const notDue = await inAcceptanceTransaction((transaction) => claimExactFixtureEvent({ transaction, eventId: `${PREFIX}FUTURE`, workerId: "CGP-IMP-02-WORKER-NOT-DUE", now: FIXED_NOW }));
    assert.equal(notDue, null);

    const processedEvent = event("PROCESSED");
    await assert.rejects(models.sequelize.transaction(async (transaction) => {
      await assertAcceptance(transaction);
      await consumeExactlyOnce({
        transaction,
        consumerName: "AUDIT_DURABILITY",
        event: processedEvent,
        effect: async () => {
          await ensureIntegrationStatus({ transaction, sourceEventId: processedEvent.eventId, aggregateType: processedEvent.aggregateType, aggregateId: processedEvent.aggregateId, consumerName: "AUDIT_DURABILITY", correlationId: processedEvent.correlationId });
          throw new Error("intentional domain rollback");
        },
      });
    }), /intentional domain rollback/);
    assert.equal(await models.ProcessedEvent.count({ where: { eventId: processedEvent.eventId } }), 0);
    assert.equal(await models.IntegrationStatus.count({ where: { sourceEventId: processedEvent.eventId } }), 0);

    const committed = await inAcceptanceTransaction(async (transaction) => consumeExactlyOnce({
      transaction,
      consumerName: "AUDIT_DURABILITY",
      event: processedEvent,
      effect: async () => ensureIntegrationStatus({ transaction, sourceEventId: processedEvent.eventId, aggregateType: processedEvent.aggregateType, aggregateId: processedEvent.aggregateId, consumerName: "AUDIT_DURABILITY", correlationId: processedEvent.correlationId }),
    }));
    assert.equal(committed.processed, true);
    let integration = await models.IntegrationStatus.findOne({ where: { sourceEventId: processedEvent.eventId, consumerName: "AUDIT_DURABILITY" } });
    const duplicateStatus = await inAcceptanceTransaction((transaction) => ensureIntegrationStatus({ transaction, sourceEventId: processedEvent.eventId, aggregateType: processedEvent.aggregateType, aggregateId: processedEvent.aggregateId, consumerName: "AUDIT_DURABILITY", correlationId: processedEvent.correlationId }));
    assert.equal(duplicateStatus.created, false);
    await inAcceptanceTransaction((transaction) => transitionIntegrationStatus({ transaction, status: integration, nextStatus: INTEGRATION_STATUS.PROCESSING, now: FIXED_NOW }));
    await inAcceptanceTransaction((transaction) => transitionIntegrationStatus({ transaction, status: integration, nextStatus: INTEGRATION_STATUS.RETRYABLE_FAILED, error: "authorization=do-not-store", now: new Date(FIXED_NOW.getTime() + 1) }));
    await inAcceptanceTransaction((transaction) => transitionIntegrationStatus({ transaction, status: integration, nextStatus: INTEGRATION_STATUS.PROCESSING, now: new Date(FIXED_NOW.getTime() + 2) }));
    await inAcceptanceTransaction((transaction) => transitionIntegrationStatus({ transaction, status: integration, nextStatus: INTEGRATION_STATUS.SUCCEEDED, now: new Date(FIXED_NOW.getTime() + 3) }));
    assert.equal(integration.status, "SUCCEEDED");
    assert.equal(Number(integration.attemptCount), 2);

    // Concurrent consumer delivery shares the unique durable receipt boundary.
    const concurrentEvent = event("CONCURRENT");
    const results = await Promise.all([
      inAcceptanceTransaction((transaction) => recordProcessedEvent({ transaction, consumerName: "CRM", event: concurrentEvent })),
      inAcceptanceTransaction((transaction) => recordProcessedEvent({ transaction, consumerName: "CRM", event: concurrentEvent })),
    ]);
    assert.equal(results.filter((result) => result.claimed).length, 1);
    assert.equal(await models.ProcessedEvent.count({ where: { consumerName: "CRM", eventId: concurrentEvent.eventId } }), 1);
    const multiConsumerEvent = event("MULTI-CONSUMER");
    await inAcceptanceTransaction((transaction) => recordProcessedEvent({ transaction, consumerName: "CRM", event: multiConsumerEvent }));
    await inAcceptanceTransaction((transaction) => recordProcessedEvent({ transaction, consumerName: "INVENTORY", event: multiConsumerEvent }));
    await inAcceptanceTransaction((transaction) => recordProcessedEvent({ transaction, consumerName: "CRM", event: event("DIFFERENT-EVENT") }));
    assert.equal(await models.ProcessedEvent.count({ where: { eventId: multiConsumerEvent.eventId } }), 2);
    await assert.rejects(inAcceptanceTransaction((transaction) => recordProcessedEvent({ transaction, consumerName: "CLIENT_SUPPLIED", event: event("UNSAFE-CONSUMER") })));

    const nonFixtureAfter = await snapshotNonFixtureOutbox();
    assert.deepEqual(nonFixtureAfter, nonFixtureBefore, "CGP-IMP-02 must not mutate a non-fixture Outbox row");

    console.log("CGP_IMP_02_TRANSACTIONAL_OUTBOX: PASS");
    console.log("CGP_IMP_02_PROCESSED_EVENT_IDEMPOTENCY: PASS");
    console.log("CGP_IMP_02_CLAIM_CONCURRENCY: PASS");
    console.log("CGP_IMP_02_INTEGRATION_STATUS: PASS");
    console.log("CGP_IMP_02_NON_TEST_OUTBOX_MUTATION: 0");
  } finally {
    await cleanup();
    const remaining = await countFixtures();
    assert.deepEqual(remaining, { outbox: 0, processed: 0, integration: 0 });
    await models.sequelize.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
