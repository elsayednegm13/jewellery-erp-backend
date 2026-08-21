const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const service = require(path.join(root, "src/services/asset-selling-price.service.js"));
const route = fs.readFileSync(path.join(root, "src/routes/erp.routes.js"), "utf8");
const page = fs.readFileSync(path.join(root, "..", "app/[locale]/(dashboard)/inventory/[id]/page.tsx"), "utf8");

function modelsFor(minimum = "8000.0000") {
  const calls = [];
  return {
    calls,
    sequelize: {
      query: async (sql) => { calls.push(sql); return [{ minimum_selling_price: minimum }]; },
    },
  };
}

function asset(price = "8000.0000", status = "AVAILABLE") {
  const row = { id: "AST-TEST", price, branchId: "BR-1", branch: "Main", operationalStatus: status, updatedAt: new Date("2026-08-21T10:00:00Z"), updatedBy: null };
  return { ...row, update: async (values) => Object.assign(row, values), toJSON: () => ({ ...row }), __row: row };
}

const req = { companyId: "CMP-1", branchId: "BR-1", user: { id: "USR-1" } };

test("authorized valid change is validated and staged without financial collaborators", async () => {
  const models = modelsFor();
  const row = asset("8000.0000");
  const audit = require(path.join(root, "src/services/audit.service.js"));
  const original = audit.record;
  const staged = [];
  audit.record = async (_companyId, data) => staged.push(data);
  try {
    const result = await service.updateSellingPrice({ models, asset: row, body: { newSellingPrice: "8500", reason: "Management repricing" }, req, transaction: {} });
    assert.equal(result.oldPrice, "8000.0000");
    assert.equal(result.newPrice, "8500.0000");
    assert.equal(row.__row.price, "8500.0000");
    assert.equal(staged[0].action, service.PRICE_CHANGE_ACTION);
    assert.match(staged[0].before, /8000\.0000/);
    assert.match(staged[0].after, /8500\.0000/);
  } finally { audit.record = original; }
});

test("below minimum, missing reason, and invalid decimal fail closed", async () => {
  for (const body of [
    { newSellingPrice: "7900", reason: "Below minimum test" },
    { newSellingPrice: "8500", reason: "" },
    { newSellingPrice: "0", reason: "Invalid test" },
    { newSellingPrice: "8500.12345", reason: "Precision test" },
  ]) {
    await assert.rejects(() => service.updateSellingPrice({ models: modelsFor(), asset: asset(), body, req, transaction: {} }));
  }
});

test("immutable sold/melted states and stale versions fail closed", async () => {
  await assert.rejects(() => service.updateSellingPrice({ models: modelsFor(), asset: asset("8000", "SOLD"), body: { newSellingPrice: "8500", reason: "State test" }, req, transaction: {} }));
  await assert.rejects(() => service.updateSellingPrice({ models: modelsFor(), asset: asset(), body: { newSellingPrice: "8500", reason: "Version test", expectedUpdatedAt: "2026-08-21T11:00:00Z" }, req, transaction: {} }));
});

test("route is permission-gated, idempotent, scoped, and separate from metadata", () => {
  assert.match(route, /router\.patch\("\/inventory-v2\/assets\/:id\/selling-price"/);
  assert.match(route, /requireBusinessPermission\("inventory\.adjust"/);
  assert.match(route, /assetSellingPriceService\.PRICE_EDIT_OPERATION/);
  assert.match(route, /idempotencyService\.hashRequest\(scope, body, \{ assetId: req\.params\.id, branchId \}\)/);
  assert.match(route, /assetSellingPriceService\.updateSellingPrice/);
  assert.doesNotMatch(route, /assetMetadataService\.ALLOWLIST.*price/);
});

test("AR and EN Asset details expose the dedicated user-facing price action", () => {
  assert.match(page, /إدارة سعر البيع/);
  assert.match(page, /Selling Price Management/);
  assert.match(page, /تعديل سعر البيع/);
  assert.match(page, /Edit Selling Price/);
  assert.match(page, /سبب التعديل/);
  assert.match(page, /Reason/);
});
