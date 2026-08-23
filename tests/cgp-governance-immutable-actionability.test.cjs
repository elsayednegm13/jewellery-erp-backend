"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const governance = require(path.join(root, "src/services/gold-purchase-governance.service.js"));
const frontend = fs.readFileSync(path.join(root, "..", "app/[locale]/(dashboard)/approvals/page.tsx"), "utf8");
const ar = JSON.parse(fs.readFileSync(path.join(root, "..", "messages/ar.json"), "utf8"));
const service = fs.readFileSync(path.join(root, "src/services/gold-purchase-governance.service.js"), "utf8");

assert.deepEqual(governance.deriveApprovalActionability({
  aggregateType: "cgp", approvalStatus: "pending", linkedDocument: { businessStatus: "POSTED" }
}), { actionable: false, actionBlockedCode: "CGP_APPROVAL_DISABLED", linkedBusinessStatus: "POSTED" });
assert.deepEqual(governance.deriveApprovalActionability({
  aggregateType: "cgp", approvalStatus: "pending", linkedDocument: { businessStatus: "REVERSED" }
}), { actionable: false, actionBlockedCode: "CGP_APPROVAL_DISABLED", linkedBusinessStatus: "REVERSED" });
assert.deepEqual(governance.deriveApprovalActionability({
  aggregateType: "cgp", approvalStatus: "pending", linkedDocument: { businessStatus: "VALIDATED" }
}), { actionable: false, actionBlockedCode: "CGP_APPROVAL_DISABLED", linkedBusinessStatus: "VALIDATED" });
assert.deepEqual(governance.deriveApprovalActionability({
  aggregateType: "cgp", approvalStatus: "approved", linkedDocument: { businessStatus: "VALIDATED" }
}), { actionable: false, actionBlockedCode: "CGP_APPROVAL_DISABLED", linkedBusinessStatus: "VALIDATED" });

assert.match(service, /assertCgpBusinessMutable/);
assert.match(service, /DOCUMENT_IMMUTABLE/);
assert.match(service, /CustomerGoldPurchaseDocument\.findAll/);
assert.match(service, /deriveApprovalActionability/);
assert.match(frontend, /request\.actionable === false/);
assert.match(frontend, /request\.actionBlockedCode === "DOCUMENT_IMMUTABLE"/);
assert.match(frontend, /governanceImmutablePosted/);
assert.match(frontend, /governanceImmutableReversed/);
assert.doesNotMatch(frontend, /actionabilityBlocked[\s\S]{0,1200}onClick=\{\(\) => void reviewGold/);
assert.equal(typeof ar.Common.governanceImmutablePosted, "string");
assert.equal(typeof ar.Common.governanceImmutableReversed, "string");
assert.equal(typeof ar.Common.governanceActionabilityUnknown, "string");

console.log("CGP_GOVERNANCE_ACTIONABILITY: PASS");
console.log("CGP_IMMUTABLE_HISTORY_PRESERVED: PASS");
console.log("CGP_IMMUTABLE_FRONTEND_ACTIONS_BLOCKED: PASS");
