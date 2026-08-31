const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const pageSource = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/pos/page.tsx"), "utf8");
const hookSource = fs.readFileSync(path.join(root, "features/sales/hooks/use-pos.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "backend/src/routes/erp.routes.js"), "utf8");
const phoneSource = fs.readFileSync(path.join(root, "backend/src/services/customer-phone.service.js"), "utf8");
const searchRouteSource = routeSource.split('router.get("/pos/customers/search"')[1].split('setupCrud("customers"')[0];

test("phone search interpretation supports international input without country inference", () => {
  const { normalizeCustomerPhoneSearchInput } = require("../src/services/customer-phone.service");

  const international = normalizeCustomerPhoneSearchInput("00971 50 123 4567");
  assert.equal(international.canonicalPhone, "+971501234567");
  assert.equal(international.isExactCanonical, true);

  const local = normalizeCustomerPhoneSearchInput("050 123 4567");
  assert.equal(local.canonicalPhone, null);
  assert.equal(local.isExactCanonical, false);
  assert.equal(local.digits, "0501234567");

  assert.match(phoneSource, /Read-only POS search interpretation/i);
});

test("customer search route is authenticated, company/branch scoped, bounded, and read-only", () => {
  assert.match(routeSource, /router\.get\("\/pos\/customers\/search"/);
  assert.match(searchRouteSource, /authMiddleware/);
  assert.match(searchRouteSource, /requireAnyBusinessPermission\(\["pos\.view", "pos\.sell"\]\)/);
  assert.match(searchRouteSource, /resolveAuthorizedBranchId[\s\S]*required: true/);
  assert.match(searchRouteSource, /c\.company_id = :companyId/);
  assert.match(searchRouteSource, /bc\.branch_id = :branchId/);
  assert.match(searchRouteSource, /bc\.is_active = TRUE/);
  assert.match(searchRouteSource, /c\.status = 'active'/);
  assert.match(searchRouteSource, /c\.deleted_at IS NULL/);
  assert.doesNotMatch(searchRouteSource, /SELECT DISTINCT/i);
  assert.match(searchRouteSource, /SELECT 1[\s\S]*FROM branch_customers bc[\s\S]*bc\.customer_id = c\.id/);
  assert.match(searchRouteSource, /CAST\(:branchId AS VARCHAR\) AS "branchId"/);
  assert.match(searchRouteSource, /LIMIT \$\{phoneInput\.isExactCanonical \? 2 : limit\}/);
  assert.match(searchRouteSource, /CUSTOMER_PHONE_AMBIGUOUS/);
  assert.match(searchRouteSource, /phoneCountry/);
  assert.doesNotMatch(searchRouteSource, /SELECT[^;]+email/i);
  assert.doesNotMatch(searchRouteSource, /\.(create|update|destroy|save)\s*\(/);
  assert.doesNotMatch(searchRouteSource, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});

test("POS API mode does not preload the full customer collection", () => {
  assert.match(hookSource, /return EMPTY_API_CUSTOMERS/);
  assert.doesNotMatch(hookSource, /\buseQuery\s*\(/);
  assert.doesNotMatch(hookSource, /apiCustomers/);
  assert.doesNotMatch(hookSource, /queryKeys\.customers/);
  assert.match(pageSource, /useCoreErpData\(\{ enabled: !isApi \}\)/);
});

test("POS uses one explicit customer combobox with keyboard and no auto-selection", () => {
  assert.match(pageSource, /id="pos-customer-search"/);
  assert.match(pageSource, /role="combobox"/);
  assert.match(pageSource, /role="listbox"/);
  assert.match(pageSource, /role="option"/);
  assert.match(pageSource, /ArrowDown/);
  assert.match(pageSource, /ArrowUp/);
  assert.match(pageSource, /Escape/);
  assert.match(pageSource, /selectCustomer\(candidate\)/);
  assert.match(pageSource, /href="\/customers"/);
  assert.match(pageSource, /\/pos\/customers\/search\?query=/);
  assert.doesNotMatch(pageSource, /PhoneCountrySelect/);
  assert.doesNotMatch(pageSource, /const \[customerPhoneCountry/);
  assert.doesNotMatch(pageSource, /customers\[0\]\.id/);
  assert.doesNotMatch(pageSource, /lookupCustomerByPhone/);
  assert.match(pageSource, /const customer = selectedCustomer/);
});
