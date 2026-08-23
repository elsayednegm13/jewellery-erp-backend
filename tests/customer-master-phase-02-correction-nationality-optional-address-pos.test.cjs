"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const customerModel = fs.readFileSync(path.join(root, "backend/src/models/customer.model.js"), "utf8");
const customerRoute = fs.readFileSync(path.join(root, "backend/src/routes/erp.routes.js"), "utf8");
const detailsPage = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/customers/[id]/page.tsx"), "utf8");
const posPage = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/pos/page.tsx"), "utf8");
const {
  normalizeCustomerAddresses,
  sanitizeCustomerMutation,
  resolvePrimaryAddress,
} = require("../src/services/customer-address.service");

test("nationality is a nullable Customer column and survives the narrow profile sanitizer", () => {
  assert.match(customerModel, /nationality:\s*\{\s*type:\s*DataTypes\.STRING\s*\}/s);
  assert.equal(sanitizeCustomerMutation({ nationality: "  مصري  " }).nationality, "مصري");
  assert.equal(sanitizeCustomerMutation({ nationality: "  " }).nationality, null);
  assert.match(detailsPage, /customer-profile-nationality/);
});

test("DOB stays outside the profile mutation contract until a validated server contract exists", () => {
  assert.match(customerModel, /kycDetails:\s*\{\s*type:\s*DataTypes\.JSONB/s);
  assert.match(detailsPage, /customer\.kycDetails\?\.dateOfBirth/);
  assert.doesNotMatch(customerRoute, /dateOfBirth/);
  assert.equal(Object.hasOwn(sanitizeCustomerMutation({ dateOfBirth: "2000-01-02" }), "dateOfBirth"), false);
});

test("partial address variants normalize while an all-blank object fails closed", () => {
  for (const address of [{ line1: "A" }, { city: "Cairo" }, { country: "Egypt" }, { postalCode: "11511" }]) {
    const normalized = normalizeCustomerAddresses([address]);
    assert.equal(normalized[0].isPrimary, true);
  }
  assert.throws(
    () => normalizeCustomerAddresses([{ line1: " ", line2: "", city: "", country: "", postalCode: "", isPrimary: true }]),
    (error) => error.errorCode === "EMPTY_CUSTOMER_ADDRESS",
  );
});

test("explicit Primary overrides array order for both server resolver and POS display helper", () => {
  const addresses = [{ line1: "A", city: "Cairo" }, { line1: "B", city: "Giza", isPrimary: true }];
  assert.equal(resolvePrimaryAddress(addresses).primaryAddress.line1, "B");
  assert.match(customerRoute, /customers\/:id\/pos-summary/);
  assert.match(customerRoute, /customerPosSummaryService\.getCustomerPosSummary/);
  assert.match(posPage, /customerSummary\.primaryAddress/);
  assert.doesNotMatch(posPage, /addresses\?\.find\(\(item\) => item && \(item\.line1 \|\| item\.city \|\| item\.country\)\)/);
});
