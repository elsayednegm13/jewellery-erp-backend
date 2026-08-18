const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");

const models = require("../src/models");
const taxEngine = require("../src/services/uae-tax-engine.service");
const policyService = require("../src/services/company-tax-policy.service");

test("G2A1 tax engine is UAE-scoped with the exact five treatments and legal metadata", () => {
  const metadata = taxEngine.getUaeTaxEngineMetadata();
  assert.equal(metadata.jurisdiction, "UAE");
  assert.equal(metadata.legalStandardVatRate, 5);
  assert.deepEqual(metadata.supportedTaxTreatments, [
    "STANDARD_VAT", "ZERO_RATED", "REVERSE_CHARGE", "EXEMPT", "OUT_OF_SCOPE",
  ]);
  assert.equal(metadata.transactionLegalEligibilityImplemented, true);
  assert.throws(() => taxEngine.validateCompanyTaxPolicy({ enabledTaxTreatments: ["STANDARD_VAT", "UNKNOWN"] }), /unsupported/);
  assert.throws(() => taxEngine.validateCompanyTaxPolicy({ enabledTaxTreatments: ["STANDARD_VAT", "STANDARD_VAT"] }), /unique/);
});

test("vat registration is typed and independent from TRN and operational vatEnabled", async () => {
  const originalCompanyFind = models.Company.findByPk;
  const originalSettingsFind = models.Setting.findAll;
  models.Company.findByPk = async () => ({ vatRegistered: null, taxNumber: "TRN-SYNTHETIC", currency: "AED" });
  models.Setting.findAll = async () => [{ key: "vatEnabled", value: true }];
  try {
    const policy = await policyService.getCompanyTaxPolicy("COMP-SYNTHETIC");
    assert.equal(policy.vatRegistered, null);
    assert.equal(policy.trn, "TRN-SYNTHETIC");
    assert.equal(policy.vatEnabled, true);
    assert.equal(policy.configured, true);
    assert.throws(() => taxEngine.validateCompanyTaxPolicy({ vatRegistered: "true" }), /boolean/);
    assert.throws(() => taxEngine.validateCompanyTaxPolicy({ vatEnabled: "false" }), /boolean/);
  } finally {
    models.Company.findByPk = originalCompanyFind;
    models.Setting.findAll = originalSettingsFind;
  }
});

test("policy validation requires an enabled default and accepts explicit unset values", () => {
  assert.throws(() => taxEngine.validateCompanyTaxPolicy({
    enabledTaxTreatments: ["STANDARD_VAT"],
    defaultTaxTreatment: "EXEMPT",
  }), /must be enabled/);
  assert.throws(() => taxEngine.validateCompanyTaxPolicy({
    enabledTaxTreatments: null,
    defaultTaxTreatment: "STANDARD_VAT",
  }), /must be enabled/);
  assert.equal(taxEngine.validateCompanyTaxPolicy({
    vatRegistered: null,
    vatRate: null,
    enabledTaxTreatments: null,
    defaultTaxTreatment: null,
    preciousGoodsRcmEnabled: null,
    vatEnabled: null,
  }), true);
});

test("company policy write persists only requested values and reads explicit nulls without fallback", async () => {
  const originalCompanyFind = models.Company.findByPk;
  const originalSettingsFind = models.Setting.findAll;
  const originalSettingFind = models.Setting.findOne;
  const originalSettingCreate = models.Setting.create;
  const rows = [];
  const company = {
    vatRegistered: null,
    taxNumber: null,
    update: async (values) => Object.assign(company, values),
  };
  models.Company.findByPk = async () => company;
  models.Setting.findAll = async () => rows;
  models.Setting.findOne = async ({ where }) => rows.find((row) => row.key === where.key) || null;
  models.Setting.create = async (values) => { rows.push({ ...values }); return rows.at(-1); };
  try {
    const result = await policyService.updateCompanyTaxPolicy({
      companyId: "COMP-SYNTHETIC",
      patch: {
        vatRegistered: false,
        vatRate: 5,
        enabledTaxTreatments: ["STANDARD_VAT", "ZERO_RATED"],
        defaultTaxTreatment: "STANDARD_VAT",
        preciousGoodsRcmEnabled: false,
        vatEnabled: true,
      },
      transaction: { LOCK: { UPDATE: "UPDATE" } },
    });
    assert.equal(result.after.vatRegistered, false);
    assert.equal(result.after.vatRate, 5);
    assert.deepEqual(result.after.enabledTaxTreatments, ["STANDARD_VAT", "ZERO_RATED"]);
    assert.equal(result.after.defaultTaxTreatment, "STANDARD_VAT");
    assert.equal(result.after.preciousGoodsRcmEnabled, false);
    assert.equal(rows.length, 5);
  } finally {
    models.Company.findByPk = originalCompanyFind;
    models.Setting.findAll = originalSettingsFind;
    models.Setting.findOne = originalSettingFind;
    models.Setting.create = originalSettingCreate;
  }
});

test("route has server-authoritative tax policy and no client company override", () => {
  const route = fs.readFileSync("src/routes/erp.routes.js", "utf8");
  assert.match(route, /hasFrozenTaxPolicyAuthority/);
  assert.match(route, /companyTaxPolicyService\.getCompanyTaxPolicy\(req\.companyId\)/);
  assert.match(route, /companyTaxPolicyService\.updateCompanyTaxPolicy/);
  assert.match(route, /TAX_POLICY_INPUT_KEYS\.has\(req\.params\.key\)/);
  assert.match(route, /company\.vat_registration\.updated/);
  assert.match(route, /company\.tax_policy\.updated/);
});

test("migration is additive, nullable, has no default/backfill, and is the next timestamp", () => {
  const migration = fs.readFileSync("migrations/20260818020000-add-company-vat-registered.js", "utf8");
  assert.match(migration, /addColumn\("companies", "vat_registered"/);
  assert.match(migration, /allowNull: true/);
  assert.doesNotMatch(migration, /defaultValue/);
  assert.doesNotMatch(migration, /UPDATE|bulkInsert|bulkUpdate|backfill/i);
});
