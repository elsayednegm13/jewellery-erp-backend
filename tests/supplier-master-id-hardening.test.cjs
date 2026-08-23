const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const controller = fs.readFileSync(path.join(root, "backend/src/controllers/erp.controller.js"), "utf8");
const model = fs.readFileSync(path.join(root, "backend/src/models/supplier.model.js"), "utf8");

test("Supplier create strips client id and due before server ID generation", () => {
  const supplierGuard = controller.slice(
    controller.indexOf('if (this.model.name === "Supplier") {'),
    controller.indexOf('// Phase 10R: Customer.balance')
  );
  assert.match(supplierGuard, /delete payload\.due/);
  assert.match(supplierGuard, /delete payload\.id/);
  assert.match(controller, /if \(shouldGenerateStringId\) \{\s*payload\.id = await generateScopedSequentialId\(this\.model, req\.companyId\);/);
  assert.match(controller, /Supplier: \{ prefix: "SUP", width: 3 \}/);
  assert.match(model, /id:\s*\{[\s\S]*?primaryKey: true/);
});

test("Supplier ID hardening is scoped and does not remove the generic ID contract", () => {
  const supplierGuard = controller.slice(
    controller.indexOf('if (this.model.name === "Supplier") {'),
    controller.indexOf('// Phase 10R: Customer.balance')
  );
  assert.equal((supplierGuard.match(/delete payload\.id/g) || []).length, 1);
  assert.doesNotMatch(supplierGuard, /delete payload\.companyId/);
  assert.match(controller, /companyId: req\.companyId/);
});
