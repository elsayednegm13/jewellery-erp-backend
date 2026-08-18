const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PurchaseOrder = require("../src/models/purchaseOrder.model");
const migrationPath = path.join(__dirname, "../migrations/20260819010000-widen-purchase-order-tax-precision.js");

test("PurchaseOrder ORM preserves the canonical 8-decimal tax authority", () => {
  assert.equal(PurchaseOrder.rawAttributes.taxBase.type.toString(), "DECIMAL(20,8)");
  assert.equal(PurchaseOrder.rawAttributes.inputVatAmount.type.toString(), "DECIMAL(20,8)");
});

test("G3 precision migration widens only the two proven PO tax columns", () => {
  const source = fs.readFileSync(migrationPath, "utf8");
  assert.match(source, /changeColumn\("purchase_orders",\s*"tax_base"/);
  assert.match(source, /changeColumn\("purchase_orders",\s*"input_vat_amount"/);
  assert.match(source, /DECIMAL\(20, 8\)/g);
  assert.doesNotMatch(source, /changeColumn\("purchase_orders",\s*"total"/);
});
