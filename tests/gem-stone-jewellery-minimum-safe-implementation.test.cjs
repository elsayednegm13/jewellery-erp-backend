const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const goldRefPath = require.resolve("../src/services/gold-center-reference-price.service.js");
require.cache[goldRefPath] = { id: goldRefPath, filename: goldRefPath, loaded: true, exports: { getGlobalRateForGoldByPiece: async () => ({ rate: "300.00000000", snapshot: { provider: "TEST_GOLD_CENTER" } }) } };
const gem = require("../src/services/gem-stone-jewellery-profile.service.js");
const idempotency = require("../src/services/idempotency.service.js");
const gemPage = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/inventory/gem-stone/page.tsx"), "utf8");

const masters = gem.masterIndex([
  { category: "GEMSTONE_NAME", label: "Ruby", isActive: true },
  { category: "GEMSTONE_TYPE", label: "Natural", isActive: true },
  { category: "GEMSTONE_SETTING", label: "Prong", isActive: true },
  { category: "GEMSTONE_SETTING", label: "Bezel", isActive: true },
]);
const taxPolicy = { vatRegistered: true, vatRate: 14, enabledTaxTreatments: ["STANDARD_VAT", "ZERO_RATED", "EXEMPT", "REVERSE_CHARGE", "OUT_OF_SCOPE"] };
const baseInput = {
  profile: "GEMSTONE_JEWELLERY", description: "Gem Stone Ring", itemCode: "RNG", grossWeight: "10.00000000", karat: 21,
  totalGemStoneWeightCt: "2.00000000", goldPurchasePrice: "250.00000000", makingPerGram: "20.00000000",
  currentMakingPerGram: "25.00000000", currentGemStoneValue: "150.00000000", sellingPrice: "4000.00000000", taxTreatment: "STANDARD_VAT",
  components: [{ stoneName: "Ruby", stoneType: "Natural", stoneCaratWeight: "1.00000000", stoneCost: "40.00000000", settings: ["Prong", "Bezel"] }, { stoneName: "Ruby", stoneType: "Natural", stoneCaratWeight: "1.00000000", stoneCost: "60.00000000", settings: ["Prong"] }],
};

test("Gem Stone profile is server-authoritatively classified and validates the nine-section core", () => {
  const normalized = gem.normalizePiece(baseInput, { masterData: masters, requireSalePrice: true });
  assert.equal(normalized.profile, "GEMSTONE_JEWELLERY");
  assert.equal(normalized.stoneWeight, "0.40000000");
  assert.equal(normalized.netGoldWeight, "9.60000000");
  assert.equal(normalized.pureGoldWeight9999, "8.40000000");
  assert.deepEqual(normalized.components[0].settings, ["Prong", "Bezel"]);
});

test("Gem Stone CT total mismatch and missing Treatment master fail closed", () => {
  assert.throws(() => gem.normalizePiece({ ...baseInput, totalGemStoneWeightCt: "1.00000000" }, { masterData: masters }), /GEMSTONE_TOTAL_CARAT_MISMATCH/);
  assert.throws(() => gem.normalizePiece({ ...baseInput, components: [{ ...baseInput.components[0], treatment: "Heated" }] }, { masterData: masters }), /GEMSTONE_TREATMENT_MASTER_UNAVAILABLE/);
});

test("Gem Stone financial preview applies configured VAT once and separates historical/current values", async () => {
  const result = await gem.calculatePreview({ companyId: "COMP-TEST", input: baseInput, settings: { vatEnabled: true }, taxPolicy, masterData: masters });
  assert.equal(result.historicalPurchase.goldValue, "2400.00000000");
  assert.equal(result.historicalPurchase.makingTotal, "192.00000000");
  assert.equal(result.historicalPurchase.gemStoneCost, "100.00000000");
  assert.equal(result.historicalPurchase.purchaseBasePreTax, "2692.00000000");
  assert.equal(result.historicalPurchase.vatAmount, "376.88000000");
  assert.equal(result.historicalPurchase.totalPurchaseCost, "3068.88000000");
  assert.equal(result.currentCost.goldValue, "2880.00000000");
  assert.equal(result.currentCost.gemStoneValue, "150.00000000");
  assert.notEqual(result.currentCost.currentValuationTotalTaxInclusive, result.historicalPurchase.totalPurchaseCost);
});

test("Migration defines normalized multi-setting relation and preserves forward-only history", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../migrations/20260821020000-gemstone-jewellery-multisetting-and-master-alignment.js"), "utf8");
  assert.match(migration, /asset_gemstone_component_settings/);
  assert.match(migration, /master_data_id/);
  assert.match(migration, /NON_DESTRUCTIVE_FORWARD_ONLY/);
});

test("Unified Intake exposes Gem Stone as the single canonical profile route", () => {
  const chooser = fs.readFileSync(path.join(__dirname, "../../components/inventory/inventory-intake-chooser.tsx"), "utf8");
  assert.match(chooser, /key: "GEM_STONE"[\s\S]*?enabled: true/);
  assert.match(chooser, /\/inventory\/gem-stone/);
});

test("Gem receive retains one exact prepared request and follows the canonical idempotency hash", () => {
  assert.match(gemPage, /setPreparedReceive\(JSON\.parse\(JSON\.stringify\(\{ \.\.\.receiveBody, idempotencyKey \}\)\)\)/);
  assert.match(gemPage, /const exactRequest = preparedReceive/);
  assert.match(gemPage, /body: JSON\.stringify\(exactRequest\)/);
  assert.match(gemPage, /data-testid="prepared-receive-payload"/);
  const original = { idempotencyKey: "gem-proof-key", inventoryV2: true, items: [{ profile: "GEMSTONE_JEWELLERY", unitCost: 2692 }] };
  const replay = { ...original, idempotencyKey: "gem-proof-key" };
  const changed = { ...original, items: [{ ...original.items[0], unitCost: 2693 }] };
  assert.equal(idempotency.hashRequest("purchase.receive", original), idempotency.hashRequest("purchase.receive", replay));
  assert.notEqual(idempotency.hashRequest("purchase.receive", original), idempotency.hashRequest("purchase.receive", changed));
});

test("Gem Stone settings keeps array binding while using an accessible chip multi-select", () => {
  assert.match(gemPage, /value=\{stone\.settings\}/);
  assert.match(gemPage, /aria-multiselectable="true"/);
  assert.match(gemPage, /role="listbox"/);
  assert.match(gemPage, /Remove \$\{option\}/);
  assert.doesNotMatch(gemPage, /<select className="input-base w-full" multiple=\{multiple\}/);
});
