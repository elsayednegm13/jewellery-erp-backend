const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const loose = require("../src/services/loose-diamond-profile.service");
const runtime = require("../src/services/inventory-v2-runtime.service");
const acquisitionPreview = require("../src/services/supplier-acquisition-preview.service");
const policy = require("../src/services/inventory-master-policy.service");
const profileMasterData = require("../src/services/profile-master-data.service");
const barcode = require("../src/services/barcode-identity.service");
const manifest = require("../src/services/inventory-master-data-manifest");

const masterRows = Object.entries({
  DIAMOND_NAME: ["Diamond"], DIAMOND_TYPE: ["Natural Diamond"], DIAMOND_TREATMENT: ["Other"],
  DIAMOND_COLOR: ["G", "H"], DIAMOND_CLARITY: ["VS1"], DIAMOND_SHAPE: ["Round"],
  DIAMOND_CUT: ["Excellent"], DIAMOND_ORIGIN: ["Canada"], DIAMOND_TONE: ["Bright"],
  DIAMOND_TONE_LEVEL: ["Medium"], DIAMOND_SATURATION: ["Strong"], CERTIFICATE_AUTHORITY: ["GIA"],
}).flatMap(([category, values]) => values.map((label, index) => ({ id: `${category}-${index}`, category, value: label.toLowerCase(), label, isActive: true })));

const taxPolicy = { vatRate: "14", vatRegistered: true, enabledTaxTreatments: ["STANDARD_VAT"] };
const input = {
  profile: "LOOSE_DIAMOND", inventoryProfile: "LOOSE_DIAMOND", description: "Synthetic Loose Diamond",
  looseDetails: {
    stoneName: "DIAMOND_NAME-0", diamondType: "DIAMOND_TYPE-0", colors: ["DIAMOND_COLOR-0", "DIAMOND_COLOR-1"],
    clarity: "DIAMOND_CLARITY-0", shape: "DIAMOND_SHAPE-0", cut: "DIAMOND_CUT-0", origin: "DIAMOND_ORIGIN-0",
    tone: "DIAMOND_TONE-0", toneLevel: "DIAMOND_TONE_LEVEL-0", saturation: "DIAMOND_SATURATION-0", carat: "1.250",
    purchasePrice: "1000", stoneCost: "1000", sellingPrice: "1500",
  },
  purchasePricePreTax: "1000", sellingPrice: "1500", taxTreatment: "STANDARD_VAT",
};

test("Loose Diamond master data and contract authority are versioned", () => {
  assert.equal(manifest.R2_PROFILE_MASTER_DATA_ROWS.length, 1);
  assert.deepEqual(manifest.R2_PROFILE_MASTER_DATA_ROWS[0].category, "DIAMOND_NAME");
  assert.equal(manifest.R2_PROFILE_MASTER_DATA_ROWS[0].displayLabel, "Diamond");
  assert.ok(profileMasterData.categoriesForProfile("LOOSE_DIAMOND").includes("DIAMOND_NAME"));
  assert.match(fs.readFileSync(path.join(__dirname, "../src/routes/loose-diamond-profile.routes.js"), "utf8"), /inventory\.view/);
});

test("Loose Diamond preview preserves CT, multi-color, and one-time dynamic VAT", () => {
  const result = loose.calculatePreview({ input, taxPolicy, masters: masterRows });
  assert.equal(result.piece.carat, "1.25000000");
  assert.equal(result.piece.derivedWeightGrams, "0.25000000");
  assert.deepEqual(result.piece.colors, ["G", "H"]);
  assert.equal(result.purchase.purchaseBasePreTax, "1000.00000000");
  assert.equal(result.purchase.purchaseVAT, "140.00000000");
  assert.equal(result.purchase.purchaseTotalTaxInclusive, "1140.00000000");
});

test("Loose Diamond rejects unsupported treatment, duplicate colors, and Stone Cost mismatch", () => {
  assert.throws(() => loose.calculatePreview({ input: { ...input, looseDetails: { ...input.looseDetails, treatment: "Gemstone Treatment Only" } }, taxPolicy, masters: masterRows }), /NATURAL_TREATMENT_FORBIDDEN|TREATMENT_MASTER_INVALID/);
  assert.throws(() => loose.calculatePreview({ input: { ...input, looseDetails: { ...input.looseDetails, colors: ["DIAMOND_COLOR-0", "DIAMOND_COLOR-0"] } }, taxPolicy, masters: masterRows }), /COLOR_DUPLICATE/);
  assert.throws(() => loose.calculatePreview({ input: { ...input, looseDetails: { ...input.looseDetails, stoneCost: "999" } }, taxPolicy, masters: masterRows }), /PURCHASE_PRICE_STONE_COST_MISMATCH/);
});

test("Supplier V2 normalization is Asset-based, component-free, and pre-tax", () => {
  const normalized = runtime.normalizeReceiptPiece({
    profile: "LOOSE_DIAMOND", description: "Loose Diamond", purchaseCost: "1000", sellingPrice: "1500",
    looseDetails: { stoneName: "Diamond", diamondType: "Natural Diamond", color: ["G", "H"], clarity: "VS1", shape: "Round", carat: "1.250" },
    pricing: { sellingPrice: "1500" },
  }, { companyId: "company", branchId: "branch", supplierId: "supplier", locationId: "location", purchaseDate: "2026-08-21", vatRateDefault: 14 });
  assert.equal(normalized.grossWeight, 0.25);
  assert.equal(normalized.karat, null);
  assert.equal(normalized.purchaseCost, 1000);
  assert.equal(normalized.currentValuation, null);
  assert.throws(() => runtime.normalizeReceiptPiece({ ...normalized, components: [{ componentKind: "DIAMOND" }] }, { vatRateDefault: 14 }), /COMPONENTS_FORBIDDEN/);
  assert.throws(() => runtime.normalizeReceiptPiece({ ...normalized, quantity: 2 }, { vatRateDefault: 14 }), /STOCK_QUANTITY_FORBIDDEN/);
});

test("Shared receive preview maps pre-tax base to inclusive PO total without double VAT", () => {
  const piece = runtime.normalizeReceiptPiece({
    profile: "LOOSE_DIAMOND", description: "Loose Diamond", purchaseCost: "1000", sellingPrice: "1500",
    looseDetails: { stoneName: "Diamond", diamondType: "Natural Diamond", color: ["G", "H"], clarity: "VS1", shape: "Round", carat: "1.250" },
    pricing: { sellingPrice: "1500" },
  }, { companyId: "company", branchId: "branch", supplierId: "supplier", locationId: "location", purchaseDate: "2026-08-21", vatRateDefault: 14 });
  const result = acquisitionPreview.previewFromPieces({ normalizedItems: [acquisitionPreview.normalizeItem({ profile: "LOOSE_DIAMOND" }, [piece])], body: { applyVat: true, isRecoverable: true }, settings: { vatEnabled: true }, inventoryV2Target: true });
  assert.equal(result.taxBase, 1000);
  assert.equal(result.inputVatAmount, 140);
  assert.equal(result.total, 1140);
});

test("Loose Diamond barcode authority is DD / LOS / 00", () => {
  assert.equal(barcode.resolveKaratCodeForProfile({ profile: "LOOSE_DIAMOND" }), "00");
  const source = fs.readFileSync(path.join(__dirname, "../src/services/barcode-identity.service.js"), "utf8");
  assert.match(source, /isLooseDiamond/);
  assert.match(source, /requestedInventory !== "DD"/);
});
