const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
const routeSource = fs.readFileSync(path.join(repo, "backend/src/routes/erp.routes.js"), "utf8");
const posSource = fs.readFileSync(path.join(repo, "app/[locale]/(dashboard)/pos/page.tsx"), "utf8");
const toolbarSource = fs.readFileSync(path.join(repo, "components/ui/data-toolbar.tsx"), "utf8");
const routeStart = routeSource.indexOf('router.get("/pos/search"');
const routeEnd = routeSource.indexOf('router.get("/products/:id/movements"', routeStart);
const searchRoute = routeSource.slice(routeStart, routeEnd);

test("POS universal search contract is bounded and branch/permission scoped", () => {
  assert.ok(routeStart >= 0, "bounded /pos/search route exists");
  assert.match(searchRoute, /authMiddleware/);
  assert.match(searchRoute, /requireAnyBusinessPermission\(\["pos\.view", "pos\.sell"\]\)/);
  assert.match(searchRoute, /resolveAuthorizedBranchId\(req/);
  assert.match(searchRoute, /Math\.min\(Math\.max/);
  assert.match(searchRoute, /\blimit,\s/);
  assert.match(searchRoute, /companyId: req\.companyId/);
  assert.match(searchRoute, /branchId/);
  assert.match(searchRoute, /productCode/);
  assert.match(searchRoute, /barcode/);
  assert.match(searchRoute, /productName/);
  assert.match(searchRoute, /operationalStatus/);
  assert.match(searchRoute, /isSalePricingProfile/);
  assert.match(searchRoute, /resolveCanonicalSellingGoldRate/);
  assert.match(searchRoute, /calculateGoldSalePriceForAsset/);
  assert.doesNotMatch(searchRoute, /\b(unitCost|averageCost|acquisitionCost|purchaseCost)\b[^\n]*:/, "acquisition-cost fields are not projected");
  assert.doesNotMatch(searchRoute, /\bcost\s*:/, "cost is not projected in the search DTO");
  assert.doesNotMatch(searchRoute, /\b(INSERT|UPDATE|DELETE|create|destroy|bulkCreate)\b/);
});

test("POS search uses debounce, abort, and latest-generation protection", () => {
  assert.match(posSource, /new AbortController\(\)/);
  assert.match(posSource, /searchGenerationRef/);
  assert.match(posSource, /generation !== searchGenerationRef\.current/);
  assert.match(posSource, /query\.trim\(\) \? 250 : 0/);
  assert.match(posSource, /setSearchOpen\(false\)/);
  assert.match(posSource, /handleSearchKeyDown/);
  assert.match(toolbarSource, /onInputKeyDown/);
  assert.match(toolbarSource, /inputAriaExpanded/);
});

test("POS customer panel is read-only and shows canonical customer identity details", () => {
  assert.match(posSource, /selectedCustomerAddress/);
  assert.match(posSource, /selectedCustomer\.name/);
  assert.match(posSource, /selectedCustomer\.phone/);
  assert.match(posSource, /selectedCustomer\.loyaltyPoints/);
  assert.match(posSource, /selectedCustomer\.balance/);
  assert.match(posSource, /addresses/);
  assert.match(posSource, /Address not registered|العنوان غير مسجل/);
  assert.match(posSource, /numeric-token/);
});

test("POS search keeps unavailable exact matches disabled and never adds them to cart", () => {
  assert.match(posSource, /item as any\)\.unavailable/);
  assert.match(posSource, /disabled=\{priceUnavailable\}/);
  assert.match(posSource, /if \(\(item as any\)\.unavailable\)/);
  assert.match(posSource, /includeUnavailableExact/);
  assert.match(searchRoute, /availabilityReason/);
});
