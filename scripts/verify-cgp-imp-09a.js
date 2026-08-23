"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
delete process.env.DATABASE_URL;
process.env.DB_NAME = ACCEPTANCE_DATABASE;

const models = require("../src/models");
const policy = require("../src/services/financial-approval-policy.service");

const EXERCISE = process.argv.includes("--exercise-rollback");
const marker = `CGP_IMP_09A_ACCEPTANCE_ONLY:${Date.now()}`;
const now = new Date("2026-08-09T12:00:00.000Z");

async function target() {
  const [row] = await models.sequelize.query("SELECT current_database() AS db", { type: models.sequelize.QueryTypes.SELECT });
  assert.equal(row.db, ACCEPTANCE_DATABASE, "STOP — acceptance DB required");
}

function basePolicy(overrides = {}) {
  return {
    id: `P-${Math.random().toString(36).slice(2)}`,
    companyId: "COMPANY-A",
    operationType: "CUSTOMER_PAYOUT",
    branchId: null,
    currency: null,
    paymentMethod: null,
    minAmount: null,
    maxAmount: null,
    approvalRequired: false,
    priority: 0,
    isActive: true,
    effectiveFrom: null,
    effectiveTo: null,
    version: 1,
    ...overrides,
  };
}

const input = (overrides = {}) => ({
  operationType: "CUSTOMER_PAYOUT",
  companyId: "COMPANY-A",
  branchId: "BRANCH-A",
  currency: "AED",
  amount: "100.0000",
  paymentMethod: "CASH",
  occurredAt: now,
  ...overrides,
});

function assertDecision(policies, operation, status) {
  assert.equal(policy.evaluateCandidates(policies, operation).status, status);
}

function runPurePolicyMatrix() {
  assertDecision([], input(), policy.DECISION.POLICY_CONFIGURATION_MISSING);
  assertDecision([basePolicy()], input(), policy.DECISION.APPROVAL_NOT_REQUIRED);
  assertDecision([basePolicy({ approvalRequired: true })], input(), policy.DECISION.APPROVAL_REQUIRED);
  const ranged = basePolicy({ minAmount: "100.0000", maxAmount: "200.0000", approvalRequired: true });
  assertDecision([ranged], input({ amount: "99.9999" }), policy.DECISION.POLICY_CONFIGURATION_MISSING);
  assertDecision([ranged], input({ amount: "100.0000" }), policy.DECISION.APPROVAL_REQUIRED);
  assertDecision([ranged], input({ amount: "150.0000" }), policy.DECISION.APPROVAL_REQUIRED);
  assertDecision([ranged], input({ amount: "200.0000" }), policy.DECISION.APPROVAL_REQUIRED);
  assertDecision([ranged], input({ amount: "200.0001" }), policy.DECISION.POLICY_CONFIGURATION_MISSING);
  let result = policy.evaluateCandidates([basePolicy(), basePolicy({ id: "branch", branchId: "BRANCH-A", approvalRequired: true })], input());
  assert.equal(result.policy.id, "branch");
  result = policy.evaluateCandidates([basePolicy(), basePolicy({ id: "currency", currency: "AED", approvalRequired: true })], input());
  assert.equal(result.policy.id, "currency");
  result = policy.evaluateCandidates([basePolicy(), basePolicy({ id: "method", paymentMethod: "CASH", approvalRequired: true })], input());
  assert.equal(result.policy.id, "method");
  result = policy.evaluateCandidates([basePolicy({ priority: 1 }), basePolicy({ id: "priority", priority: 2, approvalRequired: true })], input());
  assert.equal(result.policy.id, "priority");
  assertDecision([basePolicy({ id: "one", approvalRequired: true }), basePolicy({ id: "two", approvalRequired: false })], input(), policy.DECISION.POLICY_CONFIGURATION_AMBIGUOUS);
  assertDecision([basePolicy({ isActive: false })], input(), policy.DECISION.POLICY_CONFIGURATION_MISSING);
  assertDecision([basePolicy({ effectiveTo: now })], input(), policy.DECISION.POLICY_CONFIGURATION_MISSING);
  assertDecision([basePolicy({ effectiveFrom: new Date("2026-08-09T12:00:00.001Z") })], input(), policy.DECISION.POLICY_CONFIGURATION_MISSING);
  assertDecision([basePolicy()], input({ companyId: "COMPANY-B" }), policy.DECISION.POLICY_CONFIGURATION_MISSING);
  assertDecision([basePolicy()], input({ amount: "1.00001" }), policy.DECISION.INVALID_CONTEXT);
  assertDecision([basePolicy()], input({ paymentMethod: "UNKNOWN" }), policy.DECISION.INVALID_CONTEXT);
}

async function rollbackRequestCoverage(company, branch) {
  await target();
  await models.sequelize.transaction(async (transaction) => {
    const context = { companyId: company.id, branchId: branch.id, actorId: `${marker}:rollback` };
    const row = await policy.createFinancialApprovalPolicy({ models, context, input: { operationType: "IMP09A_TEST_ROLLBACK", branchId: branch.id, currency: "AED", paymentMethod: "CASH", minAmount: "1.0000", maxAmount: "2.0000", approvalRequired: true, priority: 9, effectiveFrom: now }, transaction });
    const created = await policy.createFinancialApprovalRequest({ models, context, operation: { operationType: "IMP09A_TEST_ROLLBACK", currency: "AED", amount: "1.5000", paymentMethod: "CASH", occurredAt: now }, subjectType: "TEST_SUBJECT", subjectId: `${marker}:rollback`, description: marker, idempotencyKey: `${marker}:rollback-key`, transaction });
    assert.equal(created.created, true);
    const request = await models.ApprovalRequest.findByPk(created.approvalRequestId, { transaction });
    assert.equal(request.status, "pending", "policy evaluation must not auto-approve");
    assert.equal(request.policyId, row.id);
    assert.equal(request.policyDecisionSnapshot.policyId, row.id);
    assert.equal(request.policyDecisionSnapshot.policyVersion, 1);
    await assert.rejects(() => request.update({ status: "approved", reviewedBy: "system", reviewedAt: new Date().toISOString() }, { transaction }), /canonical approval authority/);
    const replay = await policy.createFinancialApprovalRequest({ models, context, operation: { operationType: "IMP09A_TEST_ROLLBACK", currency: "AED", amount: "1.5000", paymentMethod: "CASH", occurredAt: now }, subjectType: "TEST_SUBJECT", subjectId: `${marker}:rollback`, description: marker, idempotencyKey: `${marker}:rollback-key`, transaction });
    assert.equal(replay.replayed, true);
    await assert.rejects(() => policy.createFinancialApprovalRequest({ models, context, operation: { operationType: "IMP09A_TEST_ROLLBACK", currency: "AED", amount: "1.5000", paymentMethod: "CASH", occurredAt: now }, subjectType: "TEST_SUBJECT", subjectId: `${marker}:rollback`, description: `${marker}:changed`, idempotencyKey: `${marker}:rollback-key`, transaction }), (error) => error?.errorCode === "IDEMPOTENCY_KEY_CONFLICT");
    throw new Error("CGP_IMP09A_ROLLBACK_SENTINEL");
  }).catch((error) => {
    if (error.message !== "CGP_IMP09A_ROLLBACK_SENTINEL") throw error;
  });
}

async function committedConcurrencyCoverage(company, branch) {
  await target();
  const context = { companyId: company.id, branchId: branch.id, actorId: `${marker}:concurrency` };
  let testPolicy;
  await models.sequelize.transaction(async (transaction) => {
    testPolicy = await policy.createFinancialApprovalPolicy({ models, context, input: { operationType: "IMP09A_TEST_CONCURRENCY", branchId: branch.id, currency: "AED", paymentMethod: "CASH", approvalRequired: true, priority: 99, effectiveFrom: now }, transaction });
  });
  const body = { operation: { operationType: "IMP09A_TEST_CONCURRENCY", currency: "AED", amount: "1.0000", paymentMethod: "CASH", occurredAt: now }, subjectType: "TEST_SUBJECT", subjectId: `${marker}:concurrency`, description: marker, idempotencyKey: `${marker}:concurrency-key` };
  const calls = await Promise.all([
    models.sequelize.transaction(async (transaction) => { await target(); return policy.createFinancialApprovalRequest({ models, context, ...body, transaction }); }),
    models.sequelize.transaction(async (transaction) => { await target(); return policy.createFinancialApprovalRequest({ models, context, ...body, transaction }); }),
  ]);
  assert.equal(calls.filter((result) => result.created && !result.replayed).length, 1, "one concurrent request must create durable evidence");
  assert.equal(calls.filter((result) => result.replayed).length, 1, "one concurrent request must replay durable evidence");
  const requestCount = await models.ApprovalRequest.count({ where: { type: policy.FINANCIAL_OPERATION_TYPE, subjectId: body.subjectId } });
  assert.equal(requestCount, 1);
  await target();
  await models.sequelize.transaction((transaction) => policy.deactivateFinancialApprovalPolicy({ models, context, policyId: testPolicy.id, transaction }));
  return { policyId: testPolicy.id, approvalRequestId: calls.find((result) => result.created && !result.replayed).approvalRequestId };
}

async function verifySchema() {
  const columns = await models.sequelize.getQueryInterface().describeTable("approval_requests");
  for (const column of ["policy_id", "operation_type", "subject_type", "subject_id", "branch_id", "currency", "payment_method", "idempotency_key", "request_context_snapshot", "policy_decision_snapshot"]) assert.ok(columns[column], `approval_requests.${column} missing`);
  const policyColumns = await models.sequelize.getQueryInterface().describeTable("financial_approval_policies");
  for (const column of ["operation_type", "company_id", "branch_id", "currency", "payment_method", "min_amount", "max_amount", "approval_required", "priority", "is_active", "effective_from", "effective_to", "version"]) assert.ok(policyColumns[column], `financial_approval_policies.${column} missing`);
  const activeCustomerPayout = await models.FinancialApprovalPolicy.count({ where: { operationType: policy.FUTURE_IMP09_OPERATION_TYPE, isActive: true } });
  assert.equal(activeCustomerPayout, 0, "migration must not create an active CUSTOMER_PAYOUT policy");
}

async function main() {
  await models.sequelize.authenticate();
  await target();
  await verifySchema();
  runPurePolicyMatrix();
  let evidence = null;
  if (EXERCISE) {
    const company = await models.Company.findOne();
    const branch = company && await models.Branch.findOne({ where: { companyId: company.id, isActive: true } });
    assert.ok(company && branch, "acceptance company and branch required");
    await rollbackRequestCoverage(company, branch);
    evidence = await committedConcurrencyCoverage(company, branch);
  }
  console.log(JSON.stringify({ exercise: EXERCISE, concurrencyEvidence: evidence }));
  console.log("CGP_IMP_09A_FINANCIAL_APPROVAL_POLICY: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
