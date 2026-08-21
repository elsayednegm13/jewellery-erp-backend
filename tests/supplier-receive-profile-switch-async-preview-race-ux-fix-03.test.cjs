const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("G2C legacy Supplier receive URL redirects to canonical Inventory", () => {
  const page = read("app/[locale]/(dashboard)/suppliers/purchases/page.tsx");
  assert.match(page, /redirect\(`\/\$\{locale\}\/inventory`\)/);
  assert.doesNotMatch(page, /purchase-orders\/receive|Post Purchase|استلام وتسجيل الأصل/);
});

test("G2C shared receive fields are present in both final Inventory profiles", () => {
  const shared = read("components/inventory/shared-receive-section.tsx");
  const gbw = read("app/[locale]/(dashboard)/inventory/gold-by-weight/page.tsx");
  const gbp = read("app/[locale]/(dashboard)/inventory/gold-by-piece/page.tsx");
  for (const source of [gbw, gbp]) {
    assert.match(source, /SharedReceiveSection/);
    assert.match(source, /buildSharedTaxRequest/);
    assert.match(source, /inventory-v2\/receive-preview/);
    assert.match(source, /taxTreatment/);
    assert.match(source, /locationId/);
  }
  assert.match(shared, /ReverseChargeChecklist/);
  assert.match(shared, /Server Tax Summary/);
  assert.match(shared, /No frontend tax default/);
});
