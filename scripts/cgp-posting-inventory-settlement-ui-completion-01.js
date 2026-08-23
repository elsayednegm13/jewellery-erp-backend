"use strict";

// Disposable-clone-only proof for CGP-POSTING-INVENTORY-SETTLEMENT-UI-COMPLETION-01.
// The source Acceptance and Persistent databases are never used for writes.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");
const { Op, QueryTypes } = require("sequelize");
const Decimal = require("decimal.js");

const BACKEND = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(BACKEND, ".env"), override: true });
const { resolveDatabaseEnv } = require("../src/config/database-env");
const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PERSISTENT_MIGRATIONS = 80;
const PREFIX = "darfus_erp_cgp_ui_completion_";
const MARKER = "CGP_UI_COMPLETION_E2E";
const EXECUTE = process.argv.includes("--execute");

function configFor(database) {
  const config = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: database });
  assert.equal(config.database, database);
  return config;
}
function clientFor(config, database = config.database) { return new Client({ host: config.host, port: config.port, user: config.username, password: config.password, database, ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {}) }); }
function pgEnv(config, database) { return { ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password, PGDATABASE: database, PGSSLMODE: config.ssl ? "require" : "disable" }; }
function qid(value) { assert.match(value, /^[a-z0-9_]+$/); return `"${value}"`; }
function cloneLogical(sourceConfig, clone, dir) {
  const dump = path.join(dir, "acceptance.dump");
  execFileSync("C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, ACCEPTANCE], { env: pgEnv(sourceConfig, ACCEPTANCE), stdio: "pipe" });
  execFileSync("C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, dump], { env: pgEnv(sourceConfig, clone), stdio: "pipe" });
}
async function verifyDb(config, expected, migrations) {
  const c = clientFor(config); await c.connect();
  try { const db = await c.query("SELECT current_database() AS db"); assert.equal(db.rows[0]?.db, expected); const m = await c.query('SELECT count(*)::int AS count FROM "SequelizeMeta"'); assert.equal(Number(m.rows[0]?.count), migrations); }
  finally { await c.end().catch(() => {}); }
}
function load(clone) {
  delete process.env.DATABASE_URL; process.env.NODE_ENV = "development"; process.env.DB_NAME = clone;
  const models = require("../src/models");
  return { models, draft: require("../src/services/gold-purchase-draft.service"), posting: require("../src/services/cgp-posting.service"), permissions: require("../src/services/permission.service"), inventory: require("../src/services/cgp-inventory-consumer.service"), accounting: require("../src/services/cgp-accounting-consumer.service"), gold: require("../src/services/cgp-gold-center-consumer.service"), availability: require("../src/services/cgp-availability-evaluator.service"), crm: require("../src/services/cgp-crm-consumer.service"), settlement: require("../src/services/financial-settlement.service"), approvalPolicy: require("../src/services/financial-approval-policy.service") };
}

async function proof(clone) {
  console.log(`CGP_UI_COMPLETION_PROOF_START=${clone}`);
  const s = load(clone); const { models } = s; const count = async (sql, replacements = {}) => Number((await models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }))[0]?.count || 0);
  const row = (await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0]; assert.equal(row.db, clone);
  let ctx;
  for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true } }); const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" } });
    if (!branch || !customer) continue;
    for (const user of await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] })) if (await s.permissions.userHasPermission(user.toJSON(), s.posting.POST_PERMISSION)) { ctx = { company: company.toJSON(), branch: branch.toJSON(), customer: customer.toJSON(), user: user.toJSON() }; break; }
    if (ctx) break;
  }
  assert.ok(ctx, "CGP_UI_COMPLETION_CONTEXT_NOT_FOUND"); const c = { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user };
  console.log("CGP_UI_COMPLETION_CONTEXT: PASS");
  try {
    await models.GoldPrice.create({ karat: 22, pricePerGram: "999.0000", currency: ctx.company.currency || "AED", companyId: ctx.company.id, source: "manual", approvalStatus: "APPROVED", approvedAt: new Date(), approvedBy: ctx.user.id, validFrom: new Date(Date.now() - 60000), validUntil: new Date(Date.now() + 600000), approvalVersion: 1 });
  } catch (error) {
    console.error(`CGP_UI_COMPLETION_GOLD_PRICE_FIXTURE_ERROR=${error?.parent?.detail || error?.original?.detail || error?.message || error}`);
    throw error;
  }
  console.log("CGP_UI_COMPLETION_GOLD_PRICE_FIXTURE: CLONE_ONLY");
  const items = ["CGP_UI_COMPLETION_ITEM_RING", "CGP_UI_COMPLETION_ITEM_CHAIN", "CGP_UI_COMPLETION_ITEM_SCRAP"].map((notes, i) => ({ goldType: `${MARKER}:22K`, notes, karat: "22", purityFactor: "0.916000", fineness: "0.916000", grossWeight: String(8 + i), stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }));
  const before = { assets: await count("SELECT count(*)::int count FROM assets"), journals: await count("SELECT count(*)::int count FROM journal_entries"), cash: await count("SELECT count(*)::int count FROM cash_transactions") };
  const made = await models.sequelize.transaction(async (t) => {
    const d = await s.draft.create("cgp", c, { branchId: ctx.branch.id, customerId: ctx.customer.id, transactionDate: "2026-08-12", currency: ctx.company.currency || "AED", exchangeRate: "1", notes: MARKER, items }, t);
    assert.equal(await count("SELECT count(*)::int count FROM asset_origins ao JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id WHERE i.document_id=:id", { id: d.id }), 0);
    const v = await s.draft.validate("cgp", c, d.id, d.version, t); return s.posting.post({ context: c, id: v.id, expectedVersion: v.version, correlationId: `${MARKER}:POST`, transaction: t });
  });
  console.log("CGP_UI_COMPLETION_POSTING: PASS");
  const eventId = made.outboxEvent.eventId; const documentId = made.document.id; assert.equal(made.document.businessStatus, "POSTED");
  assert.equal(await count("SELECT count(*)::int count FROM assets WHERE metadata->>'cgpDocumentId'=:id", { id: documentId }), 0);
  assert.equal(await count("SELECT count(*)::int count FROM cash_transactions WHERE reference=:r", { r: eventId }), 0);
  await s.inventory.consumePostedEvent({ eventId }); await s.accounting.consumePostedEvent({ eventId }); await s.gold.consumePostedEvent({ eventId }); await s.availability.evaluateAvailability({ eventId }); await s.crm.consumePostedEvent({ eventId });
  console.log("CGP_UI_COMPLETION_INTEGRATIONS: PASS");
  const assets = await models.sequelize.query("SELECT a.id,a.name,a.description,a.barcode,a.operational_status AS status,o.cgp_item_id AS item_id FROM assets a JOIN asset_origins o ON o.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=o.cgp_item_id WHERE i.document_id=:id ORDER BY i.line_number", { replacements: { id: documentId }, type: QueryTypes.SELECT });
  assert.equal(assets.length, 3); assert.equal(new Set(assets.map((a) => a.barcode)).size, 3); assert.ok(assets.every((a) => a.status === "AVAILABLE")); assert.deepEqual(assets.map((a) => a.name), items.map((x) => x.notes));
  const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: documentId, sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED" } }); assert.ok(liability);
  const policy = await models.sequelize.transaction((t) => s.approvalPolicy.createFinancialApprovalPolicy({ models, context: { companyId: ctx.company.id, actorId: ctx.user.id }, input: { operationType: s.settlement.OPERATION_TYPE, branchId: ctx.branch.id, currency: liability.currency, paymentMethod: "MIXED", minAmount: "2.0000", maxAmount: "2.0000", approvalRequired: false, priority: 999, effectiveFrom: new Date(Date.now() - 60000), effectiveTo: new Date(Date.now() + 600000), description: MARKER, metadata: { acceptanceOnly: true, marker: MARKER } }, transaction: t }));
  try {
    await s.settlement.executeCustomerPayoutSettlement({
      context: { companyId: ctx.company.id, branchId: ctx.branch.id, actorId: ctx.user.id },
      input: {
        liabilityId: liability.id,
        idempotencyKey: `${MARKER}:SETTLEMENT`,
        legs: [
          { method: "CASH", amount: "1.0000" },
          { method: "BANK_TRANSFER", amount: "1.0000", bankReference: `${MARKER}:BANK` },
        ],
        testMarker: MARKER,
      },
    });
  } finally {
    await models.sequelize.transaction(async (t) => s.approvalPolicy.deactivateFinancialApprovalPolicy({
      models,
      context: { companyId: ctx.company.id, actorId: ctx.user.id },
      policyId: policy.id,
      transaction: t,
    }));
  }
  console.log("CGP_UI_COMPLETION_SETTLEMENT: PASS");
  const paid = (await models.sequelize.query("SELECT COALESCE(sum(a.amount),0)::numeric AS paid FROM financial_settlement_allocations a JOIN financial_settlements s ON s.id=a.settlement_id WHERE a.customer_financial_liability_id=:id AND s.status='EXECUTED'", { replacements: { id: liability.id }, type: QueryTypes.SELECT }))[0].paid; assert.equal(new Decimal(paid).toFixed(4), "2.0000");
  const after = { assets: await count("SELECT count(*)::int count FROM assets"), journals: await count("SELECT count(*)::int count FROM journal_entries"), cash: await count("SELECT count(*)::int count FROM cash_transactions") };
  const integrity = (await models.sequelize.query("SELECT (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS unbalanced,(SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines,(SELECT count(*)::int FROM cash_transactions c LEFT JOIN journal_entries j ON j.id=c.journal_entry_id WHERE c.journal_entry_id IS NOT NULL AND j.id IS NULL) AS unlinked_treasury,(SELECT count(*)::int FROM assets WHERE barcode IS NULL OR btrim(barcode)='') AS blank_barcodes", { type: QueryTypes.SELECT }))[0]; assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, unlinked_treasury: 0, blank_barcodes: 0 });
  await models.sequelize.close(); return { documentId, eventId, assets, before, after, paidAmount: new Decimal(paid).toFixed(4), remainingAmount: liability.outstandingAmount, integrity };
}

async function main() {
  const sourceConfig = configFor(ACCEPTANCE); const persistentConfig = configFor(PERSISTENT); await verifyDb(sourceConfig, ACCEPTANCE, 80); await verifyDb(persistentConfig, PERSISTENT, PERSISTENT_MIGRATIONS); if (!EXECUTE) { console.log("CGP_UI_COMPLETION_DRY_RUN: PASS"); return; }
  const clone = `${PREFIX}${Date.now()}_${crypto.randomBytes(4).toString("hex")}`.toLowerCase(); const admin = clientFor(configFor("postgres"), "postgres"); let created = false; let dump = null;
  try { await admin.connect(); assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone])).rowCount, 0); try { await admin.query(`CREATE DATABASE ${qid(clone)} WITH TEMPLATE ${qid(ACCEPTANCE)}`); } catch (e) { if (e?.code !== "55006") throw e; dump = fs.mkdtempSync(path.join(os.tmpdir(), "darfus-cgp-ui-completion-")); await admin.query(`CREATE DATABASE ${qid(clone)}`); cloneLogical(sourceConfig, clone, dump); } created = true; await verifyDb(configFor(clone), clone, 80); const result = await proof(clone); console.log(`CGP_UI_COMPLETION_RESULT=${JSON.stringify({ clone, ...result })}`); console.log("CGP_UI_COMPLETION_ACCEPTANCE: PASS"); }
  finally { if (created) { await verifyDb(sourceConfig, ACCEPTANCE, 80); await verifyDb(persistentConfig, PERSISTENT, PERSISTENT_MIGRATIONS); await admin.query(`DROP DATABASE ${qid(clone)} WITH (FORCE)`); assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone])).rowCount, 0); console.log("CGP_UI_COMPLETION_CLONE_DROPPED: YES"); } await admin.end().catch(() => {}); if (dump) fs.rmSync(dump, { recursive: true, force: true }); }
}
main().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
