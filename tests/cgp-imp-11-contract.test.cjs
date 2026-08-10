"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { AppError, ValidationError } = require("../src/utils/errors");
const {
  CGP_LEGACY_ISOLATION_ENV,
  CGP_PROFILE,
  isCanonicalCgpCutoverActive,
  assertLegacyCustomerGoldAcquisitionAllowed,
  assertCgpDispositionConversionAllowed,
  assertSupplierReceiveDoesNotMasqueradeAsCgp,
} = require("../src/services/cgp-legacy-isolation.service");
const { CGP_FUTURE_CAPABILITIES } = require("../src/bootstrap/cgp-permission-catalog-v3");

const root = path.resolve(__dirname, "..");
const routes = fs.readFileSync(path.join(root, "src/routes/erp.routes.js"), "utf8");
const goldPurchaseRoutes = fs.readFileSync(path.join(root, "src/routes/gold-purchase.routes.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "migrations/20260809050000-add-cgp-future-capabilities.js"), "utf8");
const runtimeVerifier = fs.readFileSync(path.join(root, "scripts/verify-cgp-imp-11.js"), "utf8");

assert.deepEqual(CGP_FUTURE_CAPABILITIES.map(({ name }) => name), [
  "gold_purchase.cgp.post",
  "gold_purchase.cgp.view_integration_status",
  "gold_purchase.cgp.retry_integration",
  "gold_purchase.cgp.reverse",
]);
assert.equal(migration.includes("role_permissions"), true, "down migration must protect assignments before removal");
assert.equal(migration.includes("INSERT INTO role_permissions"), false, "future permissions must not receive a role assignment");
assert.equal(migration.includes("INSERT INTO employee_permission_grants"), false, "future permissions must not receive a user assignment");

assert.equal(isCanonicalCgpCutoverActive({}), false);
assert.equal(isCanonicalCgpCutoverActive({ [CGP_LEGACY_ISOLATION_ENV]: "true" }), true);
assert.doesNotThrow(() => assertLegacyCustomerGoldAcquisitionAllowed({ env: {} }));
assert.throws(() => assertLegacyCustomerGoldAcquisitionAllowed({ env: { [CGP_LEGACY_ISOLATION_ENV]: "true" } }), (error) => error instanceof AppError && error.errorCode === "CGP_LEGACY_ACQUISITION_ISOLATED");
assert.doesNotThrow(() => assertCgpDispositionConversionAllowed({ disposition: "MELTED", env: { [CGP_LEGACY_ISOLATION_ENV]: "true" } }));
assert.throws(() => assertCgpDispositionConversionAllowed({ disposition: "CONVERTED_TO_ASSET", env: { [CGP_LEGACY_ISOLATION_ENV]: "true" } }), (error) => error instanceof AppError && error.errorCode === "CGP_LEGACY_ACQUISITION_ISOLATED");
assert.doesNotThrow(() => assertSupplierReceiveDoesNotMasqueradeAsCgp({ body: {}, items: [{ profile: "GOLD_BY_WEIGHT_JEWELLERY" }] }));
assert.throws(() => assertSupplierReceiveDoesNotMasqueradeAsCgp({ body: { items: [{ perPiece: [{ profile: CGP_PROFILE }] }] } }), (error) => error instanceof ValidationError);

for (const call of [
  "assertLegacyCustomerGoldAcquisitionAllowed()",
  "assertCgpDispositionConversionAllowed({ disposition: req.body?.disposition })",
  "assertSupplierReceiveDoesNotMasqueradeAsCgp({ body, items })",
  "if (resourceName === \"customer-gold-pools\")",
]) assert.equal(routes.includes(call), true, `central isolation boundary missing: ${call}`);
assert.equal(goldPurchaseRoutes.includes("/cgp/drafts/:id/post"), true, "CGP-IMP-03 canonical Posting route must remain available");
for (const pathFragment of ["/cgp/drafts/:id/retry", "/cgp/drafts/:id/reverse"]) {
  assert.equal(goldPurchaseRoutes.includes(pathFragment), false, `CGP-IMP-11 must not expose ${pathFragment}`);
}
assert.equal(routes.includes("CGP_LEGACY_ISOLATION_ENABLED"), false, "client request code must not control legacy isolation");
assert.equal(runtimeVerifier.includes("assert.equal(Number(final.processed), 0"), false, "IMP11 runtime verifier must not require a global processed-event count of zero");
assert.equal(runtimeVerifier.includes("assertStageAwareReceipts"), true, "IMP11 runtime verifier must classify stage-aware receipts");
console.log("CGP_IMP_11_PERMISSION_CATALOG: PASS");
console.log("CGP_IMP_11_LEGACY_ISOLATION_CONTRACT: PASS");
console.log("CGP_IMP_11_STAGE_AWARE_POSTING_BOUNDARY: PASS");
