"use strict";

const Decimal = require("decimal.js");
const goldCenterReferencePriceService = require("./gold-center-reference-price.service");
const goldSalePricingService = require("./gold-sale-pricing.service");

const PROFILE = "GOLD_BY_PIECE";
const KARATS = Object.freeze([9, 10, 12, 14, 18, 21, 22, 24]);
const RATE_TYPES = Object.freeze(["GLOBAL", "RETAIL"]);
const CURRENCY = "AED";
const UNIT = "PER_GRAM";

function decimal(value, field, { required = false, min = null } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`GBP_${field}_REQUIRED`);
    return null;
  }
  let parsed;
  try { parsed = new Decimal(String(value)); } catch { throw new Error(`GBP_${field}_INVALID`); }
  if (!parsed.isFinite() || (min !== null && parsed.lt(min))) throw new Error(`GBP_${field}_INVALID`);
  return parsed;
}

function fixed8(value) {
  return new Decimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

function fixed6(value) {
  return new Decimal(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

function requireKarat(value) {
  const karat = decimal(value, "KARAT", { required: true, min: 0 });
  if (!karat.isInteger() || !KARATS.includes(karat.toNumber())) throw new Error("GBP_KARAT_UNSUPPORTED");
  return karat.toNumber();
}

function validateWeights({ grossWeight, stoneWeight, karat }) {
  const gross = decimal(grossWeight, "GROSS_WEIGHT", { required: true, min: 0 });
  const stone = decimal(stoneWeight, "STONE_WEIGHT", { required: true, min: 0 });
  if (gross.lte(0)) throw new Error("GBP_GROSS_WEIGHT_INVALID");
  if (stone.gt(gross)) throw new Error("GBP_STONE_WEIGHT_EXCEEDS_GROSS");
  const selectedKarat = requireKarat(karat);
  const net = gross.minus(stone);
  const pure = net.times(selectedKarat).div(24);
  return { gross, stone, net, pure, karat: selectedKarat };
}

function resolveCurrentRateMode(settings = {}) {
  const raw = settings._raw || {};
  const requested = raw.goldByPieceCurrentRateMode ?? raw.goldCurrentRateMode ?? raw.currentGoldRateMode;
  const mode = String(requested || "GLOBAL").trim().toUpperCase();
  if (!RATE_TYPES.includes(mode)) throw new Error("GBP_CURRENT_RATE_MODE_INVALID");
  return mode;
}

async function resolveRate({ companyId, currency = CURRENCY, karat, rateType = "GLOBAL", now = new Date() }) {
  const normalizedType = String(rateType || "GLOBAL").trim().toUpperCase();
  if (!RATE_TYPES.includes(normalizedType)) throw new Error("GBP_RATE_TYPE_INVALID");
  if (normalizedType === "RETAIL") {
    const error = new Error("GBP_RETAIL_RATE_NOT_CONFIGURED");
    error.code = "GBP_RETAIL_RATE_NOT_CONFIGURED";
    throw error;
  }
  if (String(currency || CURRENCY).toUpperCase() !== CURRENCY) throw new Error("GBP_CURRENCY_MUST_BE_AED");
  const selectedKarat = requireKarat(karat);
  const resolved = await goldCenterReferencePriceService.getGlobalRateForGoldByPiece(companyId, CURRENCY, selectedKarat, { now });
  return Object.freeze({
    rateType: "GLOBAL",
    karat: selectedKarat,
    rate: resolved.rate,
    currency: CURRENCY,
    unit: UNIT,
    source: resolved.snapshot.provider || resolved.snapshot.source,
    sourceTimestamp: resolved.snapshot.sourceTimestamp,
    resolvedAt: resolved.snapshot.resolvedAt,
    quoteTimestamp: resolved.snapshot.updatedAt,
    quoteId: resolved.snapshot.quoteId,
    quoteType: "SPOT",
    freshness: resolved.snapshot.freshness,
    status: resolved.snapshot.status,
    derivation: resolved.snapshot.derivation,
    snapshot: resolved.snapshot,
  });
}

function calculateVat(base, vatEnabled, vatRate) {
  const enabled = vatEnabled !== false;
  const rate = enabled ? decimal(vatRate, "VAT_RATE", { required: true, min: 0 }) : new Decimal(0);
  if (rate.gt(100)) throw new Error("GBP_VAT_RATE_INVALID");
  const amount = base.times(rate).div(100);
  return { enabled, rate: fixed6(rate), base: fixed8(base), amount: fixed8(amount) };
}

function calculate({ input = {}, settings = {}, purchaseRate, currentRate, purchaseRateSnapshot, currentRateSnapshot }) {
  const weights = validateWeights(input);
  const purchase = decimal(purchaseRate, "PURCHASE_GOLD_RATE", { required: true, min: 0 });
  const current = decimal(currentRate ?? purchaseRate, "CURRENT_GOLD_RATE", { required: true, min: 0 });
  if (purchase.lte(0) || current.lte(0)) throw new Error("GBP_GOLD_RATE_INVALID");
  const makingPerGram = decimal(input.makingPerGram, "MAKING_PER_GRAM", { required: true, min: 0 });
  const currentMakingPerGram = decimal(input.currentMakingPerGram ?? input.makingPerGram, "CURRENT_MAKING_PER_GRAM", { required: true, min: 0 });
  const purchaseGoldValue = purchase.times(weights.net);
  const purchaseMakingTotal = makingPerGram.times(weights.net);
  const purchaseBase = purchaseGoldValue.plus(purchaseMakingTotal);
  const purchaseVat = calculateVat(purchaseBase, settings.vatEnabled, input.vatRate ?? settings.purchaseVatRate ?? settings.vatRate);
  const purchaseTotal = purchaseBase.plus(purchaseVat.amount);
  const currentGoldValue = current.times(weights.net);
  const currentMakingValue = currentMakingPerGram.times(weights.net);
  const currentBase = currentGoldValue.plus(currentMakingValue);
  const currentVat = calculateVat(currentBase, settings.vatEnabled, input.currentVatRate ?? input.vatRate ?? settings.vatRate);
  const currentTotal = currentBase.plus(currentVat.amount);
  const sale = input.markupPercent === undefined || input.markupPercent === null || input.markupPercent === ""
    ? null
    : goldSalePricingService.calculateGoldByPieceSalePrice({
      currentTotalCost: fixed8(currentTotal),
      markupPercent: input.markupPercent,
      maximumDiscountPercent: input.maximumDiscountPercent,
      proposedDiscount: input.proposedDiscount,
      vatRate: input.saleVatRate ?? input.vatRate ?? settings.vatRate,
      configuredVatRate: settings.vatRate,
    });

  return Object.freeze({
    profile: PROFILE,
    weights: {
      grossWeight: fixed8(weights.gross),
      stoneWeight: fixed8(weights.stone),
      netGoldWeight: fixed8(weights.net),
      pureGoldWeight9999: fixed8(weights.pure),
      karat: fixed6(weights.karat),
    },
    gold: {
      purchaseRate: fixed8(purchase), currentRate: fixed8(current),
      purchaseRateType: "GLOBAL", currentRateType: currentRateSnapshot?.rateType || "GLOBAL",
      currency: CURRENCY, unit: UNIT, purchaseRateSnapshot: purchaseRateSnapshot || null, currentRateSnapshot: currentRateSnapshot || null,
    },
    purchase: {
      goldValue: fixed8(purchaseGoldValue), makingPerGram: fixed8(makingPerGram), makingTotal: fixed8(purchaseMakingTotal),
      vatEnabled: purchaseVat.enabled, vatRate: purchaseVat.rate, vatBase: purchaseVat.base, vatAmount: purchaseVat.amount,
      totalPurchaseCost: fixed8(purchaseTotal),
    },
    current: {
      goldValue: fixed8(currentGoldValue), makingPerGram: fixed8(currentMakingPerGram), makingValue: fixed8(currentMakingValue),
      vatEnabled: currentVat.enabled, vatRate: currentVat.rate, vatBase: currentVat.base, vatAmount: currentVat.amount,
      totalValue: fixed8(currentTotal),
    },
    sale,
  });
}

async function calculateWithLiveRates({ companyId, settings, input }) {
  const selectedKarat = requireKarat(input.karat);
  const purchaseRate = await resolveRate({ companyId, currency: CURRENCY, karat: selectedKarat, rateType: "GLOBAL" });
  const currentRateType = resolveCurrentRateMode(settings);
  const currentRate = await resolveRate({ companyId, currency: CURRENCY, karat: selectedKarat, rateType: currentRateType });
  const result = calculate({ input, settings, purchaseRate: purchaseRate.rate, currentRate: currentRate.rate, purchaseRateSnapshot: purchaseRate, currentRateSnapshot: currentRate });
  return Object.freeze({ ...result, currentRateMode: currentRateType });
}

module.exports = {
  PROFILE,
  KARATS,
  RATE_TYPES,
  CURRENCY,
  UNIT,
  fixed8,
  fixed6,
  validateWeights,
  resolveCurrentRateMode,
  resolveRate,
  calculate,
  calculateWithLiveRates,
};
