"use strict";

const assert = require("node:assert/strict");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const models = require("../src/models");

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const CLAIMED_AT = "2026-08-09T12:00:00.000Z";
const TARGETS = Object.freeze([
  {
    eventId: "CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:c5bc38dc-dece-4ca2-89ed-b94fda9fb379",
    workerId: "CGP-IMP-02-WORKER-A",
  },
  {
    eventId: "CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:8fa6162b-a3f3-4efa-bcc4-56734b0ac8b4",
    workerId: "CGP-IMP-02-WORKER-B",
  },
]);

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function assertAcceptance(transaction) {
  const [rows] = await models.sequelize.query("SELECT current_database() AS db", { transaction });
  assert.equal(rows[0]?.db, ACCEPTANCE_DATABASE, "Outbox remediation refused a non-acceptance database");
}

async function snapshotNonTargets(transaction) {
  const [rows] = await models.sequelize.query(`
    SELECT event_id, status, attempt_count, last_error, available_at,
           claimed_at, claimed_by, published_at, updated_at
      FROM outbox_events
     WHERE event_id NOT IN (:eventIds)
     ORDER BY event_id ASC
  `, { replacements: { eventIds: TARGETS.map((target) => target.eventId) }, transaction });
  return rows;
}

async function targetRows(transaction, lock = false) {
  const [rows] = await models.sequelize.query(`
    SELECT id, event_id, status, attempt_count, last_error, available_at,
           claimed_at, claimed_by, published_at, created_at, updated_at
      FROM outbox_events
     WHERE event_id IN (:eventIds)
     ORDER BY event_id ASC
     ${lock ? "FOR UPDATE" : ""}
  `, { replacements: { eventIds: TARGETS.map((target) => target.eventId) }, transaction });
  return rows;
}

function assertExpectedClaimedRows(rows) {
  assert.equal(rows.length, TARGETS.length, "Target event set must contain exactly two rows");
  const expectedById = new Map(TARGETS.map((target) => [target.eventId, target]));
  for (const row of rows) {
    const target = expectedById.get(row.event_id);
    assert.ok(target, `Unexpected target row ${row.event_id}`);
    assert.equal(row.status, "PROCESSING", `Target ${row.event_id} status changed since incident`);
    assert.equal(row.claimed_by, target.workerId, `Target ${row.event_id} worker changed since incident`);
    assert.equal(new Date(row.claimed_at).toISOString(), CLAIMED_AT, `Target ${row.event_id} claim time changed since incident`);
    assert.equal(new Date(row.updated_at).toISOString(), CLAIMED_AT, `Target ${row.event_id} update time changed since incident`);
    assert.equal(Number(row.attempt_count), 0, `Target ${row.event_id} attempt count changed since incident`);
    assert.equal(row.last_error, null, `Target ${row.event_id} error changed since incident`);
    assert.equal(row.published_at, null, `Target ${row.event_id} publication state changed since incident`);
  }
}

async function main() {
  const transaction = await models.sequelize.transaction();
  try {
    await assertAcceptance(transaction);
    const beforeTargets = await targetRows(transaction, true);
    assertExpectedClaimedRows(beforeTargets);
    const nonTargetsBefore = await snapshotNonTargets(transaction);

    const [restored] = await models.sequelize.query(`
      UPDATE outbox_events
         SET status = 'PENDING',
             claimed_at = NULL,
             claimed_by = NULL,
             updated_at = created_at
       WHERE (event_id = :eventA AND status = 'PROCESSING' AND claimed_by = :workerA
              AND claimed_at = :claimedAt AND updated_at = :claimedAt
              AND attempt_count = 0 AND last_error IS NULL AND published_at IS NULL)
          OR (event_id = :eventB AND status = 'PROCESSING' AND claimed_by = :workerB
              AND claimed_at = :claimedAt AND updated_at = :claimedAt
              AND attempt_count = 0 AND last_error IS NULL AND published_at IS NULL)
      RETURNING event_id, status, attempt_count, last_error, available_at,
                claimed_at, claimed_by, published_at, created_at, updated_at
    `, {
      replacements: {
        eventA: TARGETS[0].eventId,
        workerA: TARGETS[0].workerId,
        eventB: TARGETS[1].eventId,
        workerB: TARGETS[1].workerId,
        claimedAt: CLAIMED_AT,
      },
      transaction,
    });
    assert.equal(restored.length, TARGETS.length, "Compare-and-set did not restore exactly two target rows");
    for (const row of restored) {
      assert.equal(row.status, "PENDING");
      assert.equal(row.claimed_at, null);
      assert.equal(row.claimed_by, null);
      assert.equal(new Date(row.updated_at).getTime(), new Date(row.created_at).getTime());
    }
    const nonTargetsAfter = await snapshotNonTargets(transaction);
    assert.equal(sameJson(nonTargetsAfter, nonTargetsBefore), true, "A non-target Outbox row changed during remediation");
    await transaction.commit();
    console.log(JSON.stringify({
      database: ACCEPTANCE_DATABASE,
      restored: restored.map((row) => ({ eventId: row.event_id, status: row.status, claimedBy: row.claimed_by, claimedAt: row.claimed_at, updatedAt: row.updated_at })),
      nonTargetOutboxRowsMutated: 0,
    }));
    console.log("CGP_IMP_08A_TARGETED_OUTBOX_REMEDIATION: PASS");
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  } finally {
    await models.sequelize.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
