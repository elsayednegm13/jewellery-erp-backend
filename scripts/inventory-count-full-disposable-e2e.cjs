"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("pg");

const SOURCE_DB = "darfus_erp";
const CLONE_DB = `darfus_erp_count_full_${Date.now()}`;
const API_PORT = 8001;
const API_BASE = `http://127.0.0.1:${API_PORT}/api/v1`;
const COMPANY_ID = "COMP-48ab554f-427e-4642-9419-bc8616c2dc36";
const TEST_BRANCH = "BRA-1787464306683";
const TEST_LOCATION = "LOC-2ca3af2d-e01a-454c-a625-4951d0925927";
const LOGIN_EMAIL = process.env.COUNT_E2E_LOGIN_EMAIL || "admin@admin.com";
const LOGIN_PASSWORD = process.env.COUNT_E2E_LOGIN_PASSWORD;
const pgBin = process.env.PG_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin";
const pgDump = path.join(pgBin, "pg_dump.exe");
const pgRestore = path.join(pgBin, "pg_restore.exe");
const psql = path.join(pgBin, "psql.exe");
const pgHost = process.env.DB_HOST && process.env.DB_HOST !== "::1" ? process.env.DB_HOST : "127.0.0.1";
const pgPort = Number(process.env.DB_PORT || 5433) === 5432 ? 5433 : Number(process.env.DB_PORT || 5433);
const pgUser = process.env.DB_USER || "postgres";
const pgPassword = process.env.DB_PASSWORD || process.env.DB_PASS || "postgres";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "darfus-count-full-"));
const dumpFile = path.join(tempDir, "official.dump");
const plainFile = path.join(tempDir, "official.sql");

function envForPg() { return { ...process.env, PGPASSWORD: pgPassword }; }
function q(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function run(binary, args, options = {}) { return childProcess.execFileSync(binary, args, { env: envForPg(), stdio: "pipe", ...options }); }
function dbConfig(database) { return { host: pgHost, port: pgPort, user: pgUser, password: pgPassword, database }; }
async function query(client, sql, values = []) { return (await client.query(sql, values)).rows; }
async function one(client, sql, values = []) { return (await client.query(sql, values)).rows[0]; }
async function waitFor(url, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `${response.status}`;
    } catch (error) { last = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`SERVER_NOT_READY:${url}:${last}`);
}
function dockerBackendEnv() {
  try {
    const raw = childProcess.execFileSync("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", "darfus-backend"], { encoding: "utf8" });
    return Object.fromEntries(raw.split(/\r?\n/).filter(Boolean).map((line) => {
      const index = line.indexOf("=");
      return index < 0 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
    }));
  } catch { return {}; }
}
function jsonResponse(response, payload) {
  return { status: response.status, body: payload };
}

async function main() {
  if (!LOGIN_PASSWORD) throw new Error("COUNT_E2E_LOGIN_PASSWORD is required and is never printed.");
  let admin;
  let server;
  let cloneClient;
  let sourceBefore;
  let sourceAfter;
  let cloneDropped = false;
  const keepClone = process.env.KEEP_COUNT_CLONE === "1";
  const mutationRequests = [];
  const request = async (method, pathname, body, key) => {
    const response = await fetch(`${API_BASE}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${main.token}`,
        "X-Company-ID": COMPANY_ID,
        "X-Branch-ID": TEST_BRANCH,
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (method !== "GET") mutationRequests.push({ method, pathname, key: key || null, status: response.status, requestId: parsed?.error?.requestId || null });
    return jsonResponse(response, parsed);
  };

  try {
    const sourceClient = new Client(dbConfig(SOURCE_DB));
    await sourceClient.connect();
    const identity = await one(sourceClient, "SELECT current_database() AS database");
    assert.equal(identity.database, SOURCE_DB, "official source identity must be proven");
    sourceBefore = await one(sourceClient, `SELECT
      (SELECT count(*)::int FROM stock_audits) AS stock_audits,
      (SELECT count(*)::int FROM stock_audit_items) AS stock_audit_items,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM inventory_asset_movements) AS inventory_asset_movements,
      (SELECT count(*)::int FROM journal_entries) AS journal_entries,
      (SELECT count(*)::int FROM asset_events) AS asset_events`);
    await sourceClient.end();

    run(pgDump, ["--format=custom", "--no-owner", "--no-privileges", "--host", pgHost, "--port", String(pgPort), "--username", pgUser, "--file", dumpFile, SOURCE_DB]);
    assert.ok(fs.statSync(dumpFile).size > 0, "official dump must be non-empty");
    admin = new Client(dbConfig("postgres"));
    await admin.connect();
    const exists = await one(admin, "SELECT 1 FROM pg_database WHERE datname=$1", [CLONE_DB]);
    assert.equal(exists, undefined, "clone name must be fresh");
    await admin.query(`CREATE DATABASE ${q(CLONE_DB)}`);
    run(pgRestore, ["--no-owner", "--no-privileges", "--file", plainFile, dumpFile]);
    fs.writeFileSync(plainFile, fs.readFileSync(plainFile, "utf8").replaceAll("SET transaction_timeout = 0;", ""), "utf8");
    run(psql, ["--host", pgHost, "--port", String(pgPort), "--username", pgUser, "--dbname", CLONE_DB, "--set", "ON_ERROR_STOP=1", "--file", plainFile]);

    cloneClient = new Client(dbConfig(CLONE_DB));
    await cloneClient.connect();
    const cloneIdentity = await one(cloneClient, "SELECT current_database() AS database");
    assert.equal(cloneIdentity.database, CLONE_DB);
    const cloneBefore = await one(cloneClient, `SELECT
      (SELECT count(*)::int FROM stock_audits) AS stock_audits,
      (SELECT count(*)::int FROM stock_audit_items) AS stock_audit_items,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM inventory_asset_movements) AS inventory_asset_movements,
      (SELECT count(*)::int FROM journal_entries) AS journal_entries,
      (SELECT count(*)::int FROM asset_events) AS asset_events`);
    const assetSnapshotBefore = await query(cloneClient, `SELECT id, barcode, operational_status AS status, branch_id, location_id FROM assets ORDER BY id`);
    const candidates = await query(cloneClient, `SELECT id, barcode FROM assets
      WHERE company_id=$1 AND branch_id=$2 AND location_id=$3
        AND upper(operational_status) NOT IN ('SOLD','MELTED','MISSING')
      ORDER BY id`, [COMPANY_ID, TEST_BRANCH, TEST_LOCATION]);
    assert.ok(candidates.length > 0, "clone must provide eligible candidates");
    const sold = await one(cloneClient, "SELECT id, barcode FROM assets WHERE company_id=$1 AND upper(operational_status)='SOLD' ORDER BY id LIMIT 1", [COMPANY_ID]);
    const wrongScope = await one(cloneClient, "SELECT id, barcode, branch_id AS \"branchId\", location_id AS \"locationId\" FROM assets WHERE company_id=$1 AND upper(operational_status) NOT IN ('SOLD','MELTED','MISSING') AND (branch_id<>$2 OR location_id<>$3) ORDER BY id LIMIT 1", [COMPANY_ID, TEST_BRANCH, TEST_LOCATION]);
    assert.ok(sold, "clone must provide a SOLD candidate");
    assert.ok(wrongScope, "clone must provide a wrong-scope candidate");

    const dockerEnv = dockerBackendEnv();
    const serverEnv = {
      ...process.env,
      ...dockerEnv,
      NODE_ENV: "development",
      PORT: String(API_PORT),
      DB_HOST: pgHost,
      DB_PORT: String(pgPort),
      DB_NAME: CLONE_DB,
      DB_USER: pgUser,
      DB_PASS: pgPassword,
      DB_PASSWORD: pgPassword,
      DATABASE_URL: "",
      REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379",
      CORS_ALLOWED_ORIGINS: `http://localhost:3001,http://127.0.0.1:3001`,
      FRONTEND_URL: "http://localhost:3001",
      ALLOW_RUNTIME_ADMIN_BOOTSTRAP: "false",
      UPLOAD_DIR: path.join(tempDir, "uploads"),
    };
    fs.mkdirSync(serverEnv.UPLOAD_DIR, { recursive: true });
    server = childProcess.spawn(process.execPath, ["src/server.js"], { cwd: path.resolve(__dirname, ".."), env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });
    const logs = [];
    server.stdout.on("data", (chunk) => logs.push(String(chunk).replace(/Bearer\s+\S+/g, "Bearer [REDACTED]")));
    server.stderr.on("data", (chunk) => logs.push(String(chunk).replace(/Bearer\s+\S+/g, "Bearer [REDACTED]")));
    await waitFor(`${API_BASE}/health`);
    const health = await (await fetch(`${API_BASE}/health`)).json();
    assert.equal(health.success, true);
    const loginResponse = await fetch(`${API_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }) });
    const loginBody = await loginResponse.json();
    assert.equal(loginResponse.status, 200, `clone login failed: ${loginBody?.error?.code || loginBody?.message || "unknown"}`);
    main.token = loginBody.data.token;
    assert.ok(main.token);

    const auditNumber = `COUNT-CLONE-${Date.now()}`;
    const createKey = `count-create-${Date.now()}`;
    const createBody = { auditNumber, auditMethod: "BARCODE_SCAN", locationId: TEST_LOCATION, notes: "Disposable E2E only" };
    const created = await request("POST", "/inventory-v2/audits", createBody, createKey);
    assert.equal(created.status, 201);
    const testCountId = created.body.data.id;
    const duplicateCreate = await request("POST", "/inventory-v2/audits", { ...createBody, auditNumber: `${auditNumber}-DUPLICATE` }, `count-create-duplicate-${Date.now()}`);
    assert.equal(duplicateCreate.status, 409);
    assert.equal(duplicateCreate.body.error?.code, "STATE_CONFLICT");
    const start = await request("POST", `/inventory-v2/audits/${encodeURIComponent(testCountId)}/start`, {}, `count-start-${Date.now()}`);
    assert.equal(start.status, 200);
    assert.equal(start.body.data.status, "in-progress");
    assert.equal(Number(start.body.data.expectedCount), candidates.length);
    const secondActive = await query(cloneClient, "SELECT count(*)::int AS count FROM stock_audits WHERE company_id=$1 AND branch_id=$2 AND location_id=$3 AND status IN ('draft','in-progress')", [COMPANY_ID, TEST_BRANCH, TEST_LOCATION]);
    assert.equal(secondActive[0].count, 1);

    const eligibleBarcodes = candidates.map((row) => row.barcode);
    const scanKey = `count-scan-${Date.now()}`;
    const scanned = await request("POST", `/inventory-v2/audits/${encodeURIComponent(testCountId)}/observe`, { barcodes: eligibleBarcodes, method: "BARCODE_SCAN" }, scanKey);
    assert.equal(scanned.status, 200);
    const replay = await request("POST", `/inventory-v2/audits/${encodeURIComponent(testCountId)}/observe`, { barcodes: eligibleBarcodes, method: "BARCODE_SCAN" }, scanKey);
    assert.equal(replay.status, 200);
    const observationCount = await one(cloneClient, "SELECT count(*)::int AS count FROM stock_audit_items WHERE stock_audit_id=$1 AND result='MATCHED'", [testCountId]);
    assert.equal(observationCount.count, candidates.length);

    const soldAttempt = await request("POST", `/inventory-v2/audits/${encodeURIComponent(testCountId)}/observe`, { barcodes: [sold.barcode], method: "BARCODE_SCAN" }, `count-sold-${Date.now()}`);
    assert.equal(soldAttempt.status, 409);
    assert.equal(soldAttempt.body.error?.code, "STATE_CONFLICT");
    assert.equal(soldAttempt.body.error?.details?.reasonCode, "ASSET_SOLD");
    assert.equal(soldAttempt.body.error?.details?.currentOperationalStatus, "SOLD");
    const wrongAttempt = await request("POST", `/inventory-v2/audits/${encodeURIComponent(testCountId)}/observe`, { barcodes: [wrongScope.barcode], method: "BARCODE_SCAN" }, `count-scope-${Date.now()}`);
    assert.equal(wrongAttempt.status, 409);
    const expectedScopeCode = String(wrongScope.branchId) !== TEST_BRANCH ? "ASSET_BRANCH_MISMATCH" : "ASSET_LOCATION_MISMATCH";
    assert.equal(wrongAttempt.body.error?.details?.reasonCode, expectedScopeCode);

    const beforeComplete = await one(cloneClient, "SELECT status, count(*) FILTER (WHERE result='MATCHED')::int AS matched, count(*) FILTER (WHERE result IS NULL)::int AS unresolved FROM stock_audit_items WHERE stock_audit_id=$1 GROUP BY status", [testCountId]);
    assert.equal(beforeComplete.unresolved, 0);
    const complete = await request("POST", `/inventory-v2/audits/${encodeURIComponent(testCountId)}/complete`, {}, `count-complete-${Date.now()}`);
    assert.equal(complete.status, 200);
    assert.equal(complete.body.data.status, "completed");
    const close = await request("POST", `/inventory-v2/audits/${encodeURIComponent(testCountId)}/close`, {}, `count-close-${Date.now()}`);
    assert.equal(close.status, 200);
    assert.equal(close.body.data.status, "closed");

    const cloneAfter = await one(cloneClient, `SELECT
      (SELECT count(*)::int FROM stock_audits) AS stock_audits,
      (SELECT count(*)::int FROM stock_audit_items) AS stock_audit_items,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM inventory_asset_movements) AS inventory_asset_movements,
      (SELECT count(*)::int FROM journal_entries) AS journal_entries,
      (SELECT count(*)::int FROM asset_events) AS asset_events`);
    const assetSnapshotAfter = await query(cloneClient, "SELECT id, barcode, operational_status AS status, branch_id, location_id FROM assets ORDER BY id");
    assert.deepEqual(assetSnapshotAfter, assetSnapshotBefore);
    const final = await one(cloneClient, `SELECT a.status, count(*)::int AS items, count(*) FILTER (WHERE sai.result='MATCHED')::int AS matched, count(*) FILTER (WHERE sai.result='MISSING')::int AS missing, count(*) FILTER (WHERE sai.result='EXTRA')::int AS unexpected, count(*) FILTER (WHERE sai.result IS NULL)::int AS unresolved FROM stock_audits a JOIN stock_audit_items sai ON sai.stock_audit_id=a.id WHERE a.id=$1 GROUP BY a.status`, [testCountId]);
    const countIdem = await query(cloneClient, "SELECT scope, status FROM idempotency_requests WHERE scope LIKE 'inventory-count.%' AND key LIKE 'count-%' ORDER BY created_at", []);
    assert.equal(final.status, "closed");
    assert.equal(final.items, candidates.length);
    assert.equal(final.matched, candidates.length);
    assert.equal(final.missing, 0);
    assert.equal(final.unexpected, 0);
    assert.equal(final.unresolved, 0);
    assert.equal(Number(cloneAfter.assets), Number(cloneBefore.assets));
    assert.equal(Number(cloneAfter.inventory_asset_movements), Number(cloneBefore.inventory_asset_movements));
    assert.equal(Number(cloneAfter.journal_entries), Number(cloneBefore.journal_entries));
    assert.equal(Number(cloneAfter.asset_events), Number(cloneBefore.asset_events));
    assert.equal(Number(cloneAfter.stock_audits), Number(cloneBefore.stock_audits) + 1);
    assert.equal(Number(cloneAfter.stock_audit_items), Number(cloneBefore.stock_audit_items) + candidates.length);
    await cloneClient.end();
    cloneClient = null;

    const postSource = new Client(dbConfig(SOURCE_DB));
    await postSource.connect();
    const postIdentity = await one(postSource, "SELECT current_database() AS database");
    assert.equal(postIdentity.database, SOURCE_DB);
    sourceAfter = await one(postSource, `SELECT
      (SELECT count(*)::int FROM stock_audits) AS stock_audits,
      (SELECT count(*)::int FROM stock_audit_items) AS stock_audit_items,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM inventory_asset_movements) AS inventory_asset_movements,
      (SELECT count(*)::int FROM journal_entries) AS journal_entries,
      (SELECT count(*)::int FROM asset_events) AS asset_events`);
    await postSource.end();
    assert.deepEqual(sourceAfter, sourceBefore);

    console.log(JSON.stringify({
      control: "DARFUS-INVENTORY-COUNT-FULL-DISPOSABLE-E2E-01",
      officialDatabase: SOURCE_DB,
      disposableDatabase: CLONE_DB,
      disposableDbProven: true,
      testCountId,
      testCountNumber: auditNumber,
      testBranch: TEST_BRANCH,
      testLocation: TEST_LOCATION,
      eligibleBarcodes,
      ineligibleBarcode: sold.barcode,
      ineligibleReason: soldAttempt.body.error.details.reasonCode,
      wrongScopeBarcode: wrongScope.barcode,
      wrongScopeReason: wrongAttempt.body.error.details.reasonCode,
      create: "PASS",
      start: "PASS",
      duplicateActiveGuard: "PASS",
      secondActiveCountCreated: "NO",
      eligibleScan: "PASS",
      duplicateScanProtection: "PASS",
      ineligibleSoldRejection: "PASS",
      complete: "PASS",
      close: "PASS",
      finalCountStatus: final.status,
      exactCounts: { countDocumentsAdded: Number(cloneAfter.stock_audits) - Number(cloneBefore.stock_audits), itemRowsAdded: Number(cloneAfter.stock_audit_items) - Number(cloneBefore.stock_audit_items), matched: final.matched, missing: final.missing, unexpected: final.unexpected, unresolved: final.unresolved },
      assetBusinessStateDeltaFromCount: 0,
      inventoryMovementDeltaFromCount: Number(cloneAfter.inventory_asset_movements) - Number(cloneBefore.inventory_asset_movements),
      accountingDeltaFromCount: Number(cloneAfter.journal_entries) - Number(cloneBefore.journal_entries),
      assetEventsDeltaFromCount: Number(cloneAfter.asset_events) - Number(cloneBefore.asset_events),
      mutationRequests: mutationRequests.map(({ method, pathname, key, status, requestId }) => ({ method, pathname, key, status, requestId })),
      countIdempotencyRows: countIdem.length,
      mainBusinessWriteDelta: 0,
      mainCountsBefore: sourceBefore,
      mainCountsAfter: sourceAfter,
      cloneLogLines: logs.filter((line) => /listening|database connection|redis connected/i.test(line)).length,
    }, null, 2));
  } finally {
    if (cloneClient) await cloneClient.end().catch(() => {});
    if (server && !server.killed) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        server.once("exit", finish);
        server.kill("SIGTERM");
        setTimeout(() => { if (!settled) { server.kill("SIGKILL"); finish(); } }, 2500);
      });
    }
    if (admin && !keepClone) {
      await admin.query(`DROP DATABASE IF EXISTS ${q(CLONE_DB)} WITH (FORCE)`).catch(() => {});
      const gone = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [CLONE_DB]).catch(() => ({ rowCount: 1 }));
      cloneDropped = gone.rowCount === 0;
      await admin.end().catch(() => {});
    } else if (admin) {
      await admin.end().catch(() => {});
      cloneDropped = false;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`DISPOSABLE_CLONE_DROPPED=${cloneDropped ? "YES" : "NO"}`);
    console.log(`DISPOSABLE_CLONE_RETAINED=${keepClone ? "YES" : "NO"}`);
    if (!cloneDropped && !keepClone) process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
