const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const serviceSource = fs.readFileSync(path.join(root, "src/services/inventory-location.service.js"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "src/routes/inventory-location.routes.js"), "utf8");
const uiSource = fs.readFileSync(path.resolve(root, "../app/[locale]/(dashboard)/inventory/locations/page.tsx"), "utf8");
const migrationSource = fs.readFileSync(path.join(root, "migrations/20260804010000-inventory-master-core-profile-foundation.js"), "utf8");
const { normalizedNameKey } = require("../src/services/inventory-location.service");

test("G2B location normalization is whitespace-stable and case-insensitive", () => {
  assert.equal(normalizedNameKey("  QA   Location  "), "qa location");
  assert.equal(normalizedNameKey("QA Location"), normalizedNameKey("qa   location"));
});

test("G2B routes expose one canonical DB-backed management path", () => {
  assert.match(routeSource, /router\.get\("\/"/);
  assert.match(routeSource, /router\.post\("\/"/);
  assert.match(routeSource, /router\.patch\("\/:id"/);
  assert.match(routeSource, /router\.post\("\/:id\/disable"/);
  assert.doesNotMatch(routeSource, /router\.delete\(/);
  assert.match(routeSource, /authMiddleware/);
  assert.match(routeSource, /inventory\.view/);
  assert.match(routeSource, /inventory\.adjust/);
});

test("G2B service is company/branch server-authoritative and prevents active normalized duplicates", () => {
  assert.match(serviceSource, /where: \{ id: branchId, companyId, isActive: true \}/);
  assert.match(serviceSource, /where: \{ companyId, branchId, isActive: true/);
  assert.match(serviceSource, /normalizedNameKey\(row\.name\) === key/);
  assert.match(serviceSource, /LOCATION_SCOPE_IMMUTABLE/);
  assert.match(serviceSource, /companyId, branchId/);
  assert.match(serviceSource, /action: "location\.created"/);
  assert.match(serviceSource, /action: "location\.updated"/);
  assert.match(serviceSource, /action: "location\.disabled"/);
});

test("G2B UI supports management only and does not synthesize a fake production location", () => {
  assert.match(uiSource, /Inventory Locations|مواقع المخزون/);
  assert.match(uiSource, /Include disabled|إظهار المعطّل/);
  assert.match(uiSource, /\/inventory\/locations/);
  assert.doesNotMatch(uiSource, /Showroom|Main Warehouse|Default Location/);
});

test("existing schema already satisfies G2B location authority without a migration", () => {
  assert.match(migrationSource, /createTable\("inventory_locations"/);
  assert.match(migrationSource, /branch_id:/);
  assert.match(migrationSource, /is_active:/);
  assert.match(migrationSource, /inventory_locations_company_branch_code_uq/);
});
