const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mapper = require(path.join(root, "src/services/inventory-v2-price-mapping.service.js"));
const receiveRoute = fs.readFileSync(path.join(root, "src/routes/erp.routes.js"), "utf8");

test("explicit Loose Diamond sellingPrice wins over legacy item.price fallback", () => {
  assert.equal(mapper.resolveAssetSellingPrice({
    piece: { profile: "LOOSE_DIAMOND", sellingPrice: "8000" },
    item: { unitCost: "5000", price: 6600 },
  }), 8000);
});

test("legacy salePrice alias remains compatible when canonical sellingPrice is absent", () => {
  assert.equal(mapper.resolveAssetSellingPrice({ piece: { salePrice: "7200" }, item: { price: 6600 } }), 7200);
});

test("legacy item.price fallback remains available without explicit sale authority", () => {
  assert.equal(mapper.resolveAssetSellingPrice({ piece: {}, item: { price: 6600 } }), 6600);
});

test("explicit item sellingPrice authority is not overridden by the legacy fallback", () => {
  assert.equal(mapper.resolveAssetSellingPrice({ piece: {}, item: { sellingPrice: "7100", price: 6600 }, fallback: 5000 }), 7100);
});

test("all shared V2 Asset creation sites use the centralized mapping", () => {
  assert.equal((receiveRoute.match(/inventoryV2PriceMappingService\.resolveAssetSellingPrice/g) || []).length, 3);
  assert.doesNotMatch(receiveRoute, /price:\s*v2Piece\?\.salePrice\s*\?\?\s*item\.price/);
});
