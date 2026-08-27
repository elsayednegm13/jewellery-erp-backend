"use strict";

// Disposable-clone-only proof for CGP-SETTLEMENT-PERMISSION-AUTHORITY-TREASURY-HARD-GATE-01.
// The persistent database is used only as a read-only source for the clone.
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
const PREFIX = "darfus_erp_cgp_settlement_gate_";
const MARKER = "CGP_SETTLEMENT_PERMISSION_TREASURY_01";
const pgBin = (name) => path.join("C:", "Program Files", "PostgreSQL", "18", "bin", name);

function configFor(database) {
  const cfg = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: database });
  assert.equal(cfg.database, database);
  return cfg;
}
function pgEnv(cfg, database) {
  return { ...process.env, PGHOST: cfg.host, PGPORT: String(cfg.port), PGUSER: cfg.username, PGPASSWORD: cfg.password || "", PGDATABASE: database };
}
function clientFor(cfg, database = cfg.database) {
  return new Client({ host: cfg.host, port: cfg.port, user: cfg.username, password: cfg.password, database });
}
function qid(value) { assert.match(value, /^[a-z0-9_]+$/); return `"${value}"`; }
function runBin(name, args, env) { execFileSync(pgBin(name), args, { env, stdio: "pipe" }); }
function logicalClone(sourceCfg, clone, dumpDir) {
  const dump = path.join(dumpDir, "source.dump");
  runBin("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, PERSISTENT], pgEnv(sourceCfg, PERSISTENT));
  runBin("createdb.exe", [clone], pgEnv(sourceCfg, "postgres"));
  runBin("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, dump], pgEnv(sourceCfg, clone));
}
async function verifyDb(cfg, expected) {
  const client = clientFor(cfg);
  await client.connect();
  try {
    const db = (await client.query("SELECT current_database() AS db")).rows[0].db;
    assert.equal(db, expected);
    const migrations = Number((await client.query('SELECT count(*)::int AS n FROM "SequelizeMeta"')).rows[0].n);
    assert.equal(migrations, 80);
    return { db, migrations };
  } finally { await client.end(); }
}

async function main() {
  const persistentCfg = configFor(PERSISTENT);
  const acceptanceCfg = configFor(ACCEPTANCE);
  await verifyDb(persistentCfg, PERSISTENT);
  await verifyDb(acceptanceCfg, ACCEPTANCE);

  const clone = `${PREFIX}${Date.now()}_${crypto.randomBytes(3).toString("hex")}`.toLowerCase();
  assert.match(clone, /^darfus_erp_cgp_settlement_gate_[a-z0-9_]+$/);
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
      dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "darfus-cgp-settlement-gate-"));
      logicalClone(persistentCfg, clone, dumpDir);
    }
    created = true;
    await verifyDb(configFor(clone), clone);
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "";
    process.env.DB_NAME = clone;

    const models = require("../src/models");
    const { sequelize } = models;
    const cashRegister = require("../src/services/cash-register.service");
    const settlement = require("../src/services/financial-settlement.service");
    const permissionService = require("../src/services/permission.service");
    const count = async (table) => Number((await sequelize.query(`SELECT count(*)::int AS n FROM ${table}`, { type: QueryTypes.SELECT }))[0].n);
    const company = await models.Company.findOne();
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true } });
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" } });
    const adminUser = await models.User.findOne({ where: { companyId: company.id, role: "admin" } });
    assert.ok(company && branch && customer && adminUser);
    const actor = adminUser.toJSON();
    const permissions = await permissionService.getUserPermissionNames(actor);
    assert.ok(permissions.includes("gold_purchase.cgp.settle"));
    assert.equal(permissions.includes("approvals.manage"), true);

    const sourceLiability = await models.CustomerFinancialLiability.findOne({
      where: { companyId: company.id, branchId: branch.id, status: "OPEN", currency: "AED", outstandingAmount: "5182.4854" },
      order: [["createdAt", "ASC"]],
    });
    assert.ok(sourceLiability, "A posted/open liability is required in the persistent clone");
    async function fixtureEvent(label) {
      const eventId = `${MARKER}:${label}:EVENT`;
      return models.OutboxEvent.create({
        id: `${MARKER}:${label}:OUTBOX`, eventId, eventType: "CustomerGoldPurchasePostedEvent", eventVersion: 1,
        aggregateType: "CustomerGoldPurchaseDocument", aggregateId: sourceLiability.sourceDocumentId, payload: { marker: MARKER, label },
        occurredAt: new Date(), availableAt: new Date(), status: "PENDING", attemptCount: 0,
        correlationId: `${MARKER}:${label}:CORRELATION`, causationId: null,
      });
    }

    // Clone-only fixture liability used for repeatable amount/concurrency cases.
    const fixtureBase = await models.JournalEntry.findOne({ where: { companyId: company.id }, order: [["createdAt", "ASC"]] });
    const fixtureEventRow = await fixtureEvent("FIXTURE");
    const fixture = await models.CustomerFinancialLiability.create({
      id: `${MARKER}:LIABILITY`, companyId: company.id, branchId: branch.id, customerId: customer.id,
      sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED", sourceDocumentId: sourceLiability.sourceDocumentId, sourceEventId: fixtureEventRow.eventId,
      journalEntryId: fixtureBase.id, currency: "AED", originalAmount: "10000.0000", outstandingAmount: "10000.0000",
      settledAmount: "0.0000", status: "OPEN", recognizedAt: new Date(), correlationId: `${MARKER}:CORRELATION`, causationId: null,
    });
    const context = { companyId: company.id, branchId: branch.id, actorId: adminUser.id };
    const cashSession = () => cashRegister.currentOpen({ companyId: company.id, branchId: branch.id });
    async function setCash(amount) {
      const current = await cashSession();
      if (current) {
        const expected = await cashRegister.calculateExpected(current);
        await cashRegister.closeRegister({ companyId: company.id, branchId: branch.id, countedAmount: Math.max(0, Number(expected)), varianceReason: `${MARKER}:reset`, actor: { userId: adminUser.id, name: "Clone Test" } });
      }
      return cashRegister.openRegister({ companyId: company.id, branchId: branch.id, openingCountedAmount: amount, idempotencyKey: `${MARKER}:OPEN:${amount}:${Date.now()}`, actor: { userId: adminUser.id, name: "Clone Test" } });
    }
    async function snapshot(liabilityId = fixture.id) {
      const liability = await models.CustomerFinancialLiability.findByPk(liabilityId);
      return { settlements: await count("financial_settlements"), legs: await count("financial_settlement_legs"), allocations: await count("financial_settlement_allocations"), journals: await count("journal_entries"), treasury: await count("cash_transactions"), approvalRequests: Number((await sequelize.query("SELECT count(*)::int AS n FROM approval_requests WHERE type='financial-operation'", { type: QueryTypes.SELECT }))[0].n), outstanding: new Decimal(liability.outstandingAmount).toFixed(4), settled: new Decimal(liability.settledAmount).toFixed(4) };
    }
    async function pay(liabilityId, legs, label) {
      return settlement.executeCustomerPayoutSettlement({ context, input: { liabilityId, idempotencyKey: `${MARKER}:${label}`, legs, testMarker: MARKER } });
    }

    await setCash("0.0000");
    const zeroBefore = await snapshot(sourceLiability.id);
    await assert.rejects(() => pay(sourceLiability.id, [{ method: "CASH", amount: "5182.4854" }], "ZERO"), (e) => e.errorCode === "INSUFFICIENT_CASH_BALANCE");
    assert.deepEqual(await snapshot(sourceLiability.id), zeroBefore);

    await setCash("5182.4853");
    await assert.rejects(() => pay(fixture.id, [{ method: "CASH", amount: "5182.4854" }], "PRECISION_LOW"), (e) => e.errorCode === "INSUFFICIENT_CASH_BALANCE");
    await setCash("5182.4854");
    const exact = await pay(fixture.id, [{ method: "CASH", amount: "5182.4854" }], "EXACT");
    assert.equal(exact.totalAmount, "5182.4854");

    await setCash("10.0000");
    const partial = await pay(fixture.id, [{ method: "CASH", amount: "1.0000" }], "PARTIAL");
    assert.equal(partial.liabilityStatus, "PARTIALLY_SETTLED");

    await setCash("1.0000");
    const mixedEvent = await fixtureEvent("MIXED");
    const mixedLiability = await models.CustomerFinancialLiability.create({
      id: `${MARKER}:MIXED`, companyId: company.id, branchId: branch.id, customerId: customer.id,
      sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED", sourceDocumentId: sourceLiability.sourceDocumentId, sourceEventId: mixedEvent.eventId,
      journalEntryId: fixtureBase.id, currency: "AED", originalAmount: "10.0000", outstandingAmount: "10.0000", settledAmount: "0.0000", status: "OPEN", recognizedAt: new Date(), correlationId: `${MARKER}:MIXED_CORRELATION`, causationId: null,
    });
    await pay(mixedLiability.id, [{ method: "CASH", amount: "1.0000" }, { method: "BANK_TRANSFER", amount: "1.0000", bankReference: `${MARKER}:BANK` }], "MIXED");
    await setCash("0.0000");
    const mixedFailBefore = await snapshot(mixedLiability.id);
    await assert.rejects(() => pay(mixedLiability.id, [{ method: "CASH", amount: "1.0000" }, { method: "BANK_TRANSFER", amount: "1.0000", bankReference: `${MARKER}:BANK_FAIL` }], "MIXED_FAIL"), (e) => e.errorCode === "INSUFFICIENT_CASH_BALANCE");
    assert.deepEqual(await snapshot(mixedLiability.id), mixedFailBefore);

    await setCash("1.0000");
    const raceEvent = await fixtureEvent("RACE");
    const raceLiability = await models.CustomerFinancialLiability.create({
      id: `${MARKER}:RACE`, companyId: company.id, branchId: branch.id, customerId: customer.id,
      sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED", sourceDocumentId: sourceLiability.sourceDocumentId, sourceEventId: raceEvent.eventId,
      journalEntryId: fixtureBase.id, currency: "AED", originalAmount: "2.0000", outstandingAmount: "2.0000", settledAmount: "0.0000", status: "OPEN", recognizedAt: new Date(), correlationId: `${MARKER}:RACE_CORRELATION`, causationId: null,
    });
    const race = await Promise.allSettled([
      pay(raceLiability.id, [{ method: "CASH", amount: "1.0000" }], "RACE_A"),
      pay(raceLiability.id, [{ method: "CASH", amount: "1.0000" }], "RACE_B"),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(race.filter((r) => r.status === "rejected" && r.reason?.errorCode === "INSUFFICIENT_CASH_BALANCE").length, 1);

    const bankEvent = await fixtureEvent("BANK_ONLY");
    const bankLiability = await models.CustomerFinancialLiability.create({
      id: `${MARKER}:BANK_ONLY`, companyId: company.id, branchId: branch.id, customerId: customer.id,
      sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED", sourceDocumentId: sourceLiability.sourceDocumentId, sourceEventId: bankEvent.eventId,
      journalEntryId: fixtureBase.id, currency: "AED", originalAmount: "1.0000", outstandingAmount: "1.0000", settledAmount: "0.0000", status: "OPEN", recognizedAt: new Date(), correlationId: `${MARKER}:BANK_CORRELATION`, causationId: null,
    });
    await pay(bankLiability.id, [{ method: "BANK_TRANSFER", amount: "1.0000", bankReference: `${MARKER}:BANK_ONLY` }], "BANK_ONLY");

    const integrity = (await sequelize.query("SELECT (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS unbalanced, (SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines, (SELECT count(*)::int FROM cash_transactions x LEFT JOIN journal_entries j ON j.id=x.journal_entry_id WHERE x.journal_entry_id IS NOT NULL AND j.id IS NULL) AS unlinked_treasury", { type: QueryTypes.SELECT }))[0];
    assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, unlinked_treasury: 0 });
    assert.equal(await count("approval_requests"), 0, "Clone began with no financial approval rows for this proof");
    console.log(JSON.stringify({ clone, permission: "PASS", policyDependency: "NONE", zeroCash: "PASS", exact: "PASS", greater: "PASS", decimal: "PASS", partial: "PASS", mixed: "PASS", mixedAtomicFailure: "PASS", concurrency: "PASS", bank: "PASS", integrity }));
    console.log("CGP_SETTLEMENT_PERMISSION_AUTHORITY_TREASURY_CLONE: PASS");
    await sequelize.close();
  } finally {
    if (created) {
      await verifyDb(acceptanceCfg, ACCEPTANCE);
      await verifyDb(persistentCfg, PERSISTENT);
      await admin.query(`DROP DATABASE ${qid(clone)} WITH (FORCE)`);
      assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone])).rowCount, 0);
      console.log("CGP_SETTLEMENT_CLONE_DROPPED: YES");
    }
    await admin.end().catch(() => {});
    if (dumpDir) fs.rmSync(dumpDir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error); if (error.parent) console.error(error.parent.detail || error.parent.message || error.parent); process.exitCode = 1; });
