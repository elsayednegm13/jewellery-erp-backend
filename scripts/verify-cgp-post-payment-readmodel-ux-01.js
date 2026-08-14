"use strict";

// Disposable-clone acceptance for CGP post-payment read-model semantics.
// The persistent database is only read as the clone source; all fixtures and
// settlement writes happen in a temporary database that is dropped in finally.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");
const { QueryTypes } = require("sequelize");
const Decimal = require("decimal.js");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const { resolveDatabaseEnv } = require("../src/config/database-env");
const PERSISTENT = "darfus_erp";
const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PREFIX = "darfus_erp_cgp_post_payment_";
const pgBin = (name) => path.join("C:", "Program Files", "PostgreSQL", "18", "bin", name);

function configFor(database) {
  const cfg = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: database });
  assert.equal(cfg.database, database);
  return cfg;
}
function clientFor(cfg, database = cfg.database) {
  return new Client({ host: cfg.host, port: cfg.port, user: cfg.username, password: cfg.password, database });
}
function pgEnv(cfg, database) {
  return { ...process.env, PGHOST: cfg.host, PGPORT: String(cfg.port), PGUSER: cfg.username, PGPASSWORD: cfg.password || "", PGDATABASE: database };
}
function qid(value) { assert.match(value, /^[a-z0-9_]+$/); return `"${value}"`; }
function runBin(name, args, env) { execFileSync(pgBin(name), args, { env, stdio: "pipe" }); }
function logicalClone(sourceCfg, clone, dumpDir) {
  const dump = path.join(dumpDir, "source.dump");
  runBin("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, PERSISTENT], pgEnv(sourceCfg, PERSISTENT));
  runBin("createdb.exe", [clone], pgEnv(sourceCfg, "postgres"));
  runBin("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, dump], pgEnv(sourceCfg, clone));
}
async function assertTarget(cfg, expected) {
  const client = clientFor(cfg);
  await client.connect();
  try {
    const db = (await client.query("SELECT current_database() AS db")).rows[0].db;
    assert.equal(db, expected);
    return db;
  } finally { await client.end(); }
}

async function main() {
  const persistentCfg = configFor(PERSISTENT);
  const acceptanceCfg = configFor(ACCEPTANCE);
  await assertTarget(persistentCfg, PERSISTENT);
  await assertTarget(acceptanceCfg, ACCEPTANCE);

  const clone = `${PREFIX}${Date.now()}_${crypto.randomBytes(3).toString("hex")}`.toLowerCase();
  const admin = clientFor(configFor("postgres"), "postgres");
  let created = false;
  let dumpDir = null;
  try {
    await admin.connect();
    assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone])).rowCount, 0);
    try {
      await admin.query(`CREATE DATABASE ${qid(clone)} WITH TEMPLATE ${qid(PERSISTENT)}`);
    } catch (error) {
      if (String(error?.code) !== "55006") throw error;
      dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "darfus-cgp-post-payment-"));
      logicalClone(persistentCfg, clone, dumpDir);
    }
    created = true;
    const cloneCfg = configFor(clone);
    await assertTarget(cloneCfg, clone);
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "";
    process.env.DB_NAME = clone;

    const models = require("../src/models");
    const { sequelize } = models;
    const { buildPaymentSummary } = require("../src/services/cgp-payment-summary");
    const businessView = require("../src/services/cgp-business-view.service");
    const settlement = require("../src/services/financial-settlement.service");
    const count = async (table) => Number((await sequelize.query(`SELECT count(*)::int AS n FROM ${table}`, { type: QueryTypes.SELECT }))[0].n);
    const company = await models.Company.findOne();
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true } });
    const actor = await models.User.findOne({ where: { companyId: company.id, role: "admin" } });
    assert.ok(company && branch && actor);
    const source = await models.CustomerFinancialLiability.findOne({ where: { companyId: company.id, branchId: branch.id, status: "OPEN" }, order: [["createdAt", "ASC"]] });
    assert.ok(source, "An open CGP liability is required in the clone");
    const document = await models.CustomerGoldPurchaseDocument.findByPk(source.sourceDocumentId);
    assert.ok(document && document.businessStatus === "POSTED");
    const context = { companyId: company.id, branchId: branch.id, actorId: actor.id, user: actor.toJSON(), actorContext: { userId: actor.id } };
    const view = () => businessView.getBusinessView({ context, id: document.id });
    const before = { settlements: await count("financial_settlements"), journals: await count("journal_entries"), treasury: await count("cash_transactions"), assets: await count("assets"), approvalRequests: await count("approval_requests") };
    const initial = buildPaymentSummary({ originalAmount: source.originalAmount, settledAmount: source.settledAmount, outstandingAmount: source.outstandingAmount });
    const original = initial.originalAmount;
    assert.equal(initial.paymentStatus, "UNPAID");
    assert.equal(initial.outstandingAmount, original);
    const initialView = await view();
    assert.equal(initialView.settlementSummary.paymentStatus, "UNPAID");
    assert.equal(initialView.settlementSummary.outstandingAmount, original);

    const firstAmount = "1000.0000";
    const first = await settlement.executeCustomerPayoutSettlement({ context, input: { liabilityId: source.id, idempotencyKey: `${PREFIX}PARTIAL`, legs: [{ method: "BANK_TRANSFER", amount: firstAmount, bankReference: `${PREFIX}PARTIAL` }], testMarker: PREFIX } });
    assert.equal(first.liabilityStatus, "PARTIALLY_SETTLED");
    const partialView = await view();
    assert.equal(partialView.settlementSummary.paymentStatus, "PARTIALLY_PAID");
    assert.equal(partialView.settlementSummary.paidAmount, firstAmount);
    const partialOutstanding = new Decimal(original).minus("1000.0000").toFixed(4);
    assert.equal(partialView.settlementSummary.outstandingAmount, partialOutstanding);

    const finalAmount = partialOutstanding;
    const second = await settlement.executeCustomerPayoutSettlement({ context, input: { liabilityId: source.id, idempotencyKey: `${PREFIX}FULL`, legs: [{ method: "BANK_TRANSFER", amount: finalAmount, bankReference: `${PREFIX}FULL` }], testMarker: PREFIX } });
    assert.equal(second.liabilityStatus, "SETTLED");
    const fullView = await view();
    assert.equal(fullView.settlementSummary.paymentStatus, "FULLY_PAID");
    assert.equal(fullView.settlementSummary.outstandingAmount, "0.0000");
    assert.equal(fullView.settlementSummary.remainingAmount, "0.0000");
    assert.equal(fullView.settlementSummary.paidAmount, original);
    assert.equal(fullView.settlements.length, 2);
    assert.equal(await count("assets"), before.assets);
    const reloaded = await view();
    assert.deepEqual(reloaded.settlementSummary, fullView.settlementSummary);
    await assert.rejects(() => settlement.executeCustomerPayoutSettlement({ context, input: { liabilityId: source.id, idempotencyKey: `${PREFIX}DOUBLE`, legs: [{ method: "BANK_TRANSFER", amount: "1.0000", bankReference: `${PREFIX}DOUBLE` }], testMarker: PREFIX } }), (error) => error.errorCode === "CUSTOMER_FINANCIAL_LIABILITY_NOT_OPEN");

    const after = { settlements: await count("financial_settlements"), journals: await count("journal_entries"), treasury: await count("cash_transactions"), assets: await count("assets"), approvalRequests: await count("approval_requests") };
    assert.equal(after.settlements - before.settlements, 2);
    assert.equal(after.journals - before.journals, 2);
    assert.equal(after.treasury - before.treasury, 2);
    assert.equal(after.assets, before.assets);
    assert.equal(after.approvalRequests, before.approvalRequests);
    const integrity = (await sequelize.query("SELECT (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS unbalanced, (SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines, (SELECT count(*)::int FROM cash_transactions x LEFT JOIN journal_entries j ON j.id=x.journal_entry_id WHERE x.journal_entry_id IS NOT NULL AND j.id IS NULL) AS unlinked_treasury", { type: QueryTypes.SELECT }))[0];
    assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, unlinked_treasury: 0 });
    console.log(JSON.stringify({ clone, initial: "UNPAID", partial: "PARTIALLY_PAID", full: "FULLY_PAID", zeroReload: "PASS", doubleSettlement: "BLOCKED", assetDelta: 0, approvalRequestDelta: 0, integrity }));
    console.log("CGP_POST_PAYMENT_READMODEL_CLONE: PASS");
    await sequelize.close();
  } finally {
    if (created) {
      await assertTarget(acceptanceCfg, ACCEPTANCE);
      await assertTarget(persistentCfg, PERSISTENT);
      await admin.query(`DROP DATABASE ${qid(clone)} WITH (FORCE)`);
      assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone])).rowCount, 0);
      console.log("CGP_POST_PAYMENT_CLONE_DROPPED: YES");
    }
    await admin.end().catch(() => {});
    if (dumpDir) fs.rmSync(dumpDir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error); if (error.parent) console.error(error.parent.detail || error.parent.message || error.parent); process.exitCode = 1; });
