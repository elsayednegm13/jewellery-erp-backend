const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const settlement = fs.readFileSync(path.resolve(__dirname, "../src/services/financial-settlement.service.js"), "utf8");
const route = fs.readFileSync(path.resolve(__dirname, "../src/routes/gold-purchase.routes.js"), "utf8");
const policy = fs.readFileSync(path.resolve(__dirname, "../src/services/financial-approval-policy.service.js"), "utf8");

assert.doesNotMatch(settlement, /evaluateFinancialApprovalPolicy/);
assert.doesNotMatch(settlement, /FINANCIAL_APPROVAL_REQUIRED/);
assert.doesNotMatch(settlement, /ApprovalRequest/);
assert.match(settlement, /gold_purchase\.cgp\.settle|INSUFFICIENT_CASH_BALANCE/);
assert.match(settlement, /calculateExpected/);
assert.match(settlement, /cashRegisterService\.calculateExpectedDecimal/);
assert.match(route, /gold_purchase\.cgp\.settle/);
assert.doesNotMatch(route, /approvalRequestId:\s*body\.approvalRequestId/);
assert.match(policy, /createFinancialApprovalRequest/);
assert.match(policy, /approvals\.manage/);

console.log("CGP_SETTLEMENT_AUTHORITY_STATIC: PASS");
