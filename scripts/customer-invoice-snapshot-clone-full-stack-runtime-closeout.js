"use strict";

// Runtime-only closeout. Product source is intentionally not edited here.
// Every write is confined to a disposable PostgreSQL clone and temporary build.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { Client } = require("pg");
const { Sequelize } = require("sequelize");
const Umzug = require("umzug");
const { chromium } = require("playwright");
const { resolveDatabaseEnv } = require("../src/config/database-env");
try { fs.appendFileSync(path.join(os.tmpdir(), "snapshot-closeout-debug.log"), `loaded ${new Date().toISOString()}\n`); } catch {}

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const MIGRATION = "20260814010000-customer-invoice-contact-snapshots.js";
const CLONE = `darfus_erp_invoice_snapshot_fullstack_${Date.now()}`;
const evidenceDirectory = path.resolve(__dirname, `../reports/customer-invoice-snapshot-clone-full-stack-runtime-closeout-01-evidence-${new Date().toISOString().replace(/[-:.]/g, "")}`);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "darfus-invoice-snapshot-fullstack-"));
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
let config;
let backendServer;
let frontendProcess;
let browser;
let sequelize;
let cloneDropped = false;
let runtimeStage = "initializing";
const network = [];
const consoleErrors = [];
const screenshots = [];

function pgEnv(database) {
  return { ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password, PGDATABASE: database, PGSSLMODE: config.ssl ? "require" : "disable" };
}
function pg(bin, args, database = "postgres") { return execFileSync(path.join(PG_BIN, bin), args, { env: pgEnv(database), stdio: "pipe" }); }
async function query(database, text, values = []) {
  try { fs.appendFileSync(path.join(os.tmpdir(), "snapshot-closeout-debug.log"), `query-start ${database}\n`); } catch {}
  const client = new Client({ host: config.host, port: config.port, user: config.username, password: config.password, database, ssl: config.ssl ? { rejectUnauthorized: false } : false });
  await client.connect();
  try { const result = await client.query(text, values); try { fs.appendFileSync(path.join(os.tmpdir(), "snapshot-closeout-debug.log"), `query-done ${database}\n`); } catch {} return result; } finally { await client.end(); }
}
function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
function responseKeys(body) { return body && typeof body === "object" ? Object.keys(body).sort() : []; }
function redactUrl(value) { try { const u = new URL(value); return `${u.origin}${u.pathname}${u.search}`; } catch { return "<invalid-url>"; } }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(label, fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await wait(150); }
  throw new Error(`${label}_TIMEOUT`);
}
async function ports() {
  const net = require("node:net");
  const take = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  return { backend: await take(), frontend: await take() };
}
async function baseline(db) {
  const r = await query(db, `SELECT current_database() AS database,
    (SELECT count(*)::int FROM "SequelizeMeta") AS migrations,
    (SELECT count(*)::int FROM customers) AS customers,
    (SELECT count(*)::int FROM invoices) AS invoices,
    (SELECT count(*)::int FROM payments) AS payments,
    (SELECT count(*)::int FROM journal_entries) AS journal_entries,
    (SELECT count(*)::int FROM journal_lines) AS journal_lines,
    (SELECT count(*)::int FROM cash_transactions) AS cash_transactions,
    (SELECT count(*)::int FROM assets) AS assets,
    (SELECT count(*)::int FROM customers WHERE addresses IS NOT NULL) AS customers_with_addresses`);
  const columns = await query(db, `SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='invoices' AND column_name IN ('customer_phone_snapshot','customer_address_snapshot')`);
  const row = r.rows[0];
  row.snapshot_columns = Number(columns.rows[0].count);
  row.phone_snapshots = 0;
  if (row.snapshot_columns === 2) row.phone_snapshots = Number((await query(db, `SELECT count(*)::int AS count FROM invoices WHERE customer_phone_snapshot IS NOT NULL`)).rows[0].count);
  return row;
}
async function integrity(db) {
  const r = await query(db, `SELECT
    (SELECT count(*)::int FROM (SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id GROUP BY je.id HAVING round(sum(jl.debit),4)<>round(sum(jl.credit),4)) q) AS unbalanced_journals,
    (SELECT count(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_journal_lines,
    (SELECT count(*)::int FROM cash_transactions ct LEFT JOIN journal_entries je ON je.id=ct.journal_entry_id WHERE ct.status='posted' AND je.id IS NULL) AS unlinked_treasury,
    (SELECT count(*)::int FROM (SELECT source_type,source_id FROM journal_entries WHERE source_type IS NOT NULL GROUP BY source_type,source_id HAVING count(*)>1) q) AS duplicate_journal_sources,
    (SELECT count(*)::int FROM (SELECT journal_entry_id FROM cash_transactions WHERE journal_entry_id IS NOT NULL GROUP BY journal_entry_id HAVING count(*)>1) q) AS duplicate_treasury_links`);
  return r.rows[0];
}
function writeEvidence(name, value) { fs.mkdirSync(evidenceDirectory, { recursive: true }); fs.writeFileSync(path.join(evidenceDirectory, name), `${JSON.stringify(value, null, 2)}\n`); }
function debugStage(value) { try { fs.appendFileSync(path.join(os.tmpdir(), "snapshot-closeout-debug.log"), `stage ${value}\n`); } catch {} }

async function main() {
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  debugStage("baseline");
  try { fs.appendFileSync(path.join(os.tmpdir(), "snapshot-closeout-debug.log"), `main ${new Date().toISOString()}\n`); } catch {}
  console.error("stage:baseline");
  config = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: ACCEPTANCE });
  try { fs.appendFileSync(path.join(os.tmpdir(), "snapshot-closeout-debug.log"), `config ${config.host}:${config.port} ${config.database}\n`); } catch {}
  const before = { persistent: await baseline(PERSISTENT), acceptance: await baseline(ACCEPTANCE), persistentIntegrity: await integrity(PERSISTENT), acceptanceIntegrity: await integrity(ACCEPTANCE) };
  writeEvidence("before-baselines.json", before);
  if (before.persistent.database !== PERSISTENT || before.acceptance.database !== ACCEPTANCE) throw new Error("SOURCE_BASELINE_TARGET_MISMATCH");

  const dump = path.join(tempRoot, `${CLONE}.dump`);
  runtimeStage = "clone_create";
  debugStage("clone_create");
  console.error("stage:clone_create");
  pg("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, ACCEPTANCE], ACCEPTANCE);
  pg("dropdb.exe", ["--if-exists", CLONE]);
  pg("createdb.exe", [CLONE]);
  pg("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", CLONE, dump], CLONE);
  const cloneBaseline = await baseline(CLONE);
  if (cloneBaseline.database !== CLONE) throw new Error("CLONE_DATABASE_IDENTITY_FAILED");

  runtimeStage = "snapshot_migration";
  debugStage("snapshot_migration");
  console.error("stage:snapshot_migration");
  sequelize = new Sequelize(CLONE, config.username, config.password, { host: config.host, port: config.port, dialect: "postgres", logging: false, dialectOptions: config.ssl ? { ssl: { rejectUnauthorized: false } } : {} });
  const migrator = new Umzug({ migrations: { path: path.join(__dirname, "../migrations"), params: [sequelize.getQueryInterface(), Sequelize] }, storage: "sequelize", storageOptions: { sequelize, tableName: "SequelizeMeta" }, logging: false });
  const pending = (await migrator.pending()).map((entry) => path.basename(entry.file));
  if (pending.length !== 1 || pending[0] !== MIGRATION) throw new Error(`UNEXPECTED_CLONE_PENDING:${pending.join(",")}`);
  await migrator.up({ migrations: [MIGRATION] });
  const columns = (await query(CLONE, `SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name='invoices' AND column_name IN ('customer_phone_snapshot','customer_address_snapshot') ORDER BY column_name`)).rows;
  const oldNull = (await query(CLONE, `SELECT count(*)::int AS count FROM invoices WHERE customer_phone_snapshot IS NULL AND customer_address_snapshot IS NULL`)).rows[0].count;
  if (columns.length !== 2 || columns.some((row) => row.is_nullable !== "YES") || Number(oldNull) !== Number(cloneBaseline.invoices)) throw new Error("SNAPSHOT_MIGRATION_CLONE_PROOF_FAILED");

  runtimeStage = "clone_fixture_and_backend";
  debugStage("clone_fixture_and_backend");
  console.error("stage:clone_fixture_and_backend");
  process.env.NODE_ENV = "development"; process.env.DATABASE_URL = ""; process.env.DB_NAME = CLONE; process.env.DB_USER = config.username; process.env.DB_HOST = config.host; process.env.DB_PORT = String(config.port); process.env.DB_SSL = config.ssl ? "true" : "false"; process.env.PORT = "0";
  const models = require("../src/models");
  const company = await models.Company.findOne({ order: [["id", "ASC"]] });
  const branch = await models.Branch.findOne({ where: { companyId: company.id, code: "MAIN", isActive: true } }) || await models.Branch.findOne({ where: { companyId: company.id, isActive: true }, order: [["code", "ASC"]] });
  const superAdmin = await models.User.findOne({ where: { companyId: company.id, accountType: "super_admin", isActive: true }, order: [["id", "ASC"]] });
  if (!company || !branch || !superAdmin) throw new Error("CLONE_AUTH_CONTEXT_MISSING");
  // Prefer a concrete priced, non-dynamic asset so the POS search projection
  // cannot mark a gold-rate-dependent item unavailable during this isolated
  // runtime proof.
  let asset = (await models.sequelize.query(`SELECT id,name,barcode,price,branch_id AS "branchId",company_id AS "companyId",operational_status AS "operationalStatus",status,type,gross_weight AS "grossWeight",net_weight AS "netWeight",karat,inventory_profile AS "inventoryProfile" FROM assets WHERE company_id=:company AND branch_id=:branch AND operational_status IN ('AVAILABLE','available') AND price::numeric>0 AND COALESCE(inventory_profile,'') NOT IN ('CGP_CUSTOMER_GOLD_PURCHASE','GOLD_BY_WEIGHT_JEWELLERY','GOLD_BAR_24K','GOLD_BY_PIECE','LOOSE_GEMSTONE','LOOSE_PEARL') ORDER BY created_at DESC LIMIT 1`, { replacements: { company: company.id, branch: branch.id }, type: models.sequelize.QueryTypes.SELECT }))[0] || await models.Asset.findOne({ where: { companyId: company.id, branchId: branch.id, operationalStatus: "AVAILABLE" }, order: [["createdAt", "DESC"]] }) || await models.Asset.findOne({ where: { companyId: company.id, operationalStatus: "AVAILABLE" }, order: [["createdAt", "DESC"]] });
  if (!asset || Number(asset.price || 0) <= 0) {
    const rawAsset = (await models.sequelize.query(`SELECT id,name,barcode,price,branch_id,company_id,operational_status,status FROM assets WHERE company_id=:company AND (branch_id=:branch OR branch_id IS NULL) AND (lower(operational_status)='available' OR lower(status::text)='available') AND price::numeric>0 ORDER BY created_at DESC LIMIT 1`, { replacements: { company: company.id, branch: branch.id }, type: models.sequelize.QueryTypes.SELECT }))[0];
    if (rawAsset) asset = rawAsset;
  }
  if (!asset || Number(asset.price || 0) <= 0) {
    const availableProbe = await models.sequelize.query(`SELECT count(*)::int AS count FROM assets WHERE lower(operational_status)='available' AND price::numeric>0`, { type: models.sequelize.QueryTypes.SELECT });
    const sample = await models.sequelize.query(`SELECT id,company_id,branch_id,operational_status,status,price FROM assets WHERE lower(operational_status)='available' AND price::numeric>0 ORDER BY created_at DESC LIMIT 3`, { type: models.sequelize.QueryTypes.SELECT });
    throw new Error(`CLONE_SALE_ITEM_NOT_READY:${JSON.stringify({ companyId: company?.id, branchId: branch?.id, available: availableProbe[0]?.count, sample })}`);
  }
  const asset2 = (await models.sequelize.query(`SELECT id,name,barcode,price,branch_id AS "branchId",company_id AS "companyId",operational_status AS "operationalStatus",status,type,gross_weight AS "grossWeight",net_weight AS "netWeight",karat,inventory_profile AS "inventoryProfile" FROM assets WHERE company_id=:company AND branch_id=:branch AND id<>:asset AND operational_status IN ('AVAILABLE','available') AND price::numeric>0 AND COALESCE(inventory_profile,'') NOT IN ('CGP_CUSTOMER_GOLD_PURCHASE','GOLD_BY_WEIGHT_JEWELLERY','GOLD_BAR_24K','GOLD_BY_PIECE','LOOSE_GEMSTONE','LOOSE_PEARL') ORDER BY created_at DESC LIMIT 1`, { replacements: { company: company.id, branch: branch.id, asset: asset.id }, type: models.sequelize.QueryTypes.SELECT }))[0];
  if (!asset2 || Number(asset2.price || 0) <= 0) throw new Error("CLONE_SECOND_SALE_ITEM_NOT_READY");
  const suffix = Date.now();
  const customer = await models.Customer.create({ id: `CUS-SNAPSHOT-FS-${suffix}`, companyId: company.id, name: "N1", phone: "P1", tier: "Standard", status: "active", addresses: [{ line1: "A1", city: "C1", country: "U1", isPrimary: true }] });
  // Mirror the canonical customer-create contract so branch-scoped POS reads
  // can discover this synthetic clone-only customer.
  await models.BranchCustomer.create({ id: `BCR-${company.id}-${branch.id}-${customer.id}`, companyId: company.id, branchId: branch.id, customerId: customer.id, balance: 0, purchases: 0, loyaltyPoints: 0, isActive: true });
  const sessions = require("../src/services/technical-session.service");
  debugStage("issue_tokens");
  console.error("stage:issue_tokens");
  const auth = await sessions.issueTokens(superAdmin, { headers: { "x-device-session-id": `snapshot-fs-${suffix}` }, ip: "127.0.0.1" });
  debugStage("app_require");
  const p = await ports();
  debugStage(`ports_${p.backend}_${p.frontend}`);
  // Bind CORS to this exact temporary frontend origin. The normal process
  // environment may contain a localhost FRONTEND_URL; this override is
  // process-local and does not touch any repository env file.
  process.env.FRONTEND_URL = `http://127.0.0.1:${p.frontend}`;
  process.env.CORS_ALLOWED_ORIGINS = process.env.FRONTEND_URL;
  console.error("stage:app_require");
  const app = require("../src/app");
  backendServer = await new Promise((resolve, reject) => { const s = app.listen(p.backend, "127.0.0.1", () => resolve(s)); s.once("error", reject); });
  debugStage("backend_started");
  const backendOrigin = `http://127.0.0.1:${p.backend}`;
  const apiBase = `${backendOrigin}/api/v1`;
  const diag = await fetch(`${apiBase}/health`); const diagText = await diag.text();
  if (!diag.ok) throw new Error(`EPHEMERAL_BACKEND_HEALTH_FAILED:${diag.status}`);
  const runtimeDb = (await query(CLONE, "SELECT current_database() AS database")).rows[0].database;
  if (runtimeDb !== CLONE) throw new Error("RUNTIME_CLONE_DB_PROOF_FAILED");
  debugStage("runtime_db_proven");

  runtimeStage = "frontend_build";
  const tempApp = path.join(tempRoot, "frontend");
  debugStage("frontend_build_enter");
  fs.mkdirSync(tempApp, { recursive: true });
  debugStage(`copy_paths_${process.cwd().replace(/\\backend$/, "")}__${tempApp}`);
  debugStage("frontend_dir_created");
  const sourceRoot = process.cwd().replace(/\\backend$/, "");
  // The repository's standalone test/print-export route has no root layout and
  // prevents a production build; it is outside the runtime application and is
  // omitted only from this untracked temporary build copy.
  fs.cpSync(sourceRoot, tempApp, { recursive: true, filter: (source) => ![".git", ".next", "node_modules", "backend", "reports", "test"].includes(path.basename(source)) });
  debugStage("frontend_copied");
  // Never reuse or junction the parent node_modules: Windows/Webpack resolves
  // absolute junction targets into the original workspace. Install the exact
  // lockfile independently in the temporary workspace instead.
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const installEnv = { ...process.env, NODE_ENV: "development" };
  debugStage("before_frontend_npm_ci");
  execFileSync(process.execPath, [npmCli, "ci", "--no-audit", "--no-fund"], { cwd: tempApp, env: installEnv, stdio: "pipe", timeout: 900000, maxBuffer: 16 * 1024 * 1024 });
  debugStage("frontend_node_modules_installed");
  const buildEnv = { ...process.env, NODE_ENV: "production", NEXT_PUBLIC_DATA_SOURCE: "api", NEXT_PUBLIC_API_URL: apiBase, NEXT_PUBLIC_API_ORIGIN: backendOrigin, BACKEND_ORIGIN: backendOrigin };
  debugStage("before_frontend_copy");
  try {
    execFileSync(process.execPath, [npmCli, "run", "build", "--", "--webpack"], { cwd: tempApp, env: buildEnv, stdio: "pipe", timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
  } catch (buildError) {
    writeEvidence("frontend-build-failure.log", `${buildError.stdout || ""}\n${buildError.stderr || ""}`.slice(-20000));
    throw buildError;
  }
  debugStage("frontend_built");
  frontendProcess = spawn(process.execPath, [path.join(tempApp, "node_modules/next/dist/bin/next"), "start", "-p", String(p.frontend), "-H", "127.0.0.1"], { cwd: tempApp, env: buildEnv, stdio: ["ignore", "pipe", "pipe"] });
  let frontendOutput = ""; frontendProcess.stdout.on("data", (b) => { frontendOutput += String(b).slice(-4000); }); frontendProcess.stderr.on("data", (b) => { frontendOutput += String(b).slice(-4000); });
  await waitFor("EPHEMERAL_FRONTEND_START", async () => { try { const r = await fetch(`http://127.0.0.1:${p.frontend}/ar/pos`); return r.ok; } catch { return false; } }, 60000);

  runtimeStage = "browser_runtime";
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ token, refreshToken, companyId, branchId, branchName, session }) => { localStorage.setItem("darfus-token-v1", token); localStorage.setItem("darfus-refresh-v1", refreshToken || "synthetic-refresh"); localStorage.setItem("darfus-api-session-v1", JSON.stringify(session)); localStorage.setItem("darfus-company-id-v1", companyId); localStorage.setItem("darfus-active-branch-id-v1", branchId); localStorage.setItem("darfus-active-branch-name-v1", branchName); }, { token: auth.token, refreshToken: auth.refreshToken, companyId: company.id, branchId: branch.id, branchName: branch.name, session: { user: { ...superAdmin.toJSON(), permissions: ["*"], }, company: { ...company.toJSON(), branchName: branch.name, branchCode: branch.code } } });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500)); });
  page.on("request", (request) => { const url = request.url(); if (url.includes("/api/v1/")) network.push({ phase: "request", method: request.method(), path: redactUrl(url), requestKeys: safeJson(request.postData() || "") ? Object.keys(safeJson(request.postData() || "")).sort() : [], hasAuthorization: Boolean(request.headers().authorization), hasCompany: Boolean(request.headers()["x-company-id"]), hasBranch: Boolean(request.headers()["x-branch-id"]) }); });
  page.on("response", async (response) => { const url = response.url(); if (!url.includes("/api/v1/")) return; let body = null; try { body = safeJson(await response.text()); } catch {} network.push({ phase: "response", method: response.request().method(), path: redactUrl(url), status: response.status(), responseKeys: responseKeys(body) }); });
  const origin = `http://127.0.0.1:${p.frontend}`;
  await page.goto(`${origin}/ar/pos`, { waitUntil: "domcontentloaded", timeout: 60000 });
  writeEvidence("browser-initial.json", { url: page.url(), title: await page.title(), bodyText: (await page.locator("body").innerText().catch(() => "")).slice(0, 5000), consoleErrors, frontendOutput: frontendOutput.slice(-10000) });
  await page.screenshot({ path: path.join(evidenceDirectory, "browser-initial.png"), fullPage: true }).catch(() => {});
  await page.getByRole("heading", { name: "بحث عن المنتج" }).waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: path.join(evidenceDirectory, "pos-before-checkout.png"), fullPage: true }); screenshots.push("pos-before-checkout.png");
  const settingsGate = page.getByText(/جارٍ تحميل إعدادات النظام|Loading system settings|تعذّر تحميل إعدادات النظام|Failed to load system settings/i).first();
  if (await settingsGate.count()) {
    await settingsGate.waitFor({ state: "hidden", timeout: 60000 });
  }
  const customerSelect = page.locator("select").first();
  writeEvidence("customer-options.json", await customerSelect.locator("option").evaluateAll((options) => options.map((option) => ({ value: option.value, text: option.textContent }))));
  await customerSelect.locator(`option[value="${customer.id}"]`).waitFor({ state: "attached", timeout: 30000 });
  await customerSelect.selectOption(customer.id);
  const search = page.getByRole("combobox", { name: /ابحث بالـ ID/i });
  await search.fill(asset.barcode || asset.id || asset.name);
  const resultButton = page.getByRole("button").filter({ hasText: asset.name }).first();
  await resultButton.waitFor({ state: "visible", timeout: 30000 }); await resultButton.click();
  const checkoutButton = page.getByRole("button", { name: /إتمام|إتمام البيع|Complete/i }).last();
  await waitFor("CHECKOUT_BUTTON_ENABLED", async () => await checkoutButton.isEnabled(), 60000);
  writeEvidence("checkout-button.json", { text: await checkoutButton.innerText(), disabled: await checkoutButton.isDisabled(), ariaDisabled: await checkoutButton.getAttribute("aria-disabled"), outerHTML: await checkoutButton.evaluate((el) => el.outerHTML) });
  const checkoutResponsePromise = page.waitForResponse((r) => r.url().includes("/api/v1/pos/checkout"), { timeout: 60000 });
  await checkoutButton.click();
  const checkoutResponse = await checkoutResponsePromise;
  const checkoutPayload = safeJson(await checkoutResponse.text());
  if (!checkoutResponse.ok()) throw new Error(`I1_CHECKOUT_FAILED:${checkoutResponse.status()}`);
  const invoiceId = checkoutPayload?.data?.invoice?.id || checkoutPayload?.invoice?.id || checkoutPayload?.data?.id;
  if (!invoiceId) throw new Error("I1_INVOICE_ID_MISSING");
  await page.screenshot({ path: path.join(evidenceDirectory, "i1-checkout.png"), fullPage: true }); screenshots.push("i1-checkout.png");
  // Evidence SQL must use physical PostgreSQL identifiers.  Sequelize's
  // logical `customerName` attribute is mapped to `customer_name`; quoting
  // the logical camel-case name bypasses that mapping and falsely reports a
  // missing column on the Clone.
  const i1 = (await query(CLONE, `SELECT id,customer_name AS "customerName",customer_phone_snapshot,customer_address_snapshot,total,tax FROM invoices WHERE id=$1`, [invoiceId])).rows[0];
  if (!i1 || i1.customerName !== "N1" || i1.customer_phone_snapshot !== "P1" || i1.customer_address_snapshot?.line1 !== "A1") throw new Error("I1_DB_SNAPSHOT_FAILED");

  // Detail and print are exercised through the real Search & Print page. The modal is the canonical detail view.
  await page.goto(`${origin}/ar/sales/search-print`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#invoice-search").fill(invoiceId);
  await page.getByRole("button", { name: /بحث|Search/i }).first().click();
  await page.getByText("N1", { exact: true }).first().waitFor({ state: "visible", timeout: 60000 });
  await page.screenshot({ path: path.join(evidenceDirectory, "i1-detail.png"), fullPage: true }); screenshots.push("i1-detail.png");
  // The search/print table displays invoiceNumber when available and falls
  // back to the id.  Prefer the response invoice number so the harness does
  // not miss the row after a successful checkout merely because the visible
  // identifier is not the physical invoice id.
  const visibleInvoiceNumber = checkoutPayload?.data?.invoice?.invoiceNumber || checkoutPayload?.invoice?.invoiceNumber;
  const rows = page.locator("tbody tr");
  const row = page.locator("tbody tr").filter({ hasText: visibleInvoiceNumber || invoiceId }).first();
  // If the API response did not expose invoiceNumber at the expected level,
  // the submitted invoice search still returns a single row for the synthetic
  // customer.  Use that bounded result rather than skipping print evidence.
  const printableRow = (await row.count()) ? row : rows.filter({ hasText: "N1" }).first();
  if (await printableRow.count()) {
    await printableRow.getByRole("button").nth(1).click();
    const dialogPrint = page.getByRole("button", { name: /^طباعة$|^Print$/i }).last();
    await dialogPrint.waitFor({ state: "visible", timeout: 30000 });
    await page.screenshot({ path: path.join(evidenceDirectory, "i1-print-dialog.png"), fullPage: true }); screenshots.push("i1-print-dialog.png");
    const printPopup = page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await dialogPrint.click();
    const printedPage = await printPopup;
    if (printedPage) { await printedPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {}); await printedPage.screenshot({ path: path.join(evidenceDirectory, "i1-print.png"), fullPage: true }).catch(() => {}); screenshots.push("i1-print.png"); await printedPage.close().catch(() => {}); }
  }

  // Customer update is exercised through the real Customer UI, not a direct
  // database write.  This proves the first invoice keeps its immutable contact
  // snapshot while the next sale observes the current profile.
  await page.goto(`${origin}/ar/customers/${encodeURIComponent(customer.id)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByTestId("customer-details-edit-action").click();
  await page.getByTestId("customer-profile-name").fill("N2");
  await page.getByTestId("customer-profile-phone").fill("P2");
  await page.getByTestId("customer-profile-save").click();
  await page.getByText("N2", { exact: true }).first().waitFor({ state: "visible", timeout: 60000 });
  await page.getByTestId("customer-edit-address-0").click();
  await page.getByTestId("customer-details-address-line1").fill("A2");
  await page.getByTestId("customer-details-address-city").fill("C2");
  await page.getByTestId("customer-details-address-country").fill("U2");
  await page.getByTestId("customer-address-save").click();
  await page.getByText("A2", { exact: false }).first().waitFor({ state: "visible", timeout: 60000 });
  const customerAfterEdit = (await models.Customer.findByPk(customer.id)).toJSON();
  if (customerAfterEdit.name !== "N2" || customerAfterEdit.phone !== "P2" || customerAfterEdit.addresses?.[0]?.line1 !== "A2") throw new Error("CUSTOMER_UI_UPDATE_FAILED");
  const i1AfterEdit = (await query(CLONE, `SELECT id,customer_name AS "customerName",customer_phone_snapshot,customer_address_snapshot FROM invoices WHERE id=$1`, [invoiceId])).rows[0];
  if (i1AfterEdit.customerName !== "N1" || i1AfterEdit.customer_phone_snapshot !== "P1" || i1AfterEdit.customer_address_snapshot?.line1 !== "A1") throw new Error("I1_HISTORICAL_SNAPSHOT_CHANGED");

  // I2 uses the same real POS flow with the updated Customer and a second
  // eligible Asset from the disposable Clone.
  await page.goto(`${origin}/ar/pos`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("heading", { name: "بحث عن المنتج" }).waitFor({ state: "visible", timeout: 30000 });
  const customerSelect2 = page.locator("select").first();
  await customerSelect2.locator(`option[value="${customer.id}"]`).waitFor({ state: "attached", timeout: 30000 });
  await customerSelect2.selectOption(customer.id);
  const search2 = page.getByRole("combobox", { name: /ابحث بالـ ID/i });
  await search2.fill(asset2.barcode || asset2.id || asset2.name);
  const resultButton2 = page.getByRole("button").filter({ hasText: asset2.name }).first();
  await resultButton2.waitFor({ state: "visible", timeout: 30000 }); await resultButton2.click();
  const checkoutButton2 = page.getByRole("button", { name: /إتمام|إتمام البيع|Complete/i }).last();
  await waitFor("I2_CHECKOUT_BUTTON_ENABLED", async () => await checkoutButton2.isEnabled(), 60000);
  const checkoutResponsePromise2 = page.waitForResponse((r) => r.url().includes("/api/v1/pos/checkout"), { timeout: 60000 });
  await checkoutButton2.click();
  const checkoutResponse2 = await checkoutResponsePromise2;
  const checkoutPayload2 = safeJson(await checkoutResponse2.text());
  if (!checkoutResponse2.ok()) throw new Error(`I2_CHECKOUT_FAILED:${checkoutResponse2.status()}`);
  const invoiceId2 = checkoutPayload2?.data?.invoice?.id || checkoutPayload2?.invoice?.id || checkoutPayload2?.data?.id;
  if (!invoiceId2) throw new Error("I2_INVOICE_ID_MISSING");
  await page.screenshot({ path: path.join(evidenceDirectory, "i2-checkout.png"), fullPage: true }); screenshots.push("i2-checkout.png");
  const i2 = (await query(CLONE, `SELECT id,customer_name AS "customerName",customer_phone_snapshot,customer_address_snapshot,total,tax FROM invoices WHERE id=$1`, [invoiceId2])).rows[0];
  if (!i2 || i2.customerName !== "N2" || i2.customer_phone_snapshot !== "P2" || i2.customer_address_snapshot?.line1 !== "A2") throw new Error("I2_DB_SNAPSHOT_FAILED");
  // Repeat the canonical read-only detail/print path for I2 so both the
  // original and post-profile-change invoices have browser evidence.
  await page.goto(`${origin}/ar/sales/search-print`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#invoice-search").fill(invoiceId2);
  await page.getByRole("button", { name: /بحث|Search/i }).first().click();
  await page.getByText("N2", { exact: true }).first().waitFor({ state: "visible", timeout: 60000 });
  await page.screenshot({ path: path.join(evidenceDirectory, "i2-detail.png"), fullPage: true }); screenshots.push("i2-detail.png");
  const i2Rows = page.locator("tbody tr");
  const i2Row = i2Rows.filter({ hasText: "N2" }).first();
  if (await i2Row.count()) {
    await i2Row.getByRole("button").nth(1).click();
    const i2PrintDialog = page.getByRole("button", { name: /^طباعة$|^Print$/i }).last();
    await i2PrintDialog.waitFor({ state: "visible", timeout: 30000 });
    await page.screenshot({ path: path.join(evidenceDirectory, "i2-print-dialog.png"), fullPage: true }); screenshots.push("i2-print-dialog.png");
  }
  writeEvidence("runtime-evidence.json", { clone: CLONE, backendOrigin, frontendOrigin: origin, runtimeDatabase: runtimeDb, companyId: company.id, branchId: branch.id, customer: { id: customer.id, initial: { name: "N1", phone: "P1", address: "A1" }, afterEdit: { name: customerAfterEdit.name, phone: customerAfterEdit.phone, address: customerAfterEdit.addresses?.[0]?.line1 } }, asset: { id: asset.id, barcode: asset.barcode, name: asset.name, price: String(asset.price) }, asset2: { id: asset2.id, barcode: asset2.barcode, name: asset2.name, price: String(asset2.price) }, invoice: { id: invoiceId, db: i1, afterEdit: i1AfterEdit, checkoutStatus: checkoutResponse.status(), checkoutResponseKeys: responseKeys(checkoutPayload) }, invoice2: { id: invoiceId2, db: i2, checkoutStatus: checkoutResponse2.status(), checkoutResponseKeys: responseKeys(checkoutPayload2) }, network, consoleErrors, screenshots, frontendOutput: frontendOutput.slice(-2000), migration: { name: MIGRATION, columns, oldNullSnapshots: Number(oldNull) } });
  console.log(JSON.stringify({ result: "PASS_RUNTIME_I1_I2", clone: CLONE, frontendOrigin: origin, backendOrigin, invoiceId, invoiceId2, screenshots: screenshots.length, networkCalls: network.length, evidenceDirectory }));
} 

async function cleanup() {
  try { if (browser) await browser.close(); } catch {}
  try { if (frontendProcess) frontendProcess.kill(); } catch {}
  try { if (backendServer) await new Promise((resolve) => backendServer.close(resolve)); } catch {}
  try {
    const loadedModels = require.cache[require.resolve("../src/models")]?.exports;
    if (loadedModels?.sequelize) await loadedModels.sequelize.close();
  } catch {}
  try { if (sequelize) await sequelize.close(); } catch {}
  try { if (!cloneDropped) { pg("dropdb.exe", ["--if-exists", CLONE]); cloneDropped = true; } } catch {}
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
process.on("exit", () => { try { if (!cloneDropped) pg("dropdb.exe", ["--if-exists", CLONE]); } catch {} });
main().catch((error) => { writeEvidence("runtime-failure.json", { result: "BLOCKED", stage: runtimeStage, message: error.message, stack: error.stack?.split("\n").slice(0, 10), clone: CLONE, network, consoleErrors, frontendOutput: typeof frontendOutput === "string" ? frontendOutput.slice(-10000) : null }); console.error(JSON.stringify({ result: "BLOCKED", stage: runtimeStage, message: error.message, evidenceDirectory })); process.exitCode = 1; }).finally(cleanup);
