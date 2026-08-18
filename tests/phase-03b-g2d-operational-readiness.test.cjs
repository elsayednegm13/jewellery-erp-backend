const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { evaluateOperationalReadinessSnapshot, hasExplicitTaxPolicy } = require("../src/services/operational-readiness.service");

const readyFacts = () => ({
  company: { exists: true, id: "COMPANY-1", businessName: "Synthetic Company", workspace: "synthetic", currency: "AED" },
  branch: { id: "BRANCH-1", name: "Branch-1", isActive: true },
  activeLocationCount: 1,
  activeSupplierCount: 1,
  taxPolicy: { jurisdiction: "UAE", vatRegistered: true, vatRate: 14, enabledTaxTreatments: ["STANDARD_VAT"], defaultTaxTreatment: "STANDARD_VAT", preciousGoodsRcmEnabled: true },
  financialFoundation: { status: "READY", version: 2 },
  referenceMasterData: { state: "READY", profileCount: 659 },
});

test("system and operational readiness are independent authorities", () => {
  const facts = readyFacts();
  assert.equal(evaluateOperationalReadinessSnapshot(facts).systemFirstRunReady, true);
  assert.equal(evaluateOperationalReadinessSnapshot(facts).operationalReceiveReady, true);
  const missingSupplier = evaluateOperationalReadinessSnapshot({ ...facts, activeSupplierCount: 0 });
  assert.equal(missingSupplier.systemFirstRunReady, true);
  assert.equal(missingSupplier.operationalReceiveReady, false);
  assert.ok(missingSupplier.blockers.some((item) => item.code === "NO_ACTIVE_SUPPLIER"));
});

test("missing branch, location, tax, financial, or reference data fails closed", () => {
  const facts = readyFacts();
  for (const [name, changed, expectedCode] of [
    ["branch", { branch: null }, "ACTIVE_BRANCH_REQUIRED"],
    ["location", { activeLocationCount: 0 }, "NO_ACTIVE_LOCATION"],
    ["tax", { taxPolicy: { vatRegistered: true, vatRate: null, enabledTaxTreatments: [], defaultTaxTreatment: null, preciousGoodsRcmEnabled: true } }, "TAX_POLICY_UNCONFIGURED"],
    ["financial", { financialFoundation: { status: "BLOCKED" } }, "FINANCIAL_FOUNDATION_REQUIRED"],
    ["reference", { referenceMasterData: { state: "MISSING", profileCount: 0 } }, "REFERENCE_MASTER_DATA_REQUIRED"],
  ]) {
    const result = evaluateOperationalReadinessSnapshot({ ...facts, ...changed });
    assert.equal(result.operationalReceiveReady, false, name);
    assert.ok(result.blockers.some((item) => item.code === expectedCode), name);
  }
});

test("tax registration is explicit and is never inferred from TRN or vatEnabled", () => {
  assert.equal(hasExplicitTaxPolicy({ vatRegistered: null, vatRate: 5, enabledTaxTreatments: ["STANDARD_VAT"], defaultTaxTreatment: "STANDARD_VAT", preciousGoodsRcmEnabled: true }), false);
  assert.equal(hasExplicitTaxPolicy({ vatRegistered: false, vatRate: 0, enabledTaxTreatments: ["ZERO_RATED"], defaultTaxTreatment: "ZERO_RATED", preciousGoodsRcmEnabled: false, trn: "TRN-ONLY" }), true);
  assert.equal(hasExplicitTaxPolicy({ vatEnabled: true, vatRate: 5, enabledTaxTreatments: [], defaultTaxTreatment: null, preciousGoodsRcmEnabled: null }), false);
});

test("scope is supplied by server facts and onboarding has no duplicate receive form", () => {
  const route = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
  const page = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/settings/onboarding/page.tsx"), "utf8");
  const readinessRoute = route.slice(route.indexOf('router.get("/settings/operational-readiness"'), route.indexOf('router.post("/bootstrap/branch-accounts"'));
  assert.match(readinessRoute, /settings\/operational-readiness/);
  assert.match(readinessRoute, /req\.companyId/);
  assert.match(readinessRoute, /req\.headers\["x-branch-id"\]/);
  assert.doesNotMatch(readinessRoute, /req\.body/);
  for (const step of ["Company identity", "UAE tax policy", "Branches", "Inventory locations", "Financial readiness", "Suppliers", "Readiness review"]) assert.match(page, new RegExp(step));
  assert.match(page, /Inventory.*Add \/ Receive Inventory|Inventory.*إضافة \/ استلام مخزون/);
  assert.doesNotMatch(page, /purchase-orders\/receive|supplier-purchases\/receive/);
});
