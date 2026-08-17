const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("01C adds permanent barcode history and a controlled replacement exception", () => {
  const migration = read("migrations/20260817010000-barcode-replacement-status-foundation.js");
  const identity = read("src/services/barcode-identity.service.js");
  const route = read("src/routes/erp.routes.js");

  assert.match(migration, /createTable\("asset_barcode_history"/);
  assert.match(migration, /asset_barcode_history_barcode_uq/);
  assert.match(migration, /asset_barcode_history_one_active_uq/);
  assert.match(migration, /state IN \('ACTIVE','RETIRED'\)/);
  assert.match(migration, /current_setting\('darfus\.inventory_barcode_replacement'/);
  assert.match(identity, /SELECT 1 FROM asset_barcode_history WHERE barcode=:barcode/);
  assert.match(identity, /async function replaceAssetBarcode/);
  assert.match(identity, /Barcode replacement reason is required/);
  assert.match(route, /\/inventory-v2\/assets\/:id\/barcode\/replace/);
  assert.match(route, /requireBusinessPermission\("inventory\.adjust"/);
  assert.match(route, /BARCODE_REPLACED/);
  assert.match(route, /idempotencyService\.succeed/);
});

test("01C keeps barcode reprint separate from replacement", () => {
  const runtime = read("src/services/inventory-v2-runtime.service.js");
  const route = read("src/routes/erp.routes.js");
  assert.match(runtime, /tagState: "PRINTED"/);
  assert.match(runtime, /TAG_REPRINTED/);
  assert.match(route, /\/inventory-v2\/assets\/:id\/tags\/print/);
  assert.match(route, /printKind === "REPRINT" && !String\(req\.body\?\.reason/);
  assert.doesNotMatch(runtime, /recordTagPrint[\s\S]{0,1200}barcodeRevision/);
});

test("01C exposes the frozen status domains without promoting event-only terms", () => {
  const runtime = read("src/services/inventory-v2-runtime.service.js");
  assert.match(runtime, /const OPERATIONAL_STATUS = Object\.freeze\(\[/);
  assert.match(runtime, /const CONDITION = Object\.freeze\(\["NEW", "USED"\]\)/);
  assert.match(runtime, /const TAG_STATE = Object\.freeze\(\["PENDING", "PRINTED"\]\)/);
  assert.match(runtime, /const EVENT_ONLY_TERMS = Object\.freeze\(\["IN_TRANSFER", "RECOVERED", "EXCHANGED"\]\)/);
  const operationalLiteral = runtime.match(/const OPERATIONAL_STATUS = Object\.freeze\(\[([\s\S]*?)\]\);/)[1];
  for (const eventOnly of ["IN_TRANSFER", "RECOVERED", "EXCHANGED"]) assert.doesNotMatch(operationalLiteral, new RegExp(eventOnly));
});

test("01C keeps the approved server-side receive and POS/sale boundaries", () => {
  const policy = read("src/services/inventory-master-policy.service.js");
  const route = read("src/routes/erp.routes.js");
  assert.match(policy, /FINAL_CLIENT_PROFILE_CANONICAL_CODES/);
  assert.match(policy, /assessFinalClientSupplierReceive/);
  assert.match(route, /FINAL_CLIENT_PROFILE_V2_REQUIRED/);
  assert.match(route, /FINAL_PROFILE_PRODUCT_SALE_FORBIDDEN/);
  assert.match(route, /filter\(\(product\) => !inventoryMasterPolicy\.isFinalClientInventoryProduct\(product\)\)/);
});
