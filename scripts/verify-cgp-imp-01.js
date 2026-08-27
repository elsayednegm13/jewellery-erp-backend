"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const Decimal = require("decimal.js");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const requestedDatabase = String(process.env.CGP_IMP01_DB || ACCEPTANCE_DATABASE).trim();
const CLONE_DATABASE = /^darfus_erp_cgp_imp10_regression_[a-z0-9_]+$/;
if (requestedDatabase !== ACCEPTANCE_DATABASE && !CLONE_DATABASE.test(requestedDatabase)) {
  throw new Error("CGP_IMP01_DATABASE_OVERRIDE_REJECTED");
}
const expectedDatabase = requestedDatabase;
const AUTHORIZED_IMP10_REVERSED_DOCUMENT_ID = "CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:2883073b-8ce1-4676-a948-938c956c04fb";
delete process.env.DATABASE_URL;
process.env.DB_NAME = expectedDatabase;

const models = require("../src/models");
const snapshotService = require("../src/services/cgp-pricing-snapshot.service");
const draftService = require("../src/services/gold-purchase-draft.service");
const governanceService = require("../src/services/gold-purchase-governance.service");

async function one(sql, replacements = {}, transaction) {
  const [rows] = await models.sequelize.query(sql, { replacements, transaction });
  return rows[0];
}

async function main() {
  await models.sequelize.authenticate();
  assert.equal((await one("SELECT current_database() AS db")).db, expectedDatabase, "STOP — acceptance DB required");

  const baseline = await one(`
    SELECT
      (SELECT count(*)::int FROM customer_gold_purchase_documents) AS documents,
      (SELECT count(*)::int FROM customer_gold_purchase_items) AS items,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM cgp_pricing_snapshots) AS snapshots,
      (SELECT count(*)::int FROM journal_entries) AS journals,
      (SELECT count(*)::int FROM customer_gold_purchase_documents WHERE business_status='POSTED') AS posted
  `);
  // Later approved phases intentionally retain immutable snapshots and posted
  // CGP evidence.  This regression proves IMP-01 has no *new* effect rather
  // than incorrectly requiring a pre-IMP-03 empty database.

  const mapped = await models.sequelize.query(`
    SELECT id, status, business_status AS "businessStatus", governance_status AS "governanceStatus"
    FROM customer_gold_purchase_documents
    ORDER BY status, id
  `, { type: models.sequelize.QueryTypes.SELECT });
  for (const row of mapped) {
    // POSTED is an IMP-03 immutable business fact; its legacy compatibility
    // status remains the last pre-posting projection and is not a second
    // state authority.
    if (row.businessStatus !== "POSTED" && !(row.businessStatus === "REVERSED" && row.id === AUTHORIZED_IMP10_REVERSED_DOCUMENT_ID)) {
      assert.deepEqual({ businessStatus: row.businessStatus, governanceStatus: row.governanceStatus }, draftService.cgpLifecycleForLegacyStatus(row.status));
    }
  }
  console.log("CGP_M1_BACKFILL_EXACT: PASS");

  const transaction = await models.sequelize.transaction();
  try {
    const scope = await one(`
      SELECT c.id AS "companyId", b.id AS "branchId", cu.id AS "customerId", c.currency
      FROM companies c
      JOIN branches b ON b.company_id=c.id AND b.is_active=true
      JOIN customers cu ON cu.company_id=c.id AND cu.status='active'
      LIMIT 1
    `, {}, transaction);
    const user = await models.User.findOne({ where: { email: "admin@admin.com", isActive: true }, transaction });
    assert.ok(scope && user, "acceptance CGP scope and authorized user required");
    const context = { companyId: scope.companyId, branchId: scope.branchId, user };
    const body = {
      branchId: scope.branchId,
      customerId: scope.customerId,
      transactionDate: "2026-08-09",
      currency: scope.currency,
      items: [{ goldType: "CGP IMP 01 transaction-only", karat: "21", fineness: "0.875000", grossWeight: "10.000000", stoneWeight: "0.000000", proposedRate: "50.0000" }],
    };
    const created = await draftService.create("cgp", context, body, transaction);
    assert.deepEqual({ businessStatus: created.businessStatus, governanceStatus: created.governanceStatus }, { businessStatus: "DRAFT", governanceStatus: "NONE" });
    const validated = await draftService.validate("cgp", context, created.id, created.version, transaction);
    assert.deepEqual({ businessStatus: validated.businessStatus, governanceStatus: validated.governanceStatus }, { businessStatus: "VALIDATED", governanceStatus: "NONE" });
    const submitted = await governanceService.submit("cgp", context, validated.id, { version: validated.version }, transaction);
    assert.deepEqual({ businessStatus: submitted.document.businessStatus, governanceStatus: submitted.document.governanceStatus }, { businessStatus: "VALIDATED", governanceStatus: "PENDING" });
    const approved = await governanceService.review("cgp", context, submitted.document.id, { version: submitted.document.version, approvalVersion: submitted.approvalRequest.version, reason: "CGP IMP 01 transaction-only approval" }, "approved", transaction);
    assert.deepEqual({ businessStatus: approved.document.businessStatus, governanceStatus: approved.document.governanceStatus }, { businessStatus: "VALIDATED", governanceStatus: "APPROVED" });

    const rejectedCreated = await draftService.create("cgp", context, body, transaction);
    const rejectedValidated = await draftService.validate("cgp", context, rejectedCreated.id, rejectedCreated.version, transaction);
    const rejectedSubmitted = await governanceService.submit("cgp", context, rejectedValidated.id, { version: rejectedValidated.version }, transaction);
    const rejected = await governanceService.review("cgp", context, rejectedSubmitted.document.id, { version: rejectedSubmitted.document.version, approvalVersion: rejectedSubmitted.approvalRequest.version, reason: "CGP IMP 01 transaction-only rejection" }, "rejected", transaction);
    assert.deepEqual({ businessStatus: rejected.document.businessStatus, governanceStatus: rejected.document.governanceStatus }, { businessStatus: "VALIDATED", governanceStatus: "REJECTED" });
    console.log("CGP_DRAFT_VALIDATE_GOVERNANCE_COMPATIBILITY: PASS");

    const document = await models.CustomerGoldPurchaseDocument.findOne({
      where: { companyId: scope.companyId, businessStatus: "VALIDATED" },
      include: [{ model: models.CustomerGoldPurchaseItem, as: "items", required: true }],
      order: [["createdAt", "DESC"]], transaction, lock: transaction.LOCK.UPDATE,
    });
    assert.ok(document && document.items.length, "acceptance CGP document and item required");
    const price = await models.GoldPrice.findOne({
      where: { companyId: document.companyId, currency: document.currency, karat: document.items[0].karat, approvalStatus: "APPROVED" },
      order: [["approvedAt", "DESC"], ["id", "DESC"]], transaction,
    });
    assert.ok(price, "IMP-01 compatibility proof requires existing approved price provenance");
    const snapshot = await snapshotService.createSnapshot({
      transaction,
      document,
      item: document.items[0],
      pricing: {
        priceSource: "GOLD_CENTER_APPROVED_PRICE",
        priceVersion: `GOLD_PRICE:${price.id}:APPROVAL:${price.approvalVersion}`,
        priceTimestamp: price.approvedAt,
        approvedKaratRate: price.pricePerGram,
        approvedPriceId: price.id,
        approvedPriceStatus: price.approvalStatus,
        approvedPriceAt: price.approvedAt,
        approvedPriceBy: price.approvedBy,
        approvedPriceSource: price.source,
      },
      createdBy: document.createdBy,
    });
    assert.equal(snapshot.rateBasis, "KARAT_SPECIFIC");
    assert.ok(new Decimal(snapshot.lineGoldValue).eq(new Decimal(snapshot.netWeight).mul(snapshot.approvedKaratRate)), "stored monetary evidence must equal net weight times the karat-specific rate");
    await assert.rejects(() => snapshot.update({ priceSource: "changed" }, { transaction }), /immutable/);
    await assert.rejects(() => snapshot.destroy({ transaction }), /immutable/);
    console.log("CGP_PRICING_SNAPSHOT_TRANSACTION_AND_IMMUTABILITY: PASS");
  } finally {
    await transaction.rollback();
  }

  const final = await one(`
    SELECT
      (SELECT count(*)::int FROM customer_gold_purchase_documents) AS documents,
      (SELECT count(*)::int FROM customer_gold_purchase_items) AS items,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM cgp_pricing_snapshots) AS snapshots,
      (SELECT count(*)::int FROM journal_entries) AS journals
  `);
  assert.equal(final.documents, baseline.documents);
  assert.equal(final.items, baseline.items);
  assert.equal(final.assets, baseline.assets);
  assert.equal(final.snapshots, baseline.snapshots);
  assert.equal(final.journals, baseline.journals);
  console.log("CGP_IMP_01_ACCEPTANCE_TRANSACTION_CLEANUP: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
