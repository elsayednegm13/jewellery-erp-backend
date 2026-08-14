const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const route = fs.readFileSync(path.join(root, "backend/src/routes/erp.routes.js"), "utf8");
const page = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/suppliers/purchases/page.tsx"), "utf8");
const preview = require(path.join(root, "backend/src/services/supplier-acquisition-preview.service.js"));

test("supplier preview reuses the canonical V2 normalization boundary", () => {
  assert.match(route, /router\.post\("\/inventory-v2\/receive-preview"/);
  assert.match(route, /requireV2ReceiptPieces\(rawItems/);
  assert.match(route, /supplierAcquisitionPreviewService\.previewFromPieces/);
  assert.match(route, /supplierAcquisitionPreviewService\.calculateTotals\(\{ normalizedItems/);
  assert.match(route, /supplierPaymentState/);
  assert.doesNotMatch(route, /Supplier\.due\s*=|supplier\.due\s*=/);
});

test("all serialized profiles have a server-preview path and CGP is blocked", () => {
  assert.match(page, /\/inventory-v2\/receive-preview/);
  assert.match(page, /canonicalPreview/);
  assert.match(page, /disabled=\{isCgpOption\}/);
  assert.match(page, /previewUnavailable/);
  assert.match(page, /goldValuationApplicable \? undefined/);
  assert.match(page, /is24kGoldBar \? parseDecimal\(piece\.certificateCost\)/);
});

test("preview preserves profile-specific acquisition totals without persistence", () => {
  const result = preview.previewFromPieces({
    normalizedItems: [{
      totalCost: 1250,
      totalWeight: 10,
      v2Pieces: [{ profile: "GOLD_BAR_24K", grossWeight: 10, stoneWeight: 0, goldValue: 1200, certificateCost: 50, vat: { vatRate: 0, vatAmount: 0 }, purchaseCost: 1250 }],
    }],
    body: { paidAmount: 250 },
    settings: { vatEnabled: true },
  });
  assert.equal(result.total, 1250);
  assert.equal(result.remainingAmount, 1000);
  assert.equal(result.items[0].profile, "GOLD_BAR_24K");
  assert.equal(result.items[0].certificateCost, 50);
  assert.equal(result.items[0].certificateVat, 0);
});

test("preview parity covers every Supplier-valid profile family", () => {
  const profiles = [
    "GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K", "GOLD_BY_PIECE",
    "DIAMOND_JEWELLERY", "LOOSE_DIAMOND", "GEMSTONE_JEWELLERY",
    "LOOSE_GEMSTONE", "PEARL_JEWELLERY", "LOOSE_PEARL",
  ];
  const normalizedItems = profiles.map((profile, index) => ({
    totalCost: 100 + index,
    totalWeight: 1,
    v2Pieces: [{ profile, purchaseCost: 100 + index, grossWeight: 1, stoneWeight: 0, vat: { vatRate: 0, vatAmount: 0 }, ...(profile.startsWith("GOLD_") ? { goldValue: 100 + index, makingTotal: 0 } : {}) }],
  }));
  const result = preview.previewFromPieces({ normalizedItems, body: { paidAmount: 0 }, settings: {} });
  assert.equal(result.items.length, profiles.length);
  assert.equal(result.total, 936);
  profiles.forEach((profile, index) => assert.equal(result.items[index].profile, profile));
});
