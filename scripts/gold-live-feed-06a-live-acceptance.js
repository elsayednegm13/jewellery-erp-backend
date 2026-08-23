"use strict";

// Controlled GOLD-LIVE-FEED-06A proof. The canonical Acceptance database is
// read-only; all writable business evidence belongs to the exact disposable
// clone created by this script and is dropped in finally.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");
const { Op, QueryTypes } = require("sequelize");
const Decimal = require("decimal.js");
const axios = require("axios");

const BACKEND = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(BACKEND, ".env"), override: true });
const { resolveDatabaseEnv } = require("../src/config/database-env");

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PREFIX = "darfus_erp_gold_live_feed_06a_rehearsal_";
const MARKER = "GOLD_LIVE_FEED_06A";
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
function clientFor(config, database) {
  return new Client({ host: config.host, port: config.port, user: config.username, password: config.password, database, ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
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
function dropClone(config, clone) {
  assertClone(clone);
  runBin("dropdb.exe", [clone], pgEnv(config, "postgres"));
}
async function verifyDatabase(config, database, expectedMigrations) {
  const client = clientFor(config, database);
  try {
    await client.connect();
    const current = (await client.query("SELECT current_database() AS db")).rows[0].db;
    assert.equal(current, database);
    const migrations = Number((await client.query('SELECT count(*)::int AS n FROM "SequelizeMeta"')).rows[0].n);
    assert.equal(migrations, expectedMigrations);
  } finally { await client.end().catch(() => {}); }
}
async function snapshot(config, database) {
  const client = clientFor(config, database);
  const tables = ["assets", "products", "customers", "customer_gold_purchase_documents", "customer_gold_purchase_items", "journal_entries", "journal_lines", "cash_transactions", "gold_core_events", "outbox_events", "cgp_reversal_compensations"];
  try {
    await client.connect();
    const db = (await client.query("SELECT current_database() AS db")).rows[0].db;
    const migrations = Number((await client.query('SELECT count(*)::int AS n FROM "SequelizeMeta"')).rows[0].n);
    const result = { db, migrations };
    for (const table of tables) {
      const exists = (await client.query("SELECT to_regclass($1) AS name", [`public.${table}`])).rows[0].name;
      result[table] = exists ? Number((await client.query(`SELECT count(*)::int AS n FROM \"${table}\"`)).rows[0].n) : null;
    }
    return result;
  } finally { await client.end().catch(() => {}); }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const sourceConfig = configFor(ACCEPTANCE);
  const persistentConfig = configFor(PERSISTENT);
  await verifyDatabase(sourceConfig, ACCEPTANCE, 80);
  await verifyDatabase(persistentConfig, PERSISTENT, 77);
  const acceptanceBaseline = await snapshot(sourceConfig, ACCEPTANCE);
  const clone = `${PREFIX}${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  assertClone(clone);
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gold-live-feed-06a-"));
  cloneAcceptance(sourceConfig, clone, dumpDir);
  let models;
  let liveHttpRequests = 0;
  const originalAxiosGet = axios.get;
  axios.get = async (...args) => { liveHttpRequests += 1; return originalAxiosGet(...args); };

  try {
    process.env.NODE_ENV = "development";
    delete process.env.DATABASE_URL;
    process.env.DB_NAME = clone;
    models = require("../src/models");
    const currentDb = (await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0].db;
    assert.equal(currentDb, clone);
    const cloneBaseline = await snapshot(sourceConfig, clone);
    assert.deepEqual(cloneBaseline, { ...acceptanceBaseline, db: clone });

    const permissions = require("../src/services/permission.service");
    const draft = require("../src/services/gold-purchase-draft.service");
    const posting = require("../src/services/cgp-posting.service");
    const feed = require("../src/services/gold-market-feed.service");
    const refresh = require("../src/services/gold-market-refresh.service");
    const policy = require("../src/services/gold-pricing-policy.service");
    const adminService = require("../src/services/gold-market-admin.service");
    const inventory = require("../src/services/cgp-inventory-consumer.service");
    const availability = require("../src/services/cgp-availability-evaluator.service");
    const accounting = require("../src/services/cgp-accounting-consumer.service");
    const gold = require("../src/services/cgp-gold-center-consumer.service");
    const crm = require("../src/services/cgp-crm-consumer.service");
    const settlement = require("../src/services/financial-settlement.service");
    const approvalPolicy = require("../src/services/financial-approval-policy.service");
    const hold = require("../src/services/cgp-reversal-hold.service");
    const holdConsumer = require("../src/services/cgp-reversal-hold-inventory-consumer.service");
    const reversal = require("../src/services/cgp-reversal-compensation.service");

    let chosen = null;
    for (const candidateCompany of await models.Company.findAll({ order: [["id", "ASC"]] })) {
      const candidateCustomer = await models.Customer.findOne({ where: { companyId: candidateCompany.id, status: "active" }, order: [["id", "ASC"]] });
      const candidateUser = (await models.User.findAll({ where: { companyId: candidateCompany.id, isActive: true }, order: [["id", "ASC"]] })).find((u) => u.accountType === "super_admin" || ["admin", "owner"].includes(u.role));
      for (const candidateBranch of await models.Branch.findAll({ where: { companyId: candidateCompany.id, isActive: true }, order: [["id", "ASC"]] })) {
        const roles = await models.SystemAccountRole.findAll({ where: { companyId: candidateCompany.id, branchId: candidateBranch.id, roleCode: { [Op.in]: ["INVENTORY_ASSET", "CUSTOMER_CREDITOR"] } } });
        if (candidateCustomer && candidateUser && new Set(roles.map((role) => role.roleCode)).size === 2) {
          chosen = { company: candidateCompany, branch: candidateBranch, customer: candidateCustomer, user: candidateUser };
          break;
        }
      }
      if (chosen) break;
    }
    assert.ok(chosen, "live acceptance context required");
    const { company, branch, customer, user } = chosen;
    const ctx = { companyId: company.id, branchId: branch.id, user: user.toJSON() };
    const currency = String(company.currency || "AED").toUpperCase();
    assert.equal(await permissions.userHasPermission(user.toJSON(), policy.PRICING_POLICY_PERMISSION), true);

    // Canonical admin service creates the test-only live policy and settings.
    const policyVersion = await policy.createPolicyVersion({ context: ctx, input: { pricingMode: "LIVE_PROVIDER", scopeType: "DEFAULT", baseQuoteType: "BID", adjustmentType: "NONE", adjustmentValue: "0", effectiveFrom: new Date(Date.now() - 1000) }, activate: true, reason: `${MARKER}:POLICY` });
    await adminService.updateSettings({ context: ctx, input: { pricingMode: "LIVE_PROVIDER", activeProvider: "GOLDAPI_IO", marketCurrency: currency, refreshIntervalSeconds: 30, staleAfterSeconds: 120, enabled: true } });

    // One bounded real centralized refresh. No polling worker is started.
    const refreshedResult = await refresh.refreshOnce({ companyId: company.id, providerId: "GOLDAPI_IO", currency, metal: "XAU", staleAfterSeconds: 120 });
    const refreshed = refreshedResult.quote.toJSON ? refreshedResult.quote.toJSON() : refreshedResult.quote;
    assert.equal(refreshed.provider, "GOLDAPI_IO");
    assert.equal(refreshed.unit, "PER_GRAM");
    assert.equal(refreshed.status, "VALID");
    assert.ok(Number(refreshed.bid) > 0 && Number(refreshed.spot) > 0 && Number(refreshed.ask) > 0);
    assert.ok(Number(refreshed.karat18Rate) > 0 && Number(refreshed.karat21Rate) > 0 && Number(refreshed.karat22Rate) > 0 && Number(refreshed.karat24Rate) > 0);
    const state = await adminService.currentState(company.id);
    assert.equal(state.health.status, "HEALTHY");
    const resolved = await policy.resolvePolicy({ companyId: company.id, karat: 21 });
    const calculated = policy.calculateFromPolicy({ quote: refreshed, policy: resolved.policy, companyId: company.id, karat: 21, currency, now: new Date(), staleAfterSeconds: 120, marketQuoteId: refreshed.id });
    assert.equal(calculated.baseQuoteType, "BID");
    assert.equal(calculated.adjustmentType, "NONE");
    assert.equal(new Decimal(calculated.adjustmentValue).toFixed(4), "0.0000");
    assert.equal(new Decimal(calculated.effectiveRate).toFixed(4), new Decimal(calculated.karatMarketRate).toFixed(4));

    const createValidated = async (suffix, documentCurrency = currency) => models.sequelize.transaction(async (transaction) => {
      const document = await draft.create("cgp", ctx, { branchId: branch.id, customerId: customer.id, transactionDate: "2026-08-11", currency: documentCurrency, exchangeRate: "1", notes: `${MARKER}:${suffix}`, items: [{ goldType: `${MARKER}:${suffix}`, karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "2.000000", stoneWeight: "0.000000", proposedRate: "1.0000", referenceMarketRate: "1.0000" }] }, transaction);
      return draft.validate("cgp", ctx, document.id, document.version, transaction);
    });

    const made = await models.sequelize.transaction(async (transaction) => {
      const document = await draft.create("cgp", ctx, { branchId: branch.id, customerId: customer.id, transactionDate: "2026-08-11", currency, exchangeRate: "1", notes: `${MARKER}:PRIMARY`, items: [{ goldType: `${MARKER}:21K`, karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "2.000000", stoneWeight: "0.000000", proposedRate: "1.0000", referenceMarketRate: "1.0000" }] }, transaction);
      const validated = await draft.validate("cgp", ctx, document.id, document.version, transaction);
      return posting.post({ context: ctx, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:PRIMARY`, transaction });
    });
    assert.equal(made.document.businessStatus, "POSTED");
    assert.equal(made.outboxEvent.eventType, "CustomerGoldPurchasePostedEvent");
    const snapshotRow = await models.CgpPricingSnapshot.findOne({ where: { cgpDocumentId: made.document.id } });
    assert.equal(snapshotRow.pricingMode, "LIVE_PROVIDER");
    assert.equal(snapshotRow.provider, "GOLDAPI_IO");
    assert.equal(snapshotRow.baseQuoteType, "BID");
    assert.equal(snapshotRow.quoteUnit, "PER_GRAM");
    assert.equal(snapshotRow.adjustmentType, "NONE");
    assert.ok(snapshotRow.marketQuoteId && snapshotRow.policyId && snapshotRow.marketQuoteTimestamp);
    assert.equal(new Decimal(snapshotRow.lineGoldValue).toFixed(4), new Decimal(snapshotRow.netWeight).mul(snapshotRow.approvedKaratRate).toFixed(4));
    assert.notEqual(String(snapshotRow.approvedKaratRate), "1.0000");
    const originalSnapshot = snapshotRow.toJSON();

    await inventory.consumePostedEvent({ eventId: made.outboxEvent.eventId });
    await accounting.consumePostedEvent({ eventId: made.outboxEvent.eventId });
    await gold.consumePostedEvent({ eventId: made.outboxEvent.eventId });
    await availability.evaluateAvailability({ eventId: made.outboxEvent.eventId });
    await crm.consumePostedEvent({ eventId: made.outboxEvent.eventId });
    const asset = (await models.sequelize.query("SELECT a.id,a.barcode,a.operational_status AS status FROM assets a JOIN asset_origins o ON o.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=o.cgp_item_id WHERE i.document_id=:id", { replacements: { id: made.document.id }, type: QueryTypes.SELECT }))[0];
    assert.ok(asset && asset.barcode);
    assert.equal(String(asset.status).toUpperCase(), "AVAILABLE");

    const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: made.document.id, sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED" } });
    assert.ok(liability);
    const settlementPolicy = await models.sequelize.transaction((transaction) => approvalPolicy.createFinancialApprovalPolicy({ models, context: { companyId: company.id, actorId: user.id }, input: { operationType: settlement.OPERATION_TYPE, branchId: branch.id, currency: liability.currency, paymentMethod: "CASH", minAmount: "1.0000", maxAmount: "1.0000", approvalRequired: false, priority: 999, effectiveFrom: new Date(Date.now() - 60000), effectiveTo: new Date(Date.now() + 600000), description: `${MARKER}:SETTLEMENT`, metadata: { acceptanceOnly: true, marker: MARKER } }, transaction }));
    try { await settlement.executeCustomerPayoutSettlement({ context: { companyId: company.id, branchId: branch.id, actorId: user.id }, input: { liabilityId: liability.id, idempotencyKey: `${MARKER}:SETTLEMENT`, legs: [{ method: "CASH", amount: "1.0000" }], testMarker: MARKER } }); } finally { await models.sequelize.transaction((transaction) => approvalPolicy.deactivateFinancialApprovalPolicy({ models, context: { companyId: company.id, actorId: user.id }, policyId: settlementPolicy.id, transaction })); }

    const holdResult = await models.sequelize.transaction((transaction) => hold.requestHold({ context: ctx, cgpDocumentId: made.document.id, reason: `${MARKER}:REVERSAL`, idempotencyKey: `${MARKER}:HOLD`, correlationId: `${MARKER}:HOLD`, transaction }));
    await holdConsumer.consumeHoldEvent({ eventId: holdResult.holdEventId });
    const reversalRequest = await models.CgpReversalRequest.findByPk(holdResult.request.id);
    const begun = await models.sequelize.transaction((transaction) => reversal.beginCompensation({ requestId: reversalRequest.id, actorId: user.id, context: ctx, transaction }));
    await reversal.compensateAccounting({ eventId: begun.eventId, context: ctx });
    await reversal.compensateGold({ eventId: begun.eventId, context: ctx });
    await reversal.finalize({ requestId: reversalRequest.id, actorId: user.id, context: ctx });
    assert.equal((await models.CustomerGoldPurchaseDocument.findByPk(made.document.id)).businessStatus, "REVERSED");
    assert.equal((await models.CgpPricingSnapshot.findByPk(originalSnapshot.id)).finalEffectiveRate, originalSnapshot.finalEffectiveRate);

    // A controlled newer quote cannot mutate the old Posted snapshot.
    await feed.ingestNormalizedQuote({ id: `GMQ:${MARKER}:NEWER`, companyId: company.id, provider: "GOLDAPI_IO", metal: "XAU", currency, unit: "PER_GRAM", quoteTimestamp: new Date(), receivedAt: new Date(), bid: new Decimal(refreshed.bid).plus(10).toFixed(8), spot: new Decimal(refreshed.spot).plus(10).toFixed(8), ask: new Decimal(refreshed.ask).plus(10).toFixed(8), karat18Rate: new Decimal(refreshed.karat18Rate).plus(10).toFixed(8), karat21Rate: new Decimal(refreshed.karat21Rate).plus(10).toFixed(8), karat22Rate: new Decimal(refreshed.karat22Rate).plus(10).toFixed(8), karat24Rate: new Decimal(refreshed.karat24Rate).plus(10).toFixed(8), karatRateSource: "PROVIDER_DIRECT", status: "VALID", quality: "CONTROLLED_NEWER_QUOTE" });
    const unchanged = await models.CgpPricingSnapshot.findByPk(originalSnapshot.id);
    assert.equal(unchanged.marketQuoteId, originalSnapshot.marketQuoteId);
    assert.equal(unchanged.finalEffectiveRate, originalSnapshot.finalEffectiveRate);

    const noSideEffect = async (suffix, action) => {
      const before = { docs: await models.CustomerGoldPurchaseDocument.count(), assets: await models.Asset.count(), journals: await models.JournalEntry.count(), snapshots: await models.CgpPricingSnapshot.count() };
      if (suffix === "CURRENCY") {
        await assert.rejects(() => createValidated(suffix, "USD"));
        const afterInvalid = { docs: await models.CustomerGoldPurchaseDocument.count(), assets: await models.Asset.count(), journals: await models.JournalEntry.count(), snapshots: await models.CgpPricingSnapshot.count() };
        assert.deepEqual(afterInvalid, before);
        return;
      }
      const doc = await createValidated(suffix, suffix === "CURRENCY" ? "USD" : currency);
      await assert.rejects(() => models.sequelize.transaction((transaction) => action(doc, transaction)));
      const after = { docs: await models.CustomerGoldPurchaseDocument.count(), assets: await models.Asset.count(), journals: await models.JournalEntry.count(), snapshots: await models.CgpPricingSnapshot.count() };
      assert.deepEqual(after, { ...before, docs: before.docs + 1 });
    };
    await models.GoldMarketSetting.update({ refreshIntervalSeconds: 1, staleAfterSeconds: 1 }, { where: { companyId: company.id } });
    await sleep(1200);
    await noSideEffect("STALE", (doc, transaction) => posting.post({ context: ctx, id: doc.id, expectedVersion: doc.version, correlationId: `${MARKER}:STALE`, transaction }));
    await models.GoldMarketSetting.update({ refreshIntervalSeconds: 30, staleAfterSeconds: 120 }, { where: { companyId: company.id } });

    await feed.ingestNormalizedQuote({ id: `GMQ:${MARKER}:NO_BID`, companyId: company.id, provider: "GOLDAPI_IO", metal: "XAU", currency, unit: "PER_GRAM", quoteTimestamp: new Date(), receivedAt: new Date(), bid: null, spot: refreshed.spot, ask: refreshed.ask, karat18Rate: refreshed.karat18Rate, karat21Rate: refreshed.karat21Rate, karat22Rate: refreshed.karat22Rate, karat24Rate: refreshed.karat24Rate, karatRateSource: "PROVIDER_DIRECT", status: "VALID", quality: "CONTROLLED_MISSING_BID" });
    await noSideEffect("NO_BID", (doc, transaction) => posting.post({ context: ctx, id: doc.id, expectedVersion: doc.version, correlationId: `${MARKER}:NO_BID`, transaction }));
    await noSideEffect("CURRENCY", (doc, transaction) => posting.post({ context: ctx, id: doc.id, expectedVersion: doc.version, correlationId: `${MARKER}:CURRENCY`, transaction }));

    const integrity = (await models.sequelize.query(`SELECT
      (SELECT count(*)::int FROM journal_entries WHERE status IN ('posted','reversed') AND total_debit<>total_credit) AS unbalanced,
      (SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines,
      (SELECT count(*)::int FROM cash_transactions c LEFT JOIN journal_entries j ON j.id=c.journal_entry_id WHERE c.status='posted' AND c.journal_entry_id IS NOT NULL AND j.id IS NULL) AS unlinked_treasury,
      (SELECT count(*)::int FROM assets WHERE barcode IS NULL OR btrim(barcode)='') AS blank_barcodes`, { type: QueryTypes.SELECT }))[0];
    assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, unlinked_treasury: 0, blank_barcodes: 0 });
    assert.equal(liveHttpRequests, 2);
    console.log(JSON.stringify({ result: "PASS", database: clone, baseline: acceptanceBaseline, provider: "GOLDAPI_IO", currency, liveHttpRequests, testConnectionDuringSettings: true, refresh: "PASS", quote: { id: refreshed.id, unit: refreshed.unit, status: refreshed.status, freshness: "FRESH", bid: refreshed.bid, spot: refreshed.spot, ask: refreshed.ask, karat18: refreshed.karat18Rate, karat21: refreshed.karat21Rate, karat22: refreshed.karat22Rate, karat24: refreshed.karat24Rate }, karatSemantics: "PASS", noDoublePurity: true, policy: { baseQuoteType: "BID", adjustmentType: "NONE", adjustmentValue: "0", production: false }, liveCgp: "PASS", postedSnapshot: "PASS", snapshotImmutable: "PASS", newerQuoteMutatesOldPosted: false, inventory: "PASS", accounting: "PASS", goldCenter: "PASS", crm: "PASS", settlement: "PASS", reversal: "PASS", staleFailClosed: "PASS", missingBidSubstitutesSpot: false, currencyMismatchFailClosed: "PASS", integrity }));
  } finally {
    axios.get = originalAxiosGet;
    try { if (models?.sequelize && !models.sequelize.closed) await models.sequelize.close(); } catch { /* cleanup only */ }
    try { dropClone(sourceConfig, clone); } finally { fs.rmSync(dumpDir, { recursive: true, force: true }); }
  }
}

main().catch((error) => { console.error(JSON.stringify({ name: error.name, message: error.message, code: error.code, errorCode: error.errorCode, stack: error.stack }, null, 2)); process.exitCode = 1; });
