const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const policy = require("../src/services/workshop-policy.service");
const runtime = require("../src/services/inventory-v2-runtime.service");
const idempotency = require("../src/services/idempotency.service");

test("Workshop send is Asset-only and requires a DB-backed Workshop location", () => {
  const body = policy.normalizeSendBody({ assetIds: ["B", "A"], workshopLocationId: "LOC-W", providerName: "Tech", notes: "repair" });
  assert.deepEqual(body.assetIds, ["A", "B"]);
  assert.equal(body.workshopLocationId, "LOC-W");
  assert.throws(() => policy.normalizeSendBody({ assetIds: ["A"] }), /WORKSHOP_LOCATION_ID_REQUIRED/);
  assert.throws(() => policy.normalizeSendBody({ assetIds: ["A", "A"], workshopLocationId: "LOC-W" }), /WORKSHOP_ASSET_IDS_DUPLICATE/);
  assert.throws(() => policy.normalizeSendBody({ assetIds: ["A"], workshopLocationId: "LOC-W", productId: "P" }), /WORKSHOP_SEND_UNKNOWN_FIELDS/);
});

test("Workshop completion requires an explicit validated return location", () => {
  assert.deepEqual(policy.normalizeCompleteBody({ returnLocationId: "LOC-RETURN", notes: "done" }), { returnLocationId: "LOC-RETURN", notes: "done" });
  assert.throws(() => policy.normalizeCompleteBody({ notes: "done" }), /WORKSHOP_RETURN_LOCATION_ID_REQUIRED/);
  assert.throws(() => policy.normalizeCompleteBody({ returnLocationId: "LOC-RETURN", assetId: "A" }), /WORKSHOP_COMPLETE_UNKNOWN_FIELDS/);
});

test("Company/Branch/location scope and lifecycle fail closed", () => {
  const active = { id: "LOC-1", companyId: "COMP-1", branchId: "BR-1", isActive: true };
  assert.equal(policy.assertScopedActiveLocation(active, { companyId: "COMP-1", branchId: "BR-1" }), active);
  assert.throws(() => policy.assertScopedActiveLocation({ ...active, branchId: "BR-2" }, { companyId: "COMP-1", branchId: "BR-1" }), /SCOPE_INVALID/);
  assert.throws(() => policy.assertScopedActiveLocation({ ...active, isActive: false }, { companyId: "COMP-1", branchId: "BR-1" }), /INACTIVE/);
  assert.doesNotThrow(() => policy.assertOrderCanComplete({ status: "SENT" }));
  assert.throws(() => policy.assertOrderCanComplete({ status: "RETURNED" }), /WORKSHOP_ORDER_NOT_SENT/);
});

test("Workshop permissions and status transitions are explicit", () => {
  assert.deepEqual(Object.values(policy.WORKSHOP_PERMISSIONS), [
    "inventory.workshop.read",
    "inventory.workshop.send",
    "inventory.workshop.complete",
    "inventory.workshop.cancel",
  ]);
  assert.equal(runtime.TRANSITIONS.AVAILABLE.has("WORKSHOP"), true);
  assert.equal(runtime.TRANSITIONS.WORKSHOP.has("AVAILABLE"), true);
  assert.equal(runtime.TRANSITIONS.WORKSHOP.has("SOLD"), false);
});

test("Canonical idempotency hash makes exact replay equal and changed payload different", () => {
  const body = policy.normalizeSendBody({ assetIds: ["A"], workshopLocationId: "LOC-W", notes: "same" });
  const first = idempotency.hashRequest("workshop.send", body, { branchId: "BR-1" });
  const replay = idempotency.hashRequest("workshop.send", { ...body, assetIds: ["A"] }, { branchId: "BR-1" });
  const changed = idempotency.hashRequest("workshop.send", { ...body, notes: "changed" }, { branchId: "BR-1" });
  assert.equal(first, replay);
  assert.notEqual(first, changed);
});

test("Workshop routes use specific permissions, central idempotency, and custody locations", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
  assert.match(routes, /workshopPolicy\.WORKSHOP_PERMISSIONS\.read/);
  assert.match(routes, /workshopPolicy\.WORKSHOP_PERMISSIONS\.send/);
  assert.match(routes, /workshopPolicy\.WORKSHOP_PERMISSIONS\.complete/);
  assert.match(routes, /idempotencyService\.claim/);
  assert.match(routes, /idempotencyService\.succeed/);
  assert.match(routes, /toLocationId: workshopLocation\.id/);
  assert.match(routes, /toLocationId: returnLocation\.id/);
  assert.doesNotMatch(routes, /workshop-orders.*requireBusinessPermission\("inventory\.adjust"/);
});

test("Workshop schema migration adds custody and return location authority", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../migrations/20260823020000-workshop-authority-foundation.js"), "utf8");
  assert.match(migration, /workshop_location_id/);
  assert.match(migration, /return_location_id/);
  assert.match(migration, /inventory\.workshop\.send/);
  assert.match(migration, /role_permissions/);
});

test("Workshop UI is one canonical branch-scoped workflow", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/inventory/workshop/page.tsx"), "utf8");
  assert.match(page, /inventory-v2\/workshop-orders/);
  assert.match(page, /workshopLocationId/);
  assert.match(page, /returnLocationId/);
  assert.match(page, /inventory\.workshop\.send/);
  assert.match(page, /inventory\.workshop\.complete/);
  assert.doesNotMatch(page, /productId|quantity/);
});
