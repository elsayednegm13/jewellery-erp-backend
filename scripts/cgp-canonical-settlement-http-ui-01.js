"use strict";

// Clone-only acceptance proof for the canonical CGP settlement transport.
// The HTTP route is static-tested separately; this script proves the exact
// settlement authority and its financial/reversal behavior on a disposable DB.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Client } = require("pg");
const { Op, QueryTypes } = require("sequelize");
const Decimal = require("decimal.js");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });
const { resolveDatabaseEnv } = require("../src/config/database-env");
const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const PERSISTENT = "darfus_erp";
const PREFIX = "darfus_erp_cgp_settlement_";
const MARKER = "CGP_SETTLEMENT_HTTP_UI_01";
const EXECUTE = process.argv.includes("--execute");
function configFor(database) { const cfg = resolveDatabaseEnv({ ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: database }); assert.equal(cfg.database, database); return cfg; }
function clientFor(cfg, database = cfg.database) { return new Client({ host: cfg.host, port: cfg.port, user: cfg.username, password: cfg.password, database, ...(cfg.ssl ? { ssl: { rejectUnauthorized: false } } : {}) }); }
function qid(value) { assert.match(value, /^[a-z0-9_]+$/); return `"${value}"`; }
async function verifyDb(cfg, expected, migrations) { const c = clientFor(cfg); await c.connect(); try { assert.equal((await c.query("select current_database() db")).rows[0].db, expected); assert.equal(Number((await c.query('select count(*)::int n from "SequelizeMeta"')).rows[0].n), migrations); } finally { await c.end(); } }
async function main() {
  const sourceCfg = configFor(ACCEPTANCE); const persistentCfg = configFor(PERSISTENT);
  await verifyDb(sourceCfg, ACCEPTANCE, 80); await verifyDb(persistentCfg, PERSISTENT, 80);
  if (!EXECUTE) { console.log("CGP_SETTLEMENT_HTTP_UI_DRY_RUN: PASS"); return; }
  const clone = `${PREFIX}${Date.now()}_${crypto.randomBytes(4).toString("hex")}`.toLowerCase();
  const admin = clientFor(configFor("postgres"), "postgres"); let created = false;
  try {
    await admin.connect(); assert.equal((await admin.query("select 1 from pg_database where datname=$1", [clone])).rowCount, 0);
    await admin.query(`create database ${qid(clone)} with template ${qid(ACCEPTANCE)}`); created = true;
    await verifyDb(configFor(clone), clone, 80);
    process.env.DATABASE_URL = ""; process.env.DB_NAME = clone;
    const models = require("../src/models");
    const access = require("../src/bootstrap/accessControl");
    const perms = require("../src/services/permission.service");
    const draft = require("../src/services/gold-purchase-draft.service");
    const posting = require("../src/services/cgp-posting.service");
    const inventory = require("../src/services/cgp-inventory-consumer.service");
    const accounting = require("../src/services/cgp-accounting-consumer.service");
    const gold = require("../src/services/cgp-gold-center-consumer.service");
    const availability = require("../src/services/cgp-availability-evaluator.service");
    const settlement = require("../src/services/financial-settlement.service");
    const policy = require("../src/services/financial-approval-policy.service");
    const hold = require("../src/services/cgp-reversal-hold.service");
    const holdConsumer = require("../src/services/cgp-reversal-hold-inventory-consumer.service");
    const compensation = require("../src/services/cgp-reversal-compensation.service");
    const count = async (sql, replacements = {}) => Number((await models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }))[0]?.count || 0);
    const company = await models.Company.findOne(); const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true } }); const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" } }); const user = await models.User.findOne({ where: { companyId: company.id, role: "admin" } });
    assert.ok(company && branch && customer && user, "CGP_SETTLEMENT_CONTEXT_NOT_FOUND");
    await access.ensurePermissions(); await access.ensureRolesForCompany(company.id);
    const actor = user.toJSON(); const names = await perms.getUserPermissionNames(actor); assert.ok(names.includes("gold_purchase.cgp.settle"));
    await models.GoldPrice.create({ karat: 22, pricePerGram: "999.0000", currency: company.currency || "AED", companyId: company.id, source: "manual", approvalStatus: "APPROVED", approvedAt: new Date(), approvedBy: user.id, validFrom: new Date(Date.now() - 60000), validUntil: new Date(Date.now() + 600000), approvalVersion: 1 });
    const ctx = { companyId: company.id, branchId: branch.id, user: actor }; const c = { companyId: company.id, branchId: branch.id, user: actor, actorId: user.id };
    async function createPosted(label) { const made = await models.sequelize.transaction(async (t) => { const d = await draft.create("cgp", { ...ctx, user: actor }, { branchId: branch.id, customerId: customer.id, transactionDate: "2026-08-12", currency: company.currency || "AED", exchangeRate: "1", notes: `${MARKER}:${label}`, items: [{ goldType: `${MARKER}:${label}`, notes: `${MARKER}:${label}`, karat: "22", purityFactor: "0.916000", fineness: "0.916000", grossWeight: "8.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }] }, t); const v = await draft.validate("cgp", ctx, d.id, d.version, t); return posting.post({ context: c, id: v.id, expectedVersion: v.version, correlationId: `${MARKER}:${label}`, transaction: t }); }); const eventId = made.outboxEvent.eventId; await inventory.consumePostedEvent({ eventId }); await accounting.consumePostedEvent({ eventId }); await gold.consumePostedEvent({ eventId }); await availability.evaluateAvailability({ eventId }); return made.document; }
    async function withPolicy(liability, method, amount, fn) { const p = await models.sequelize.transaction((t) => policy.createFinancialApprovalPolicy({ models, context: { companyId: company.id, actorId: user.id }, input: { operationType: settlement.OPERATION_TYPE, branchId: branch.id, currency: liability.currency, paymentMethod: method, minAmount: amount, maxAmount: amount, approvalRequired: false, priority: 999, effectiveFrom: new Date(Date.now() - 60000), effectiveTo: new Date(Date.now() + 600000), description: `${MARKER}:${method}:${amount}`, metadata: { acceptanceOnly: true, marker: MARKER } }, transaction: t })); try { return await fn(); } finally { await models.sequelize.transaction((t) => policy.deactivateFinancialApprovalPolicy({ models, context: { companyId: company.id, actorId: user.id }, policyId: p.id, transaction: t })); } }
    async function pay(document, legs, label) { const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: document.id } }); const total = legs.reduce((s, x) => s.plus(x.amount), new Decimal(0)).toFixed(4); return withPolicy(liability, legs.length === 2 ? "MIXED" : legs[0].method, total, () => settlement.executeCustomerPayoutSettlement({ context: c, input: { liabilityId: liability.id, idempotencyKey: `${MARKER}:${label}`, legs, testMarker: MARKER } })); }
    const partial = await createPosted("PARTIAL"); const partialLiability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: partial.id } }); const assetsBefore = await count("select count(*)::int count from assets"); await pay(partial, [{ method: "CASH", amount: "1.0000" }], "PARTIAL"); const partialAfter = await models.CustomerFinancialLiability.findByPk(partialLiability.id); assert.equal(String(partialAfter.status), "PARTIALLY_SETTLED"); assert.equal(new Decimal(partialAfter.settledAmount).toFixed(4), "1.0000"); assert.equal(await count("select count(*)::int count from assets"), assetsBefore);
    const bank = await createPosted("BANK"); await assert.rejects(() => pay(bank, [{ method: "BANK_TRANSFER", amount: "1.0000" }], "BANK_MISSING_REF"), (e) => e.errorCode === "FINANCIAL_SETTLEMENT_BANK_REFERENCE_REQUIRED"); await pay(bank, [{ method: "BANK_TRANSFER", amount: "1.0000", bankReference: `${MARKER}:BANK` }], "BANK");
    const mixed = await createPosted("MIXED"); await pay(mixed, [{ method: "CASH", amount: "1.0000" }, { method: "BANK_TRANSFER", amount: "1.0000", bankReference: `${MARKER}:MIXED` }], "MIXED");
    const full = await createPosted("FULL"); const fullLiability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: full.id } }); const fullAmount = new Decimal(fullLiability.outstandingAmount).toFixed(4); const fullResult = await pay(full, [{ method: "CASH", amount: fullAmount }], "FULL"); assert.equal(fullResult.liabilityStatus, "SETTLED"); const replay = await withPolicy(fullLiability, "CASH", fullAmount, () => settlement.executeCustomerPayoutSettlement({ context: c, input: { liabilityId: fullLiability.id, idempotencyKey: `${MARKER}:FULL`, legs: [{ method: "CASH", amount: fullAmount }], testMarker: MARKER } })); assert.equal(replay.replayed, true); await assert.rejects(() => pay(full, [{ method: "CASH", amount: "0.0001" }], "OVERPAY"), (e) => e.errorCode === "CUSTOMER_FINANCIAL_LIABILITY_NOT_OPEN"); await assert.rejects(() => pay(full, [{ method: "CASH", amount: "0" }], "ZERO"), (e) => e.errorCode === "FINANCIAL_SETTLEMENT_AMOUNT_INVALID");
    const request = await models.sequelize.transaction((t) => hold.requestHold({ context: ctx, cgpDocumentId: full.id, reason: MARKER, idempotencyKey: `${MARKER}:HOLD`, correlationId: MARKER, transaction: t })); await holdConsumer.consumeHoldEvent({ eventId: request.holdEventId }); const reversalRequest = await models.CgpReversalRequest.findByPk(request.request.id); const started = await models.sequelize.transaction((t) => compensation.beginCompensation({ requestId: reversalRequest.id, actorId: user.id, context: c, transaction: t })); await compensation.compensateAccounting({ eventId: started.eventId, context: c }); await compensation.compensateGold({ eventId: started.eventId, context: c }); await compensation.finalize({ requestId: reversalRequest.id, actorId: user.id, context: c }); const finalDoc = await models.CustomerGoldPurchaseDocument.findByPk(full.id); assert.equal(finalDoc.businessStatus, "REVERSED");
    const integrity = (await models.sequelize.query("select (select count(*)::int from journal_entries where status='posted' and total_debit<>total_credit) unbalanced,(select count(*)::int from journal_lines l left join journal_entries j on j.id=l.journal_entry_id where j.id is null) orphan_lines,(select count(*)::int from cash_transactions x left join journal_entries j on j.id=x.journal_entry_id where x.journal_entry_id is not null and j.id is null) unlinked_treasury", { type: QueryTypes.SELECT }))[0]; assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, unlinked_treasury: 0 });
    console.log(JSON.stringify({ clone, partial: "PASS", bank: "PASS", mixed: "PASS", full: "PASS", idempotency: "PASS", invalid: "PASS", paidReversal: "PASS", assetsUnchangedDuringSettlement: "PASS", integrity })); console.log("CGP_SETTLEMENT_HTTP_UI_CLONE: PASS"); await models.sequelize.close();
  } finally { if (created) { await verifyDb(sourceCfg, ACCEPTANCE, 80); await verifyDb(persistentCfg, PERSISTENT, 80); await admin.query(`drop database ${qid(clone)} with (force)`); assert.equal((await admin.query("select 1 from pg_database where datname=$1", [clone])).rowCount, 0); console.log("CGP_SETTLEMENT_CLONE_DROPPED: YES"); } await admin.end(); }
}
main().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
