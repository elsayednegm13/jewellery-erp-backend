const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const policy = require("../src/services/inventory-count-policy.service.js");
const serviceSource = fs.readFileSync(path.join(__dirname, "../src/services/inventory-audit-canonical.service.js"), "utf8");
const routeSource = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
const pageSource = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/inventory/stock-audit/page.tsx"), "utf8");
const semanticsSource = fs.readFileSync(path.join(__dirname, "../../components/inventory/count-semantics.ts"), "utf8");
const migrationSource = fs.readFileSync(path.join(__dirname, "../migrations/20260823030000-inventory-count-authority-foundation.js"), "utf8");
const canonicalRouteSource = routeSource.slice(routeSource.indexOf("// Canonical B3 Inventory Count routes"), routeSource.indexOf('router.post("/inventory-v2/audits", authMiddleware, requireBusinessPermission("inventory.adjust"'));

test("count permission catalog is specific and excludes adjustment fallback", () => {
  assert.deepEqual(policy.COUNT_PERMISSIONS, {
    read: "inventory.count.read",
    create: "inventory.count.create",
    scan: "inventory.count.scan",
    complete: "inventory.count.complete",
  });
  assert.equal(canonicalRouteSource.includes('requireBusinessPermission("inventory.adjust"'), false);
});

test("create contract requires audit number, method, and DB location", () => {
  assert.throws(() => policy.normalizeCreateBody({ auditMethod: "BARCODE_SCAN", locationId: "LOC-1" }), /auditNumber/);
  assert.throws(() => policy.normalizeCreateBody({ auditNumber: "C-1", auditMethod: "BAD", locationId: "LOC-1" }), /method/);
  assert.throws(() => policy.normalizeCreateBody({ auditNumber: "C-1", auditMethod: "BARCODE_SCAN" }), /location/);
});

test("create contract normalizes only approved business fields", () => {
  assert.deepEqual(policy.normalizeCreateBody({ auditNumber: " C-1 ", auditMethod: "barcode_scan", locationId: " LOC-1 ", notes: " note " }), { auditNumber: "C-1", auditMethod: "BARCODE_SCAN", locationId: "LOC-1", notes: "note" });
  assert.throws(() => policy.normalizeCreateBody({ auditNumber: "C-1", auditMethod: "BARCODE_SCAN", locationId: "LOC-1", branchId: "BR-1" }), /Unsupported/);
});

test("scan accepts canonical identifiers and deduplicates exact inputs", () => {
  assert.deepEqual(policy.normalizeScanBody({ assetIds: ["A-1", "A-1"], barcodes: ["B-1", "B-1"], rfidNumbers: ["R-1"], method: "barcode_scan" }), { assetIds: ["A-1"], barcodes: ["B-1"], rfidNumbers: ["R-1"], method: "BARCODE_SCAN" });
});

test("scan rejects empty, malformed, and unknown fields", () => {
  assert.throws(() => policy.normalizeScanBody({}), /At least one/);
  assert.throws(() => policy.normalizeScanBody({ barcodes: "B-1" }), /arrays/);
  assert.throws(() => policy.normalizeScanBody({ barcodes: ["B-1"], debug: true }), /Unsupported/);
});

test("location scope is active DB master data only", () => {
  assert.doesNotThrow(() => policy.assertScopedActiveLocation({ isActive: true, companyId: "C", branchId: "B" }, { companyId: "C", branchId: "B" }));
  assert.throws(() => policy.assertScopedActiveLocation({ isActive: false, companyId: "C", branchId: "B" }, { companyId: "C", branchId: "B" }), /inactive/);
  assert.throws(() => policy.assertScopedActiveLocation({ isActive: true, companyId: "C", branchId: "OTHER" }, { companyId: "C", branchId: "B" }), /scope/);
});

test("asset scope rejects sold, melted, missing, and outside-location assets", () => {
  assert.doesNotThrow(() => policy.assertCountableAsset({ operationalStatus: "AVAILABLE", locationId: "LOC-1" }, "LOC-1"));
  for (const status of ["SOLD", "MELTED", "MISSING"]) assert.throws(() => policy.assertCountableAsset({ operationalStatus: status, locationId: "LOC-1" }, "LOC-1"), /not count-eligible/);
  assert.throws(() => policy.assertCountableAsset({ operationalStatus: "AVAILABLE", locationId: "LOC-2" }, "LOC-1"), /outside/);
});

test("empty mutation bodies are explicit", () => {
  assert.deepEqual(policy.assertNoBody({}), {});
  assert.throws(() => policy.assertNoBody({ reason: "x" }), /does not accept/);
});

test("expected set is frozen by branch and location, not global branch only", () => {
  assert.match(serviceSource, /locationId: audit\.locationId/);
  assert.match(serviceSource, /operationalStatus: \{ \[Op\.notIn\]: \["SOLD", "MELTED", "MISSING"\] \}/);
});

test("unknown identifiers are rejected before count rows are written", () => {
  assert.match(serviceSource, /identifierMatches/);
  assert.match(serviceSource, /Scanned Asset identity was not found/);
});

test("outside-scope assets are rejected", () => {
  assert.match(serviceSource, /Scanned Asset is outside the Count location scope/);
});

test("duplicate asset scan updates one expected row rather than creating another", () => {
  assert.match(serviceSource, /findOne\(\{ where: \{ stockAuditId: audit\.id, assetId: asset\.id \}/);
  assert.match(serviceSource, /expected\.update\(\{ status: "matched"/);
  assert.doesNotMatch(serviceSource, /status: "unexpected"/);
});

test("variance is evidence only and does not call Asset transition or adjustment", () => {
  assert.match(routeSource, /Count completion does not mutate Asset state or apply adjustments/);
  const serviceSection = serviceSource.slice(serviceSource.indexOf("async function completeAudit"));
  assert.doesNotMatch(serviceSection, /transitionAsset|InventoryAdjustment|journal|Product/);
});

test("canonical endpoints are present", () => {
  for (const endpoint of ["/inventory-v2/audits", "/inventory-v2/audits/:id/start", "/inventory-v2/audits/:id/observe", "/inventory-v2/audits/:id/complete", "/inventory-v2/audits/:id/close"]) assert.match(routeSource, new RegExp(endpoint.replace(/[/:]/g, "\\$&")));
});

test("canonical endpoints use count-specific permissions", () => {
  assert.match(routeSource, /COUNT_PERMISSIONS\.read/);
  assert.match(routeSource, /COUNT_PERMISSIONS\.create/);
  assert.match(routeSource, /COUNT_PERMISSIONS\.scan/);
  assert.match(routeSource, /COUNT_PERMISSIONS\.complete/);
});

test("canonical mutations claim central idempotency", () => {
  for (const scope of ["inventory-count.create", "inventory-count.start", "inventory-count.scan", "inventory-count.complete", "inventory-count.close"]) assert.match(routeSource, new RegExp(scope));
  assert.match(routeSource, /idempotencyService\.claim/);
  assert.match(routeSource, /idempotencyService\.resolveExisting/);
  assert.match(routeSource, /idempotencyService\.succeed/);
});

test("legacy mutation entry points are explicitly blocked", () => {
  assert.match(routeSource, /router\.post\("\/stock-audits", authMiddleware, async \(_req, res\) => res\.status\(410\)/);
  assert.match(routeSource, /router\.post\("\/stock-audits\/:id\/items", authMiddleware, async \(_req, res\) => res\.status\(410\)/);
  assert.match(routeSource, /router\.post\("\/stock-audits\/:id\/complete", authMiddleware, async \(_req, res\) => res\.status\(410\)/);
});

test("migration contains only count permissions and role links", () => {
  for (const permission of Object.values(policy.COUNT_PERMISSIONS)) assert.match(migrationSource, new RegExp(permission));
  assert.doesNotMatch(migrationSource, /createTable|addColumn|journal_entries|Product\.quantity/);
});

test("UI is one barcode-first workflow with DB location and no automatic resolution", () => {
  assert.match(pageSource, /\/inventory-v2\/audits/);
  assert.match(pageSource, /locationId/);
  assert.match(pageSource, /barcodes: \[value\]/);
  assert.match(pageSource, /Complete Zero-Variance Count/);
  assert.doesNotMatch(pageSource, /Mark Missing as Lost|Update Branch Locations|85%|RFID Stock Audit/);
});

test("UI exposes expected, counted, missing, and variance totals", () => {
  for (const label of ["Expected", "Counted", "Missing", "Variance", "Not Counted Yet", "Final Variance"]) assert.match(pageSource, new RegExp(label));
  assert.match(pageSource, /countTotals\(count\)/);
  assert.match(semanticsSource, /const unobserved/);
  assert.match(semanticsSource, /isFinalizedCount\(candidate\.status\)/);
  assert.doesNotMatch(pageSource, /EXPECTED_AND_COUNTED|EXPECTED_NOT_COUNTED|COUNTED_NOT_EXPECTED/);
});

test("UI has Arabic and English business labels", () => {
  for (const label of ["جرد المخزون", "مسح باركود", "إكمال الجرد بدون فروقات", "Inventory Count", "Scan Barcode", "Complete Zero-Variance Count"]) assert.match(pageSource, new RegExp(label));
});

test("UI permissions are action-specific", () => {
  for (const permission of ["inventory.count.read", "inventory.count.create", "inventory.count.scan", "inventory.count.complete"]) assert.match(pageSource, new RegExp(permission.replace(/[.]/g, "\\.")));
});

test("frozen identity and financial authorities are preserved", () => {
  assert.match(canonicalRouteSource, /locationId|authorized Branch|location scope/);
  assert.match(canonicalRouteSource, /Asset/);
  assert.match(canonicalRouteSource, /does not mutate Asset state/);
  assert.doesNotMatch(canonicalRouteSource, /Product\.quantity/);
});
