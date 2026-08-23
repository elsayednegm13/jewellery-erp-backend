"use strict";

// Owner-authorized disposable-clone proof only. Never points application
// writes at Persistent or the Acceptance source.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { QueryTypes, Op } = require("sequelize");
const { resolveDatabaseEnv } = require("../src/config/database-env");
const { BRANCH_MAPPING_CATALOG } = require("../src/services/financial-account-catalog.service");

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PREFIX = "darfus_erp_supplier_mapping_resolution_";
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";
const trace = (message) => { try { fs.appendFileSync(path.join(os.tmpdir(), "supplier-mapping-resolution.trace"), `${new Date().toISOString()} ${message}\n`); } catch (_) {} };
const assertClone = (db) => { assert.match(db, new RegExp(`^${PREFIX}`)); assert.notEqual(db, ACCEPTANCE); assert.notEqual(db, PERSISTENT); };
const pgEnv = (config, database) => ({ ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password, PGDATABASE: database, PGSSLMODE: config.ssl ? "require" : "disable" });
const pg = (name, args, env) => execFileSync(path.join(PG_BIN, name), args, { env, stdio: "pipe" });

async function main() {
  const sourceConfig = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: ACCEPTANCE });
  const sourceClient = new (require("pg").Client)({ host: sourceConfig.host, port: sourceConfig.port, user: sourceConfig.username, password: sourceConfig.password, database: ACCEPTANCE, ssl: sourceConfig.ssl ? { rejectUnauthorized: false } : false });
  await sourceClient.connect();
  const sourceDb = (await sourceClient.query("SELECT current_database() AS db")).rows[0].db;
  if (sourceDb !== ACCEPTANCE) throw new Error(`source target mismatch: ${sourceDb}`);
  const sourceCounts = (await sourceClient.query("SELECT (SELECT count(*)::int FROM branch_financial_mappings WHERE channel IS NULL AND is_active=true) AS mappings, (SELECT count(*)::int FROM assets) AS assets, (SELECT count(*)::int FROM purchase_orders) AS purchase_orders")).rows[0];
  await sourceClient.end();

  const clone = `${PREFIX}${Date.now()}`;
  assertClone(clone);
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-mapping-resolution-"));
  let sequelize = null; let server = null; let auth = null; let company = null; let branch = null; let supplier = null; let superAdmin = null;
  try {
    pg("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${path.join(dumpDir, "acceptance.dump")}`, ACCEPTANCE], pgEnv(sourceConfig, ACCEPTANCE));
    pg("createdb.exe", [clone], pgEnv(sourceConfig, "postgres"));
    process.env.NODE_ENV = "development"; process.env.DATABASE_URL = ""; process.env.DB_NAME = clone;
    // Restore is a clone-only mutation; verify the clone target immediately.
    pg("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, path.join(dumpDir, "acceptance.dump")], pgEnv(sourceConfig, clone));
    const cloneProbe = new (require("pg").Client)({ host: sourceConfig.host, port: sourceConfig.port, user: sourceConfig.username, password: sourceConfig.password, database: clone, ssl: sourceConfig.ssl ? { rejectUnauthorized: false } : false });
    await cloneProbe.connect();
    const cloneDb = (await cloneProbe.query("SELECT current_database() AS db")).rows[0].db;
    if (cloneDb !== clone) throw new Error(`clone target mismatch: ${cloneDb}`);
    await cloneProbe.end();

    const models = require("../src/models");
    const financialAccountResolver = require("../src/services/financial-account-resolver.service");
    sequelize = models.sequelize;
    const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements, type: QueryTypes.SELECT }))[0];
    const assertDb = async () => assert.equal((await one("SELECT current_database() AS db")).db, clone);
    await assertDb();
    company = await models.Company.findOne({ order: [["id", "ASC"]] });
    // Intentionally select the active branch with no current mappings so the
    // inherited blocker is reproduced against the real branch context rather
    // than silently falling back to the mapped MAIN branch.
    const branches = await models.Branch.findAll({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] });
    const branchCounts = await Promise.all(branches.map(async (candidate) => ({
      branch: candidate,
      count: await models.BranchFinancialMapping.count({ where: { companyId: company.id, branchId: candidate.id, channel: null, isActive: true } }),
    })));
    branch = (branchCounts.find((entry) => entry.count === 0) || branchCounts[0])?.branch;
    supplier = await models.Supplier.findOne({ where: { companyId: company.id }, order: [["id", "ASC"]] });
    superAdmin = await models.User.findOne({ where: { companyId: company.id, isActive: true, accountType: "super_admin" }, order: [["id", "ASC"]] });
    assert.ok(company && branch && supplier && superAdmin, "clone harness rows are required");

    const mappingRows = await models.BranchFinancialMapping.findAll({ where: { companyId: company.id, branchId: branch.id, channel: null, isActive: true }, include: [{ model: models.Account, as: "account", attributes: ["id", "code", "companyId", "branchId", "isActive", "type", "nature", "statementClassification"] }], order: [["mappingType", "ASC"]] });
    const mappingInventory = mappingRows.map((row) => ({ role: row.mappingType, accountId: row.accountId, account: row.account?.toJSON?.() || null }));

    const resolverResults = {};
    for (const role of Object.keys(BRANCH_MAPPING_CATALOG)) {
      try {
        resolverResults[role] = await sequelize.transaction(async (transaction) => {
          const account = await financialAccountResolver.resolveRequiredBranchFinancialAccount({ models, companyId: company.id, branchId: branch.id, mappingRole: role, transaction });
          return { ok: true, accountCode: account.code, accountId: account.id };
        });
      } catch (error) {
        resolverResults[role] = { ok: false, code: error.code, message: error.message };
      }
    }
    const failedRoles = Object.entries(resolverResults).filter(([, value]) => !value.ok).map(([role, value]) => ({ role, ...value }));
    console.log(JSON.stringify({ phase: "clone-mapping-inventory", sourceDb, sourceCounts, clone, company: company.id, branch: { id: branch.id, code: branch.code, name: branch.name }, mappingInventory, resolverResults, failedRoles }, null, 2));

    const sessions = require("../src/services/technical-session.service");
    auth = await sessions.issueTokens(superAdmin, { headers: { "x-device-session-id": `supplier-mapping-resolution-${Date.now()}` }, ip: "127.0.0.1" });
    const app = require("../src/app");
    // Clone-only diagnostics: preserve the canonical response contract while
    // exposing the in-memory stack locally so a post-gate 500 cannot be
    // misclassified as another mapping failure.
    const errorLayer = app._router?.stack?.find((layer) => layer.handle && layer.handle.length === 4);
    if (errorLayer) {
      const originalErrorHandler = errorLayer.handle;
      errorLayer.handle = (error, req, res, next) => { console.error(`[clone-diagnostic] ${error?.stack || error?.message || error}`); return originalErrorHandler(error, req, res, next); };
    }
    server = await new Promise((resolve, reject) => { const s = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const request = async (method, url, body, key) => {
      await assertDb();
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}`, "X-Company-ID": company.id, "X-Branch-ID": branch.id, "Idempotency-Key": key };
      const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const raw = await response.text(); let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
      return { status: response.status, body: parsed };
    };
    const code = (await one("SELECT i.code AS \"inventoryCode\", m.code AS \"itemCode\" FROM barcode_inventory_codes i JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code) WHERE i.asset_type='gold-piece' AND i.is_active=true ORDER BY i.code,m.code LIMIT 1"));
    assert.ok(code, "gold-weight barcode taxonomy required");
    const body = {
      id: `SUP-MAPPING-RESOLUTION-${Date.now()}`, supplierId: supplier.id, branchId: branch.id, warehouseId: branch.id,
      purchaseDate: "2026-08-13", paymentMethod: "credit", paidAmount: 0, applyVat: false, inventoryV2: true,
      items: [{ name: "Disposable mapping proof", type: "gold-weight", inventoryCode: code.inventoryCode, itemCode: code.itemCode, karat: 24, quantity: 1, weightPerUnit: 1, unitCost: 0, price: 0,
        perPiece: [{ name: "Disposable mapping proof", description: "Clone-only mapping proof", profile: "GOLD_BY_PIECE", inventoryProfile: "GOLD_BY_PIECE", type: "gold-piece", inventoryCode: code.inventoryCode, itemCode: code.itemCode, karat: 24, grossWeight: 1, stoneWeight: 0, purchaseCost: 100, condition: "NEW" }] }],
    };
    const before = await request("POST", "/purchase-orders/receive", body, `SUP-MAPPING-RESOLUTION-BEFORE-${Date.now()}`);
    console.log(JSON.stringify({ phase: "minimal-receipt-before-resolution", status: before.status, body: before.body }, null, 2));

    // The branch has no SystemAccountRole rows, so the per-role endpoint has
    // no eligible candidates by design.  Use the existing audited canonical
    // reconciliation/configuration path, which resolves stable semantic
    // account definitions server-side and creates the complete branch
    // configuration without accepting client-selected financial authority.
    await assertDb();
    const mappingAuditBefore = await one("SELECT count(*)::int AS n FROM audit_logs WHERE action='financial_configuration.reconciled'");
    const reconcile = await request("POST", "/financial/reconcile", { branchId: branch.id, dryRun: false }, `SUP-MAPPING-RECONCILE-${Date.now()}`);
    assert.equal(reconcile.status, 200, "clone financial reconciliation must complete");
    const mappingResolution = { path: "POST /financial/reconcile", report: reconcile.body?.data || null };
    const mappingAuditAfter = await one("SELECT count(*)::int AS n FROM audit_logs WHERE action='financial_configuration.reconciled'");
    const mappingAudit = { before: mappingAuditBefore.n, after: mappingAuditAfter.n, delta: mappingAuditAfter.n - mappingAuditBefore.n };
    const countsBeforeReceipt = await one(`SELECT
      (SELECT count(*)::int FROM purchase_orders) AS purchase_orders,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM purchase_order_items) AS purchase_order_items,
      (SELECT count(*)::int FROM asset_purchase_cost_revisions) AS purchase_revisions,
      (SELECT count(*)::int FROM journal_entries) AS journals,
      (SELECT count(*)::int FROM cash_transactions) AS treasury`);
    const receiptKey = `SUP-MAPPING-RESOLUTION-${Date.now()}`;
    const after = await request("POST", "/purchase-orders/receive", body, receiptKey);
    assert.equal(after.status, 201, "minimal Supplier receipt must cross the mapping gate");
    const payload = after.body?.data || after.body;
    const po = payload?.purchaseOrder;
    const asset = payload?.assets?.[0];
    const journal = payload?.journalEntry;
    assert.equal(po?.total, 100);
    assert.equal(po?.paidAmount, 0);
    assert.equal(po?.remainingAmount, 100);
    assert.equal(payload?.assets?.length, 1);
    assert.ok(asset?.id && asset?.barcode);
    assert.equal(payload?.purchaseOrder?.items?.length, 1);
    assert.equal(journal?.totalDebit, journal?.totalCredit);
    assert.equal(payload?.treasuryTransaction, null);
    const replay = await request("POST", "/purchase-orders/receive", body, receiptKey);
    assert.ok([200, 201].includes(replay.status), "same-key retry must replay the original receipt");
    assert.equal((replay.body?.data || replay.body)?.purchaseOrder?.id, po.id);
    const countsAfterReplay = await one(`SELECT
      (SELECT count(*)::int FROM purchase_orders) AS purchase_orders,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM purchase_order_items) AS purchase_order_items,
      (SELECT count(*)::int FROM asset_purchase_cost_revisions) AS purchase_revisions,
      (SELECT count(*)::int FROM journal_entries) AS journals,
      (SELECT count(*)::int FROM cash_transactions) AS treasury`);
    for (const key of Object.keys(countsBeforeReceipt)) assert.equal(countsAfterReplay[key] - countsBeforeReceipt[key], key === "treasury" ? 0 : 1, `idempotency count ${key}`);
    const finalMappings = await models.BranchFinancialMapping.count({ where: { companyId: company.id, branchId: branch.id, channel: null, isActive: true } });
    console.log(JSON.stringify({ phase: "minimal-receipt-after-resolution", mappingResolution, status: after.status,
      receipt: { purchaseOrderId: po.id, total: po.total, paidAmount: po.paidAmount, remainingAmount: po.remainingAmount,
        assetId: asset.id, barcode: asset.barcode, purchaseRevisionCountDelta: countsAfterReplay.purchase_revisions - countsBeforeReceipt.purchase_revisions,
        journalId: journal.id, journalBalanced: journal.totalDebit === journal.totalCredit, treasury: payload.treasuryTransaction,
      idempotentReplayStatus: replay.status }, finalActiveMappingCount: finalMappings, mappingAudit }, null, 2));
  } finally {
    try { if (auth && superAdmin) await Promise.race([require("../src/services/technical-session.service").revokeSession(auth.session.id, superAdmin.id, "supplier_mapping_resolution_complete"), new Promise((resolve) => setTimeout(resolve, 2000))]); } catch (_) {}
    try { if (server) { server.closeAllConnections?.(); await Promise.race([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => setTimeout(resolve, 2500))]); } } catch (_) {}
    try { if (sequelize && !sequelize.closed) await sequelize.close(); } catch (_) {}
    try { assertClone(clone); pg("dropdb.exe", ["--if-exists", clone], pgEnv(sourceConfig, "postgres")); } catch (_) {}
    fs.rmSync(dumpDir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(JSON.stringify({ phase: "FAIL", message: error.message, code: error.code, stack: error.stack })); process.exitCode = 1; });
