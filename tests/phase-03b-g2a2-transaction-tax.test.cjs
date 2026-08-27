const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const tax = require("../src/services/transaction-tax-context.service");
const uae = require("../src/services/uae-tax-engine.service");
const PurchaseOrder = require("../src/models/purchaseOrder.model");

const basePolicy = {
  vatRegistered: true,
  vatRate: 5,
  enabledTaxTreatments: [...uae.SUPPORTED_TAX_TREATMENTS],
  defaultTaxTreatment: "STANDARD_VAT",
  preciousGoodsRcmEnabled: true,
};

const validRcm = {
  supplierVatRegistrationVerified: true,
  intendedForResaleOrProduction: true,
  requiredRecipientDeclarationObtained: true,
  supplierRetainedRequiredEvidence: true,
  preciousGoodsCategoryEligible: true,
  supplyStructureEligible: true,
  preciousComponentValueDominanceRequired: true,
  supplyKind: "JEWELLERY",
  preciousComponentValue: "1200.00",
  otherComponentValue: "200.00",
};

test("G2A2 exposes exactly the five canonical tax treatments", () => {
  assert.deepEqual(uae.SUPPORTED_TAX_TREATMENTS, ["STANDARD_VAT", "ZERO_RATED", "REVERSE_CHARGE", "EXEMPT", "OUT_OF_SCOPE"]);
});

test("G2A2 server-calculates Standard VAT and preserves the treatment", () => {
  const snapshot = tax.buildImmutableTaxSnapshot({
    requestedTaxTreatment: "STANDARD_VAT",
    companyPolicy: basePolicy,
    taxableBase: "100.01",
    roundingScale: 2,
  });
  assert.equal(snapshot.resolvedTaxTreatment, "STANDARD_VAT");
  assert.equal(snapshot.effectiveVatRate, 5);
  assert.equal(snapshot.taxableBase, 100.01);
  assert.equal(snapshot.vatAmount, 5);
  assert.equal(snapshot.vatRegisteredSnapshot, true);
});

test("G2A2 keeps Zero Rated, Exempt, and Out of Scope distinct", () => {
  const snapshots = ["ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"].map((requestedTaxTreatment) => tax.buildImmutableTaxSnapshot({
    requestedTaxTreatment,
    companyPolicy: basePolicy,
    taxableBase: 100,
  }));
  assert.deepEqual(snapshots.map((row) => row.resolvedTaxTreatment), ["ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]);
  assert.deepEqual(snapshots.map((row) => row.effectiveVatRate), [0, 0, 0]);
  assert.deepEqual(snapshots.map((row) => row.vatAmount), [0, 0, 0]);
});

test("G2A2 RCM fails closed for every missing legal evidence item", () => {
  const cases = [
    ["company policy disabled", { company: { preciousGoodsRcmEnabled: false }, code: "COMPANY_RCM_DISABLED" }],
    ["recipient not registered", { company: { vatRegistered: false }, code: "RECIPIENT_NOT_VAT_REGISTERED" }],
    ["supplier not verified", { context: { supplierVatRegistrationVerified: false }, code: "SUPPLIER_VAT_NOT_VERIFIED" }],
    ["resale intent missing", { context: { intendedForResaleOrProduction: false }, code: "RESALE_OR_PRODUCTION_INTENT_MISSING" }],
    ["declaration missing", { context: { requiredRecipientDeclarationObtained: false }, code: "RECIPIENT_DECLARATION_MISSING" }],
    ["evidence missing", { context: { supplierRetainedRequiredEvidence: false }, code: "SUPPLIER_EVIDENCE_NOT_RETAINED" }],
    ["category not eligible", { context: { preciousGoodsCategoryEligible: false }, code: "PRECIOUS_GOODS_CATEGORY_NOT_ELIGIBLE" }],
    ["dominance not proven", { context: { preciousComponentValueDominanceRequired: true, supplyKind: "JEWELLERY", preciousComponentValue: null, otherComponentValue: null }, code: "PRECIOUS_COMPONENT_DOMINANCE_NOT_PROVEN" }],
    ["Article 45 exclusion", { context: { zeroRatedArticle45Excluded: true }, code: "ZERO_RATED_ARTICLE_45_EXCLUSION" }],
    ["separate supply", { context: { supplyStructureEligible: false }, code: "SUPPLY_STRUCTURE_NOT_ELIGIBLE" }],
  ];
  for (const [, item] of cases) {
    const result = tax.assessRcmEligibility({ companyPolicy: { ...basePolicy, ...(item.company || {}) }, context: { ...validRcm, ...(item.context || {}) } });
    assert.equal(result.eligible, false);
    assert.ok(result.reasonCodes.includes(item.code), item.code);
  }
});

test("G2A2 accepts RCM only after server-side checks and ignores client eligibility", () => {
  const snapshot = tax.buildImmutableTaxSnapshot({
    requestedTaxTreatment: "REVERSE_CHARGE",
    companyPolicy: basePolicy,
    rcmContext: { ...validRcm, rcmEligible: false },
    taxableBase: 1000,
  });
  assert.equal(snapshot.resolvedTaxTreatment, "REVERSE_CHARGE");
  assert.equal(snapshot.rcmEligibilityResult, "ELIGIBLE");
  assert.equal(snapshot.effectiveVatRate, 5);
  assert.equal(snapshot.vatAmount, 50);
  assert.equal(snapshot.rcmEligibilityChecks.supplierVatRegistrationVerified, true);
});

test("G2A2 rejects unsupported or disabled treatments", () => {
  assert.throws(() => tax.buildImmutableTaxSnapshot({ requestedTaxTreatment: "VAT_5", companyPolicy: basePolicy }), /unsupported/i);
  assert.throws(() => tax.buildImmutableTaxSnapshot({ requestedTaxTreatment: "EXEMPT", companyPolicy: { ...basePolicy, enabledTaxTreatments: ["STANDARD_VAT"] } }), /not enabled/i);
});

test("G2A2 snapshot contains immutable rule and policy evidence", () => {
  const snapshot = tax.buildImmutableTaxSnapshot({ requestedTaxTreatment: "ZERO_RATED", companyPolicy: basePolicy, taxableBase: 250 });
  assert.equal(snapshot.jurisdiction, "UAE");
  assert.equal(snapshot.taxLawRuleVersion, "UAE-VATP043-2025-02-26");
  assert.equal(snapshot.taxLawEffectiveDate, "2025-02-26");
  assert.ok(snapshot.createdAt);
  assert.deepEqual(snapshot.enabledTaxTreatmentsSnapshot, basePolicy.enabledTaxTreatments);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("G2A2 source contract wires treatment resolution and immutable PO fields", () => {
  const route = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
  const model = fs.readFileSync(path.join(__dirname, "../src/models/purchaseOrder.model.js"), "utf8");
  assert.match(route, /transactionTaxContextService\.buildImmutableTaxSnapshot/);
  assert.match(route, /taxTreatment: requestedTaxTreatment/);
  assert.match(route, /taxSnapshot/);
  assert.match(model, /taxTreatment/);
  assert.match(model, /immutableTransactionTaxSnapshot/);
  assert.match(model, /protectTransactionTaxSnapshot/);
});

test("G2A2 migration is nullable and does not backfill historical transactions", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../migrations/20260818030000-transaction-tax-snapshot-rcm.js"), "utf8");
  assert.match(migration, /tax_treatment/);
  assert.match(migration, /tax_snapshot/);
  assert.match(migration, /allowNull:\s*true/);
  assert.doesNotMatch(migration, /UPDATE\s+purchase_orders/i);
  assert.doesNotMatch(migration, /bulkInsert/i);
});

test("G2A2 model guard rejects tax snapshot overwrite and deletion", async () => {
  const row = PurchaseOrder.build({ id: "PO-UNIT", taxTreatment: "STANDARD_VAT", taxSnapshot: { resolvedTaxTreatment: "STANDARD_VAT" } });
  row.set("taxSnapshot", { resolvedTaxTreatment: "EXEMPT" });
  await assert.rejects(() => PurchaseOrder.runHooks("beforeUpdate", row), /immutable/i);
  await assert.rejects(() => PurchaseOrder.runHooks("beforeDestroy", row), /cannot be deleted/i);
});
