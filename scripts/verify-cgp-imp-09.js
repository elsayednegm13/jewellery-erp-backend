"use strict";

// Controlled acceptance proof for the generic customer-payout settlement.  It
// creates exactly one new CGP source, consumes only ACCOUNTING by exact event,
// and never starts the global dispatcher or Inventory/Gold/CRM consumers.
const assert = require("assert/strict");
const Decimal = require("decimal.js");
const { Op, QueryTypes } = require("sequelize");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const MARKER = "ACCEPTANCE_TEST_CGP_IMP09";
process.env.DATABASE_URL = "";
process.env.DB_NAME = ACCEPTANCE_DATABASE;
const models = require("../src/models");
const draftService = require("../src/services/gold-purchase-draft.service");
const cgpPosting = require("../src/services/cgp-posting.service");
const accountingConsumer = require("../src/services/cgp-accounting-consumer.service");
const priceService = require("../src/services/gold-price-approval.service");
const permissionService = require("../src/services/permission.service");
const policy = require("../src/services/financial-approval-policy.service");
const settlement = require("../src/services/financial-settlement.service");

async function requireAcceptance() {
  const rows = await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT });
  assert.equal(rows[0]?.db, ACCEPTANCE_DATABASE, "CGP-IMP-09 verifier refuses a non-acceptance database");
}
function money(value) { return new Decimal(value).toFixed(4); }
async function context() {
  for (const company of await models.Company.findAll({ order: [["id", "ASC"]] })) {
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" }, order: [["id", "ASC"]] });
    if (!customer) continue;
    for (const user of await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] })) {
      const actor = user.toJSON();
      if (!await permissionService.userHasPermission(actor, cgpPosting.POST_PERMISSION) || !await permissionService.userHasPermission(actor, priceService.GOLD_PRICE_APPROVAL_PERMISSION)) continue;
      for (const branch of await models.Branch.findAll({ where: { companyId: company.id, isActive: true } })) {
        const roles = await models.SystemAccountRole.findAll({ where: { companyId: company.id, branchId: branch.id, roleCode: ["INVENTORY_ASSET", "CUSTOMER_CREDITOR", "CASH_TREASURY", "BANK_ACCOUNT"] } });
        if (new Set(roles.map((r) => r.roleCode)).size === 4) return { company: company.toJSON(), branch: branch.toJSON(), customer: customer.toJSON(), user: actor };
      }
    }
  }
  throw new Error("CGP_IMP09_ACCEPTANCE_CONTEXT_NOT_FOUND");
}
async function oneAccountingOnlySource(ctx) {
  await requireAcceptance();
  const existing = await models.CustomerGoldPurchaseDocument.findOne({ where: { notes: { [Op.like]: `${MARKER}%` } } });
  if (existing) {
    const event = await models.OutboxEvent.findOne({ where: { aggregateId: existing.id, eventType: accountingConsumer.EVENT_TYPE } });
    const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceEventId: event?.eventId } });
    assert.ok(event && liability, "existing IMP09 fixture must have accounting recognition");
    return { document: existing, event, liability };
  }
  const price = await models.GoldPrice.findOne({ where: { companyId: ctx.company.id, currency: ctx.company.currency || "AED", karat: 21, approvalStatus: "APPROVED", validFrom: { [Op.lte]: new Date() }, validUntil: { [Op.gt]: new Date() } } });
  assert.ok(price, "CGP-IMP-09 requires an approved active 21K acceptance price");
  const tx = await models.sequelize.transaction();
  try {
    const draft = await draftService.create("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, {
      branchId: ctx.branch.id, customerId: ctx.customer.id, transactionDate: "2026-08-09", currency: ctx.company.currency || "AED", exchangeRate: "1",
      notes: `${MARKER}:ACCOUNTING_ONLY_SETTLEMENT_SOURCE`,
      items: [{ goldType: "acceptance-cgp-imp09-one-piece", karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "13.000000", stoneWeight: "0.100000", proposedRate: "999.0000", referenceMarketRate: "888.0000" }],
    }, tx);
    const validated = await draftService.validate("cgp", { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, draft.id, draft.version, tx);
    await cgpPosting.post({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, user: ctx.user }, id: validated.id, expectedVersion: validated.version, correlationId: `${MARKER}:POST`, transaction: tx });
    await tx.commit();
  } catch (error) { if (!tx.finished) await tx.rollback(); throw error; }
  const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { notes: { [Op.like]: `${MARKER}%` } } });
  const event = await models.OutboxEvent.findOne({ where: { aggregateId: document.id, eventType: accountingConsumer.EVENT_TYPE } });
  await requireAcceptance();
  await accountingConsumer.consumePostedEvent({ eventId: event.eventId });
  const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceEventId: event.eventId } });
  assert.ok(liability, "Accounting-only consumer must create the customer liability");
  assert.equal(await models.OutboxEvent.count({ where: { eventId: event.eventId, status: "PENDING" } }), 1, "source outbox remains pending and undispatched");
  return { document, event, liability };
}
async function createPolicy(ctx, input) {
  await requireAcceptance();
  return models.sequelize.transaction((transaction) => policy.createFinancialApprovalPolicy({ models, context: { companyId: ctx.company.id, actorId: ctx.user.id }, input: { ...input, description: `${MARKER}:${input.description}`, metadata: { acceptanceOnly: true, marker: MARKER } }, transaction }));
}
async function deactivate(ctx, id) {
  await requireAcceptance();
  return models.sequelize.transaction((transaction) => policy.deactivateFinancialApprovalPolicy({ models, context: { companyId: ctx.company.id, actorId: ctx.user.id }, policyId: id, transaction }));
}
async function counts() {
  const [r] = await models.sequelize.query(`SELECT
    (SELECT count(*)::int FROM financial_settlements) AS settlements,
    (SELECT count(*)::int FROM financial_settlement_legs) AS legs,
    (SELECT count(*)::int FROM financial_settlement_allocations) AS allocations,
    (SELECT count(*)::int FROM journal_entries WHERE source_type='FINANCIAL_SETTLEMENT') AS journals,
    (SELECT count(*)::int FROM cash_transactions WHERE category='customer_payout_settlement') AS treasury`, { type: QueryTypes.SELECT });
  return r;
}
async function assertNoSettlementDelta(before) { assert.deepEqual(await counts(), before, "rejected or rollback settlement must have no durable effect"); }
async function rejectsCode(fn, code) { await assert.rejects(fn, (error) => error?.errorCode === code, `expected ${code}`); }

async function verifyExisting() {
  await requireAcceptance();
  const document = await models.CustomerGoldPurchaseDocument.findOne({ where: { notes: { [Op.like]: `${MARKER}%` } } });
  assert.ok(document && document.businessStatus === "POSTED", "IMP09 posted source evidence is required");
  const event = await models.OutboxEvent.findOne({ where: { aggregateId: document.id, eventType: accountingConsumer.EVENT_TYPE } });
  const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceEventId: event?.eventId } });
  assert.ok(event && liability && liability.status === "SETTLED", "IMP09 settled liability evidence is required");
  assert.equal(money(liability.outstandingAmount), "0.0000");
  const rows = await models.FinancialSettlement.findAll({ where: { sourceDocumentId: document.id, operationType: settlement.OPERATION_TYPE }, include: [{ model: models.FinancialSettlementLeg, as: "legs" }, { model: models.FinancialSettlementAllocation, as: "allocations" }] });
  assert.equal(rows.length, 2); assert.equal(rows.reduce((n, row) => n + row.legs.length, 0), 3); assert.equal(rows.reduce((n, row) => n + row.allocations.length, 0), 2);
  assert.equal(await models.FinancialApprovalPolicy.count({ where: { operationType: settlement.OPERATION_TYPE, isActive: true } }), 0);
  const effects = (await models.sequelize.query(`SELECT
    (SELECT count(*)::int FROM processed_events WHERE event_id=:eventId AND consumer_name IN ('INVENTORY','GOLD_CENTER','CRM')) AS "forbiddenConsumers",
    (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS "unbalanced",
    (SELECT count(*)::int FROM financial_settlement_legs l LEFT JOIN financial_settlements s ON s.id=l.settlement_id WHERE s.id IS NULL) AS "orphanLegs",
    (SELECT count(*)::int FROM financial_settlement_allocations a LEFT JOIN customer_financial_liabilities l ON l.id=a.customer_financial_liability_id WHERE l.id IS NULL) AS "orphanAllocations"`, { replacements: { eventId: event.eventId, documentId: document.id }, type: QueryTypes.SELECT }))[0];
  assert.deepEqual(effects, { forbiddenConsumers: 0, unbalanced: 0, orphanLegs: 0, orphanAllocations: 0 });
  console.log("CGP_IMP_09_VERIFY_EXISTING: PASS");
}

// A pure-bank path is exercised only as a rolled-back transaction against the
// already-marked IMP05 acceptance liability.  It creates no second IMP09 CGP
// source and leaves that protected prior fixture financially unchanged.
async function verifyPureBankRollback() {
  await requireAcceptance();
  const ctx = await context();
  const liability = await models.CustomerFinancialLiability.findOne({ include: [{ model: models.CustomerGoldPurchaseDocument, as: "sourceDocument", where: { notes: { [Op.like]: "ACCEPTANCE_TEST_CGP_IMP05%" } } }], where: { status: "OPEN" } });
  assert.ok(liability && new Decimal(liability.outstandingAmount).gt(0), "open IMP05 acceptance liability is required for pure-bank rollback proof");
  const before = await counts();
  const temp = await createPolicy(ctx, { operationType: settlement.OPERATION_TYPE, branchId: ctx.branch.id, currency: "AED", paymentMethod: "BANK_TRANSFER", minAmount: money(liability.outstandingAmount), maxAmount: money(liability.outstandingAmount), approvalRequired: true, priority: 100, effectiveFrom: new Date(Date.now()-60000), effectiveTo: new Date(Date.now()+600000), description: "PURE_BANK_ROLLBACK" });
  try {
    const request = await models.sequelize.transaction((transaction) => policy.createFinancialApprovalRequest({ models, context: { companyId: ctx.company.id, branchId: ctx.branch.id, actorId: ctx.user.id }, operation: { operationType: settlement.OPERATION_TYPE, currency: "AED", paymentMethod: "BANK_TRANSFER", amount: money(liability.outstandingAmount) }, subjectType: "CustomerFinancialLiability", subjectId: liability.id, description: `${MARKER}:pure bank human approval`, idempotencyKey: `${MARKER}:PURE_BANK_APPROVAL_REQUEST`, transaction }));
    assert.equal(request.status, "pending");
    const approved = await models.sequelize.transaction((transaction) => policy.approveFinancialApprovalRequest({ models, context: { companyId: ctx.company.id, branchId: ctx.branch.id, actorId: ctx.user.id, user: ctx.user }, approvalRequestId: request.approvalRequestId, transaction }));
    assert.equal(approved.status, "approved");
    await assert.rejects(() => settlement.executeCustomerPayoutSettlement({ context: { companyId: ctx.company.id, branchId: ctx.branch.id, actorId: ctx.user.id }, input: { liabilityId: liability.id, idempotencyKey: `${MARKER}:PURE_BANK_ROLLBACK`, approvalRequestId: request.approvalRequestId, legs: [{ method: "BANK_TRANSFER", amount: money(liability.outstandingAmount), bankReference: "IMP09-PURE-BANK-ROLLBACK" }], failureStage: "AFTER_JOURNAL", testMarker: MARKER } }), /FINANCIAL_SETTLEMENT_INJECTED_FAILURE/);
    await assertNoSettlementDelta(before);
    const current = await models.CustomerFinancialLiability.findByPk(liability.id);
    assert.equal(money(current.outstandingAmount), money(liability.outstandingAmount));
  } finally { await deactivate(ctx, temp.id); }
  console.log("CGP_IMP_09_PURE_BANK_ROLLBACK: PASS");
}

async function main() {
  await requireAcceptance();
  const ctx = await context();
  const beforeAssets = await models.Asset.count();
  const fixture = await oneAccountingOnlySource(ctx);
  assert.equal(fixture.document.businessStatus, "POSTED");
  assert.equal(await models.Asset.count(), beforeAssets, "IMP09 source must not invoke Inventory asset creation");
  const base = await models.CustomerFinancialLiability.findByPk(fixture.liability.id);
  assert.equal(base.status, "OPEN");
  const total = new Decimal(base.outstandingAmount);
  const cashPartial = total.div(3).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  const mixedRemainder = total.minus(cashPartial);
  const mixedCash = mixedRemainder.div(2).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  const mixedBank = mixedRemainder.minus(mixedCash);
  assert.ok(cashPartial.gt(0) && mixedCash.gt(0) && mixedBank.gt(0));
  const execContext = { companyId: ctx.company.id, branchId: ctx.branch.id, actorId: ctx.user.id };
  const initial = await counts();

  await rejectsCode(() => settlement.executeCustomerPayoutSettlement({ context: execContext, input: { liabilityId: base.id, idempotencyKey: `${MARKER}:NO_POLICY`, legs: [{ method: "CASH", amount: money(cashPartial) }] } }), "POLICY_CONFIGURATION_MISSING");
  await assertNoSettlementDelta(initial);
  await rejectsCode(() => settlement.executeCustomerPayoutSettlement({ context: execContext, input: { liabilityId: base.id, idempotencyKey: `${MARKER}:BAD_BANK`, legs: [{ method: "BANK_TRANSFER", amount: money(cashPartial) }] } }), "FINANCIAL_SETTLEMENT_BANK_REFERENCE_REQUIRED");
  await rejectsCode(() => settlement.executeCustomerPayoutSettlement({ context: execContext, input: { liabilityId: base.id, idempotencyKey: `${MARKER}:ZERO`, legs: [{ method: "CASH", amount: "0.0000" }] } }), "FINANCIAL_SETTLEMENT_AMOUNT_INVALID");
  await assertNoSettlementDelta(initial);

  const approvalPolicy = await createPolicy(ctx, { operationType: settlement.OPERATION_TYPE, branchId: ctx.branch.id, currency: "AED", paymentMethod: "BANK_TRANSFER", minAmount: money(cashPartial), maxAmount: money(cashPartial), approvalRequired: true, priority: 100, effectiveFrom: new Date(Date.now()-60000), effectiveTo: new Date(Date.now()+600000), description: "APPROVAL_REQUIRED_ROLLBACK" });
  await requireAcceptance();
  const approval = await models.sequelize.transaction((transaction) => policy.createFinancialApprovalRequest({ models, context: { companyId: ctx.company.id, branchId: ctx.branch.id, actorId: ctx.user.id }, operation: { operationType: settlement.OPERATION_TYPE, currency: "AED", paymentMethod: "BANK_TRANSFER", amount: money(cashPartial) }, subjectType: "CustomerFinancialLiability", subjectId: base.id, description: `${MARKER}:human approval required`, idempotencyKey: `${MARKER}:APPROVAL_REQUEST`, transaction }));
  assert.equal(approval.status, "pending");
  await rejectsCode(() => settlement.executeCustomerPayoutSettlement({ context: execContext, input: { liabilityId: base.id, idempotencyKey: `${MARKER}:APPROVAL_BLOCK`, legs: [{ method: "BANK_TRANSFER", amount: money(cashPartial), bankReference: "IMP09-APPROVAL-BLOCK" }] } }), "FINANCIAL_APPROVAL_REQUIRED");
  await assertNoSettlementDelta(initial);
  await deactivate(ctx, approvalPolicy.id);

  const cashPolicy = await createPolicy(ctx, { operationType: settlement.OPERATION_TYPE, branchId: ctx.branch.id, currency: "AED", paymentMethod: "CASH", minAmount: money(cashPartial), maxAmount: money(cashPartial), approvalRequired: false, priority: 100, effectiveFrom: new Date(Date.now()-60000), effectiveTo: new Date(Date.now()+600000), description: "CASH_PARTIAL" });
  await assert.rejects(() => settlement.executeCustomerPayoutSettlement({ context: execContext, input: { liabilityId: base.id, idempotencyKey: `${MARKER}:CASH_ROLLBACK`, legs: [{ method: "CASH", amount: money(cashPartial) }], failureStage: "AFTER_JOURNAL", testMarker: MARKER } }), /FINANCIAL_SETTLEMENT_INJECTED_FAILURE/);
  await assertNoSettlementDelta(initial);
  const cashResult = await settlement.executeCustomerPayoutSettlement({ context: execContext, input: { liabilityId: base.id, idempotencyKey: `${MARKER}:CASH_PARTIAL`, legs: [{ method: "CASH", amount: money(cashPartial) }], testMarker: MARKER } });
  assert.equal(cashResult.liabilityStatus, "PARTIALLY_SETTLED");
  const cashReplay = await settlement.executeCustomerPayoutSettlement({ context: execContext, input: { liabilityId: base.id, idempotencyKey: `${MARKER}:CASH_PARTIAL`, legs: [{ method: "CASH", amount: money(cashPartial) }], testMarker: MARKER } });
  assert.equal(cashReplay.replayed, true);
  await rejectsCode(() => settlement.executeCustomerPayoutSettlement({ context: execContext, input: { liabilityId: base.id, idempotencyKey: `${MARKER}:CASH_PARTIAL`, legs: [{ method: "CASH", amount: money(cashPartial.plus("0.0001")) }], testMarker: MARKER } }), "IDEMPOTENCY_KEY_CONFLICT");
  await deactivate(ctx, cashPolicy.id);

  const mixedPolicy = await createPolicy(ctx, { operationType: settlement.OPERATION_TYPE, branchId: ctx.branch.id, currency: "AED", paymentMethod: "MIXED", minAmount: money(mixedRemainder), maxAmount: money(mixedRemainder), approvalRequired: false, priority: 100, effectiveFrom: new Date(Date.now()-60000), effectiveTo: new Date(Date.now()+600000), description: "MIXED_FULL" });
  const mixedInput = { liabilityId: base.id, idempotencyKey: `${MARKER}:MIXED_FULL`, legs: [{ method: "CASH", amount: money(mixedCash) }, { method: "BANK_TRANSFER", amount: money(mixedBank), bankReference: "IMP09-BANK-REFERENCE" }], testMarker: MARKER };
  const concurrent = await Promise.allSettled([settlement.executeCustomerPayoutSettlement({ context: execContext, input: mixedInput }), settlement.executeCustomerPayoutSettlement({ context: execContext, input: mixedInput })]);
  assert.equal(concurrent.filter((x) => x.status === "fulfilled").length, 2);
  assert.equal(concurrent.map((x) => x.value.replayed).filter(Boolean).length, 1);
  assert.equal(concurrent.map((x) => x.value.replayed).filter((x) => !x).length, 1);
  await deactivate(ctx, mixedPolicy.id);
  const finalLiability = await models.CustomerFinancialLiability.findByPk(base.id);
  assert.equal(finalLiability.status, "SETTLED"); assert.equal(money(finalLiability.outstandingAmount), "0.0000"); assert.equal(money(finalLiability.settledAmount), money(total));
  await rejectsCode(() => settlement.executeCustomerPayoutSettlement({ context: execContext, input: { liabilityId: base.id, idempotencyKey: `${MARKER}:OVERPAY`, legs: [{ method: "CASH", amount: "0.0001" }] } }), "CUSTOMER_FINANCIAL_LIABILITY_NOT_OPEN");
  const final = await counts();
  assert.deepEqual(final, { settlements: initial.settlements + 2, legs: initial.legs + 3, allocations: initial.allocations + 2, journals: initial.journals + 2, treasury: initial.treasury + 3 });
  const active = await models.FinancialApprovalPolicy.count({ where: { operationType: settlement.OPERATION_TYPE, isActive: true } });
  assert.equal(active, 0, "no active customer payout policy may remain after acceptance");
  const integrity = (await models.sequelize.query(`SELECT
    (SELECT count(*)::int FROM journal_entries WHERE status='posted' AND total_debit<>total_credit) AS "unbalanced",
    (SELECT count(*)::int FROM journal_lines l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.id IS NULL) AS "orphanLines",
    (SELECT count(*)::int FROM financial_settlement_legs l LEFT JOIN financial_settlements s ON s.id=l.settlement_id WHERE s.id IS NULL) AS "orphanLegs",
    (SELECT count(*)::int FROM financial_settlement_allocations a LEFT JOIN customer_financial_liabilities l ON l.id=a.customer_financial_liability_id WHERE l.id IS NULL) AS "orphanAllocations"`, { type: QueryTypes.SELECT }))[0];
  assert.deepEqual(integrity, { unbalanced: 0, orphanLines: 0, orphanLegs: 0, orphanAllocations: 0 });
  console.log("CGP_IMP_09_GENERIC_SETTLEMENT: PASS");
  console.log("CGP_IMP_09_CASH_PARTIAL: PASS");
  console.log("CGP_IMP_09_MIXED_FULL: PASS");
  console.log("CGP_IMP_09_APPROVAL_GATE: PASS");
  console.log("CGP_IMP_09_IDEMPOTENCY_CONCURRENCY: PASS");
  console.log("CGP_IMP_09_ROLLBACK: PASS");
  console.log("CGP_IMP_09_INTEGRITY: PASS");
}

(process.argv.includes("--verify-existing") ? verifyExisting() : process.argv.includes("--verify-pure-bank-rollback") ? verifyPureBankRollback() : main()).catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
