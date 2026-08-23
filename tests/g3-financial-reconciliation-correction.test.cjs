const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const goldByPiece = require("../src/services/gold-by-piece-profile.service");
const acquisitionPreview = require("../src/services/supplier-acquisition-preview.service");

const repo = path.resolve(__dirname, "../..");
const gbpPage = fs.readFileSync(path.join(repo, "app/[locale]/(dashboard)/inventory/gold-by-piece/page.tsx"), "utf8");
const posting = fs.readFileSync(path.join(repo, "backend/src/services/posting.service.js"), "utf8");

test("GBP shared receive preview carries server-derived purchase/tax evidence", () => {
  assert.match(gbpPage, /purchaseCost:\s*unitCost/);
  assert.match(gbpPage, /vatBase:\s*preview\?\.purchase\?\.vatBase/);
  assert.match(gbpPage, /vatAmount:\s*preview\?\.purchase\?\.vatAmount/);
  assert.match(gbpPage, /makingTotal:\s*preview\?\.purchase\?\.makingTotal/);
});

test("GBP profile economics and shared tax preview reconcile at the same precision", () => {
  const calculation = goldByPiece.calculate({
    input: { grossWeight: 4, stoneWeight: 0, karat: 21, makingPerGram: 20, currentMakingPerGram: 20, markupPercent: 25, maximumDiscountPercent: 10, vatRate: 14 },
    settings: { vatEnabled: true, vatRate: 14, purchaseVatRate: 14 },
    purchaseRate: "448.69471393",
    currentRate: "448.69471393",
  });
  const normalizedItems = [acquisitionPreview.normalizeItem({ quantity: 1 }, [{
    profile: "GOLD_BY_PIECE",
    grossWeight: 4,
    purchaseCost: calculation.purchase.totalPurchaseCost,
    vat: { vatBase: calculation.purchase.vatBase, vatAmount: calculation.purchase.vatAmount, vatRate: calculation.purchase.vatRate },
  }])];
  const shared = acquisitionPreview.previewFromPieces({
    normalizedItems,
    body: { applyVat: true },
    settings: { vatEnabled: true, vatRate: 14, purchaseVatRate: 14 },
    inventoryV2Target: true,
  });
  assert.equal(shared.goodsTotal, Number(calculation.purchase.totalPurchaseCost));
  assert.equal(shared.taxBase, Number(calculation.purchase.vatBase));
  assert.equal(shared.inputVatAmount, Number(calculation.purchase.vatAmount));
  assert.equal(shared.total, Number(calculation.purchase.totalPurchaseCost));
});

test("posting rejects a one-cent imbalance before any JournalEntry write", () => {
  assert.match(posting, /const roundedLines = lines\.map/);
  assert.match(posting, /Math\.round\(totalDebit \* 100\) !== Math\.round\(totalCredit \* 100\)/);
  const guard = posting.indexOf("Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)");
  const create = posting.indexOf("JournalEntry.create");
  assert.ok(guard >= 0 && guard < create, "balance guard must precede JournalEntry.create");
});
