"use strict";

// Disposable-clone acceptance for the CGP scoped runtime dispatcher. The
// canonical Acceptance and Persistent databases are never used for writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Op, QueryTypes } = require("sequelize");

const BACKEND = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(BACKEND, ".env"), override: true });
const { resolveDatabaseEnv } = require("../src/config/database-env");

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PREFIX = "darfus_erp_cgp_runtime_dispatcher_01_rehearsal_";
const MARKER = "CGP_RUNTIME_DISPATCHER_01";
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";

function configFor(database) {
  const config = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: database });
  assert.equal(config.database, database);
  return config;
}
function assertClone(database) {
  assert.match(database, new RegExp(`^${PREFIX}`));
  assert.notEqual(database, ACCEPTANCE);
  assert.notEqual(database, PERSISTENT);
}
function pgEnv(config, database) {
  return { ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password, PGDATABASE: database, PGSSLMODE: config.ssl ? "require" : "disable" };
}
function runBin(name, args, env) { execFileSync(path.join(PG_BIN, name), args, { env, stdio: "pipe" }); }
function cloneAcceptance(config, clone, dumpDir) {
  runBin("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${path.join(dumpDir, "acceptance.dump")}`, ACCEPTANCE], pgEnv(config, ACCEPTANCE));
  runBin("createdb.exe", [clone], pgEnv(config, "postgres"));
  runBin("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, path.join(dumpDir, "acceptance.dump")], pgEnv(config, clone));
}
function dropClone(config, clone) { assertClone(clone); runBin("dropdb.exe", [clone], pgEnv(config, "postgres")); }
function clientFor(config, database) {
  const { Client } = require("pg");
  return new Client({ host: config.host, port: config.port, user: config.username, password: config.password, database, ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
}
async function verifyDb(config, database, expectedMigrations) {
  const client = clientFor(config, database);
  try {
    await client.connect();
    assert.equal((await client.query("SELECT current_database() AS db")).rows[0].db, database);
    assert.equal(Number((await client.query('SELECT count(*)::int AS n FROM "SequelizeMeta"')).rows[0].n), expectedMigrations);
  } finally { await client.end().catch(() => {}); }
}
async function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const sourceConfig = configFor(ACCEPTANCE);
  const persistentConfig = configFor(PERSISTENT);
  await verifyDb(sourceConfig, ACCEPTANCE, 80);
  await verifyDb(persistentConfig, PERSISTENT, 80);
  const clone = `${PREFIX}${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  assertClone(clone);
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cgp-runtime-dispatcher-01-"));
  cloneAcceptance(sourceConfig, clone, dumpDir);
  process.env.NODE_ENV = "development";
  process.env.DATABASE_URL = "";
  process.env.DB_NAME = clone;
  let models;
  try {
    models = require("../src/models");
    const runtime = require("../src/services/cgp-runtime-dispatcher.service");
    const draft = require("../src/services/gold-purchase-draft.service");
    const posting = require("../src/services/cgp-posting.service");
    const permissions = require("../src/services/permission.service");
    const current = await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT });
    assert.equal(current[0].db, clone);

    const company = await models.Company.findOne();
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true } });
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" } });
    const user = (await models.User.findAll({ where: { companyId: company.id } })).find((row) => permissions.userHasPermission(row.toJSON(), posting.POST_PERMISSION));
    assert.ok(company && branch && customer && user, "CGP_RUNTIME_CONTEXT_NOT_FOUND");
    const context = { companyId: company.id, branchId: branch.id, user: user.toJSON() };

    const mutationGuard = async () => {
      const row = await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT });
      assert.equal(row[0].db, clone, "STOP — clone required before mutation");
    };
    const createPosted = async (label) => {
      await mutationGuard();
      return models.sequelize.transaction(async (transaction) => {
        const created = await draft.create("cgp", context, { branchId: branch.id, customerId: customer.id, transactionDate: "2026-08-12", currency: company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:${label}`, items: [{ goldType: `${MARKER}-${label}`, karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "7.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }] }, transaction);
        const validated = await draft.validate("cgp", context, created.id, created.version, transaction);
        return posting.post({ context, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:${label}:POST`, transaction });
      });
    };

    // Acceptance clone only: posting needs one executable Gold Center price;
    // this is isolated test configuration and is never copied to Persistent.
    await mutationGuard();
    const priceApproval = require("../src/services/gold-price-approval.service");
    await models.sequelize.transaction(async (transaction) => {
      const pending = await priceApproval.createPendingPrice({ context, input: { karat: 21, pricePerGram: "999.0000", currency: company.currency || "AED", source: "manual", validFrom: new Date(Date.now() - 60000), validUntil: new Date(Date.now() + 600000) }, transaction });
      await priceApproval.approvePrice({ context, priceId: pending.id, transaction });
    });

    const activation = new Date(Date.now());
    const old = await createPosted("PRE");
    await mutationGuard();
    await models.sequelize.query("UPDATE outbox_events SET created_at=:createdAt, available_at=:createdAt WHERE event_id=:eventId", { replacements: { createdAt: new Date(activation.getTime() - 1000), eventId: old.outboxEvent.eventId }, type: QueryTypes.UPDATE });
    const fresh = await createPosted("POST");
    await mutationGuard();
    await models.sequelize.query("UPDATE outbox_events SET created_at=:createdAt, available_at=:createdAt WHERE event_id=:eventId", { replacements: { createdAt: new Date(activation.getTime() + 1000), eventId: fresh.outboxEvent.eventId }, type: QueryTypes.UPDATE });

    const config = runtime.resolveConfig({ CGP_RUNTIME_DISPATCH_ENABLED: "true", CGP_RUNTIME_DISPATCH_MIN_CREATED_AT: activation.toISOString(), CGP_RUNTIME_DISPATCH_POLL_MS: "250" });
    assert.equal(config.valid, true);
    const first = await runtime.start({ env: { CGP_RUNTIME_DISPATCH_ENABLED: "true", CGP_RUNTIME_DISPATCH_MIN_CREATED_AT: activation.toISOString(), CGP_RUNTIME_DISPATCH_POLL_MS: "250" }, logger: { warn() {}, error: (...args) => console.error(...args) } });
    assert.equal(first.enabled, true);
    let freshState;
    for (let i = 0; i < 40; i += 1) {
      freshState = await models.sequelize.query(`SELECT o.status,o.last_error,(SELECT count(*) FROM processed_events p WHERE p.event_id=o.event_id) AS receipts,(SELECT count(*) FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=o.aggregate_id) AS assets,(SELECT count(*) FROM customer_financial_liabilities l WHERE l.source_event_id=o.event_id) AS liabilities,(SELECT l.status FROM customer_financial_liabilities l WHERE l.source_event_id=o.event_id LIMIT 1) AS liability_status,(SELECT l.outstanding_amount FROM customer_financial_liabilities l WHERE l.source_event_id=o.event_id LIMIT 1) AS liability_outstanding FROM outbox_events o WHERE o.event_id=:eventId`, { replacements: { eventId: fresh.outboxEvent.eventId }, type: QueryTypes.SELECT });
      if (freshState[0]?.status === "PUBLISHED" && Number(freshState[0].receipts) >= 4) break;
      await sleep(250);
    }
    if (freshState[0].status !== "PUBLISHED") console.error("CGP_RUNTIME_DISPATCH_FAILURE", freshState[0]);
    assert.equal(freshState[0].status, "PUBLISHED");
    assert.equal(Number(freshState[0].receipts), 4);
    assert.equal(Number(freshState[0].assets), 1);
    assert.equal(Number(freshState[0].liabilities), 1);
    assert.equal(freshState[0].liability_status, "OPEN");
    assert.ok(Number(freshState[0].liability_outstanding) > 0);
    const freshAsset = await models.sequelize.query("SELECT a.id,a.barcode,a.operational_status AS status FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=:documentId", { replacements: { documentId: fresh.document.id }, type: QueryTypes.SELECT });
    assert.equal(freshAsset.length, 1);
    assert.equal(freshAsset[0].status, "AVAILABLE");

    const oldState = await models.sequelize.query(`SELECT o.status,o.attempt_count,(SELECT count(*) FROM processed_events p WHERE p.event_id=o.event_id) AS receipts,(SELECT count(*) FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=o.aggregate_id) AS assets FROM outbox_events o WHERE o.event_id=:eventId`, { replacements: { eventId: old.outboxEvent.eventId }, type: QueryTypes.SELECT });
    assert.equal(oldState[0].status, "PENDING");
    assert.equal(Number(oldState[0].attempt_count), 0);
    assert.equal(Number(oldState[0].receipts), 0);
    assert.equal(Number(oldState[0].assets), 0);

    // Duplicate dispatch after completion finds no eligible source event and
    // therefore cannot create a second Asset, Journal, Liability, or event.
    await runtime.stop();
    const duplicate = await runtime.processOnce({ config, limit: 1 });
    assert.equal(duplicate.claimed, 0);

    // Restart/retry proof: force a failure after Inventory has committed. The
    // next runtime instance uses the same fixed watermark and canonical
    // registry; Inventory replays idempotently and remaining consumers finish.
    const retryable = await createPosted("RESTART");
    await mutationGuard();
    await models.sequelize.query("UPDATE outbox_events SET created_at=:createdAt, available_at=:createdAt WHERE event_id=:eventId", { replacements: { createdAt: new Date(activation.getTime() + 2000), eventId: retryable.outboxEvent.eventId }, type: QueryTypes.UPDATE });
    // Make the clone-only failure injection immediately eligible while the
    // event remains strictly after the fixed activation watermark.
    await mutationGuard();
    await models.sequelize.query("UPDATE outbox_events SET available_at=NOW() WHERE event_id=:eventId", { replacements: { eventId: retryable.outboxEvent.eventId }, type: QueryTypes.UPDATE });
    const failureRegistry = require("../src/services/outbox-dispatcher.service").createHandlerRegistry();
    const retryInventory = require("../src/services/cgp-inventory-consumer.service");
    failureRegistry.register({ eventType: runtime.EVENT_TYPE, eventVersion: runtime.EVENT_VERSION, handler: async (event) => { await retryInventory.consumePostedEvent({ eventId: event.event_id }); throw new Error("CGP_RUNTIME_FORCED_ACCOUNTING_FAILURE"); } });
    const failed = await runtime.processOnce({ config, registry: failureRegistry, limit: 1, now: new Date(Date.now() + 5000) });
    assert.equal(failed.results[0].state, "RETRYABLE_FAILED");
    const failedState = await models.sequelize.query("SELECT status,attempt_count FROM outbox_events WHERE event_id=:eventId", { replacements: { eventId: retryable.outboxEvent.eventId }, type: QueryTypes.SELECT });
    assert.equal(failedState[0].status, "RETRYABLE_FAILED");
    assert.equal(Number(failedState[0].attempt_count), 1);
    await mutationGuard();
    await models.sequelize.query("UPDATE outbox_events SET available_at=NOW() WHERE event_id=:eventId", { replacements: { eventId: retryable.outboxEvent.eventId }, type: QueryTypes.UPDATE });
    const restarted = await runtime.start({ env: { CGP_RUNTIME_DISPATCH_ENABLED: "true", CGP_RUNTIME_DISPATCH_MIN_CREATED_AT: activation.toISOString(), CGP_RUNTIME_DISPATCH_POLL_MS: "250" }, logger: { warn() {}, error() {} } });
    assert.equal(restarted.config.watermark.toISOString(), activation.toISOString());
    let retryState;
    for (let i = 0; i < 40; i += 1) {
      retryState = await models.sequelize.query("SELECT status,(SELECT count(*) FROM processed_events p WHERE p.event_id=o.event_id) AS receipts FROM outbox_events o WHERE o.event_id=:eventId", { replacements: { eventId: retryable.outboxEvent.eventId }, type: QueryTypes.SELECT });
      if (retryState[0]?.status === "PUBLISHED" && Number(retryState[0].receipts) >= 4) break;
      await sleep(250);
    }
    assert.equal(retryState[0].status, "PUBLISHED");
    assert.equal(Number(retryState[0].receipts), 4);
    await runtime.stop();

    // Two independent runtime claims against one eligible event must yield
    // exactly one durable winner through the existing SKIP LOCKED claim.
    const concurrent = await createPosted("CONCURRENT");
    await mutationGuard();
    await models.sequelize.query("UPDATE outbox_events SET created_at=:createdAt, available_at=NOW() WHERE event_id=:eventId", { replacements: { createdAt: new Date(activation.getTime() + 3000), eventId: concurrent.outboxEvent.eventId }, type: QueryTypes.UPDATE });
    const concurrentResults = await Promise.all([
      runtime.processOnce({ config, claimant: "cgp-concurrency-a", limit: 1, now: new Date(Date.now() + 5000) }),
      runtime.processOnce({ config, claimant: "cgp-concurrency-b", limit: 1, now: new Date(Date.now() + 5000) }),
    ]);
    assert.equal(concurrentResults.filter((result) => result.claimed === 1).length, 1);
    const concurrentState = await models.sequelize.query("SELECT status,(SELECT count(*) FROM processed_events p WHERE p.event_id=o.event_id) AS receipts,(SELECT count(*) FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=o.aggregate_id) AS assets FROM outbox_events o WHERE o.event_id=:eventId", { replacements: { eventId: concurrent.outboxEvent.eventId }, type: QueryTypes.SELECT });
    assert.equal(concurrentState[0].status, "PUBLISHED");
    assert.equal(Number(concurrentState[0].receipts), 4);
    assert.equal(Number(concurrentState[0].assets), 1);

    const integrity = (await models.sequelize.query(`SELECT (SELECT count(*)::int FROM journal_entries je JOIN (SELECT journal_entry_id,SUM(debit) d,SUM(credit) c FROM journal_lines GROUP BY journal_entry_id)x ON x.journal_entry_id=je.id WHERE je.status IN ('posted','reversed') AND x.d<>x.c) AS unbalanced,(SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines,(SELECT count(*)::int FROM cash_transactions c LEFT JOIN journal_entries j ON j.id=c.journal_entry_id WHERE c.journal_entry_id IS NOT NULL AND j.id IS NULL) AS unlinked_treasury,(SELECT count(*)::int FROM assets WHERE barcode IS NULL OR btrim(barcode)='') AS blank_barcodes`, { type: QueryTypes.SELECT }))[0];
    assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, unlinked_treasury: 0, blank_barcodes: 0 });
    console.log(JSON.stringify({ database: clone, activationWatermark: activation.toISOString(), preActivation: { eventId: old.outboxEvent.eventId, status: oldState[0].status, attemptCount: Number(oldState[0].attempt_count), receipts: Number(oldState[0].receipts), assets: Number(oldState[0].assets) }, postActivation: { eventId: fresh.outboxEvent.eventId, status: freshState[0].status, receipts: Number(freshState[0].receipts), assets: Number(freshState[0].assets), liability: Number(freshState[0].liabilities), liabilityStatus: freshState[0].liability_status, settlementReady: Number(freshState[0].liability_outstanding) > 0, assetStatus: freshAsset[0].status }, restartRecovery: { eventId: retryable.outboxEvent.eventId, status: retryState[0].status, receipts: Number(retryState[0].receipts), failedAttemptCount: Number(failedState[0].attempt_count) }, concurrency: { eventId: concurrent.outboxEvent.eventId, winners: concurrentResults.filter((result) => result.claimed === 1).length, status: concurrentState[0].status, receipts: Number(concurrentState[0].receipts), assets: Number(concurrentState[0].assets) }, integrity }));
    console.log("CGP_RUNTIME_OUTBOX_DISPATCHER_01: PASS");
  } finally {
    try { await models?.sequelize?.close(); } catch {}
    try { dropClone(sourceConfig, clone); } finally { fs.rmSync(dumpDir, { recursive: true, force: true }); }
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
