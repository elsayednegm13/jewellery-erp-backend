"use strict";

// Disposable final CGP acceptance proof.  It owns only a clone whose name is
// generated below, never starts the global dispatcher, and drops that exact
// clone in finally.  Product services are invoked unchanged.
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
const PREFIX = "darfus_erp_cgp_e2e_final_";
const MARKER = "CGP_E2E_FINAL_ACCEPTANCE";
const execute = process.argv.includes("--execute");

function quoteIdentifier(value) {
  assert.match(value, /^[a-z0-9_]+$/, "unsafe database identifier");
  return `"${value}"`;
}

function configFor(database) {
  const env = { ...process.env, NODE_ENV: "development", DATABASE_URL: "", DB_NAME: database };
  const config = resolveDatabaseEnv(env);
  assert.equal(config.database, database, "database configuration must remain explicit");
  return config;
}

function clientFor(config) {
  return new Client({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

function postgresEnvironment(config, database) {
  return {
    ...process.env,
    PGHOST: config.host,
    PGPORT: String(config.port),
    PGUSER: config.username,
    PGPASSWORD: config.password,
    PGDATABASE: database,
    PGSSLMODE: config.ssl ? "require" : "disable",
  };
}

function logicalClone(sourceConfig, clone, dumpDirectory) {
  const dumpPath = path.join(dumpDirectory, "acceptance.clone.dump");
  const pgDump = "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe";
  const pgRestore = "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe";
  // pg_dump is source read-only.  Its custom dump is restored only into the
  // exact disposable database already created by this run.
  execFileSync(pgDump, ["--format=custom", "--no-owner", "--no-privileges", `--file=${dumpPath}`, ACCEPTANCE], { env: postgresEnvironment(sourceConfig, ACCEPTANCE), stdio: "pipe" });
  execFileSync(pgRestore, ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", clone, dumpPath], { env: postgresEnvironment(sourceConfig, clone), stdio: "pipe" });
}

async function verifyDatabase(config, expected, { migrations = null } = {}) {
  const client = clientFor(config);
  try {
    await client.connect();
    const current = await client.query("SELECT current_database() AS db");
    assert.equal(current.rows[0]?.db, expected, "database target mismatch");
    if (migrations !== null) {
      const count = await client.query('SELECT count(*)::int AS count FROM "SequelizeMeta"');
      assert.equal(Number(count.rows[0]?.count), migrations, "unexpected migration count");
    }
  } finally {
    await client.end().catch(() => {});
  }
}

function loadServices(clone) {
  delete process.env.DATABASE_URL;
  process.env.NODE_ENV = "development";
  process.env.DB_NAME = clone;
  const models = require("../src/models");
  return {
    models,
    draft: require("../src/services/gold-purchase-draft.service"),
    posting: require("../src/services/cgp-posting.service"),
    permissions: require("../src/services/permission.service"),
    inventory: require("../src/services/cgp-inventory-consumer.service"),
    accounting: require("../src/services/cgp-accounting-consumer.service"),
    gold: require("../src/services/cgp-gold-center-consumer.service"),
    availability: require("../src/services/cgp-availability-evaluator.service"),
    crmPurchase: require("../src/services/cgp-crm-consumer.service"),
    hold: require("../src/services/cgp-reversal-hold.service"),
    holdConsumer: require("../src/services/cgp-reversal-hold-inventory-consumer.service"),
    reversal: require("../src/services/cgp-reversal-compensation.service"),
    crmReversal: require("../src/services/cgp-reversal-crm-consumer.service"),
    settlement: require("../src/services/financial-settlement.service"),
    approvalPolicy: require("../src/services/financial-approval-policy.service"),
  };
}

async function runProof(clone) {
  const s = loadServices(clone);
  const { models } = s;
  const count = async (sql, replacements = {}) => Number((await models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }))[0]?.count || 0);
  const target = async () => {
    const row = (await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0];
    assert.equal(row?.db, clone, "E2E service execution must use its exact clone");
  };
  const context = async () => {
    for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
      const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true } });
      const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" } });
      const price = await models.GoldPrice.findOne({ where: { companyId: company.id, currency: company.currency || "AED", karat: 21, approvalStatus: "APPROVED", validFrom: { [Op.lte]: new Date() }, validUntil: { [Op.gt]: new Date() } } });
      if (!branch || !customer || !price || await models.BranchFinancialMapping.count({ where: { companyId: company.id, branchId: branch.id, isActive: true } }) < 11) continue;
      for (const user of await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] })) {
        const actor = user.toJSON();
        if (await s.permissions.userHasPermission(actor, s.posting.POST_PERMISSION) && await s.permissions.userHasPermission(actor, s.hold.REVERSE_PERMISSION)) {
          return { company: company.toJSON(), branch: branch.toJSON(), customer: customer.toJSON(), user: actor, price: price.toJSON() };
        }
      }
    }
    throw new Error("CGP_E2E_FINAL_CONTEXT_NOT_FOUND");
  };
  const c = (ctx) => ({ companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user });
  let result;
  try {
    await target();
    assert.equal(await count('SELECT count(*)::int count FROM "SequelizeMeta"'), 77);
    const ctx = await context();
    const made = await models.sequelize.transaction(async (transaction) => {
      const document = await s.draft.create("cgp", c(ctx), {
        branchId: ctx.branch.id,
        customerId: ctx.customer.id,
        transactionDate: "2026-08-10",
        currency: ctx.company.currency || "AED",
        exchangeRate: "1",
        notes: `${MARKER}:PRIMARY_MIXED`,
        items: [{ goldType: `${MARKER}:21K_ONE_PHYSICAL_PIECE`, karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "8.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }],
      }, transaction);
      assert.equal(document.businessStatus, "DRAFT");
      assert.equal(await models.Asset.count({ where: { metadata: { cgpDocumentId: document.id } }, transaction }), 0);
      assert.equal(await models.JournalEntry.count({ where: { sourceId: document.id }, transaction }), 0);
      const validated = await s.draft.validate("cgp", c(ctx), document.id, document.version, transaction);
      assert.equal(validated.businessStatus, "VALIDATED");
      assert.equal(await models.Asset.count({ where: { metadata: { cgpDocumentId: document.id } }, transaction }), 0);
      return s.posting.post({ context: c(ctx), id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:PRIMARY:POST`, transaction });
    });
    const documentId = made.document.id;
    const postedEventId = made.outboxEvent.eventId;
    assert.equal(made.document.businessStatus, "POSTED");
    assert.equal(made.outboxEvent.eventType, "CustomerGoldPurchasePostedEvent");
    assert.equal(await count("SELECT count(*)::int count FROM outbox_events WHERE event_id=:eventId AND event_type='CustomerGoldPurchasePostedEvent'", { eventId: postedEventId }), 1);
    const snap = await models.CgpPricingSnapshot.findOne({ where: { cgpDocumentId: documentId } });
    assert.ok(snap);
    assert.equal(new Decimal(snap.netWeight).toFixed(6), "7.900000");
    assert.equal(new Decimal(snap.pureGoldWeight).toFixed(6), "6.912500");
    assert.equal(new Decimal(snap.lineGoldValue).toFixed(4), new Decimal(snap.netWeight).mul(snap.approvedKaratRate).toFixed(4));

    await s.inventory.consumePostedEvent({ eventId: postedEventId });
    await s.accounting.consumePostedEvent({ eventId: postedEventId });
    await s.gold.consumePostedEvent({ eventId: postedEventId });
    await s.availability.evaluateAvailability({ eventId: postedEventId });
    await s.crmPurchase.consumePostedEvent({ eventId: postedEventId });
    const purchaseReplay = await s.crmPurchase.consumePostedEvent({ eventId: postedEventId });
    assert.equal(purchaseReplay.replayed, true);
    const assetRows = await models.sequelize.query(`SELECT a.id,a.barcode,a.rfid,a.operational_status AS status
      FROM assets a JOIN asset_origins o ON o.asset_id=a.id JOIN customer_gold_purchase_items i ON i.id=o.cgp_item_id
      WHERE i.document_id=:documentId`, { replacements: { documentId }, type: QueryTypes.SELECT });
    assert.equal(assetRows.length, 1);
    assert.equal(assetRows[0].status, "AVAILABLE");
    assert.ok(String(assetRows[0].barcode || "").trim());
    assert.equal(await count("SELECT count(*)::int count FROM customer_transaction_history WHERE source_event_id=:eventId", { eventId: postedEventId }), 1);
    assert.equal(await count("SELECT count(*)::int count FROM gold_core_events WHERE source_event_id=:eventId", { eventId: postedEventId }), 1);
    const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceDocumentId: documentId, sourceType: "CUSTOMER_GOLD_PURCHASE_POSTED" } });
    assert.ok(liability);
    const paidAmount = "2.0000";
    const policy = await models.sequelize.transaction((transaction) => s.approvalPolicy.createFinancialApprovalPolicy({
      models, context: { companyId: ctx.company.id, actorId: ctx.user.id },
      input: { operationType: s.settlement.OPERATION_TYPE, branchId: ctx.branch.id, currency: liability.currency, paymentMethod: "MIXED", minAmount: paidAmount, maxAmount: paidAmount, approvalRequired: false, priority: 999, effectiveFrom: new Date(Date.now() - 60_000), effectiveTo: new Date(Date.now() + 600_000), description: `${MARKER}:MIXED`, metadata: { acceptanceOnly: true, marker: MARKER } }, transaction,
    }));
    try {
      await s.settlement.executeCustomerPayoutSettlement({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, actorId: ctx.user.id }, input: { liabilityId: liability.id, idempotencyKey: `${MARKER}:MIXED_SETTLEMENT`, legs: [{ method: "CASH", amount: "1.0000" }, { method: "BANK_TRANSFER", amount: "1.0000", bankReference: `${MARKER}:BANK` }], testMarker: MARKER } });
    } finally {
      await models.sequelize.transaction((transaction) => s.approvalPolicy.deactivateFinancialApprovalPolicy({ models, context: { companyId: ctx.company.id, actorId: ctx.user.id }, policyId: policy.id, transaction }));
    }
    const paid = (await models.sequelize.query("SELECT COALESCE(sum(a.amount),0)::numeric AS paid FROM financial_settlement_allocations a JOIN financial_settlements s ON s.id=a.settlement_id WHERE a.customer_financial_liability_id=:id AND s.status='EXECUTED'", { replacements: { id: liability.id }, type: QueryTypes.SELECT }))[0].paid;
    assert.equal(new Decimal(paid).toFixed(4), paidAmount);
    const requestResult = await models.sequelize.transaction((transaction) => s.hold.requestHold({ context: c(ctx), cgpDocumentId: documentId, reason: `${MARKER}:reversal`, idempotencyKey: `${MARKER}:HOLD`, correlationId: `${MARKER}:HOLD`, transaction }));
    await s.holdConsumer.consumeHoldEvent({ eventId: requestResult.holdEventId });
    const request = await models.CgpReversalRequest.findByPk(requestResult.request.id);
    assert.equal(request.status, "HELD");
    assert.equal((await models.Asset.findByPk(assetRows[0].id)).operationalStatus, "REVERSAL_PENDING");
    const begun = await models.sequelize.transaction((transaction) => s.reversal.beginCompensation({ requestId: request.id, actorId: ctx.user.id, context: c(ctx), transaction }));
    await assert.rejects(() => s.reversal.compensateAccounting({ eventId: begun.eventId, context: c(ctx), failureInjector: () => { throw new Error("CGP_E2E_FORCED_ACCOUNTING_FAILURE"); } }), /CGP_E2E_FORCED_ACCOUNTING_FAILURE/);
    await assert.rejects(() => s.reversal.finalize({ requestId: request.id, actorId: ctx.user.id, context: c(ctx) }), /hard compensations are incomplete/);
    const accounting = await s.reversal.compensateAccounting({ eventId: begun.eventId, context: c(ctx) });
    assert.equal((await s.reversal.compensateAccounting({ eventId: begun.eventId, context: c(ctx) })).replayed, true);
    const gold = await s.reversal.compensateGold({ eventId: begun.eventId, context: c(ctx) });
    const final = await s.reversal.finalize({ requestId: request.id, actorId: ctx.user.id, context: c(ctx) });
    assert.equal((await s.reversal.finalize({ requestId: request.id, actorId: ctx.user.id, context: c(ctx) })).replayed, true);
    await assert.rejects(() => s.crmReversal.consumeReversedEvent({ eventId: final.finalEventId, failureInjector: () => { throw new Error("CGP_E2E_FORCED_CRM_FAILURE"); } }), /CGP_E2E_FORCED_CRM_FAILURE/);
    await s.crmReversal.consumeReversedEvent({ eventId: final.finalEventId });
    assert.equal((await s.crmReversal.consumeReversedEvent({ eventId: final.finalEventId })).replayed, true);

    const finalDoc = await models.CustomerGoldPurchaseDocument.findByPk(documentId);
    const finalRequest = await models.CgpReversalRequest.findByPk(request.id);
    const finalAsset = await models.Asset.findByPk(assetRows[0].id);
    assert.equal(finalDoc.businessStatus, "REVERSED"); assert.equal(finalRequest.status, "COMPLETED"); assert.equal(finalAsset.operationalStatus, "REVERSED");
    assert.equal(await count("SELECT count(*)::int count FROM outbox_events WHERE event_type='CustomerGoldPurchaseReversedEvent' AND payload->>'reversalRequestId'=:requestId", { requestId: request.id }), 1);
    assert.equal(await count("SELECT count(*)::int count FROM journal_entries WHERE source_type='CUSTOMER_GOLD_PURCHASE_REVERSAL_COMPENSATION' AND source_id=:requestId AND total_debit=total_credit", { requestId: request.id }), 1);
    assert.equal(await count("SELECT count(*)::int count FROM cash_transactions WHERE reference=:requestId", { requestId: request.id }), 0);
    assert.equal(await count("SELECT count(*)::int count FROM gold_core_events WHERE source_event_id=:eventId AND event_type='CUSTOMER_GOLD_ACQUISITION_REVERSED'", { eventId: begun.eventId }), 1);
    assert.equal(await count("SELECT count(*)::int count FROM customer_transaction_history WHERE source_event_id=:eventId", { eventId: final.finalEventId }), 1);
    const finalLiability = await models.CustomerFinancialLiability.findByPk(liability.id);
    const accountingComp = await models.CgpReversalCompensation.findOne({ where: { reversalRequestId: request.id, domain: "ACCOUNTING" } });
    assert.equal(new Decimal(finalLiability.outstandingAmount).toFixed(4), "0.0000");
    assert.equal(new Decimal(accountingComp.metadata.receivableAmount).toFixed(4), paidAmount);
    const integrity = (await models.sequelize.query(`SELECT
      (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS unbalanced,
      (SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS orphan_lines,
      (SELECT count(*)::int FROM cash_transactions c LEFT JOIN journal_entries j ON j.id=c.journal_entry_id WHERE c.journal_entry_id IS NOT NULL AND j.id IS NULL) AS unlinked_treasury,
      (SELECT count(*)::int FROM assets WHERE barcode IS NULL OR btrim(barcode)='') AS blank_barcodes`, { type: QueryTypes.SELECT }))[0];
    assert.deepEqual(integrity, { unbalanced: 0, orphan_lines: 0, unlinked_treasury: 0, blank_barcodes: 0 });
    result = { clone, document: finalDoc.draftNumber, documentId, postedEventId, finalEventId: final.finalEventId, reversalRequestId: request.id, asset: assetRows[0], originalAcquisitionAmount: new Decimal(made.document.totalPayableToCustomer).toFixed(4), paidAmount, outstandingCreditorBeforeReversal: new Decimal((await models.CustomerFinancialLiability.findByPk(liability.id, { paranoid: false })).settledAmount).toFixed(4), finalCreditorResidual: "0.0000", finalReceivable: paidAmount, accountingCompensationId: accounting.compensation.id, goldCompensationId: gold.compensation.id, integrity };
    return result;
  } finally {
    await models.sequelize.close().catch(() => {});
  }
}

async function main() {
  const sourceConfig = configFor(ACCEPTANCE);
  const persistentConfig = configFor(PERSISTENT);
  await verifyDatabase(sourceConfig, ACCEPTANCE, { migrations: 77 });
  await verifyDatabase(persistentConfig, PERSISTENT, { migrations: 61 });
  if (!execute) {
    console.log("CGP_E2E_FINAL_DRY_RUN: PASS");
    console.log("CGP_E2E_FINAL_EXECUTION_BLOCKED: use --execute");
    return;
  }
  const clone = `${PREFIX}${Date.now()}_${crypto.randomBytes(4).toString("hex")}`.toLowerCase();
  assert.match(clone, /^darfus_erp_cgp_e2e_final_[a-z0-9_]+$/);
  const admin = clientFor(configFor("postgres"));
  let created = false;
  let dumpDirectory = null;
  let cloneMethod = "TEMPLATE";
  try {
    await admin.connect();
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone]);
    assert.equal(existing.rowCount, 0, "E2E clone name already exists");
    try {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(clone)} WITH TEMPLATE ${quoteIdentifier(ACCEPTANCE)}`);
      created = true;
    } catch (error) {
      // A template clone correctly refuses to proceed while another user is
      // connected to the source.  We do not terminate that external session;
      // the controlled alternative is a read-only logical source copy.
      if (error?.code !== "55006") throw error;
      cloneMethod = "LOGICAL_READ_ONLY_SOURCE_COPY";
      await admin.query(`CREATE DATABASE ${quoteIdentifier(clone)}`);
      created = true;
      dumpDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "darfus-cgp-e2e-final-"));
      logicalClone(sourceConfig, clone, dumpDirectory);
    }
    await verifyDatabase(configFor(clone), clone, { migrations: 77 });
    const result = await runProof(clone);
    console.log(`CGP_E2E_FINAL_RESULT=${JSON.stringify({ ...result, cloneMethod })}`);
    console.log("CGP_E2E_FINAL_ACCEPTANCE: PASS");
  } finally {
    if (created) {
      assert.ok(clone.startsWith(PREFIX) && clone !== PERSISTENT && clone !== ACCEPTANCE, "REFUSE_DROP_DATABASE");
      await verifyDatabase(sourceConfig, ACCEPTANCE, { migrations: 77 });
      await verifyDatabase(persistentConfig, PERSISTENT, { migrations: 61 });
      const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone]);
      assert.equal(exists.rowCount, 1, "REFUSE_DROP_DATABASE");
      await admin.query(`DROP DATABASE ${quoteIdentifier(clone)}`);
      const gone = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [clone]);
      assert.equal(gone.rowCount, 0, "E2E clone cleanup failed");
      console.log("E2E_TEMP_DB_DROPPED: YES");
    }
    await admin.end().catch(() => {});
    if (dumpDirectory) fs.rmSync(dumpDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
