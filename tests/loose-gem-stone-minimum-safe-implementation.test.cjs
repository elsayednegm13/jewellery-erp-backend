const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const profile = require("../src/services/loose-gemstone-profile.service");
const runtime = require("../src/services/inventory-v2-runtime.service");
const acquisition = require("../src/services/supplier-acquisition-preview.service");
const policy = require("../src/services/inventory-master-policy.service");
const masterData = require("../src/services/profile-master-data.service");
const idempotency = require("../src/services/idempotency.service");

const masters = Object.entries({
  GEMSTONE_NAME: ["Ruby"], GEMSTONE_TYPE: ["Natural"], GEMSTONE_SHAPE: ["Oval"], GEMSTONE_COLOR: ["Red"],
  GEMSTONE_TONE: ["Medium"], GEMSTONE_TONE_LEVEL: ["3"], GEMSTONE_SATURATION: ["Strong"],
  GEMSTONE_OPTICAL_EFFECT: ["Chatoyancy"], GEMSTONE_ORIGIN: ["Mozambique"], CERTIFICATE_AUTHORITY: ["GIA"],
}).flatMap(([category, values]) => values.map((label, index) => ({ id: `${category}-${index}`, category, value: label.toLowerCase(), label, isActive: true })));
const baseInput = { profile: "LOOSE_GEMSTONE", description: "Synthetic Ruby", looseDetails: { stoneName: "GEMSTONE_NAME-0", stoneType: "GEMSTONE_TYPE-0", shape: "GEMSTONE_SHAPE-0", color: "GEMSTONE_COLOR-0", carat: "2.500", purchasePrice: "5000", additionalCost: "200", currentStoneValue: "6200", sellingPrice: "8000", masterData: { stoneName: "GEMSTONE_NAME-0", stoneType: "GEMSTONE_TYPE-0", shape: "GEMSTONE_SHAPE-0", color: "GEMSTONE_COLOR-0" } }, purchasePricePreTax: "5000", additionalCost: "200", currentStoneValue: "6200", sellingPrice: "8000", taxTreatment: "STANDARD_VAT" };

test("Loose Gem Stone contract is dedicated and excludes unsupported treatment/setting fields", () => {
  assert.equal(policy.requireProfile("LOOSE_GEMSTONE").weightApplicable, false);
  assert.equal(masterData.categoriesForProfile("LOOSE_GEMSTONE").includes("GEMSTONE_TREATMENT"), false);
  assert.equal(masterData.categoriesForProfile("LOOSE_GEMSTONE").includes("GEMSTONE_SETTING"), false);
  const page = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/inventory/loose-gem-stone/page.tsx"), "utf8");
  assert.match(page, /data-final-receive/);
  assert.doesNotMatch(page, /Gross Weight/);
});

test("Loose Gem Stone preview uses CT authority and dynamic VAT once", () => {
  const result = profile.calculatePreview({ input: baseInput, taxPolicy: { vatRate: 14, vatRegistered: true, enabledTaxTreatments: ["STANDARD_VAT"] }, masters });
  assert.equal(result.piece.carat, "2.50000000");
  assert.equal(result.piece.derivedWeightGrams, "0.50000000");
  assert.equal(result.purchase.purchaseBasePreTax, "5200.00000000");
  assert.equal(result.purchase.purchaseVAT, "728.00000000");
  assert.equal(result.purchase.purchaseTotalTaxInclusive, "5928.00000000");
  assert.equal(result.current.currentTotalTaxInclusive, "7068.00000000");
});

test("Supplier V2 Loose Gem Stone is one Asset, pre-tax, and no manual grossWeight", () => {
  const normalized = runtime.normalizeReceiptPiece({ profile: "LOOSE_GEMSTONE", description: "Synthetic Ruby", purchaseCost: "5200", sellingPrice: "8000", looseFinancial: { purchasePricePreTax: "5000", additionalCost: "200" }, currentValuation: { rateSource: "LOOSE_GEMSTONE_VALUATION", componentValue: "6200", vatRate: "14", vatRateSource: "TAX_ENGINE", vatBase: "6200", vatAmount: "868", totalValue: "7068" }, looseDetails: { stoneName: "Ruby", stoneType: "Natural", color: "Red", carat: "2.500" } }, { companyId: "company", branchId: "branch", supplierId: "supplier", locationId: "location", purchaseDate: "2026-08-21", vatRateDefault: 14 });
  assert.equal(normalized.grossWeight, 0.5);
  assert.equal(normalized.purchaseCost, 5200);
  assert.equal(normalized.vat.vatAmount, "728.00000000");
  assert.equal(normalized.karat, null);
  const derivedAgain = runtime.normalizeReceiptPiece({ ...normalized, grossWeight: 2 }, { vatRateDefault: 14 });
  assert.equal(derivedAgain.grossWeight, 0.5);
  const summary = acquisition.previewFromPieces({ normalizedItems: [acquisition.normalizeItem({ profile: "LOOSE_GEMSTONE" }, [normalized])], body: { applyVat: true, isRecoverable: true }, settings: { vatEnabled: true }, inventoryV2Target: true });
  assert.equal(summary.taxBase, 5200);
  assert.equal(summary.inputVatAmount, 728);
  assert.equal(summary.total, 5928);
});

test("Loose Gem Stone barcode and exact idempotency contracts are fixed", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/barcode-identity.service.js"), "utf8");
  assert.match(source, /isLooseGemstone/);
  assert.match(source, /LOOSE_GEMSTONE_INVENTORY_CODE_MUST_BE_GS/);
  assert.match(source, /LOOSE_GEMSTONE_ITEM_CODE_MUST_BE_LOS/);
  const original = { inventoryV2: true, profile: "LOOSE_GEMSTONE", items: [{ quantity: 1, perPiece: [{ purchaseCost: 5200 }] }] };
  assert.equal(idempotency.hashRequest("purchase.receive", original), idempotency.hashRequest("purchase.receive", { ...original }));
  assert.notEqual(idempotency.hashRequest("purchase.receive", original), idempotency.hashRequest("purchase.receive", { ...original, items: [{ quantity: 1, perPiece: [{ purchaseCost: 5201 }] }] }));
});
