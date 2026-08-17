"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const policy = require("../src/services/inventory-master-policy.service");

const routeSource = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
const supplierPageSource = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/suppliers/purchases/page.tsx"), "utf8");
const agentsSource = fs.readFileSync(path.join(__dirname, "../../AGENTS.md"), "utf8");
const handoffSource = fs.readFileSync(path.join(__dirname, "../../PROJECT_PROGRESS_HANDOFF.md"), "utf8");

test("01A classifier accepts all final internal strategies and rejects non-final scope", () => {
  const finalProfiles = [
    "GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K", "GOLD_BY_PIECE",
    "DIAMOND_JEWELLERY", "LOOSE_DIAMOND",
    "GEMSTONE_JEWELLERY", "LOOSE_GEMSTONE",
    "PEARL_JEWELLERY", "LOOSE_PEARL",
  ];
  for (const profile of finalProfiles) assert.equal(policy.isFinalClientInventoryProfile(profile), true, profile);
  for (const label of ["GOLD_BY_WEIGHT", "DIAMOND", "GEM_STONE", "PEARL"]) {
    assert.equal(policy.isFinalClientInventoryProfile(label), true, label);
  }
  for (const profile of ["CGP_CUSTOMER_GOLD_PURCHASE", "WATCH", "OTHER", ""]) {
    assert.equal(policy.isFinalClientInventoryProfile(profile), false, profile);
  }
});

test("01A Product compatibility classifier blocks final physical types only", () => {
  for (const stockType of ["gold-weight", "gold-piece", "diamond", "gemstone", "pearl"]) {
    assert.equal(policy.isFinalClientInventoryProduct({ stockType }), true, stockType);
  }
  assert.equal(policy.isFinalClientInventoryProduct({ stockType: "watch" }), false);
  assert.equal(policy.isFinalClientInventoryProduct({ stockType: "legacy-other" }), false);
});

test("01A Supplier Receive policy rejects final legacy payloads before the route transaction", () => {
  const rejected = policy.assessFinalClientSupplierReceive({
    body: { stockType: "gold-piece" },
    items: [{ type: "gold-piece", productCode: "LEGACY-001", quantity: 1 }],
  });
  assert.deepEqual(rejected, {
    targetsFinalProfile: true,
    inventoryV2Required: true,
    inventoryV2Requested: false,
    rejectLegacy: true,
  });

  const accepted = policy.assessFinalClientSupplierReceive({
    body: { inventoryV2: true, stockType: "pearl" },
    items: [{
      type: "pearl",
      quantity: 2,
      perPiece: [{ profile: "LOOSE_PEARL" }, { profile: "LOOSE_PEARL" }],
    }],
  });
  assert.equal(accepted.targetsFinalProfile, true);
  assert.equal(accepted.inventoryV2Requested, true);
  assert.equal(accepted.rejectLegacy, false);

  const legacyCompatibility = policy.assessFinalClientSupplierReceive({
    body: { stockType: "watch" },
    items: [{ type: "watch", productCode: "WATCH-001", quantity: 1 }],
  });
  assert.equal(legacyCompatibility.targetsFinalProfile, false);
  assert.equal(legacyCompatibility.rejectLegacy, false);
});

test("01A source contract has fail-closed Supplier Receive and no Product final-profile fallback", () => {
  assert.match(routeSource, /function assertFinalClientSupplierReceiveContract/);
  assert.match(routeSource, /FINAL_CLIENT_PROFILE_V2_REQUIRED/);
  assert.match(routeSource, /inventoryMasterPolicy\.isFinalClientInventoryProduct\(product\)/);
  assert.match(routeSource, /FINAL_PROFILE_PRODUCT_SALE_FORBIDDEN/);
  assert.match(routeSource, /FINAL_PROFILE_PRODUCT_RETURN_FORBIDDEN/);
  assert.match(routeSource, /FINAL_PROFILE_PRODUCT_EXCHANGE_FORBIDDEN/);
  assert.match(routeSource, /\.filter\(\(product\) => !inventoryMasterPolicy\.isFinalClientInventoryProduct\(product\)\)/);
  assert.match(routeSource, /assessFinalClientSupplierReceive/);
});

test("01A frontend never presents legacy quantity mode for final profiles", () => {
  assert.match(supplierPageSource, /const FINAL_CLIENT_PROFILE_KEYS = new Set/);
  assert.match(supplierPageSource, /disabled=\{isFinalClientProfile \|\| isPosting\}/);
  assert.match(supplierPageSource, /if \(isFinalClientProfile && isQuantityBased\)/);
  assert.match(supplierPageSource, /inventoryV2: true/);
});

test("01A guardrails identify official DB and safe rehearsal boundary", () => {
  assert.match(agentsSource, /Official persistent database: `darfus_erp`/);
  assert.match(agentsSource, /disposable clone or an explicitly/);
  assert.match(agentsSource, /Direct persistent mutation of `darfus_erp` requires explicit Owner approval/);
  assert.match(handoffSource, /CURRENT_MUTATING_REHEARSAL = DISPOSABLE_CLONE_OR_EXPLICIT_OWNER_APPROVED_REHEARSAL/);
  assert.match(handoffSource, /DIRECT_PERSISTENT_MUTATION = EXPLICIT_OWNER_APPROVAL/);
});
