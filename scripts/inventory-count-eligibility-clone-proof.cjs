"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("pg");
const { QueryTypes } = require("sequelize");

const sourceDb = "darfus_erp";
const clone = `darfus_erp_count_eligibility_${Date.now()}`;
const pgHost = process.env.DB_HOST && process.env.DB_HOST !== "::1" ? process.env.DB_HOST : "127.0.0.1";
const pgPort = Number(process.env.DB_PORT || 5433) === 5432 ? 5433 : Number(process.env.DB_PORT || 5433);
const pgUser = process.env.DB_USER || "postgres";
const pgPassword = process.env.DB_PASSWORD || process.env.DB_PASS || "postgres";
const pgBin = process.env.PG_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin";
const pgDump = path.join(pgBin, "pg_dump.exe");
const pgRestore = path.join(pgBin, "pg_restore.exe");
const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "darfus-count-eligibility-"));
const dumpFile = path.join(dumpDir, "official.dump");
const plainFile = path.join(dumpDir, "official.sql");

function env() { return { ...process.env, PGPASSWORD: pgPassword }; }
function quoteIdentifier(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function run(binary, args) { childProcess.execFileSync(binary, args, { env: env(), stdio: "pipe" }); }
function config(database) { return { host: pgHost, port: pgPort, user: pgUser, password: pgPassword, database }; }
async function one(client, sql, values = []) { return (await client.query(sql, values)).rows[0]; }

async function main() {
  let admin;
  let models;
  let dropped = false;
  const openTransactions = [];
  const track = (transaction) => { openTransactions.push(transaction); return transaction; };
  try {
    const source = new Client(config(sourceDb));
    await source.connect();
    const sourceIdentity = await one(source, "SELECT current_database() AS database");
    assert.equal(sourceIdentity.database, sourceDb);
    await source.end();

    run(pgDump, ["--format=custom", "--no-owner", "--no-privileges", "--host", pgHost, "--port", String(pgPort), "--username", pgUser, "--file", dumpFile, sourceDb]);
    assert.ok(fs.statSync(dumpFile).size > 0, "official dump must be non-empty");

    admin = new Client(config("postgres"));
    await admin.connect();
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone]);
    assert.equal(existing.rowCount, 0);
    await admin.query(`CREATE DATABASE ${quoteIdentifier(clone)}`);
    run(pgRestore, ["--no-owner", "--no-privileges", "--file", plainFile, dumpFile]);
    const plainSql = fs.readFileSync(plainFile, "utf8").replaceAll("SET transaction_timeout = 0;", "");
    fs.writeFileSync(plainFile, plainSql, "utf8");
    const psql = path.join(pgBin, "psql.exe");
    run(psql, ["--host", pgHost, "--port", String(pgPort), "--username", pgUser, "--dbname", clone, "--set", "ON_ERROR_STOP=1", "--file", plainFile]);

    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "";
    process.env.DB_HOST = pgHost;
    process.env.DB_PORT = String(pgPort);
    process.env.DB_USER = pgUser;
    process.env.DB_PASSWORD = pgPassword;
    process.env.DB_PASS = pgPassword;
    process.env.DB_NAME = clone;
    models = require("../src/models");
    await models.sequelize.authenticate();
    const cloneIdentity = (await models.sequelize.query("SELECT current_database() AS database", { type: QueryTypes.SELECT }))[0];
    assert.equal(cloneIdentity.database, clone);

    const audit = (await models.sequelize.query(`SELECT id, company_id AS "companyId", branch_id AS "branchId", location_id AS "locationId", created_at AS "createdAt" FROM stock_audits WHERE audit_number=:auditNumber`, { replacements: { auditNumber: "COUNT-20260823080206-38a95c8e" }, type: QueryTypes.SELECT }))[0];
    assert.ok(audit, "current Count must exist in the clone");
    const failed = (await models.sequelize.query(`SELECT a.id, a.barcode, a.operational_status AS "operationalStatus", sai.id AS item_id, sai.status AS item_status, sai.result, sai.created_at AS "itemCreatedAt" FROM assets a JOIN stock_audit_items sai ON sai.asset_id=a.id WHERE sai.stock_audit_id=:auditId AND a.barcode='GWRNG21000002'`, { replacements: { auditId: audit.id }, type: QueryTypes.SELECT }))[0];
    assert.equal(failed.operationalStatus, "SOLD");
    assert.equal(failed.item_status, "missing");
    assert.equal(failed.result, null);

    let rejected;
    const soldTransaction = track(await models.sequelize.transaction());
    try {
      await require("../src/services/inventory-audit-canonical.service").observeAudit({ models, companyId: audit.companyId, branchId: audit.branchId, auditId: audit.id, barcodes: [failed.barcode], method: "BARCODE_SCAN", transaction: soldTransaction });
      assert.fail("sold Asset must remain ineligible");
    } catch (error) {
      rejected = { status: error.statusCode, code: error.errorCode, reasonCode: error.details?.reasonCode, message: error.message };
    }
    assert.equal(rejected.status, 409);
    assert.equal(rejected.code, "STATE_CONFLICT");
    assert.equal(rejected.reasonCode, "ASSET_SOLD");
    const failedAfterReject = (await models.sequelize.query("SELECT status, result FROM stock_audit_items WHERE id=:id", { replacements: { id: failed.item_id }, type: QueryTypes.SELECT, transaction: soldTransaction }))[0];
    assert.deepEqual(failedAfterReject, { status: "missing", result: null });
    await soldTransaction.rollback();

    const eligible = (await models.sequelize.query(`SELECT a.id, a.barcode, sai.id AS item_id FROM assets a JOIN stock_audit_items sai ON sai.asset_id=a.id WHERE sai.stock_audit_id=:auditId AND sai.status='missing' AND upper(a.operational_status)='AVAILABLE' AND a.branch_id=:branchId AND a.location_id=:locationId ORDER BY a.id LIMIT 1`, { replacements: { auditId: audit.id, branchId: audit.branchId, locationId: audit.locationId }, type: QueryTypes.SELECT }))[0];
    assert.ok(eligible, "clone must retain an available unobserved expected Asset");
    const eligibleTransaction = track(await models.sequelize.transaction());
    const first = await require("../src/services/inventory-audit-canonical.service").observeAudit({ models, companyId: audit.companyId, branchId: audit.branchId, auditId: audit.id, assetIds: [eligible.id], method: "BARCODE_SCAN", transaction: eligibleTransaction });
    const replay = await require("../src/services/inventory-audit-canonical.service").observeAudit({ models, companyId: audit.companyId, branchId: audit.branchId, auditId: audit.id, assetIds: [eligible.id], method: "BARCODE_SCAN", transaction: eligibleTransaction });
    assert.equal(first.observed[0].replayed, false);
    assert.equal(replay.observed[0].replayed, true);
    const eligibleRows = (await models.sequelize.query("SELECT count(*)::int AS count FROM stock_audit_items WHERE stock_audit_id=:auditId AND asset_id=:assetId", { replacements: { auditId: audit.id, assetId: eligible.id }, type: QueryTypes.SELECT, transaction: eligibleTransaction }))[0];
    assert.equal(Number(eligibleRows.count), 1);
    await eligibleTransaction.rollback();

    const outsideBranch = (await models.sequelize.query(`SELECT id, branch_id AS "branchId" FROM assets WHERE company_id=:companyId AND upper(operational_status)='AVAILABLE' AND branch_id<>:branchId ORDER BY id LIMIT 1`, { replacements: { companyId: audit.companyId, branchId: audit.branchId }, type: QueryTypes.SELECT }))[0];
    let branchResult = "NOT_AVAILABLE_IN_CLONE";
    if (outsideBranch) {
      const tx = track(await models.sequelize.transaction());
      try { await require("../src/services/inventory-audit-canonical.service").observeAudit({ models, companyId: audit.companyId, branchId: audit.branchId, auditId: audit.id, assetIds: [outsideBranch.id], method: "BARCODE_SCAN", transaction: tx }); assert.fail("outside branch Asset must be rejected"); }
      catch (error) { branchResult = error.details?.reasonCode; }
      await tx.rollback();
      assert.equal(branchResult, "ASSET_BRANCH_MISMATCH");
    }

    const outsideLocation = (await models.sequelize.query(`SELECT id, location_id AS "locationId" FROM assets WHERE company_id=:companyId AND branch_id=:branchId AND upper(operational_status)='AVAILABLE' AND coalesce(location_id,'')<>:locationId ORDER BY id LIMIT 1`, { replacements: { companyId: audit.companyId, branchId: audit.branchId, locationId: audit.locationId }, type: QueryTypes.SELECT }))[0];
    let locationResult = "NOT_AVAILABLE_IN_CLONE";
    if (outsideLocation) {
      const tx = track(await models.sequelize.transaction());
      try { await require("../src/services/inventory-audit-canonical.service").observeAudit({ models, companyId: audit.companyId, branchId: audit.branchId, auditId: audit.id, assetIds: [outsideLocation.id], method: "BARCODE_SCAN", transaction: tx }); assert.fail("outside location Asset must be rejected"); }
      catch (error) { locationResult = error.details?.reasonCode; }
      await tx.rollback();
      assert.equal(locationResult, "ASSET_LOCATION_MISMATCH");
    }

    const timing = (await models.sequelize.query(`SELECT (a.updated_at > sai.created_at) AS "changedAfterSnapshot" FROM assets a JOIN stock_audit_items sai ON sai.asset_id=a.id WHERE sai.stock_audit_id=:auditId AND a.barcode='GWRNG21000002'`, { replacements: { auditId: audit.id }, type: QueryTypes.SELECT }))[0];
    assert.equal(timing.changedAfterSnapshot, true);
    const cloneCounts = (await models.sequelize.query("SELECT (SELECT count(*)::int FROM stock_audit_items WHERE stock_audit_id=:auditId) AS items, (SELECT count(*)::int FROM inventory_asset_movements) AS movements, (SELECT count(*)::int FROM journal_entries) AS journals", { replacements: { auditId: audit.id }, type: QueryTypes.SELECT }))[0];
    console.log(JSON.stringify({ clone, sourceDb, cloneDatabaseVerified: cloneIdentity.database, failed: { barcode: failed.barcode, status: failed.operationalStatus, frozenStatus: failed.item_status, frozenResult: failed.result, rejection: rejected }, eligible: { barcode: eligible.barcode, firstReplay: first.observed[0].replayed, secondReplay: replay.observed[0].replayed, rowCount: eligibleRows.count }, outsideBranchReason: branchResult, outsideLocationReason: locationResult, snapshotTiming: timing.changedAfterSnapshot, cloneCounts }, null, 2));
  } finally {
    for (const transaction of openTransactions) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
    }
    if (models) await models.sequelize.close().catch(() => {});
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(clone)} WITH (FORCE)`).catch(() => {});
      const gone = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone]).catch(() => ({ rowCount: 1 }));
      dropped = gone.rowCount === 0;
      await admin.end().catch(() => {});
    }
    fs.rmSync(dumpDir, { recursive: true, force: true });
    if (!dropped) throw new Error("CLONE_DROP_NOT_PROVEN");
    console.log(`DISPOSABLE_CLONE_DROPPED=${dropped ? "YES" : "NO"}`);
  }
}

main().catch((error) => { console.error(error.stack || error.message, error.parent?.message || ""); process.exitCode = 1; });
