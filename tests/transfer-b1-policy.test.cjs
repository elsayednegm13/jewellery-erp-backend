const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const policy = require("../src/services/transfer-policy.service");

const canonicalBody = {
  assetIds: ["ASSET-1"],
  fromBranchId: "BRANCH-1",
  toBranchId: "BRANCH-2",
  fromLocationId: "LOC-1",
  toLocationId: "LOC-2",
  notes: "synthetic B1 transfer",
};

test("valid transfer create contract requires DB location IDs", () => {
  assert.deepEqual(policy.normalizeCreateBody(canonicalBody), canonicalBody);
  assert.throws(() => policy.normalizeCreateBody({ ...canonicalBody, fromLocationId: "" }), /fromLocationId is required/);
  assert.throws(() => policy.normalizeCreateBody({ ...canonicalBody, toLocationId: undefined }), /toLocationId is required/);
});

test("create contract rejects duplicate Assets and unknown fields", () => {
  assert.throws(() => policy.normalizeCreateBody({ ...canonicalBody, assetIds: ["ASSET-1", "ASSET-1"] }), /Duplicate Asset IDs/);
  assert.throws(() => policy.normalizeCreateBody({ ...canonicalBody, arbitrary: true }), /Unknown transfer fields/);
});

test("same-branch and empty Asset requests are rejected", () => {
  assert.throws(() => policy.normalizeCreateBody({ ...canonicalBody, fromBranchId: "BRANCH-2", toBranchId: "BRANCH-2" }), /must differ/);
  assert.throws(() => policy.normalizeCreateBody({ ...canonicalBody, assetIds: [] }), /At least one Asset/);
});

test("canonical lifecycle accepts only pending approved in-transit received cancelled", () => {
  assert.deepEqual(policy.TRANSFER_STATUSES, ["pending", "approved", "in-transit", "received", "cancelled"]);
  assert.deepEqual(policy.ACTIVE_ITEM_STATUSES, ["PENDING", "APPROVED", "IN_TRANSIT"]);
});

test("approved transition is pending to approved only", () => {
  assert.equal(policy.actionForTransition("pending", "approved"), "approve");
  assert.throws(() => policy.actionForTransition("pending", "in-transit"), /Illegal transfer transition/);
  assert.throws(() => policy.actionForTransition("pending", "received"), /Illegal transfer transition/);
});

test("dispatch and receive transitions cannot be skipped", () => {
  assert.equal(policy.actionForTransition("approved", "in-transit"), "dispatch");
  assert.equal(policy.actionForTransition("in-transit", "received"), "receive");
  assert.throws(() => policy.actionForTransition("approved", "received"), /Illegal transfer transition/);
  assert.throws(() => policy.actionForTransition("pending", "received"), /Illegal transfer transition/);
});

test("cancellation is allowed only before dispatch", () => {
  assert.equal(policy.actionForTransition("pending", "cancelled"), "cancel");
  assert.equal(policy.actionForTransition("approved", "cancelled"), "cancel");
  assert.throws(() => policy.actionForTransition("in-transit", "cancelled"), /Illegal transfer transition/);
  assert.throws(() => policy.actionForTransition("received", "cancelled"), /Illegal transfer transition/);
});

test("PATCH is an allowlisted lifecycle contract", () => {
  assert.deepEqual(policy.normalizePatchBody({ status: "approved" }), { status: "approved", cancelReason: null });
  assert.deepEqual(policy.normalizePatchBody({ status: "cancelled", cancelReason: "duplicate request" }), { status: "cancelled", cancelReason: "duplicate request" });
  assert.throws(() => policy.normalizePatchBody({ status: "approved", assetIds: ["ASSET-1"] }), /Unknown transfer fields/);
  assert.throws(() => policy.normalizePatchBody({ status: "approved", cancelReason: "wrong" }), /only valid/);
  assert.equal(policy.normalizePatchBody({ status: "received" }).status, "received");
});

test("branch context is fail-closed", () => {
  assert.equal(policy.assertTransferBranchContext({ branchId: "BRANCH-1" }, "BRANCH-1", "create"), "BRANCH-1");
  assert.throws(() => policy.assertTransferBranchContext({}, "BRANCH-1", "create"), /Branch context/);
  assert.throws(() => policy.assertTransferBranchContext({ branchId: "BRANCH-2" }, "BRANCH-1", "receive"), /authorized Branch/);
});

test("transfer-specific permission semantics are present", () => {
  assert.deepEqual(Object.values(policy.TRANSFER_PERMISSIONS), [
    "inventory.transfer.read",
    "inventory.transfer.create",
    "inventory.transfer.approve",
    "inventory.transfer.dispatch",
    "inventory.transfer.receive",
    "inventory.transfer.cancel",
  ]);
});

test("source uses canonical router and does not use old direct mutation authority", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/routes/transfer.routes.js"), "utf8");
  assert.match(routes, /router\.post\("\/"/);
  assert.match(routes, /router\.patch\("\/:id"/);
  assert.match(routes, /Idempotency-Key/);
  assert.match(routes, /fromLocationId/);
  assert.match(routes, /toLocationId/);
  assert.doesNotMatch(routes, /transfer\.update\(req\.body/);
});

test("migration active index matches runtime item statuses", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../migrations/20260823010000-transfer-active-status-index.js"), "utf8");
  assert.match(migration, /PENDING.*APPROVED.*IN_TRANSIT/);
  assert.match(migration, /REQUESTED.*APPROVED.*DISPATCHED/);
});
