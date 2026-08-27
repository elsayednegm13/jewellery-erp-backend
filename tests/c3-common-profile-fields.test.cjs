"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const contract = require(path.join(root, "backend/src/services/inventory-common-profile-fields.service.js"));

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("C3 exposes exactly the five accepted profile families and current strategies", () => {
  assert.deepEqual(contract.TOP_LEVEL_PROFILES, ["GBW", "GBP", "DIAMOND", "GEM_STONE", "PEARL"]);
  assert.deepEqual(contract.INTERNAL_STRATEGIES, {
    GBW: ["GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K"],
    GBP: ["GOLD_BY_PIECE"],
    DIAMOND: ["DIAMOND_JEWELLERY", "LOOSE_DIAMOND"],
    GEM_STONE: ["GEMSTONE_JEWELLERY", "LOOSE_GEMSTONE"],
    PEARL: ["PEARL_JEWELLERY", "LOOSE_PEARL"],
  });
  for (const [family, strategies] of Object.entries(contract.INTERNAL_STRATEGIES)) {
    for (const strategy of strategies) assert.equal(contract.topLevelProfileForStrategy(strategy), family);
  }
});

test("C3 common field contract has one key per existing authority and no invented SKU/image field", () => {
  const keys = contract.COMMON_FIELD_CONTRACT.map((field) => field.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of ["description", "brand", "supplierId", "locationId", "purchaseDate", "taxTreatment", "notes", "barcode", "rfid", "inventoryProfile", "branchId", "operationalStatus", "createdBy", "createdAt", "auditLog"]) {
    assert.ok(keys.includes(key), `missing common contract key ${key}`);
  }
  assert.equal(keys.includes("sku"), false);
  assert.equal(keys.includes("image"), false);
  assert.equal(contract.getPublicContract().invariants.duplicateAuthority, false);
  assert.equal(contract.getPublicContract().invariants.physicalQuantityAuthority, false);
});

test("C3 fails closed for unknown and dedicated-authority fields", () => {
  assert.equal(contract.assertCommonField("description").key, "description");
  assert.throws(() => contract.assertCommonField("unknownField"), (error) => error.code === "COMMON_PROFILE_FIELD_NOT_ALLOWED");
  for (const field of ["barcode", "rfid", "karat", "grossWeight", "status", "branchId", "locationId", "purchaseCost", "sellingPrice", "valuation", "journal"]) {
    assert.throws(() => contract.assertCommonField(field), (error) => error.code === "COMMON_PROFILE_DEDICATED_AUTHORITY_REQUIRED", field);
  }
});

test("the existing shared receive UI remains the only common receive envelope", () => {
  const shared = read("components/inventory/shared-receive-section.tsx");
  for (const key of ["supplierId", "locationId", "purchaseDate", "taxTreatment", "notes", "Tax Summary", "buildSharedTaxRequest"]) assert.match(shared, new RegExp(key.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  for (const relativePath of [
    "app/[locale]/(dashboard)/inventory/gold-by-weight/page.tsx",
    "app/[locale]/(dashboard)/inventory/gold-by-piece/page.tsx",
    "app/[locale]/(dashboard)/inventory/diamond-jewellery/page.tsx",
    "app/[locale]/(dashboard)/inventory/gem-stone/page.tsx",
    "app/[locale]/(dashboard)/inventory/pearl/page.tsx",
  ]) assert.match(read(relativePath), /SharedReceiveSection/);
});

test("common fields round-trip through existing Asset list/detail projections", () => {
  const route = read("backend/src/routes/erp.routes.js");
  const listHook = read("features/inventory/hooks/use-inventory-v2.ts");
  const detail = read("app/[locale]/(dashboard)/inventory/[id]/page.tsx");
  for (const key of ["description", "brand", "model", "modelNumber", "barcode", "inventoryProfile", "operationalStatus", "branchId", "locationId", "supplierId", "purchaseDate", "rfid"]) {
    assert.match(route, new RegExp(key));
    assert.match(listHook, new RegExp(key));
  }
  for (const label of ["Description", "Brand", "Purchase date", "Barcode", "RFID", "Branch", "Location", "Created at"]) assert.match(detail, new RegExp(label));
});

test("the additive public profile route exposes the C3 contract under existing inventory.view protection", () => {
  const route = read("backend/src/routes/erp.routes.js");
  assert.match(route, /router\.get\("\/inventory-v2\/profiles", authMiddleware, requireBusinessPermission\("inventory\.view"\)/);
  assert.match(route, /commonFieldContract:\s*inventoryCommonProfileFieldsService\.getPublicContract\(\)/);
});

