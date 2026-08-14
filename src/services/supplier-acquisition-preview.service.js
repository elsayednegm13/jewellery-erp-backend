"use strict";

// Read-only supplier-acquisition summary.  This deliberately consumes the
// already-normalized V2 receipt pieces and mirrors the receive route's VAT
// snapshot rules; it does not persist or create a second payable authority.
const Decimal = require("decimal.js");

const round2 = (value) => new Decimal(value || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
const round4 = (value) => new Decimal(value || 0).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();

function normalizeItem(item, pieces) {
  const totalCost = round2(pieces.reduce((sum, piece) => new Decimal(sum).plus(piece.purchaseCost || 0), 0));
  const totalWeight = new Decimal(pieces.reduce((sum, piece) => new Decimal(sum).plus(piece.grossWeight || 0), 0)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
  return { ...item, v2Pieces: pieces, totalCost, unitCost: pieces.length ? totalCost / pieces.length : 0, totalWeight };
}

function calculateTotals({ normalizedItems = [], body = {}, settings = {}, inventoryV2Target = false }) {
  const goodsTotal = round2(normalizedItems.reduce((sum, item) => new Decimal(sum).plus(item.totalCost || 0), 0));
  const totalWeight = new Decimal(normalizedItems.reduce((sum, item) => new Decimal(sum).plus(item.totalWeight || 0), 0)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
  const rcmRequested = Boolean(body.isRcm || body.isDRC || body.reverseVat || body.useReverseCharge);
  const vatRequested = (rcmRequested || body.applyVat === true) && settings.vatEnabled !== false;
  let taxBase = 0;
  let vatRate = 0;
  let inputVatAmount = 0;
  let taxIncluded = false;
  let isRecoverable = true;
  let isRcm = false;
  let rcmVatAmount = 0;
  let rcmRate = 0;
  let total = goodsTotal;

  const pieceVats = inventoryV2Target
    ? normalizedItems.flatMap((item) => item.v2Pieces || []).map((piece) => piece.vat).filter(Boolean)
    : [];
  const explicitV2Vat = vatRequested && !rcmRequested && pieceVats.length > 0 && pieceVats.every((vat) => Number(vat.vatRate) > 0);
  if (explicitV2Vat) {
    const rates = new Set(pieceVats.map((vat) => Number(vat.vatRate).toFixed(8)));
    if (rates.size !== 1) throw new Error("Inventory V2 receipt requires one VAT rate per purchase document.");
  }

  if (vatRequested && rcmRequested) {
    const rate = Number(body.rcmRate ?? body.vatRate ?? settings.purchaseVatRate ?? settings.vatRate ?? 0);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new Error("RCM purchase requires a valid rcmRate between 0 and 100");
    if (body.isRecoverable === false) throw new Error("RCM purchase cannot be non-recoverable");
    if (Number(body.inputVatAmount) > 0) throw new Error("RCM purchase must not carry ordinary input VAT");
    isRcm = true;
    isRecoverable = true;
    taxBase = goodsTotal;
    rcmRate = rate;
    vatRate = rate;
    rcmVatAmount = round2(new Decimal(taxBase).times(rate).div(100));
    total = taxBase;
  } else if (explicitV2Vat) {
    vatRate = Number(pieceVats[0].vatRate);
    taxIncluded = true;
    isRecoverable = Boolean(body.isRecoverable ?? settings.purchaseVatRecoverableDefault ?? true);
    inputVatAmount = round2(pieceVats.reduce((sum, vat) => new Decimal(sum).plus(vat.vatAmount || 0), 0));
    taxBase = round2(new Decimal(goodsTotal).minus(inputVatAmount));
    total = goodsTotal;
  } else if (vatRequested) {
    const rate = Number(body.vatRate ?? settings.purchaseVatRate ?? settings.vatRate ?? 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("Purchase vatRate must be a finite number between 0 and 100");
    if (rate > 0) {
      vatRate = rate;
      taxIncluded = Boolean(body.taxIncluded ?? settings.purchaseTaxIncludedDefault ?? false);
      isRecoverable = Boolean(body.isRecoverable ?? settings.purchaseVatRecoverableDefault ?? true);
      if (taxIncluded) {
        taxBase = round2(new Decimal(goodsTotal).div(new Decimal(1).plus(rate / 100)));
        inputVatAmount = round2(new Decimal(goodsTotal).minus(taxBase));
        total = goodsTotal;
      } else {
        taxBase = goodsTotal;
        inputVatAmount = round2(new Decimal(taxBase).times(rate).div(100));
        total = round2(new Decimal(taxBase).plus(inputVatAmount));
      }
    }
  }

  const paidAmount = round2(body.paidAmount || 0);
  const remainingAmount = round2(new Decimal(total).minus(paidAmount));
  const paymentStatus = remainingAmount <= 0 && total > 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid";
  return { goodsTotal, totalWeight, total, paidAmount, remainingAmount, paymentStatus, taxBase, vatRate, inputVatAmount, taxIncluded, isRecoverable, isRcm, rcmVatAmount, rcmRate };
}

function summarizePieces(normalizedItems = []) {
  return normalizedItems.flatMap((item) => (item.v2Pieces || []).map((piece) => {
    const profile = piece.profile || piece.inventoryProfile || null;
    const isGold = profile === "GOLD_BY_WEIGHT_JEWELLERY" || profile === "GOLD_BAR_24K";
    const isBar = profile === "GOLD_BAR_24K";
    const isLoose = profile === "LOOSE_GEMSTONE" || profile === "LOOSE_PEARL";
    return {
      profile,
      grossWeight: piece.grossWeight,
      stoneWeight: piece.stoneWeight,
      netWeight: piece.weights?.netGoldWeight ?? null,
      pureGold9999: piece.weights?.pureGold9999 ?? null,
      purchaseGoldValue: isGold ? Number(piece.goldValue || 0) : 0,
      makingTotal: isGold ? Number(piece.makingTotal || 0) : 0,
      purchaseBaseCost: isLoose ? Number(piece.loosePurchase?.purchaseBaseCost || 0) : (!isGold ? Number(piece.purchaseCost || 0) : 0),
      additionalCost: isLoose ? Number(piece.loosePurchase?.additionalCost || 0) : 0,
      certificateCost: isBar ? Number(piece.certificateCost || 0) : 0,
      purchaseVat: Number(piece.vat?.vatAmount || 0),
      certificateVat: isBar ? Number(piece.vat?.vatAmount || 0) : 0,
      purchaseTotal: Number(piece.purchaseCost || 0),
      vatRate: Number(piece.vat?.vatRate || 0),
      vatRateSource: piece.vat?.vatRateSource || null,
    };
  }));
}

function previewFromPieces({ normalizedItems, body, settings, inventoryV2Target = true }) {
  return { ...calculateTotals({ normalizedItems, body, settings, inventoryV2Target }), items: summarizePieces(normalizedItems) };
}

module.exports = { normalizeItem, calculateTotals, summarizePieces, previewFromPieces };
