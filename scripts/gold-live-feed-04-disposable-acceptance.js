"use strict";

// Full live-pricing proof on an exact disposable clone of Acceptance.  This
// script never targets Persistent or the original Acceptance database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { QueryTypes, Op } = require("sequelize");
const Decimal = require("decimal.js");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PREFIX = "darfus_erp_gold_live_feed_04_posting_";
const MARKER = "GOLD_LIVE_FEED_04_ACCEPTANCE";
const PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin";

function assertTarget(db) {
  assert.match(db, new RegExp(`^${PREFIX}`));
  assert.notEqual(db, ACCEPTANCE);
  assert.notEqual(db, PERSISTENT);
}
function pgEnv(config, db) { return { ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.username, PGPASSWORD: config.password, PGDATABASE: db, PGSSLMODE: config.ssl ? "require" : "disable" }; }
function configFor(db) { const config = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: db }); assert.equal(config.database, db); return config; }
function runBin(name, args, env) { execFileSync(path.join(PG_BIN, name), args, { env, stdio: "pipe" }); }
function createClone(sourceConfig, clone, dumpDir) {
  runBin("pg_dump.exe", ["--format=custom", "--no-owner", "--no-privileges", `--file=${path.join(dumpDir, "acceptance.dump")}`, ACCEPTANCE], pgEnv(sourceConfig, ACCEPTANCE));
  runBin("createdb.exe", [clone], pgEnv(sourceConfig, "postgres"));
  runBin("pg_restore.exe", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, path.join(dumpDir, "acceptance.dump")], pgEnv(sourceConfig, clone));
}
function dropClone(config, clone) { assertTarget(clone); runBin("dropdb.exe", [clone], pgEnv(config, "postgres")); }

async function main() {
  const sourceConfig = configFor(ACCEPTANCE);
  const clone = `${PREFIX}${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  assertTarget(clone);
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gold-live-feed-04-"));
  createClone(sourceConfig, clone, dumpDir);
  let models = null;
  try {
    process.env.NODE_ENV = "development"; delete process.env.DATABASE_URL; process.env.DB_NAME = clone;
    models = require("../src/models");
    const permissions = require("../src/services/permission.service");
    const draft = require("../src/services/gold-purchase-draft.service");
    const posting = require("../src/services/cgp-posting.service");
    const feed = require("../src/services/gold-market-feed.service");
    const policy = require("../src/services/gold-pricing-policy.service");
    const settingsService = require("../src/services/gold-market-settings.service");
    const inventory = require("../src/services/cgp-inventory-consumer.service");
    const accounting = require("../src/services/cgp-accounting-consumer.service");
    const gold = require("../src/services/cgp-gold-center-consumer.service");
    const crm = require("../src/services/cgp-crm-consumer.service");
    const settlement = require("../src/services/financial-settlement.service");
    const approvalPolicy = require("../src/services/financial-approval-policy.service");
    const hold = require("../src/services/cgp-reversal-hold.service");
    const holdConsumer = require("../src/services/cgp-reversal-hold-inventory-consumer.service");
    const reversal = require("../src/services/cgp-reversal-compensation.service");
    const contextFor = (x) => ({ companyId: x.company.id, branchId: x.branch.id, user: x.user });
    const current = (await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0].db;
    assert.equal(current, clone);
    assert.equal(Number((await models.sequelize.query('SELECT count(*)::int AS c FROM "SequelizeMeta"', { type: QueryTypes.SELECT }))[0].c), 80);

    let chosen = null;
    for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
      const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" }, order: [["id", "ASC"]] });
      const admin = (await models.User.findAll({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] })).find((u) => u.accountType === "super_admin" || ["admin", "owner"].includes(u.role));
      const companyUsers = await models.User.findAll({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] });
      let sales = null;
      for (const candidate of companyUsers) {
        if ((candidate.accountType === "super_admin") || ["admin", "owner"].includes(candidate.role)) continue;
        if (!(await permissions.userHasPermission(candidate.toJSON(), posting.POST_PERMISSION))) { sales = candidate; break; }
      }
      for (const branch of await models.Branch.findAll({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] })) {
        const roles = await models.SystemAccountRole.findAll({ where: { companyId: company.id, branchId: branch.id, roleCode: ["INVENTORY_ASSET", "CUSTOMER_CREDITOR"] } });
        if (customer && admin && sales && new Set(roles.map((role) => role.roleCode)).size === 2) { chosen = { company: company.toJSON(), branch: branch.toJSON(), customer: customer.toJSON(), user: admin.toJSON(), unauthorized: sales.toJSON() }; break; }
      }
      if (chosen) break;
    }
    if (!chosen) throw new Error("GOLD_LIVE_FEED_04_CONTEXT_NOT_FOUND");
    const ctx = contextFor(chosen);
    assert.equal(await permissions.userHasPermission(chosen.user, posting.POST_PERMISSION), true);
    assert.equal(await permissions.userHasPermission(chosen.unauthorized, posting.POST_PERMISSION), false);

    // Backward-compatibility proof: with no LIVE_PROVIDER settings, Posting
    // still resolves the existing approved Gold Center price path.
    const manualPosted = await models.sequelize.transaction(async (transaction) => {
      const document = await draft.create("cgp", ctx, { branchId: chosen.branch.id, customerId: chosen.customer.id, transactionDate: "2026-08-10", currency: chosen.company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:MANUAL`, items: [{ goldType: `${MARKER}:MANUAL`, karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "1.500000", stoneWeight: "0.000000", proposedRate: "999.0000" }] }, transaction);
      const validated = await draft.validate("cgp", ctx, document.id, document.version, transaction);
      return posting.post({ context: ctx, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:MANUAL`, transaction });
    });
    const manualSnapshot = await models.CgpPricingSnapshot.findOne({ where: { cgpDocumentId: manualPosted.document.id } });
    assert.equal(manualSnapshot.pricingMode, "MANUAL_APPROVED");
    assert.equal(manualSnapshot.approvedPriceStatus, "APPROVED");

    const now = new Date();
    await models.sequelize.transaction(async (transaction) => {
      await models.GoldMarketSetting.create({ id: `GMSET:${chosen.company.id}:${MARKER}`, companyId: chosen.company.id, pricingMode: "LIVE_PROVIDER", activeProvider: "GOLDAPI_IO", marketCurrency: chosen.company.currency || "AED", refreshIntervalSeconds: 30, staleAfterSeconds: 120, enabled: true, version: 1 }, { transaction });
      await policy.createPolicyVersion({ context: ctx, input: { pricingMode: "LIVE_PROVIDER", scopeType: "DEFAULT", baseQuoteType: "BID", adjustmentType: "FIXED_PER_GRAM", adjustmentValue: "-1.0000", effectiveFrom: new Date(now.getTime() - 1000) }, activate: true, reason: MARKER, transaction });
      await feed.ingestNormalizedQuote({ id: `GMQ:${MARKER}:A`, companyId: chosen.company.id, provider: "GOLDAPI_IO", metal: "XAU", currency: chosen.company.currency || "AED", unit: "PER_GRAM", quoteTimestamp: new Date(now.getTime() - 2000), receivedAt: new Date(now.getTime() - 1000), bid: "300.12345678", spot: "301.12345678", ask: "302.12345678", karat18Rate: "225.84259259", karat21Rate: "263.48302468", karat22Rate: "276.03016272", karat24Rate: "301.12345678", karatRateSource: "PROVIDER_DIRECT", status: "VALID", quality: "GLF04A" }, { transaction });
    });

    // Failure must happen before any Posting fact is durable.
    const failedAssetCount = await models.Asset.count();
    const failedJournalCount = await models.JournalEntry.count();
    const failedGoldEventCount = await models.GoldCoreEvent.count();
    let failedDocument;
    await models.sequelize.transaction(async (transaction) => {
      failedDocument = await draft.create("cgp", ctx, { branchId: chosen.branch.id, customerId: chosen.customer.id, transactionDate: "2026-08-10", currency: chosen.company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:STALE`, items: [{ goldType: `${MARKER}:STALE`, karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "2.000000", stoneWeight: "0.000000", proposedRate: "999.0000" }] }, transaction);
      failedDocument = await draft.validate("cgp", ctx, failedDocument.id, failedDocument.version, transaction);
    });
    await models.GoldMarketSetting.update({ refreshIntervalSeconds: 1, staleAfterSeconds: 1 }, { where: { companyId: chosen.company.id } });
    await assert.rejects(async () => models.sequelize.transaction((transaction) => posting.post({ context: ctx, id: failedDocument.id, expectedVersion: failedDocument.version, correlationId: `${MARKER}:STALE`, transaction })), (error) => ["GOLD_MARKET_QUOTE_STALE", "GOLD_MARKET_QUOTE_NOT_FOUND"].includes(error.errorCode));
    await models.GoldMarketSetting.update({ refreshIntervalSeconds: 30, staleAfterSeconds: 120 }, { where: { companyId: chosen.company.id } });
    const failedReload = await models.CustomerGoldPurchaseDocument.findByPk(failedDocument.id);
    assert.equal(failedReload.businessStatus, "VALIDATED");
    assert.equal(await models.CgpPricingSnapshot.count({ where: { cgpDocumentId: failedDocument.id } }), 0);
    assert.equal(await models.OutboxEvent.count({ where: { aggregateId: failedDocument.id } }), 0);
    assert.equal(await models.Asset.count(), failedAssetCount);
    assert.equal(await models.JournalEntry.count(), failedJournalCount);
    assert.equal(await models.GoldCoreEvent.count(), failedGoldEventCount);

    const made = await models.sequelize.transaction(async (transaction) => {
      const document = await draft.create("cgp", ctx, { branchId: chosen.branch.id, customerId: chosen.customer.id, transactionDate: "2026-08-10", currency: chosen.company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:PRIMARY`, items: [{ goldType: `${MARKER}:21K`, karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "8.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }] }, transaction);
      const validated = await draft.validate("cgp", ctx, document.id, document.version, transaction);
      return posting.post({ context: ctx, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:PRIMARY`, transaction });
    });
    assert.equal(made.document.businessStatus, "POSTED");
    const snapshot = await models.CgpPricingSnapshot.findOne({ where: { cgpDocumentId: made.document.id } });
    assert.equal(snapshot.pricingMode, "LIVE_PROVIDER");
    assert.equal(snapshot.provider, "GOLDAPI_IO");
    assert.ok(snapshot.marketQuoteId);
    assert.ok(snapshot.policyId);
    assert.equal(snapshot.baseQuoteType, "BID");
    assert.equal(snapshot.quoteUnit, "PER_GRAM");
    assert.equal(snapshot.finalEffectiveRate, snapshot.approvedKaratRate);
    assert.notEqual(String(snapshot.approvedKaratRate), "999.0000", "client proposedRate must never be live pricing authority");
    assert.equal(new Decimal(snapshot.lineGoldValue).toFixed(4), new Decimal(snapshot.netWeight).mul(snapshot.approvedKaratRate).toFixed(4));
    const originalSnapshot = snapshot.toJSON();

    const postedEventId = made.outboxEvent.eventId;
    await assert.rejects(
      () => models.sequelize.transaction((transaction) => posting.post({ context: ctx, id: made.document.id, expectedVersion: made.document.version, correlationId: `${MARKER}:PRIMARY-REPLAY`, transaction })),
      (error) => error.statusCode === 409 || error.errorCode === "STATE_CONFLICT"
    );
    assert.equal(await models.OutboxEvent.count({ where: { aggregateId: made.document.id, eventType: posting.POSTED_EVENT_TYPE } }), 1);
    await inventory.consumePostedEvent({ eventId: postedEventId });
    await accounting.consumePostedEvent({ eventId: postedEventId });
    await gold.consumePostedEvent({ eventId: postedEventId });
    await crm.consumePostedEvent({ eventId: postedEventId });
    assert.equal((await models.sequelize.query("SELECT count(*)::int AS c FROM assets a JOIN asset_origins o ON o.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=o.cgp_item_id WHERE i.document_id=:id", { replacements: { id: made.document.id }, type: QueryTypes.SELECT }))[0].c, 1);

    const raceValidated = await models.sequelize.transaction(async (transaction) => {
      const document = await draft.create("cgp", ctx, { branchId: chosen.branch.id, customerId: chosen.customer.id, transactionDate: "2026-08-10", currency: chosen.company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:RACE`, items: [{ goldType: `${MARKER}:RACE`, karat: "22", purityFactor: "0.916000", fineness: "0.916000", grossWeight: "2.000000", stoneWeight: "0.000000", proposedRate: "999.0000" }] }, transaction);
      return draft.validate("cgp", ctx, document.id, document.version, transaction);
    });
    const raceResults = await Promise.all([
      models.sequelize.transaction((transaction) => posting.post({ context: ctx, id: raceValidated.id, expectedVersion: raceValidated.version, correlationId: `${MARKER}:RACE`, transaction })),
      models.sequelize.transaction((transaction) => posting.post({ context: ctx, id: raceValidated.id, expectedVersion: raceValidated.version, correlationId: `${MARKER}:RACE`, transaction })),
    ].map((promise) => promise.then(() => "fulfilled").catch((error) => ({ statusCode: error.statusCode, errorCode: error.errorCode }))));
    assert.equal(raceResults.filter((result) => result === "fulfilled").length, 1);
    assert.equal(raceResults.filter((result) => result && result.statusCode === 409).length, 1);
    assert.equal(await models.OutboxEvent.count({ where: { aggregateId: raceValidated.id, eventType: posting.POSTED_EVENT_TYPE } }), 1);

    // Quote and policy changes after Posting cannot mutate the original snapshot.
    await models.sequelize.transaction(async (transaction) => {
      await feed.ingestNormalizedQuote({ id: `GMQ:${MARKER}:B`, companyId: chosen.company.id, provider: "GOLDAPI_IO", metal: "XAU", currency: chosen.company.currency || "AED", unit: "PER_GRAM", quoteTimestamp: new Date(), receivedAt: new Date(), bid: "310.12345678", spot: "311.12345678", ask: "312.12345678", karat18Rate: "233.34259259", karat21Rate: "271.35802468", karat22Rate: "285.03016272", karat24Rate: "311.12345678", karatRateSource: "PROVIDER_DIRECT", status: "VALID", quality: "GLF04B" }, { transaction });
      await policy.createPolicyVersion({ context: ctx, supersedesPolicyId: originalSnapshot.policyId, input: { pricingMode: "LIVE_PROVIDER", scopeType: "DEFAULT", baseQuoteType: "BID", adjustmentType: "FIXED_PER_GRAM", adjustmentValue: "2.0000", effectiveFrom: new Date() }, activate: true, reason: `${MARKER}:V2`, transaction });
    });
    const unchanged = await models.CgpPricingSnapshot.findByPk(originalSnapshot.id);
    assert.equal(unchanged.marketQuoteId, originalSnapshot.marketQuoteId);
    assert.equal(unchanged.policyId, originalSnapshot.policyId);
    assert.equal(unchanged.finalEffectiveRate, originalSnapshot.finalEffectiveRate);

    const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: made.document.id, sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED" } });
    assert.ok(liability);
    const settlementPolicy = await models.sequelize.transaction((transaction) => approvalPolicy.createFinancialApprovalPolicy({ models, context: { companyId: chosen.company.id, actorId: chosen.user.id }, input: { operationType: settlement.OPERATION_TYPE, branchId: chosen.branch.id, currency: liability.currency, paymentMethod: "CASH", minAmount: "1.0000", maxAmount: "1.0000", approvalRequired: false, priority: 999, effectiveFrom: new Date(Date.now() - 60000), effectiveTo: new Date(Date.now() + 600000), description: `${MARKER}:SETTLEMENT`, metadata: { acceptanceOnly: true, marker: MARKER } }, transaction }));
    try { await settlement.executeCustomerPayoutSettlement({ context: { companyId: chosen.company.id, branchId: chosen.branch.id, actorId: chosen.user.id }, input: { liabilityId: liability.id, idempotencyKey: `${MARKER}:SETTLEMENT`, legs: [{ method: "CASH", amount: "1.0000" }], testMarker: MARKER } }); } finally { await models.sequelize.transaction((transaction) => approvalPolicy.deactivateFinancialApprovalPolicy({ models, context: { companyId: chosen.company.id, actorId: chosen.user.id }, policyId: settlementPolicy.id, transaction })); }

    const holdResult = await models.sequelize.transaction((transaction) => hold.requestHold({ context: ctx, cgpDocumentId: made.document.id, reason: `${MARKER}:REVERSAL`, idempotencyKey: `${MARKER}:HOLD`, correlationId: `${MARKER}:HOLD`, transaction }));
    await holdConsumer.consumeHoldEvent({ eventId: holdResult.holdEventId });
    const request = await models.CgpReversalRequest.findByPk(holdResult.request.id);
    const begun = await models.sequelize.transaction((transaction) => reversal.beginCompensation({ requestId: request.id, actorId: chosen.user.id, context: ctx, transaction }));
    await reversal.compensateAccounting({ eventId: begun.eventId, context: ctx });
    await reversal.compensateGold({ eventId: begun.eventId, context: ctx });
    await reversal.finalize({ requestId: request.id, actorId: chosen.user.id, context: ctx });
    const finalDoc = await models.CustomerGoldPurchaseDocument.findByPk(made.document.id);
    assert.equal(finalDoc.businessStatus, "REVERSED");
    const finalSnap = await models.CgpPricingSnapshot.findByPk(originalSnapshot.id);
    assert.equal(finalSnap.finalEffectiveRate, originalSnapshot.finalEffectiveRate);
    console.log(JSON.stringify({ database: clone, mode: "LIVE_PROVIDER", posted: 1, snapshot: originalSnapshot.id, quoteA: originalSnapshot.marketQuoteId, policyV1: originalSnapshot.policyId, failureZeroSideEffects: true, inventory: "PASS", accounting: "PASS", goldCenter: "PASS", crm: "PASS", settlement: "PASS", reversal: "PASS" }));
  } finally {
    try { if (models?.sequelize && !models.sequelize.closed) await models.sequelize.close(); } catch { /* cleanup only */ }
    try { dropClone(sourceConfig, clone); } finally { fs.rmSync(dumpDir, { recursive: true, force: true }); }
  }
}

main().catch((error) => { console.error(JSON.stringify({ name: error.name, message: error.message, code: error.code, parent: error.parent?.message, detail: error.parent?.detail, constraint: error.parent?.constraint, stack: error.stack }, null, 2)); process.exitCode = 1; });
