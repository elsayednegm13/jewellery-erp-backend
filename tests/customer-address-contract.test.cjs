const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeCustomerAddresses,
  resolvePrimaryAddress,
  sanitizeCustomerMutation,
} = require("../src/services/customer-address.service");

const address = (line1, city = "Dubai", country = "AE") => ({ line1, city, country });

test("new address contract makes the first address Primary", () => {
  const result = normalizeCustomerAddresses([address("A")]);
  assert.deepEqual(result, [{ line1: "A", city: "Dubai", country: "AE", isPrimary: true }]);
});

test("multiple new addresses without an explicit Primary use the first", () => {
  const result = normalizeCustomerAddresses([address("A"), address("B")]);
  assert.equal(result.filter((item) => item.isPrimary).length, 1);
  assert.equal(result[0].isPrimary, true);
  assert.equal(result[1].isPrimary, false);
});

test("multiple explicit Primary addresses fail closed", () => {
  assert.throws(
    () => normalizeCustomerAddresses([
      { ...address("A"), isPrimary: true },
      { ...address("B"), isPrimary: true },
    ]),
    (error) => error.errorCode === "MULTIPLE_PRIMARY_ADDRESSES"
  );
});

test("malformed and unsupported address shapes fail new writes", () => {
  assert.throws(() => normalizeCustomerAddresses([{ address: "legacy" }]), (error) => error.errorCode === "INVALID_CUSTOMER_ADDRESS");
  assert.throws(() => normalizeCustomerAddresses([address("  ", "Dubai", "AE")]), (error) => error.errorCode === "INVALID_CUSTOMER_ADDRESS");
});

test("legacy reads remain non-mutating and use explicit source classification", () => {
  const legacy = [address("A"), address("B")];
  const result = resolvePrimaryAddress(legacy);
  assert.equal(result.source, "LEGACY_FALLBACK");
  assert.equal(result.primaryAddress.line1, "A");
  assert.equal(Object.prototype.hasOwnProperty.call(legacy[0], "isPrimary"), false);
});

test("explicit Primary wins and empty legacy arrays resolve to NONE", () => {
  const result = resolvePrimaryAddress([
    address("A"),
    { ...address("B"), isPrimary: true },
  ]);
  assert.equal(result.source, "EXPLICIT_PRIMARY");
  assert.equal(result.primaryAddress.line1, "B");
  assert.deepEqual(resolvePrimaryAddress([]), { primaryAddress: null, source: "NONE" });
});

test("Customer mutation sanitizer protects financial and lifecycle authority", () => {
  const result = sanitizeCustomerMutation({
    name: "Synthetic",
    addresses: [address("A")],
    balance: 999,
    purchases: 999,
    loyaltyPoints: 999,
    availableCredit: 999,
    status: "inactive",
    companyId: "attacker-company",
    expectedUpdatedAt: "stale",
  });
  assert.equal(result.name, "Synthetic");
  assert.equal(result.addresses[0].isPrimary, true);
  assert.equal("balance" in result, false);
  assert.equal("purchases" in result, false);
  assert.equal("loyaltyPoints" in result, false);
  assert.equal("availableCredit" in result, false);
  assert.equal("status" in result, false);
  assert.equal("companyId" in result, false);
  assert.equal("expectedUpdatedAt" in result, false);
});
