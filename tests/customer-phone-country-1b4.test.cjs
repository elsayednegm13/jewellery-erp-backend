const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const phoneService = require("../src/services/customer-phone.service");
const duplicateService = require("../src/services/customer-duplicate-detection.service");

test("CRM-1B4 accepts explicit supported ISO phone countries only", () => {
  assert.equal(phoneService.normalizePhoneCountry("eg"), "EG");
  assert.equal(phoneService.normalizePhoneCountry("AE"), "AE");
  assert.equal(phoneService.normalizePhoneCountry("Egypt"), "");
  assert.equal(phoneService.normalizePhoneCountry("E1"), "");
  assert.equal(phoneService.normalizePhoneCountry(""), "");
});

test("EG local, international and 00 forms resolve to one E.164 identity", () => {
  const values = ["01013054967", "+201013054967", "00201013054967"]
    .map((value) => phoneService.canonicalizeCustomerPhone(value, "EG"));
  assert.deepEqual(values.map((value) => value.canonicalPhone), [
    "+201013054967", "+201013054967", "+201013054967",
  ]);
  assert.ok(values.every((value) => value.isValid && value.phoneCountry === "EG"));
});

test("AE and SA local, international and 00 forms resolve correctly", () => {
  for (const [country, expected] of [["AE", "+971501234567"], ["SA", "+966501234567"]]) {
    for (const value of [
      "0501234567",
      expected,
      `00${expected.slice(1)}`,
    ]) {
      const result = phoneService.canonicalizeCustomerPhone(value, country);
      assert.equal(result.canonicalPhone, expected);
      assert.equal(result.isValid, true);
    }
  }
});

test("same local digits in different countries do not collide", () => {
  const ae = phoneService.canonicalizeCustomerPhone("0501234567", "AE");
  const sa = phoneService.canonicalizeCustomerPhone("0501234567", "SA");
  assert.notEqual(ae.canonicalPhone, sa.canonicalPhone);
});

test("invalid, missing, extension and country-mismatch inputs fail closed", () => {
  assert.equal(phoneService.canonicalizeCustomerPhone("01013054967", undefined).errorCode, "CUSTOMER_PHONE_COUNTRY_REQUIRED");
  assert.equal(phoneService.canonicalizeCustomerPhone("not-a-phone", "EG").errorCode, "CUSTOMER_PHONE_INVALID");
  assert.equal(phoneService.canonicalizeCustomerPhone("01013054967 ext 4", "EG").errorCode, "CUSTOMER_PHONE_INVALID");
  assert.equal(phoneService.canonicalizeCustomerPhone("+971501234567", "EG").errorCode, "CUSTOMER_PHONE_COUNTRY_MISMATCH");
  assert.throws(
    () => phoneService.assertCanonicalCustomerPhone("01013054967", ""),
    (error) => error.statusCode === 422 && error.errorCode === "CUSTOMER_PHONE_COUNTRY_REQUIRED",
  );
});

test("duplicate service uses canonicalPhone when the server has resolved it", () => {
  const signals = duplicateService.buildDuplicateSignals({
    name: "A Customer",
    phone: "01013054967",
    canonicalPhone: "+201013054967",
  });
  assert.equal(signals.canonicalPhone, "+201013054967");
  assert.equal(signals.phone, "");
  assert.deepEqual(signals.signalsEvaluated, ["PHONE_CANONICAL", "NAME_CASEFOLDED"]);
  assert.equal(
    duplicateService.classifyCandidate({ id: "CUS-1", name: "Other", phone: "000", canonicalPhone: "+201013054967" }, signals).classification,
    "EXACT_NORMALIZED_PHONE_MATCH",
  );
});

test("CRM-1B2 remains historical and the superseding migration owns persisted fields", () => {
  const oldMigration = fs.readFileSync(path.join(__dirname, "../migrations/20260830010000-customer-phone-uniqueness.js"), "utf8");
  const migration = fs.readFileSync(path.join(__dirname, "../migrations/20260830020000-customer-phone-country-canonical.js"), "utf8");
  assert.match(oldMigration, /ltrim\(regexp_replace\(phone/);
  assert.match(migration, /default_phone_country/);
  assert.match(migration, /phone_country/);
  assert.match(migration, /canonical_phone/);
  assert.match(migration, /CREATE UNIQUE INDEX/);
  assert.match(migration, /DROP INDEX IF EXISTS/);
});

test("customer and POS production boundaries require server canonical authority", () => {
  const controller = fs.readFileSync(path.join(__dirname, "../src/controllers/erp.controller.js"), "utf8");
  const routes = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
  assert.match(controller, /assertCanonicalCustomerPhone\(payload\.phone, payload\.phoneCountry\)/);
  assert.match(controller, /payload\.canonicalPhone = phone\.canonicalPhone/);
  assert.match(controller, /attributes: \["id", "phone", "phoneCountry", "canonicalPhone"\]/);
  assert.match(routes, /assertCanonicalCustomerPhone\(req\.query\.phone, req\.query\.phoneCountry\)/);
  assert.match(routes, /canonical_phone = :canonicalPhone/);
});

test("raw phone and canonical phone are distinct model authorities", () => {
  const model = fs.readFileSync(path.join(__dirname, "../src/models/customer.model.js"), "utf8");
  assert.match(model, /phoneCountry:/);
  assert.match(model, /field: "phone_country"/);
  assert.match(model, /canonicalPhone:/);
  assert.match(model, /field: "canonical_phone"/);
  assert.match(model, /phone:/);
});

test("company default country is a separate UI-default field", () => {
  const model = fs.readFileSync(path.join(__dirname, "../src/models/company.model.js"), "utf8");
  const routes = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
  assert.match(model, /defaultPhoneCountry:/);
  assert.match(model, /field: "default_phone_country"/);
  assert.match(routes, /defaultPhoneCountry must be a supported two-letter country code or empty/);
});

test("Customer and POS UI expose the same explicit country selector without changing business fields", () => {
  const customerList = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/customers/page.tsx"), "utf8");
  const customerDetail = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/customers/[id]/page.tsx"), "utf8");
  const pos = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/pos/page.tsx"), "utf8");
  const selector = fs.readFileSync(path.join(__dirname, "../../features/customers/components/PhoneCountrySelect.tsx"), "utf8");
  for (const source of [customerList, customerDetail]) assert.match(source, /PhoneCountrySelect/);
  assert.doesNotMatch(pos, /PhoneCountrySelect/);
  assert.match(selector, /PHONE_COUNTRY_OPTIONS/);
  assert.match(selector, /Select country/);
  assert.match(selector, /اختر الدولة/);
  assert.doesNotMatch(customerList, /nationality.*phoneCountry|phoneCountry.*nationality/);
});

test("customer duplicate preflight preserves the explicit phone country", () => {
  const hook = fs.readFileSync(path.join(__dirname, "../../hooks/use-customers.ts"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "../../lib/repositories/api-impl.ts"), "utf8");
  assert.match(hook, /findPotentialDuplicates\(\{\s*name: input\.name,\s*phone: input\.phone,\s*phoneCountry: input\.phoneCountry,\s*\}\)/s);
  assert.match(repository, /if \(input\.phoneCountry\) params\.set\("phoneCountry", input\.phoneCountry\)/);
});
