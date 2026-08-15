const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  buildCustomerContactSnapshot,
  copyInvoiceContactSnapshot,
} = require("../src/services/invoice-contact-snapshot.service");

test("snapshot mapper uses canonical primary address and minimal shape", () => {
  const snapshot = buildCustomerContactSnapshot({
    phone: "  P1 ",
    addresses: [
      { line1: "legacy", city: "old", country: "old", isPrimary: false },
      { line1: " A1 ", city: " C1 ", country: " U1 ", postalCode: " 123 ", isPrimary: true },
    ],
  });
  assert.deepEqual(snapshot, {
    customerPhoneSnapshot: "P1",
    customerAddressSnapshot: { line1: "A1", city: "C1", country: "U1", postalCode: "123" },
  });
  assert.equal(Object.hasOwn(snapshot.customerAddressSnapshot, "isPrimary"), false);
});

test("snapshot mapper returns null for walk-in or meaningless address", () => {
  assert.deepEqual(buildCustomerContactSnapshot(null), { customerPhoneSnapshot: null, customerAddressSnapshot: null });
  assert.deepEqual(buildCustomerContactSnapshot({ phone: "", addresses: [{ isPrimary: true }] }), { customerPhoneSnapshot: null, customerAddressSnapshot: null });
});

test("derived invoice copy preserves original evidence and drops unsupported fields", () => {
  const copied = copyInvoiceContactSnapshot({
    customerPhoneSnapshot: "P1",
    customerAddressSnapshot: { line1: "A1", isPrimary: true, arbitrary: "no" },
  });
  assert.deepEqual(copied, { customerPhoneSnapshot: "P1", customerAddressSnapshot: { line1: "A1" } });
});

test("migration is additive, nullable, and has no backfill/index", () => {
  const migration = fs.readFileSync(require.resolve("../migrations/20260814010000-customer-invoice-contact-snapshots.js"), "utf8");
  assert.match(migration, /customer_phone_snapshot/);
  assert.match(migration, /customer_address_snapshot/);
  assert.doesNotMatch(migration, /UPDATE\s+invoices/i);
  assert.doesNotMatch(migration, /addIndex/i);
  assert.match(migration, /allowNull:\s*true/);
});

test("canonical invoice paths are the only snapshot writers", () => {
  const routes = fs.readFileSync(require.resolve("../src/routes/erp.routes.js"), "utf8");
  assert.match(routes, /buildCustomerContactSnapshot/);
  assert.match(routes, /copyInvoiceContactSnapshot/);
  assert.match(routes, /customerContactSnapshot/);
  assert.doesNotMatch(routes, /customerPhoneSnapshot\s*:\s*body/);
  assert.doesNotMatch(routes, /customerAddressSnapshot\s*:\s*body/);
});
