const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const revision = require(path.join(root, "src/services/asset-revision.service.js"));
const idempotency = require(path.join(root, "src/services/idempotency.service.js"));

test("C2C2 registers the exact revision permission pair and canonical routes", () => {
  const catalog = fs.readFileSync(path.join(root, "src/bootstrap/permission-catalog-v2.js"), "utf8");
  const routes = fs.readFileSync(path.join(root, "src/routes/asset-revision.routes.js"), "utf8");
  assert.match(catalog, /inventory\.revision\.create/);
  assert.match(catalog, /inventory\.revision\.view/);
  assert.match(routes, /\/assets\/:assetId\/revisions/);
  assert.match(routes, /requireRevisionPermission/);
  assert.match(routes, /REVISION_PERMISSION_DENIED/);
  assert.doesNotMatch(routes, /requireBusinessPermission\("inventory\.adjust"/);
});

test("C2C2 allowlist and dedicated field boundary are fail-closed", () => {
  assert.deepEqual(revision.GENERAL_ALLOWED_FIELDS, ["name", "description", "category", "brand", "notes"]);
  assert.throws(() => revision.normalizeRequest({ changes: { barcode: "no" }, reason: "x", sourceOperation: "test", expectedUpdatedAt: new Date().toISOString() }), (error) => error.errorCode === "REVISION_DEDICATED_OPERATION_REQUIRED");
  assert.throws(() => revision.normalizeRequest({ changes: { unknown: "no" }, reason: "x", sourceOperation: "test", expectedUpdatedAt: new Date().toISOString() }), (error) => error.errorCode === "REVISION_FIELD_NOT_ALLOWED");
});

test("C2C2 requires a stale-write precondition and rejects non-string implicit coercion", () => {
  assert.throws(() => revision.normalizeRequest({ changes: { name: "x" }, reason: "x", sourceOperation: "test" }), (error) => error.errorCode === "REVISION_CONCURRENT_CONFLICT");
  assert.throws(() => revision.normalizeRequest({ changes: { name: 1 }, reason: "x", sourceOperation: "test", expectedUpdatedAt: new Date().toISOString() }), (error) => error.errorCode === "REVISION_VALUE_TYPE_INVALID");
});

test("C2C2 canonical comparison sorts object keys but preserves array order and types", () => {
  assert.equal(revision.valuesEqual({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
  assert.equal(revision.valuesEqual(["a", "b"], ["b", "a"]), false);
  assert.equal(revision.valuesEqual("1", 1), false);
  assert.equal(revision.valuesEqual(null, ""), false);
});

test("C2C2 reuses the central idempotency hash and excludes only the key", () => {
  const body = { changes: { name: "new" }, reason: "reason", sourceOperation: "test", sourceReference: "R1", expectedUpdatedAt: "2026-08-26T00:00:00.000Z" };
  const replay = { expectedUpdatedAt: body.expectedUpdatedAt, sourceReference: "R1", sourceOperation: "test", reason: "reason", changes: { name: "new" }, idempotencyKey: "different" };
  const changed = { ...body, reason: "changed" };
  assert.equal(idempotency.hashRequest(revision.IDEMPOTENCY_SCOPE, body, { assetId: "A1" }), idempotency.hashRequest(revision.IDEMPOTENCY_SCOPE, replay, { assetId: "A1" }));
  assert.notEqual(idempotency.hashRequest(revision.IDEMPOTENCY_SCOPE, body, { assetId: "A1" }), idempotency.hashRequest(revision.IDEMPOTENCY_SCOPE, changed, { assetId: "A1" }));
});

test("C2C2 storage and route scope do not add UI or a migration", () => {
  const routeIndex = fs.readFileSync(path.join(root, "src/routes/index.js"), "utf8");
  const service = fs.readFileSync(path.join(root, "src/services/asset-revision.service.js"), "utf8");
  assert.match(routeIndex, /assetRevisionRoutes/);
  assert.match(service, /AssetRevisionChange\.create/);
  assert.match(service, /ASSET_REVISION_RECORDED/);
  assert.match(service, /inventory_v2\.asset_revision_recorded/);
  assert.equal(fs.existsSync(path.join(root, "migrations/20260826010000-c2c2-revision.js")), false);
});
