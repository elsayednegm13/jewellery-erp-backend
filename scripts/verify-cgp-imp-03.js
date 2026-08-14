"use strict";

const assert = require("node:assert/strict");
const path = require("path");
const Decimal = require("decimal.js");
const { Op } = require("sequelize");

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const ISOLATED_DATABASE = String(process.env.CGP_IMP10A_REGRESSION_DB || "").trim();
const ISOLATED_PREFIX = /^darfus_erp_cgp_imp10a_regression_[a-z0-9_]+$/;
if (ISOLATED_DATABASE && !ISOLATED_PREFIX.test(ISOLATED_DATABASE)) throw new Error("CGP_IMP03_ISOLATED_DATABASE_INVALID");
const TARGET_DATABASE = ISOLATED_DATABASE || ACCEPTANCE_DATABASE;
const MARKER = "ACCEPTANCE_TEST_CGP_IMP03";
const RUN_MARKER = `${MARKER}:${Date.now()}`;

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
// Test infrastructure must bind models and every verifier transaction to the
// same explicit acceptance target.  A disposable clone is accepted only by
// the narrowly anchored CGP-IMP-10A regression prefix.
delete process.env.DATABASE_URL;
process.env.DB_NAME = TARGET_DATABASE;
const models = require("../src/models");
const draftService = require("../src/services/gold-purchase-draft.service");
const governanceService = require("../src/services/gold-purchase-governance.service");
const postingService = require("../src/services/cgp-posting.service");
const priceApprovalService = require("../src/services/gold-price-approval.service");
const idempotencyService = require("../src/services/idempotency.service");
const permissionService = require("../src/services/permission.service");

function fixed(value, places) {
  return new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

async function requireAcceptanceTarget() {
  const [rows] = await models.sequelize.query("SELECT current_database() AS db");
  assert.equal(rows?.[0]?.db, TARGET_DATABASE, "CGP-IMP-03 verifier refused a non-acceptance/isolated-clone database");
}

async function countTable(name) {
  const [exists] = await models.sequelize.query("SELECT to_regclass(:name) AS table_name", { replacements: { name } });
  if (!exists?.[0]?.table_name) return null;
  const [rows] = await models.sequelize.query(`SELECT count(*)::int AS count FROM ${name}`);
  return Number(rows?.[0]?.count || 0);
}

async function forbiddenWriteBaseline() {
  const names = [
    "assets", "asset_events", "asset_movements", "asset_barcodes", "asset_rfids",
    "journals", "journal_lines", "cash_transactions", "treasury_transactions",
    "customer_gold_pools", "inventory_gold_pools", "integration_statuses",
  ];
  const result = {};
  for (const name of names) result[name] = await countTable(name);
  return result;
}

async function findPostingContext() {
  const companies = await models.Company.findAll({ order: [["id", "ASC"]] });
  for (const company of companies) {
    const branches = await models.Branch.findAll({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] });
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" }, order: [["id", "ASC"]] });
    if (!branches.length || !customer) continue;
    const users = await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] });
    for (const user of users) {
      if (
        await permissionService.userHasPermission(user.toJSON(), postingService.POST_PERMISSION)
        && await permissionService.userHasPermission(user.toJSON(), priceApprovalService.GOLD_PRICE_APPROVAL_PERMISSION)
      ) {
        return { company: company.toJSON(), branch: branches[0].toJSON(), customer: customer.toJSON(), user: user.toJSON() };
      }
    }
  }
  throw new Error("CGP_IMP03_ACCEPTANCE_POST_USER_OR_CONTEXT_NOT_FOUND");
}

async function ensureAcceptancePrice(context) {
  const now = new Date();
  const existing = await models.GoldPrice.findOne({
    where: {
      companyId: context.company.id,
      currency: context.company.currency || "AED",
      karat: 21,
      approvalStatus: "APPROVED",
      validFrom: { [Op.lte]: now },
      validUntil: { [Op.gt]: now },
    },
    order: [["approvedAt", "DESC"], ["id", "DESC"]],
  });
  if (existing) return existing;
  return createAndApprovePrice(context, "321.4321");
}

async function createAcceptancePriceChange(context) {
  return createAndApprovePrice(context, "432.1000");
}

async function createAndApprovePrice(context, pricePerGram) {
  await requireAcceptanceTarget();
  const transaction = await models.sequelize.transaction();
  try {
    const now = new Date();
    const price = await priceApprovalService.createPendingPrice({
      context: { companyId: context.company.id, branchId: context.branch.id, user: context.user },
      input: {
        karat: 21,
        pricePerGram,
        currency: context.company.currency || "AED",
        source: "manual",
        validFrom: new Date(now.getTime() - 60_000).toISOString(),
        validUntil: new Date(now.getTime() + 86_400_000).toISOString(),
      },
      transaction,
    });
    const approved = await priceApprovalService.approvePrice({
      context: { companyId: context.company.id, branchId: context.branch.id, user: context.user },
      priceId: price.id,
      transaction,
      now,
    });
    await transaction.commit();
    return approved.price;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function createValidated(context, suffix, karat = 21) {
  await requireAcceptanceTarget();
  const transaction = await models.sequelize.transaction();
  try {
    const created = await draftService.create("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, {
      branchId: context.branch.id,
      customerId: context.customer.id,
      transactionDate: "2026-08-09",
      currency: context.company.currency || "AED",
      exchangeRate: "1",
      notes: `${RUN_MARKER}:${suffix}`,
      items: [{
        goldType: "acceptance-test-gold",
        karat: String(karat),
        purityFactor: ({ 18: "0.750", 21: "0.875", 22: "0.916", 24: "1.000" })[karat],
        fineness: ({ 18: "0.750", 21: "0.875", 22: "0.916", 24: "1.000" })[karat],
        grossWeight: "10.123456",
        stoneWeight: "0.123456",
        proposedRate: "999.0000",
        referenceMarketRate: "888.0000",
      }],
    }, transaction);
    const validated = await draftService.validate("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, created.id, created.version, transaction);
    await transaction.commit();
    return validated;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function executePost(context, id, version, key, bodyExtra = {}, failureInjector = null) {
  await requireAcceptanceTarget();
  const body = { version, ...bodyExtra };
  const scope = "gold-purchase.cgp.post";
  const requestHash = idempotencyService.hashRequest(scope, body, { id });
  const transaction = await models.sequelize.transaction();
  try {
    const claim = await idempotencyService.claim({ models, companyId: context.company.id, scope, key, requestHash, transaction });
    if (!claim.claimed) {
      await transaction.rollback();
      const existing = await idempotencyService.resolveExisting({ models, companyId: context.company.id, scope, key, requestHash });
      if (existing.state === "replay") return { replay: true, body: existing.responseBody };
      const error = new Error(existing.message);
      error.code = existing.state === "processing" ? "IDEMPOTENCY_PROCESSING" : "IDEMPOTENCY_CONFLICT";
      throw error;
    }
    const data = await postingService.post({
      context: { companyId: context.company.id, branchId: context.branch.id, user: context.user },
      id,
      expectedVersion: version,
      correlationId: `CGP-IMP03:${id}`,
      transaction,
      failureInjector,
    });
    const responseBody = { success: true, data };
    await idempotencyService.succeed({ request: claim.request, statusCode: 200, responseBody, transaction });
    await transaction.commit();
    return { replay: false, body: responseBody };
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function assertNoPostedSideEffects(documentId) {
  const document = await models.CustomerGoldPurchaseDocument.findByPk(documentId);
  const snapshots = await models.CgpPricingSnapshot.count({ where: { cgpDocumentId: documentId } });
  const outbox = await models.OutboxEvent.count({ where: { aggregateId: documentId, eventType: postingService.POSTED_EVENT_TYPE } });
  const audit = await models.AuditLog.count({ where: { action: "cgp.posted", sourceDocument: document.draftNumber } });
  return { snapshots, outbox, audit };
}

async function main() {
  await requireAcceptanceTarget();
  const baseline = await forbiddenWriteBaseline();
  const context = await findPostingContext();
  const price = await ensureAcceptancePrice(context);
  assert.equal(await permissionService.userHasPermission(context.user, postingService.POST_PERMISSION), true);

  // A validated document posts without governance approval or payment.
  const direct = await createValidated(context, "DIRECT_NO_APPROVAL");
  const directPost = await executePost(context, direct.id, direct.version, `${RUN_MARKER}:DIRECT`);
  assert.equal(directPost.replay, false);
  const directData = directPost.body.data;
  assert.equal(directData.document.businessStatus, "POSTED");
  assert.equal(directData.document.postedBy, context.user.id);
  assert.equal(directData.pricingSnapshots.length, 1);
  const snapshot = directData.pricingSnapshots[0];
  assert.equal(fixed(snapshot.netWeight, 6), "10.000000");
  assert.equal(fixed(snapshot.pureGoldWeight, 6), "8.750000");
  assert.equal(fixed(snapshot.approvedKaratRate, 4), fixed(price.pricePerGram, 4));
  assert.equal(fixed(snapshot.lineGoldValue, 4), fixed(new Decimal("10").mul(price.pricePerGram), 4));
  assert.notEqual(fixed(snapshot.approvedKaratRate, 4), "999.0000");
  assert.equal(fixed(directData.document.totalGoldValue, 4), fixed(snapshot.lineGoldValue, 4));
  assert.equal(fixed(directData.document.totalPayableToCustomer, 4), fixed(snapshot.lineGoldValue, 4));
  assert.equal(directData.postedEvent.eventType, postingService.POSTED_EVENT_TYPE);
  assert.equal(directData.postedEvent.eventVersion, 1);
  assert.deepEqual(directData.outboxEvent.payload, directData.postedEvent);
  assert.equal(directData.outboxEvent.status, "PENDING");

  // A later Gold Center fixing is valid for later postings only: the original
  // immutable snapshot and posted totals remain historical truth.
  await createAcceptancePriceChange(context);
  const persistedSnapshot = await models.CgpPricingSnapshot.findOne({ where: { cgpDocumentId: direct.id } });
  const persistedDocument = await models.CustomerGoldPurchaseDocument.findByPk(direct.id);
  assert.equal(fixed(persistedSnapshot.approvedKaratRate, 4), fixed(price.pricePerGram, 4));
  assert.equal(fixed(persistedDocument.totalGoldValue, 4), fixed(snapshot.lineGoldValue, 4));

  // Same key/body replays exactly, changed body conflicts, and legacy draft
  // update/void paths cannot mutate the posted aggregate.
  const replay = await executePost(context, direct.id, direct.version, `${RUN_MARKER}:DIRECT`);
  assert.equal(replay.replay, true);
  await assert.rejects(() => executePost(context, direct.id, direct.version, `${RUN_MARKER}:DIRECT`, { changed: true }), /مفتاح منع التكرار|Idempotency|طلب مختلف/);
  await assert.rejects(async () => {
    const transaction = await models.sequelize.transaction();
    try { await draftService.update("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, direct.id, { version: directData.document.version, notes: "must-not-change" }, transaction); }
    finally { if (!transaction.finished) await transaction.rollback(); }
  }, /immutable/i);
  await assert.rejects(async () => {
    const transaction = await models.sequelize.transaction();
    try { await governanceService.submit("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, direct.id, { version: directData.document.version }, transaction); }
    finally { if (!transaction.finished) await transaction.rollback(); }
  }, /immutable/i);
  await assert.rejects(async () => {
    const transaction = await models.sequelize.transaction();
    try { await draftService.voidDraft("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, direct.id, { version: directData.document.version, reason: "must-not-change" }, transaction); }
    finally { if (!transaction.finished) await transaction.rollback(); }
  }, /immutable/i);

  // Rejected governance is independent from business validation and does not
  // become a hidden posting gate.
  const rejected = await createValidated(context, "GOVERNANCE_REJECTED");
  await requireAcceptanceTarget();
  const governanceTransaction = await models.sequelize.transaction();
  let rejectedDocument;
  try {
    const submitted = await governanceService.submit("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, rejected.id, { version: rejected.version }, governanceTransaction);
    const reviewed = await governanceService.review("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, rejected.id, { version: submitted.document.version, approvalVersion: submitted.approvalRequest.version, reason: `${RUN_MARKER}: governance rejection` }, "rejected", governanceTransaction);
    rejectedDocument = reviewed.document;
    await governanceTransaction.commit();
  } catch (error) {
    if (!governanceTransaction.finished) await governanceTransaction.rollback();
    throw error;
  }
  assert.equal(rejectedDocument.businessStatus, "VALIDATED");
  assert.equal(rejectedDocument.governanceStatus, "REJECTED");
  const rejectedPost = await executePost(context, rejectedDocument.id, rejectedDocument.version, `${RUN_MARKER}:REJECTED`);
  assert.equal(rejectedPost.body.data.document.businessStatus, "POSTED");

  // Unauthorized callers are rejected before a durable Posting side effect.
  await assert.rejects(() => postingService.post({
    context: { companyId: context.company.id, branchId: context.branch.id, user: { ...context.user, accountType: "branch_shell" } },
    id: direct.id,
    expectedVersion: directData.document.version,
    transaction: { LOCK: { UPDATE: "UPDATE" } },
  }), /required/i);

  // A forced failure after audit creation must roll every Posting fact back.
  const failure = await createValidated(context, "FAILURE_ROLLBACK");
  const preFailure = await assertNoPostedSideEffects(failure.id);
  await assert.rejects(() => executePost(context, failure.id, failure.version, `${RUN_MARKER}:FAILURE`, {}, async () => { throw new Error("CGP_IMP03_FORCED_FAILURE"); }), /CGP_IMP03_FORCED_FAILURE/);
  const failureDocument = await models.CustomerGoldPurchaseDocument.findByPk(failure.id);
  const postFailure = await assertNoPostedSideEffects(failure.id);
  assert.equal(failureDocument.businessStatus, "VALIDATED");
  assert.equal(failureDocument.postedAt, null);
  assert.equal(failureDocument.postedBy, null);
  assert.equal(failureDocument.postingReference, null);
  assert.equal(failureDocument.totalGoldValue, null);
  assert.equal(failureDocument.totalPayableToCustomer, null);
  assert.equal(postFailure.snapshots, preFailure.snapshots);
  assert.equal(postFailure.outbox, preFailure.outbox);
  assert.equal(postFailure.audit, preFailure.audit);

  // Missing server-owned price evidence fails closed and leaves the aggregate
  // validated; no client proposed/reference rate can stand in for it.
  const availablePriceRows = await models.GoldPrice.findAll({
    where: { companyId: context.company.id, currency: context.company.currency || "AED", approvalStatus: "APPROVED" },
    attributes: ["karat", "companyId"],
  });
  const pricedKarats = new Set(availablePriceRows.map((row) => Number(row.karat)));
  const missingKarat = [18, 22, 24].find((karat) => !pricedKarats.has(karat));
  assert.notEqual(missingKarat, undefined, "Acceptance fixture requires one karat without an approved price");
  const missingPrice = await createValidated(context, "MISSING_APPROVED_PRICE", missingKarat);
  const preMissingPrice = await assertNoPostedSideEffects(missingPrice.id);
  await assert.rejects(() => executePost(context, missingPrice.id, missingPrice.version, `${RUN_MARKER}:MISSING_PRICE`), /Approved (executable )?Gold Center karat price is required/);
  const missingPriceDocument = await models.CustomerGoldPurchaseDocument.findByPk(missingPrice.id);
  const postMissingPrice = await assertNoPostedSideEffects(missingPrice.id);
  assert.equal(missingPriceDocument.businessStatus, "VALIDATED");
  assert.deepEqual(postMissingPrice, preMissingPrice);

  // Two distinct idempotency keys racing on one validated document allow one
  // canonical transition only; the other rolls back its claim and loses.
  const concurrent = await createValidated(context, "CONCURRENCY");
  const race = await Promise.allSettled([
    executePost(context, concurrent.id, concurrent.version, `${RUN_MARKER}:RACE:A`),
    executePost(context, concurrent.id, concurrent.version, `${RUN_MARKER}:RACE:B`),
  ]);
  assert.equal(race.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(race.filter((entry) => entry.status === "rejected").length, 1);
  const concurrentSnapshots = await models.CgpPricingSnapshot.count({ where: { cgpDocumentId: concurrent.id } });
  const concurrentOutbox = await models.OutboxEvent.count({ where: { aggregateId: concurrent.id, eventType: postingService.POSTED_EVENT_TYPE } });
  assert.equal(concurrentSnapshots, 1);
  assert.equal(concurrentOutbox, 1);

  const after = await forbiddenWriteBaseline();
  assert.deepEqual(after, baseline, "CGP Posting must not write downstream domains in Batch 03");

  console.log("CGP_IMP03_ACCEPTANCE_POSTING: PASS");
  console.log("CGP_IMP03_IDEMPOTENCY: PASS");
  console.log("CGP_IMP03_CONCURRENCY: PASS");
  console.log("CGP_IMP03_FAILURE_ROLLBACK: PASS");
  console.log("CGP_IMP03_DOWNSTREAM_WRITES: 0");
  console.log(`CGP_IMP03_ACCEPTANCE_PRICE_ID: ${price.id}`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
