"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("pg");

const SOURCE_DB = "darfus_erp";
const CLONE_DB = `darfus_erp_count_integrity_${Date.now()}`;
const API_PORT = 8001;
const API_BASE = `http://127.0.0.1:${API_PORT}/api/v1`;
const COMPANY_ID = "COMP-48ab554f-427e-4642-9419-bc8616c2dc36";
const BRANCH_ID = "BRA-1787464306683";
const LOCATION_ID = "LOC-2ca3af2d-e01a-454c-a625-4951d0925927";
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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "darfus-count-integrity-"));
const dumpFile = path.join(tempDir, "official.dump");
const plainFile = path.join(tempDir, "official.sql");

function envForPg() { return { ...process.env, PGPASSWORD: pgPassword }; }
function q(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function run(binary, args) { return childProcess.execFileSync(binary, args, { env: envForPg(), stdio: "pipe" }); }
function dbConfig(database) { return { host: pgHost, port: pgPort, user: pgUser, password: pgPassword, database }; }
async function one(client, sql, values = []) { return (await client.query(sql, values)).rows[0]; }
async function rows(client, sql, values = []) { return (await client.query(sql, values)).rows; }
async function waitFor(url) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`SERVER_NOT_READY:${url}`);
}
function dockerBackendEnv() {
  try {
    const raw = childProcess.execFileSync("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", "darfus-backend"], { encoding: "utf8" });
    return Object.fromEntries(raw.split(/\r?\n/).filter(Boolean).map((line) => { const i = line.indexOf("="); return i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + 1)]; }));
  } catch { return {}; }
}

async function main() {
  if (!LOGIN_PASSWORD) throw new Error("COUNT_E2E_LOGIN_PASSWORD is required and is never printed.");
  let admin;
  let clone;
  let server;
  let sourceBefore;
  let sourceAfter;
  let cloneDropped = false;
  const mutationRequests = [];
  const request = async (method, pathname, body, key, context = {}) => {
    const init = {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${main.token}`,
        "X-Company-ID": context.companyId || COMPANY_ID,
        "X-Branch-ID": context.branchId || BRANCH_ID,
        "Idempotency-Key": key,
      },
    };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const response = await fetch(`${API_BASE}${pathname}`, init);
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    mutationRequests.push({ method, pathname, status: response.status });
    return { status: response.status, body: parsed };
  };
  const counts = async (client) => one(client, `SELECT
    (SELECT count(*)::int FROM stock_audits) AS stock_audits,
    (SELECT count(*)::int FROM stock_audit_items) AS stock_audit_items,
    (SELECT count(*)::int FROM assets) AS assets,
    (SELECT count(*)::int FROM inventory_asset_movements) AS inventory_asset_movements,
    (SELECT count(*)::int FROM journal_entries) AS journal_entries,
    (SELECT count(*)::int FROM asset_events) AS asset_events`);
  const optionalCounts = async (client) => {
    const result = {};
    for (const table of ["journal_lines", "cash_transactions", "supplier_payables", "supplier_payments", "treasury_transactions", "liabilities"]) {
      const exists = await one(client, "SELECT to_regclass($1) AS table_name", [table]);
      result[table] = exists.table_name ? Number((await one(client, `SELECT count(*)::int AS count FROM ${q(table)}`)).count) : null;
    }
    return result;
  };

  try {
    const source = new Client(dbConfig(SOURCE_DB));
    await source.connect();
    assert.equal((await one(source, "SELECT current_database() AS database")).database, SOURCE_DB);
    sourceBefore = await counts(source);
    await source.end();

    run(pgDump, ["--format=custom", "--no-owner", "--no-privileges", "--host", pgHost, "--port", String(pgPort), "--username", pgUser, "--file", dumpFile, SOURCE_DB]);
    assert.ok(fs.statSync(dumpFile).size > 0);
    admin = new Client(dbConfig("postgres"));
    await admin.connect();
    assert.equal((await one(admin, "SELECT current_database() AS database")).database, "postgres");
    assert.equal(await one(admin, "SELECT 1 FROM pg_database WHERE datname=$1", [CLONE_DB]), undefined);
    await admin.query(`CREATE DATABASE ${q(CLONE_DB)}`);
    run(pgRestore, ["--no-owner", "--no-privileges", "--file", plainFile, dumpFile]);
    fs.writeFileSync(plainFile, fs.readFileSync(plainFile, "utf8").replaceAll("SET transaction_timeout = 0;", ""), "utf8");
    run(psql, ["--host", pgHost, "--port", String(pgPort), "--username", pgUser, "--dbname", CLONE_DB, "--set", "ON_ERROR_STOP=1", "--file", plainFile]);

    clone = new Client(dbConfig(CLONE_DB));
    await clone.connect();
    assert.equal((await one(clone, "SELECT current_database() AS database")).database, CLONE_DB);
    const cloneBefore = await counts(clone);
    const optionalBefore = await optionalCounts(clone);
    const assetBefore = await rows(clone, "SELECT id, barcode, operational_status AS status, branch_id, location_id FROM assets ORDER BY id");
    const candidates = await rows(clone, `SELECT id, barcode FROM assets WHERE company_id=$1 AND branch_id=$2 AND location_id=$3 AND upper(operational_status) NOT IN ('SOLD','MELTED','MISSING') ORDER BY id`, [COMPANY_ID, BRANCH_ID, LOCATION_ID]);
    assert.ok(candidates.length >= 3);
    const wrongScope = await one(clone, "SELECT barcode, branch_id AS \"branchId\", location_id AS \"locationId\" FROM assets WHERE company_id=$1 AND upper(operational_status) NOT IN ('SOLD','MELTED','MISSING') AND (branch_id<>$2 OR location_id<>$3) ORDER BY id LIMIT 1", [COMPANY_ID, BRANCH_ID, LOCATION_ID]);
    assert.ok(wrongScope);

    const dockerEnv = dockerBackendEnv();
    server = childProcess.spawn(process.execPath, ["src/server.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, ...dockerEnv, NODE_ENV: "development", PORT: String(API_PORT), DB_HOST: pgHost, DB_PORT: String(pgPort), DB_NAME: CLONE_DB, DB_USER: pgUser, DB_PASS: pgPassword, DB_PASSWORD: pgPassword, DATABASE_URL: "", REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379", CORS_ALLOWED_ORIGINS: "http://localhost:3001", FRONTEND_URL: "http://localhost:3001", ALLOW_RUNTIME_ADMIN_BOOTSTRAP: "false", UPLOAD_DIR: path.join(tempDir, "uploads") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", () => {});
    server.stderr.on("data", () => {});
    await waitFor(`${API_BASE}/health`);
    const login = await fetch(`${API_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }) });
    const loginBody = await login.json();
    assert.equal(login.status, 200);
    main.token = loginBody.data.token;

    const id = Date.now();
    const auditNumber = `COUNT-INTEGRITY-${id}`;
    const createKey = `integrity-create-${id}`;
    const createBody = { auditNumber, auditMethod: "BARCODE_SCAN", locationId: LOCATION_ID, notes: "Disposable integrity proof" };
    const created = await request("POST", "/inventory-v2/audits", createBody, createKey);
    assert.equal(created.status, 201);
    const auditId = created.body.data.id;
    const createReplay = await request("POST", "/inventory-v2/audits", createBody, createKey);
    assert.equal(createReplay.status, 201);
    const createConflict = await request("POST", "/inventory-v2/audits", { ...createBody, notes: "changed" }, createKey);
    assert.equal(createConflict.status, 409);

    const startKey = `integrity-start-${id}`;
    const start = await request("POST", `/inventory-v2/audits/${auditId}/start`, {}, startKey);
    const startReplay = await request("POST", `/inventory-v2/audits/${auditId}/start`, {}, startKey);
    assert.equal(start.status, 200);
    assert.equal(startReplay.status, 200);
    assert.equal(Number(start.body.data.expectedCount), candidates.length);
    assert.equal(Number((await one(clone, "SELECT count(*)::int AS count FROM stock_audit_items WHERE stock_audit_id=$1", [auditId])).count), candidates.length);

    const observeKey = `integrity-observe-${id}`;
    const observeBody = { barcodes: [candidates[0].barcode], method: "BARCODE_SCAN" };
    const observed = await request("POST", `/inventory-v2/audits/${auditId}/observe`, observeBody, observeKey);
    const observeReplay = await request("POST", `/inventory-v2/audits/${auditId}/observe`, observeBody, observeKey);
    const observeConflict = await request("POST", `/inventory-v2/audits/${auditId}/observe`, { barcodes: [candidates[1].barcode], method: "BARCODE_SCAN" }, observeKey);
    assert.equal(observed.status, 200);
    assert.equal(observeReplay.status, 200);
    assert.equal(observeConflict.status, 409);

    const wrongScopeAttempt = await request("POST", `/inventory-v2/audits/${auditId}/observe`, { barcodes: [wrongScope.barcode], method: "BARCODE_SCAN" }, `integrity-scope-${id}`);
    assert.equal(wrongScopeAttempt.status, 409);
    const crossCompanyAttempt = await request("GET", `/inventory-v2/audits/${auditId}`, undefined, `integrity-company-${id}`, { companyId: "COMPANY-NOT-AUTHORIZED" });
    assert.ok([401, 403, 404].includes(crossCompanyAttempt.status));

    const beforeComplete = await one(clone, "SELECT count(*) FILTER (WHERE result='MATCHED')::int AS matched, count(*) FILTER (WHERE result IS NULL)::int AS unresolved, count(*) FILTER (WHERE scan_method='BARCODE_SCAN')::int AS scan_rows FROM stock_audit_items WHERE stock_audit_id=$1", [auditId]);
    assert.deepEqual(beforeComplete, { matched: 1, unresolved: candidates.length - 1, scan_rows: 1 });
    const completeKey = `integrity-complete-${id}`;
    const complete = await request("POST", `/inventory-v2/audits/${auditId}/complete`, {}, completeKey);
    const completeReplay = await request("POST", `/inventory-v2/audits/${auditId}/complete`, {}, completeKey);
    assert.equal(complete.status, 200);
    assert.equal(completeReplay.status, 200);
    const final = await one(clone, "SELECT count(*)::int AS expected, count(*) FILTER (WHERE result='MATCHED')::int AS matched, count(*) FILTER (WHERE result='MISSING')::int AS missing, count(*) FILTER (WHERE result='EXTRA')::int AS unexpected, count(*) FILTER (WHERE result IS NULL)::int AS unresolved, count(*) FILTER (WHERE result='MISSING' AND scan_method IS NULL)::int AS missing_without_scan FROM stock_audit_items WHERE stock_audit_id=$1", [auditId]);
    assert.deepEqual(final, { expected: candidates.length, matched: 1, missing: candidates.length - 1, unexpected: 0, unresolved: 0, missing_without_scan: candidates.length - 1 });
    const closeKey = `integrity-close-${id}`;
    const close = await request("POST", `/inventory-v2/audits/${auditId}/close`, {}, closeKey);
    const closeReplay = await request("POST", `/inventory-v2/audits/${auditId}/close`, {}, closeKey);
    assert.equal(close.status, 200);
    assert.equal(closeReplay.status, 200);

    const createA = request("POST", "/inventory-v2/audits", { auditNumber: `COUNT-CONC-A-${id}`, auditMethod: "BARCODE_SCAN", locationId: LOCATION_ID }, `integrity-conc-a-${id}`);
    const createB = request("POST", "/inventory-v2/audits", { auditNumber: `COUNT-CONC-B-${id}`, auditMethod: "BARCODE_SCAN", locationId: LOCATION_ID }, `integrity-conc-b-${id}`);
    const concurrent = await Promise.all([createA, createB]);
    assert.equal(concurrent.filter((result) => result.status === 201).length, 1);
    assert.equal(concurrent.filter((result) => result.status === 409).length, 1);
    assert.equal(Number((await one(clone, "SELECT count(*)::int AS count FROM stock_audits WHERE company_id=$1 AND branch_id=$2 AND location_id=$3 AND status IN ('draft','in-progress')", [COMPANY_ID, BRANCH_ID, LOCATION_ID])).count), 1);

    const cloneAfter = await counts(clone);
    const optionalAfter = await optionalCounts(clone);
    const assetAfter = await rows(clone, "SELECT id, barcode, operational_status AS status, branch_id, location_id FROM assets ORDER BY id");
    assert.deepEqual(assetAfter, assetBefore);
    assert.equal(Number(cloneAfter.stock_audits), Number(cloneBefore.stock_audits) + 2);
    assert.equal(Number(cloneAfter.stock_audit_items), Number(cloneBefore.stock_audit_items) + candidates.length);
    assert.equal(Number(cloneAfter.assets), Number(cloneBefore.assets));
    assert.equal(Number(cloneAfter.inventory_asset_movements), Number(cloneBefore.inventory_asset_movements));
    assert.equal(Number(cloneAfter.journal_entries), Number(cloneBefore.journal_entries));
    assert.equal(Number(cloneAfter.asset_events), Number(cloneBefore.asset_events));
    assert.deepEqual(optionalAfter, optionalBefore);
    await clone.end();
    clone = null;

    const postSource = new Client(dbConfig(SOURCE_DB));
    await postSource.connect();
    assert.equal((await one(postSource, "SELECT current_database() AS database")).database, SOURCE_DB);
    sourceAfter = await counts(postSource);
    await postSource.end();
    assert.deepEqual(sourceAfter, sourceBefore);

    console.log(JSON.stringify({
      control: "DARFUS-INVENTORY-COUNT-INTEGRITY-FINAL-PROOF-01",
      officialDatabase: SOURCE_DB,
      disposableDatabase: CLONE_DB,
      disposableRuntimeIdentity: "PASS",
      expected: candidates.length,
      observed: 1,
      matched: final.matched,
      missing: final.missing,
      unexpected: final.unexpected,
      variance: Number(final.missing) + Number(final.unexpected),
      missingRowsWithoutScanMethod: final.missing_without_scan,
      frozenExpectedSet: "PASS",
      createExactlyOnce: "PASS",
      startExactlyOnce: "PASS",
      observeExactlyOnce: "PASS",
      completeExactlyOnce: "PASS",
      closeExactlyOnce: "PASS",
      idempotencyConflict: "PASS",
      activeCountConcurrencyGuard: "PASS",
      companyScope: "PASS",
      branchScope: "PASS",
      locationScope: "PASS",
      summaryMath: "PASS",
      countEvidenceDelta: { stockAudits: Number(cloneAfter.stock_audits) - Number(cloneBefore.stock_audits), stockAuditItems: Number(cloneAfter.stock_audit_items) - Number(cloneBefore.stock_audit_items) },
      assetDelta: 0,
      movementDelta: Number(cloneAfter.inventory_asset_movements) - Number(cloneBefore.inventory_asset_movements),
      accountingDelta: Number(cloneAfter.journal_entries) - Number(cloneBefore.journal_entries),
      optionalAccountingCountsUnchanged: true,
      mainBusinessWriteDelta: 0,
      mutationRequestCount: mutationRequests.length,
      mutationStatuses: mutationRequests.map(({ method, pathname, status }) => ({ method, pathname, status })),
    }, null, 2));
  } finally {
    if (clone) await clone.end().catch(() => {});
    if (server && !server.killed) {
      await new Promise((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        server.once("exit", done);
        server.kill("SIGTERM");
        setTimeout(() => { server.kill("SIGKILL"); done(); }, 2500);
      });
    }
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${q(CLONE_DB)} WITH (FORCE)`).catch(() => {});
      const gone = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [CLONE_DB]).catch(() => ({ rowCount: 1 }));
      cloneDropped = gone.rowCount === 0;
      await admin.end().catch(() => {});
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`DISPOSABLE_CLONE_DROPPED=${cloneDropped ? "YES" : "NO"}`);
    if (!cloneDropped) process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
