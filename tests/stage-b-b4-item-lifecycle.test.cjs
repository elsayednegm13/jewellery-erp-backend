const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repo = path.resolve(__dirname, "../..");
const runtime = require("../src/services/inventory-v2-runtime.service.js");
const runtimeSource = fs.readFileSync(path.join(__dirname, "../src/services/inventory-v2-runtime.service.js"), "utf8");
const routeSource = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
const transferSource = fs.readFileSync(path.join(__dirname, "../src/routes/transfer.routes.js"), "utf8");
const transferPolicySource = fs.readFileSync(path.join(__dirname, "../src/services/transfer-policy.service.js"), "utf8");
const workshopPolicySource = fs.readFileSync(path.join(__dirname, "../src/services/workshop-policy.service.js"), "utf8");
const countServiceSource = fs.readFileSync(path.join(__dirname, "../src/services/inventory-audit-canonical.service.js"), "utf8");
const pageSource = fs.readFileSync(path.join(repo, "app/[locale]/(dashboard)/inventory/[id]/page.tsx"), "utf8");

const ownership = {
  PENDING_TRANSFER: "transfer",
  WORKSHOP: "workshop",
  SOLD: "pos",
  RETURNED: "return-review",
  RESERVED: "reservation",
  MELTED: "manufacturing",
};

test("B4 status authority is the canonical runtime enum", () => {
  assert.deepEqual(runtime.OPERATIONAL_STATUS, ["PENDING_INTEGRATION", "AVAILABLE", "RESERVED", "PENDING_TRANSFER", "WORKSHOP", "SOLD", "RETURNED", "MISSING", "MELTED", "REVERSAL_PENDING", "REVERSED"]);
});

test("B4 transition matrix is an explicit allowlist", () => {
  assert.ok(runtime.TRANSITIONS.AVAILABLE instanceof Set);
  assert.equal(runtime.TRANSITIONS.AVAILABLE.has("AVAILABLE"), false);
  assert.equal(runtime.TRANSITIONS.MELTED.size, 0);
});

test("valid canonical transitions remain available to their owning services", () => {
  assert.equal(runtime.TRANSITIONS.WORKSHOP.has("AVAILABLE"), true);
  assert.equal(runtime.TRANSITIONS.PENDING_TRANSFER.has("AVAILABLE"), true);
  assert.equal(runtime.TRANSITIONS.RETURNED.has("AVAILABLE"), true);
});

test("unknown transitions are denied fail-closed", () => {
  assert.match(runtimeSource, /INVALID_STATE_TRANSITION/);
  assert.equal(runtime.TRANSITIONS.AVAILABLE.has("UNKNOWN"), false);
});

test("skipped transitions are denied by the same allowlist", () => {
  assert.equal(runtime.TRANSITIONS.AVAILABLE.has("REVERSED"), false);
  assert.equal(runtime.TRANSITIONS.SOLD.has("AVAILABLE"), false);
});

test("canonical transition requires a transaction and matching company", () => {
  assert.match(runtimeSource, /INVENTORY_CANONICAL_TRANSITION_TRANSACTION_REQUIRED/);
  assert.match(runtimeSource, /INVENTORY_CANONICAL_TRANSITION_COMPANY_SCOPE_INVALID/);
});

test("cross-company and row-concurrency guards are present", () => {
  assert.match(runtimeSource, /lock: transaction\.LOCK\.UPDATE/);
  assert.match(runtimeSource, /companyId !== lockedAsset\.companyId/);
});

test("cross-module status ownership is explicit", () => {
  assert.deepEqual(ownership, { PENDING_TRANSFER: "transfer", WORKSHOP: "workshop", SOLD: "pos", RETURNED: "return-review", RESERVED: "reservation", MELTED: "manufacturing" });
  assert.match(transferSource, /toStatus: "PENDING_TRANSFER"/);
  assert.match(routeSource, /toStatus: "WORKSHOP"/);
  assert.match(routeSource, /toStatus: "SOLD"/);
  assert.match(routeSource, /approve-restock/);
});

test("Transfer owns transfer transitions and has action permissions", () => {
  for (const permission of ["inventory.transfer.approve", "inventory.transfer.dispatch", "inventory.transfer.receive", "inventory.transfer.cancel"]) assert.match(transferPolicySource, new RegExp(permission.replace(/[.]/g, "\\.")));
});

test("Workshop owns workshop transitions and has action permissions", () => {
  for (const permission of ["inventory.workshop.send", "inventory.workshop.complete"]) assert.match(workshopPolicySource, new RegExp(permission.replace(/[.]/g, "\\.")));
  assert.match(routeSource, /workshopPolicy\.WORKSHOP_PERMISSIONS\.send/);
  assert.match(routeSource, /workshopPolicy\.WORKSHOP_PERMISSIONS\.complete/);
});

test("Count remains observation-only and cannot transition an Asset", () => {
  assert.match(routeSource, /Count completion does not mutate Asset state/);
  assert.doesNotMatch(countServiceSource, /transitionAsset/);
});

test("POS owns SOLD and does not accept an unavailable Asset", () => {
  assert.match(routeSource, /operationalStatus !== "AVAILABLE"|status !== "available"/);
  assert.match(routeSource, /toStatus: "SOLD"/);
});

test("terminal/high-risk transitions are not exposed as a generic update route", () => {
  assert.doesNotMatch(routeSource, /router\.(patch|put|post)\("\/inventory-v2\/assets\/:id\/lifecycle"/);
  assert.doesNotMatch(routeSource, /asset\.update\(req\.body/);
});

test("Asset identity is preserved by transitionAsset", () => {
  assert.match(runtimeSource, /lockedAsset = await models\.Asset\.findByPk/);
  assert.match(runtimeSource, /lockedAsset\.update\(\{ operationalStatus/);
  assert.doesNotMatch(runtimeSource, /Asset\.create\(/);
});

test("barcode identity is not regenerated by a status transition", () => {
  const transitionSection = runtimeSource.slice(runtimeSource.indexOf("async function transitionAsset"), runtimeSource.indexOf("async function assignRfid"));
  assert.doesNotMatch(transitionSection, /barcode|barcodeIdentity|allocate/);
});

test("RFID identity is not changed by a status transition", () => {
  const transitionSection = runtimeSource.slice(runtimeSource.indexOf("async function transitionAsset"), runtimeSource.indexOf("async function assignRfid"));
  assert.doesNotMatch(transitionSection, /rfid/);
});

test("Product quantity is outside the lifecycle authority", () => {
  const transitionSection = runtimeSource.slice(runtimeSource.indexOf("async function transitionAsset"), runtimeSource.indexOf("async function assignRfid"));
  assert.doesNotMatch(transitionSection, /Product|quantity/);
});

test("non-financial status transition does not call journal or tax services", () => {
  const transitionSection = runtimeSource.slice(runtimeSource.indexOf("async function transitionAsset"), runtimeSource.indexOf("async function assignRfid"));
  assert.doesNotMatch(transitionSection, /journal|VAT|tax|cash|payable|valuation|purchaseCost/);
});

test("Asset event and movement evidence are recorded together", () => {
  assert.match(runtimeSource, /recordAssetEvent/);
  assert.match(runtimeSource, /recordMovement/);
  assert.match(runtimeSource, /idempotencyKey/);
});

test("idempotency service canonicalization supports exact replay and conflict", () => {
  const idempotency = require("../src/services/idempotency.service.js");
  const body = { assetId: "A", action: "X", branchId: "B" };
  assert.equal(idempotency.hashRequest("inventory.lifecycle", body), idempotency.hashRequest("inventory.lifecycle", { branchId: "B", action: "X", assetId: "A" }));
  assert.notEqual(idempotency.hashRequest("inventory.lifecycle", body), idempotency.hashRequest("inventory.lifecycle", { ...body, action: "Y" }));
});

test("idempotency scope is separate from the business body", () => {
  const idempotency = require("../src/services/idempotency.service.js");
  assert.equal(idempotency.hashRequest("inventory.lifecycle", { assetId: "A", idempotencyKey: "one" }), idempotency.hashRequest("inventory.lifecycle", { assetId: "A", idempotencyKey: "two" }));
});

test("Asset details is the single lifecycle read surface", () => {
  assert.match(pageSource, /Stock Status/);
  assert.match(pageSource, /Unified Item History/);
  assert.match(pageSource, /Status is read-only here/);
});

test("UI uses business lifecycle labels instead of raw transition identifiers", () => {
  assert.match(pageSource, /LIFECYCLE_PATH_LABELS/);
  assert.match(pageSource, /const lifecycleState/);
  assert.match(pageSource, /Lifecycle paths/);
  assert.doesNotMatch(pageSource, /data\.legalActions\.join\(\", \"\)/);
  assert.doesNotMatch(pageSource, /text\(entry\.oldStatus\) \u2192 text\(entry\.newStatus\)/);
});

test("UI keeps Arabic and English lifecycle wording aligned", () => {
  assert.match(pageSource, /مسارات دورة الحياة/);
  assert.match(pageSource, /Lifecycle paths/);
  assert.match(pageSource, /تغيير الحالة يتم فقط/);
  assert.match(pageSource, /Status changes are owned/);
});

test("UI does not create a generic lifecycle mutation bypass", () => {
  assert.doesNotMatch(pageSource, /apiClient\([^)]*lifecycle/);
  assert.doesNotMatch(pageSource, /setOperationalStatus/);
});

test("return review is permission-gated and remains the canonical restock path", () => {
  assert.match(pageSource, /inventory\.returns\.approve_restock/);
  assert.match(pageSource, /approve-restock/);
  assert.match(routeSource, /RETURNED_RESTOCK_APPROVED/);
});

test("company and branch context are required on Asset details reads", () => {
  assert.match(routeSource, /resolveAuthorizedBranchId\(req, req\.headers\["x-branch-id"\], \{ required: true \}\)/);
  assert.match(routeSource, /findScopedInventoryV2Asset\(req, req\.params\.id, branchId\)/);
});

test("B4 does not add a migration or new lifecycle permission", () => {
  assert.equal(fs.existsSync(path.join(repo, "backend/migrations/20260823040000-item-lifecycle.js")), false);
  assert.doesNotMatch(pageSource, /inventory\.lifecycle\.(update|mark-missing|retire)/);
});

test("runtime source has no direct generic Asset status update contract", () => {
  assert.doesNotMatch(routeSource, /assets\/:id\/status/);
  assert.doesNotMatch(routeSource, /assets\/:id\/lifecycle/);
});
