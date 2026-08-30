const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PHONE_MATCH,
  NAME_MATCH,
  normalizeName,
  buildDuplicateSignals,
  classifyCandidate,
  toMinimizedCandidate,
} = require("../src/services/customer-duplicate-detection.service");
const { normalizePhone } = require("../src/services/customer-phone.service");

const controllerSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "controllers", "erp.controller.js"),
  "utf8",
);
const routesSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "routes", "erp.routes.js"),
  "utf8",
);
const customerPageSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "app", "[locale]", "(dashboard)", "customers", "page.tsx"),
  "utf8",
);
const migrationSource = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "20260830010000-customer-phone-uniqueness.js"),
  "utf8",
);

test("phone duplicate signal reuses the existing deterministic normalizer", () => {
  assert.equal(normalizePhone("010 130-54967"), "1013054967");
  assert.equal(normalizePhone("1013054967"), "1013054967");
  assert.equal(normalizePhone("010 130-54967"), normalizePhone("1013054967"));
});

test("country-code mapping is not silently assumed by the current normalizer", () => {
  assert.notEqual(normalizePhone("+20 10 130 54967"), normalizePhone("010 130-54967"));
  assert.equal(normalizePhone("+20 10 130 54967"), "201013054967");
});

test("duplicate signal evaluation is deterministic and omits blank inputs", () => {
  assert.deepEqual(buildDuplicateSignals({ name: "  Elsayed Negm ", phone: "010-1" }), {
    phone: "101",
    name: "elsayed negm",
    signalsEvaluated: ["PHONE_NORMALIZED", "NAME_CASEFOLDED"],
  });
  assert.deepEqual(buildDuplicateSignals({ name: "  ", phone: "  " }), {
    phone: "",
    name: "",
    signalsEvaluated: [],
  });
  assert.equal(normalizeName("  Same Name  "), "same name");
});

test("exact normalized phone is a hard match while name remains a review signal", () => {
  const phoneSignals = buildDuplicateSignals({ name: "Different Person", phone: "01013054967" });
  assert.deepEqual(classifyCandidate({ name: "Existing Person", phone: "1013054967" }, phoneSignals), {
    classification: PHONE_MATCH,
    matchReasons: [PHONE_MATCH],
  });

  const nameSignals = buildDuplicateSignals({ name: "Existing Person", phone: "0500000000" });
  assert.deepEqual(classifyCandidate({ name: " existing person ", phone: "0501111111" }, nameSignals), {
    classification: NAME_MATCH,
    matchReasons: [NAME_MATCH],
  });
});

test("a candidate with both signals is classified without widening the signal set", () => {
  const signals = buildDuplicateSignals({ name: "Existing Person", phone: "01013054967" });
  assert.deepEqual(classifyCandidate({ name: "Existing Person", phone: "1013054967" }, signals), {
    classification: "MULTI_SIGNAL_MATCH",
    matchReasons: [PHONE_MATCH, NAME_MATCH],
  });
});

test("candidate DTO is minimized and only exposes branch relationship summaries", () => {
  const candidate = toMinimizedCandidate({
    id: "CUS-0001",
    name: "Existing Person",
    phone: "01013054967",
    email: "person@example.test",
    status: "active",
    tier: "Standard",
    branchRelationships: JSON.stringify([
      { branchId: "BR-1", isActive: true, balance: 999 },
      { branchId: "BR-2", isActive: false, privateNote: "do not expose" },
    ]),
    balance: 999,
    notes: "private note",
    addresses: [{ line1: "private address" }],
    kycDetails: { status: "verified" },
  }, buildDuplicateSignals({ name: "Existing Person", phone: "01013054967" }));

  assert.deepEqual(candidate, {
    candidateCustomerId: "CUS-0001",
    name: "Existing Person",
    phone: "01013054967",
    email: "person@example.test",
    status: "active",
    tier: "Standard",
    branchRelationships: [
      { branchId: "BR-1", isActive: true },
      { branchId: "BR-2", isActive: false },
    ],
    classification: "MULTI_SIGNAL_MATCH",
    matchReasons: [PHONE_MATCH, NAME_MATCH],
  });
  assert.equal("balance" in candidate, false);
  assert.equal("notes" in candidate, false);
  assert.equal("addresses" in candidate, false);
  assert.equal("kycDetails" in candidate, false);
});

test("server duplicate guard runs before the customer transaction", () => {
  const createStart = controllerSource.indexOf("createCustomerWithContract = async");
  const duplicateGuard = controllerSource.indexOf("findPotentialDuplicates", createStart);
  const transaction = controllerSource.indexOf("models.sequelize.transaction()", createStart);
  assert.ok(createStart >= 0, "customer create contract must exist");
  assert.ok(duplicateGuard > createStart, "customer create must call the duplicate service");
  assert.ok(transaction > duplicateGuard, "duplicate guard must run before opening a transaction");
  assert.match(controllerSource, /CUSTOMER_DUPLICATE_PHONE_REVIEW_REQUIRED/);
});

test("duplicate-check route is registered before generic customer id routing", () => {
  const duplicateRoute = routesSource.indexOf('router.get("/customers/duplicate-check"');
  const genericCrud = routesSource.indexOf('setupCrud("customers"');
  assert.ok(duplicateRoute >= 0, "read-only duplicate-check route must exist");
  assert.ok(genericCrud > duplicateRoute, "duplicate-check route must precede generic customer CRUD routes");
  assert.match(routesSource.slice(duplicateRoute, genericCrud), /requireAnyBusinessPermission/);
  assert.match(routesSource.slice(duplicateRoute, genericCrud), /req\.companyId/);
});

test("customer create UI performs review before create and exposes an explicit review state", () => {
  const duplicateLookup = customerPageSource.indexOf("findPotentialDuplicates(createPayload)");
  const createCall = customerPageSource.indexOf("addCustomer(createPayload)");
  assert.ok(duplicateLookup >= 0, "create UI must call the read-only duplicate lookup");
  assert.ok(createCall > duplicateLookup, "create UI must check duplicates before create");
  assert.match(customerPageSource, /data-testid=\"customer-duplicate-review\"/);
  assert.match(customerPageSource, /data-testid=\"customer-duplicate-review-ack\"/);
  assert.match(customerPageSource, /EXACT_NORMALIZED_PHONE_MATCH/);
});

test("phone uniqueness migration preflights invalid/colliding data and creates a deterministic functional unique index", () => {
  assert.match(migrationSource, /CUSTOMER_PHONE_CANONICALIZATION_INVALID_DATA/);
  assert.match(migrationSource, /CUSTOMER_PHONE_CANONICALIZATION_DUPLICATES_EXIST/);
  assert.match(migrationSource, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.match(migrationSource, /customers_company_id_canonical_phone_uq/);
  assert.match(migrationSource, /ltrim\(regexp_replace\(phone, '\[\^0-9\]', '', 'g'\), '0'\)/);
  assert.match(migrationSource, /DROP INDEX IF EXISTS/);
});

test("database phone uniqueness races map to the stable customer duplicate contract and do not consume generated IDs", () => {
  assert.match(controllerSource, /CUSTOMER_PHONE_UNIQUE_INDEX = "customers_company_id_canonical_phone_uq"/);
  assert.match(controllerSource, /isCustomerPhoneUniqueConstraintError/);
  assert.match(controllerSource, /customerPhoneConflictError\("DATABASE_UNIQUE_INDEX"\)/);
  const createStart = controllerSource.indexOf("createCustomerWithContract = async");
  const createLoop = controllerSource.indexOf("for (let attempt = 1; attempt <= attempts; attempt += 1)", createStart);
  const uniqueMapping = controllerSource.indexOf("isCustomerPhoneUniqueConstraintError(error)", createLoop);
  assert.ok(createLoop >= 0 && uniqueMapping > createLoop, "create must map the phone index inside the write loop");
  assert.match(controllerSource.slice(uniqueMapping, uniqueMapping + 260), /throw customerPhoneConflictError/);
  assert.match(controllerSource.slice(createStart, createLoop), /models\.Company\.findOne/);
  assert.match(controllerSource.slice(createStart, createLoop), /lock: transaction\.LOCK\.UPDATE/);
});

test("customer update performs the same company-scoped duplicate precheck while excluding the current identity", () => {
  const updateStart = controllerSource.indexOf("updateCustomerWithContract = async");
  const transaction = controllerSource.indexOf("models.sequelize.transaction()", updateStart);
  const duplicateGuard = controllerSource.indexOf("findPotentialDuplicates", updateStart);
  assert.ok(duplicateGuard > updateStart && duplicateGuard < transaction, "update phone precheck must run before its transaction");
  assert.match(controllerSource.slice(duplicateGuard, transaction), /excludeCustomerId: req\.params\.id/);
  assert.match(controllerSource.slice(duplicateGuard, transaction), /customerPhoneConflictError\("APPLICATION_PRECHECK"\)/);
  assert.match(controllerSource, /CUSTOMER_DUPLICATE_PHONE_REVIEW_REQUIRED/);
});

test("phone policy remains email-independent and does not add a second email uniqueness authority", () => {
  assert.doesNotMatch(migrationSource, /UNIQUE INDEX[^\n]*email/i);
  assert.doesNotMatch(controllerSource, /CUSTOMER_DUPLICATE_EMAIL/);
});
