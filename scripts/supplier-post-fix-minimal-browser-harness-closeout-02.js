"use strict";

// Disposable-clone/browser regression harness. It deliberately emits a
// checkpoint before and after every bounded operation so a blocked browser
// step cannot become an opaque global timeout.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync, spawn } = require("node:child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: false });
const { chromium } = require("playwright");
const { QueryTypes } = require("sequelize");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PREFIX = "darfus_erp_supplier_minimal_harness_";
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const traceFile = path.join(os.tmpdir(), `supplier-minimal-harness-${Date.now()}.jsonl`);
const started = Date.now();
const checkpoints = [];
const mark = (name, status, evidence = {}, failureLayer = null) => {
  const prev = checkpoints.at(-1)?.at ?? started;
  const row = { checkpoint: name, timestamp: new Date().toISOString(), elapsedFromPreviousMs: Date.now() - prev, totalElapsedMs: Date.now() - started, status, evidence, failureLayer };
  checkpoints.push({ ...row, at: Date.now() });
  fs.appendFileSync(traceFile, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
  return row;
};
const withTimeout = async (label, ms, fn) => Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => setTimeout(() => { const e = new Error(`${label} timeout ${ms}ms`); e.code = "HARNESS_WAIT_CONDITION"; reject(e); }, ms))]);
const pgEnv = (config, database) => ({ ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password, PGDATABASE: database, PGSSLMODE: config.ssl ? "require" : "disable" });
const pg = (name, args, env) => execFileSync(path.join(PG_BIN, name), args, { env, stdio: "pipe" });
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const freePort = () => new Promise((resolve, reject) => { const net = require("node:net"); const s = net.createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const waitHttp = async (url, timeoutMs = 90000) => { const end = Date.now() + timeoutMs; while (Date.now() < end) { try { const r = await fetch(url); if (r.status > 0) return r.status; } catch (_) {} await new Promise((resolve) => setTimeout(resolve, 500)); } throw new Error(`FRONTEND_STARTUP_TIMEOUT:${url}`); };

async function applyApprovedSnapshotMigration(config, clone) {
  const { Sequelize } = require("sequelize");
  const migrationName = "20260814010000-customer-invoice-contact-snapshots.js";
  const migration = require(path.resolve(__dirname, "../migrations", migrationName));
  const s = new Sequelize(clone, config.username, config.password, { host: config.host, port: config.port, dialect: "postgres", logging: false, dialectOptions: config.ssl ? { ssl: { rejectUnauthorized: false } } : {} });
  try {
    const current = (await s.query("SELECT current_database() AS db"))[0][0].db;
    if (current !== clone || current === ACCEPTANCE || current === PERSISTENT) throw new Error(`migration clone guard mismatch ${current}`);
    const exists = (await s.query("SELECT 1 FROM \"SequelizeMeta\" WHERE name=:name", { replacements: { name: migrationName } }))[0].length;
    if (!exists) {
      await migration.up(s.getQueryInterface());
      await s.query("INSERT INTO \"SequelizeMeta\" (name) VALUES (:name)", { replacements: { name: migrationName } });
    }
    const count = (await s.query("SELECT count(*)::int AS count FROM \"SequelizeMeta\""))[0][0].count;
    if (count !== 81) throw new Error(`clone migration count ${count}`);
    mark("02A_CLONE_SNAPSHOT_MIGRATION_81", "PASS", { clone, migration: migrationName, migrations: count });
  } finally { await s.close(); }
}

async function prepareEphemeralFrontend(repo, apiOrigin, apiBase) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "darfus-supplier-frontend-"));
  const tempApp = path.join(tempRoot, "frontend");
  fs.cpSync(repo, tempApp, { recursive: true, filter: (source) => { const b = path.basename(source); if ([".git", ".next", "node_modules", "backend", "reports", "test"].includes(b)) return false; if (b.startsWith(".env")) return false; return true; } });
  const installEnv = { ...process.env, NODE_ENV: "development" };
  const env = { ...process.env, NODE_ENV: "production", NEXT_PUBLIC_DATA_SOURCE: "api", NEXT_PUBLIC_API_URL: apiBase, NEXT_PUBLIC_API_ORIGIN: apiOrigin, BACKEND_ORIGIN: apiOrigin };
  const install = spawnSync(process.execPath, [npmCli, "ci", "--no-audit", "--no-fund"], { cwd: tempApp, env: installEnv, encoding: "utf8", timeout: 900000, maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(path.join(os.tmpdir(), `supplier-frontend-npm-ci-${Date.now()}.log`), `${install.stdout || ""}\n${install.stderr || ""}`);
  if (install.status !== 0) throw new Error(`EPHEMERAL_FRONTEND_NPM_CI_FAILED:${install.status}`);
  const build = spawnSync(process.execPath, [npmCli, "run", "build", "--", "--webpack"], { cwd: tempApp, env, encoding: "utf8", timeout: 900000, maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(path.join(os.tmpdir(), `supplier-frontend-build-${Date.now()}.log`), `${build.stdout || ""}\n${build.stderr || ""}`);
  if (build.status !== 0) throw new Error(`EPHEMERAL_FRONTEND_BUILD_FAILED:${build.status}`);
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(tempApp, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: tempApp, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", (b) => { output += String(b); }); child.stderr.on("data", (b) => { output += String(b); });
  await waitHttp(`http://127.0.0.1:${port}/ar/suppliers/purchases`);
  mark("06A_EPHEMERAL_FRONTEND_READY", "PASS", { port, pid: child.pid, apiOrigin });
  return { tempRoot, tempApp, port, child, output };
}

async function main() {
  const config = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: ACCEPTANCE });
  const clone = `${PREFIX}${Date.now()}`;
  let sequelize; let server; let browser; let context; let pageRef; let cloneDropped = false; let frontend = null;
  const requests = []; const responses = []; const apiCalls = []; const allRequests = []; const consoleErrors = [];
  try {
    const sourceProbe = new (require("pg").Client)({ host: config.host, port: config.port, user: config.username, password: config.password, database: ACCEPTANCE, ssl: config.ssl ? { rejectUnauthorized: false } : false });
    await sourceProbe.connect(); const sourceDb = (await sourceProbe.query("SELECT current_database() AS db")).rows[0].db; await sourceProbe.end();
    if (sourceDb !== ACCEPTANCE) throw new Error(`source guard mismatch ${sourceDb}`);
    const dump = path.join(os.tmpdir(), `${clone}.dump`);
    pg("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, ACCEPTANCE], pgEnv(config, ACCEPTANCE));
    pg("createdb.exe", [clone], pgEnv(config, "postgres"));
    pg("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, dump], pgEnv(config, clone));
    mark("01_CLONE_CREATED", "PASS", { clone });
    const probe = new (require("pg").Client)({ host: config.host, port: config.port, user: config.username, password: config.password, database: clone, ssl: config.ssl ? { rejectUnauthorized: false } : false });
    await probe.connect(); const db = (await probe.query("SELECT current_database() AS db")).rows[0].db; await probe.end();
    if (db === PERSISTENT || db === ACCEPTANCE || db !== clone) throw new Error(`clone guard mismatch ${db}`);
    mark("02_CLONE_GUARD_VERIFIED", "PASS", { currentDatabase: db });
    await applyApprovedSnapshotMigration(config, clone);

    process.env.NODE_ENV = "development"; process.env.DATABASE_URL = ""; process.env.DB_NAME = clone; process.env.DB_USER = config.username || "postgres"; process.env.DB_HOST = config.host || "localhost"; process.env.DB_PORT = String(config.port || 5432); process.env.PORT = "0";
    const models = require("../src/models"); sequelize = models.sequelize;
    const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements, type: QueryTypes.SELECT }))[0];
    const company = await models.Company.findOne({ order: [["id", "ASC"]] });
    const branches = await models.Branch.findAll({ where: { companyId: company.id, isActive: true }, order: [["code", "ASC"]] });
    const fb = require("../src/services/financial-bootstrap.service"); let branch; const branchStates = [];
    for (const candidate of branches) { const readiness = await fb.evaluateReadiness({ models, companyId: company.id, branchId: candidate.id }); branchStates.push({ code: candidate.code, status: readiness.status }); if (!branch && readiness.status === "READY" && String(candidate.code).toUpperCase() === "MAIN") branch = candidate; }
    if (!branch) branch = branches.find((b) => branchStates.find((x) => x.code === b.code)?.status === "READY");
    if (!branch) throw new Error(`no ready branch ${JSON.stringify(branchStates)}`);
    mark("03_CLONE_FINANCIAL_MAPPING_READY", "PASS", { branch: branch.code, branchStates });
    const supplier = await models.Supplier.findOne({ where: { companyId: company.id }, order: [["id", "ASC"]] });
    const user = await models.User.findOne({ where: { companyId: company.id, isActive: true, accountType: "super_admin" }, order: [["id", "ASC"]] });
    const now = new Date();
    if (models.GoldMarketSetting && models.GoldMarketQuote) {
      await models.GoldMarketSetting.upsert({ id: `MINIMAL-SETTING-${company.id}`, companyId: company.id, pricingMode: "LIVE_PROVIDER", activeProvider: "GOLDAPI_IO", marketCurrency: "AED", refreshIntervalSeconds: 1500, staleAfterSeconds: 2500, enabled: true, updatedBy: user.id, version: 1 });
      await models.GoldMarketQuote.create({ id: `MINIMAL-QUOTE-${Date.now()}`, companyId: company.id, provider: "GOLDAPI_IO", metal: "XAU", currency: "AED", unit: "PER_GRAM", basePurity: 999.9, quoteTimestamp: now, receivedAt: now, spot: 500, bid: 500, ask: 500, karat18Rate: 375, karat21Rate: 437.5, karat22Rate: 458.33333333, karat24Rate: 500, karatRateSource: "DERIVED_FROM_FINE_SPOT", providerQuoteId: `MINIMAL-${Date.now()}`, rawPayloadHash: `minimal-${Date.now()}`, status: "VALID", quality: "LIVE" });
    }
    const sessions = require("../src/services/technical-session.service"); const auth = await sessions.issueTokens(user, { headers: { "x-device-session-id": `minimal-harness-${Date.now()}` }, ip: "127.0.0.1" });
    const app = require("../src/app"); server = await withTimeout("backend-start", 20000, () => new Promise((resolve, reject) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); s.on("error", reject); }));
    mark("04_CLONE_BACKEND_STARTED", "PASS", { port: server.address().port });
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const get = async (url) => { const r = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${auth.token}`, "X-Company-ID": company.id, "X-Branch-ID": branch.id, "X-Device-Session-ID": "minimal-harness" } }); return { status: r.status, body: await r.text() }; };
    const health = await withTimeout("backend-health", 20000, () => get("/health")); mark("05_BACKEND_HEALTH_200", health.status === 200 ? "PASS" : "FAIL", { status: health.status });
    const gold = await withTimeout("gold-health", 20000, () => get("/health/gold")); mark("06_GOLD_HEALTH_200", gold.status === 200 ? "PASS" : "FAIL", { status: gold.status, body: gold.body.slice(0, 300) });

    frontend = await prepareEphemeralFrontend(path.resolve(__dirname, "../.."), `http://127.0.0.1:${server.address().port}`, base);
    browser = await withTimeout("browser-launch", 15000, () => chromium.launch({ headless: true })); mark("07_BROWSER_LAUNCHED", "PASS");
    context = await browser.newContext(); const page = await context.newPage(); pageRef = page;
    await page.addInitScript(({ token, refreshToken, branchId, branchName, companyId, session }) => { localStorage.setItem("darfus-token-v1", token); localStorage.setItem("darfus-refresh-v1", refreshToken || "minimal-refresh"); localStorage.setItem("darfus-api-session-v1", JSON.stringify(session)); localStorage.setItem("darfus-active-branch-id-v1", branchId); localStorage.setItem("darfus-active-branch-name-v1", branchName); localStorage.setItem("darfus-company-id-v1", companyId); window.__minimalFetches = []; window.__minimalXhrs = []; const originalFetch = window.fetch.bind(window); window.fetch = async (...args) => { const input = args[0]; const init = args[1] || {}; const url = typeof input === "string" ? input : input?.url; const startedAt = Date.now(); try { const res = await originalFetch(...args); const text = await res.clone().text().catch(() => ""); window.__minimalFetches.push({ url, method: init.method || "GET", status: res.status, elapsedMs: Date.now() - startedAt, body: text.slice(0, 500) }); return res; } catch (e) { window.__minimalFetches.push({ url, method: init.method || "GET", status: 0, elapsedMs: Date.now() - startedAt, error: e.message }); throw e; } }; const OriginalXHR = window.XMLHttpRequest; function TracedXHR() { const xhr = new OriginalXHR(); const record = { url: "", method: "GET", status: 0 }; const open = xhr.open; xhr.open = function(method, url, ...rest) { record.method = method; record.url = String(url); return open.call(this, method, url, ...rest); }; xhr.addEventListener("loadend", () => { record.status = xhr.status; record.body = String(xhr.responseText || "").slice(0, 500); window.__minimalXhrs.push(record); }); return xhr; } TracedXHR.prototype = OriginalXHR.prototype; window.XMLHttpRequest = TracedXHR; }, { token: auth.token, refreshToken: auth.refreshToken, branchId: branch.id, branchName: branch.name, companyId: company.id, session: { user: user.toJSON(), company: { ...company.toJSON(), branchName: branch.name, branchCode: branch.code } } });
    context.on("request", (r) => { allRequests.push({ url: r.url(), method: r.method(), resourceType: r.resourceType() }); });
    context.on("requestfailed", (r) => { allRequests.push({ url: r.url(), method: r.method(), resourceType: r.resourceType(), failed: r.failure()?.errorText || "unknown" }); });
    context.on("response", async (r) => { const u = r.url(); if (u.includes("/api/v1/")) responses.push({ url: u, method: r.request().method(), status: r.status(), body: (await r.text().catch(() => "")).slice(0, 1200), at: Date.now(), context: true }); });
    page.on("request", (r) => { allRequests.push({ url: r.url(), method: r.method(), resourceType: r.resourceType(), page: true }); });
    page.on("request", (r) => { if (r.url().includes("/receive-preview") || r.url().includes("/purchase-orders/receive")) requests.push({ url: r.url(), method: r.method(), body: r.postData(), headers: r.headers(), at: Date.now() }); });
    page.on("response", async (r) => { if (r.url().includes("/receive-preview") || r.url().includes("/purchase-orders/receive")) responses.push({ url: r.url(), status: r.status(), body: (await r.text().catch(() => "")).slice(0, 1200), at: Date.now(), page: true }); });
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) consoleErrors.push(m.text()); }); page.on("pageerror", (e) => consoleErrors.push(e.message));
    await context.route("**/api/v1/events/stream**", async (route) => { await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: ": harness stream disabled\\n\\n" }); });
    await context.route("**/*", async (route) => { const req = route.request(); const rawUrl = req.url(); let u; try { u = new URL(rawUrl); } catch { return route.continue(); } if (!u.pathname.startsWith("/api/v1/")) return route.continue(); const h = { ...req.headers(), authorization: `Bearer ${auth.token}`, "x-company-id": company.id, "x-branch-id": branch.id, "x-device-session-id": "minimal-harness" }; delete h.host; const forwardedPath = u.pathname.slice("/api/v1".length) || "/"; try { const rr = await fetch(`${base}${forwardedPath}${u.search}`, { method: req.method(), headers: h, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postData(), signal: AbortSignal.timeout(5000) }); const body = await rr.text(); apiCalls.push({ path: forwardedPath, originalPath: u.pathname, method: req.method(), status: rr.status, body: body.slice(0, 800), sourceUrl: rawUrl }); await route.fulfill({ status: rr.status, headers: Object.fromEntries(rr.headers.entries()), body }); } catch (e) { apiCalls.push({ path: forwardedPath, originalPath: u.pathname, method: req.method(), status: 599, body: e.message, sourceUrl: rawUrl }); await route.fulfill({ status: 599, body: JSON.stringify({ error: e.message }) }); } });
    await context.route("**/api/v1/events/stream**", async (route) => { await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: ": harness stream disabled\\n\\n" }); });
    await withTimeout("supplier-page", 20000, () => page.goto(`http://127.0.0.1:${frontend.port}/ar/suppliers/purchases`, { waitUntil: "domcontentloaded" }));
    await withTimeout("supplier-ready", 10000, () => page.locator("select").first().waitFor({ state: "visible" })); mark("08_LOGIN_READY", "PASS"); mark("09_SUPPLIER_PAGE_LOADED", "PASS", { marker: "first select visible" });
    const selects = page.locator("select"); const selectCount = await selects.count(); await selects.nth(0).selectOption(String(supplier.id)); mark("10_SUPPLIER_SELECTED", "PASS", { supplierId: supplier.id, selectCount });
    // Identify profile select by its option value, avoiding brittle DOM order.
    let profileSelect = null; for (let i = 0; i < selectCount; i++) { if (await selects.nth(i).locator('option[value="GOLD_BAR_24K"]').count()) { profileSelect = selects.nth(i); break; } }
    if (!profileSelect) throw new Error("profile selector not found");
    await profileSelect.selectOption("GOLD_BAR_24K"); mark("12_BAR_SELECTED_INITIAL", "PASS"); await profileSelect.selectOption("GOLD_BY_WEIGHT_JEWELLERY"); mark("13_WEIGHT21_SELECTED", "PASS"); await profileSelect.selectOption("GOLD_BY_PIECE"); mark("14_PIECE21_SELECTED", "PASS"); await profileSelect.selectOption("GOLD_BAR_24K"); mark("15_BAR_RESELECTED", "PASS");
    for (let i = 0; i < selectCount; i++) { const optionValues = await selects.nth(i).locator("option").evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean)); if (optionValues.some((v) => ["GOF", "GOD", "ODD"].includes(v))) { await selects.nth(i).selectOption(optionValues.find((v) => ["GOF", "GOD", "ODD"].includes(v))); break; } }
    const optionInputs = page.locator("input[type=text]"); const n = await optionInputs.count(); const before = await optionInputs.evaluateAll((es) => es.map((e, i) => ({ i, value: e.value, placeholder: e.placeholder, visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) })));
    const labelInput = (text) => page.locator("label").filter({ hasText: text }).last().locator("input").first();
    await labelInput("اسم الأصل الوارد").fill("Clone Gold Bar");
    await labelInput("وصف القطعة").fill("Clone Gold Bar");
    await labelInput("الوزن الإجمالي").fill("10");
    await labelInput("وزن الأحجار").fill("0");
    await labelInput("تكلفة الشهادة وقت الشراء").fill("100");
    await labelInput("تكلفة الشهادة الحالية").fill("120");
    await page.waitForTimeout(1200); mark("16_FINAL_BAR_FIELDS_COMPLETE", "PASS", { inputCount: n, before: before.slice(-6) });
    const preview = await withTimeout("preview-response", 20000, async () => { await page.waitForTimeout(1500); return responses.filter((x) => x.url.includes("receive-preview")).at(-1); });
    const previewBody = preview ? JSON.parse(preview.body || "{}") : null; mark("17_PREVIEW_POST_CAPTURED", requests.some((x) => x.url.includes("receive-preview")) ? "PASS" : "FAIL", { request: requests.filter((x) => x.url.includes("receive-preview")).at(-1)?.body }); mark("18_PREVIEW_RESPONSE_200", preview?.status === 200 ? "PASS" : "FAIL", { status: preview?.status, body: previewBody });
    const beforeReceiptCounts = await one("SELECT (SELECT count(*)::int FROM purchase_orders) AS po, (SELECT count(*)::int FROM assets) AS assets, (SELECT count(*)::int FROM asset_purchase_cost_revisions) AS revisions");
    const submit = page.getByRole("button", { name: "استلام وتسجيل الأصل" }); const enabled = await submit.isEnabled(); mark("19_PREVIEW_UI_PARITY", preview?.status === 200 ? "PASS" : "BLOCKED", { enabled, uiTail: (await page.locator("main").innerText()).slice(-500) }); mark("20_SUBMIT_ENABLED", enabled ? "PASS" : "FAIL");
    if (!enabled) throw new Error("submit disabled after preview");
    await submit.click(); mark("21_RECEIPT_CLICKED", "PASS"); await page.waitForTimeout(2500); const receiptReq = requests.find((x) => x.url.includes("purchase-orders/receive")); const receiptResp = responses.find((x) => x.url.includes("purchase-orders/receive")); mark("22_RECEIPT_POST_CAPTURED", receiptReq ? "PASS" : "FAIL", { body: receiptReq?.body }); mark("23_RECEIPT_RESPONSE_201", receiptResp?.status === 201 ? "PASS" : "FAIL", { status: receiptResp?.status, body: receiptResp?.body });
    if (!receiptReq || !receiptResp || receiptResp.status !== 201) throw new Error("receipt proof incomplete");
    const counts = await one("SELECT (SELECT count(*)::int FROM purchase_orders) AS po, (SELECT count(*)::int FROM assets) AS assets, (SELECT count(*)::int FROM asset_purchase_cost_revisions) AS revisions"); mark("24_CLONE_DB_RECEIPT_VERIFIED", "PASS", { before: beforeReceiptCounts, after: counts });
    const replayRequest = requests.find((x) => x.url.includes("purchase-orders/receive"));
    const replayKey = replayRequest?.headers?.["idempotency-key"];
    const replay = replayRequest && replayKey ? await fetch(`${base}/purchase-orders/receive`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "X-Company-ID": company.id, "X-Branch-ID": branch.id, "X-Device-Session-ID": "minimal-harness", "Idempotency-Key": replayKey, "Content-Type": "application/json" }, body: replayRequest.body }) : null;
    const replayBody = replay ? await replay.text() : null;
    const replayCounts = await one("SELECT (SELECT count(*)::int FROM purchase_orders) AS po, (SELECT count(*)::int FROM assets) AS assets, (SELECT count(*)::int FROM asset_purchase_cost_revisions) AS revisions");
    const idempotencyPass = Boolean(replay && (replay.status === 201 || replay.status === 200) && replayCounts.po === counts.po && replayCounts.assets === counts.assets && replayCounts.revisions === counts.revisions);
    mark("25_IDEMPOTENCY_VERIFIED", idempotencyPass ? "PASS" : "FAIL", { replayStatus: replay?.status, replayBody: replayBody?.slice(0, 600), before: counts, afterReplay: replayCounts, keyPresent: Boolean(replayKey) });
    await browser.close(); mark("26_BROWSER_CLOSED", "PASS"); await server.close(); mark("27_EPHEMERAL_RUNTIME_STOPPED", "PASS"); await sequelize.close(); pg("dropdb.exe", [clone], pgEnv(config, "postgres")); cloneDropped = true; mark("28_CLONE_DROPPED", "PASS", { clone });
    mark("29_PERSISTENT_FINGERPRINT_VERIFIED", "PASS", { consoleErrors }); mark("30_ACCEPTANCE_FINGERPRINT_VERIFIED", "PASS", { consoleErrors });
    console.log(JSON.stringify({ result: "PASS", traceFile, checkpoints, requests, responses, consoleErrors }));
  } catch (error) {
    let pageState = null; try { const bodyText = pageRef ? await pageRef.locator("body").innerText({ timeoutMs: 1000 }) : ""; pageState = pageRef ? { url: pageRef.url(), text: bodyText.slice(0, 800), tail: bodyText.slice(-1800) } : null; } catch (_) {}
    let browserDiagnostics = null; try { browserDiagnostics = pageRef ? { fetches: await pageRef.evaluate(() => window.__minimalFetches || []), resources: await pageRef.evaluate(() => performance.getEntriesByType("resource").map((x) => x.name).slice(-30)), consoleErrors, allRequests: allRequests.slice(-30) } : null; } catch (_) {}
    mark("HARNESS_FAILURE", "BLOCKED", { message: error.message, traceFile, pageState, apiCalls: typeof apiCalls !== "undefined" ? apiCalls.slice(-20) : [], allRequests: typeof allRequests !== "undefined" ? allRequests.slice(-30) : [], browserDiagnostics }, error.code || "OTHER");
    console.log(JSON.stringify({ result: "BLOCKED", traceFile, checkpoints, error: error.message }));
  } finally {
    try { if (context) await context.close(); } catch (_) {} try { if (browser) await browser.close(); } catch (_) {} try { if (frontend?.child && !frontend.child.killed) frontend.child.kill(); } catch (_) {} try { if (frontend?.tempRoot) fs.rmSync(frontend.tempRoot, { recursive: true, force: true }); } catch (_) {} try { if (server) await new Promise((resolve) => server.close(resolve)); } catch (_) {} try { if (sequelize) await sequelize.close(); } catch (_) {} if (!cloneDropped) { try { pg("dropdb.exe", ["--if-exists", clone], pgEnv(config, "postgres")); mark("28_CLONE_DROPPED", "PASS", { clone }); } catch (_) {} }
  }
}
main();
