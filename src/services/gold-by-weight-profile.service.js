"use strict";

const Decimal = require("decimal.js");
const inventoryPolicy = require("./inventory-master-policy.service");
const goldValuationService = require("./gold-valuation.service");
const goldSalePricingService = require("./gold-sale-pricing.service");

const PROFILE_JEWELLERY = "GOLD_BY_WEIGHT_JEWELLERY";
const PROFILE_BAR = "GOLD_BAR_24K";
const PROFILES = Object.freeze([PROFILE_JEWELLERY, PROFILE_BAR]);
const KARATS = Object.freeze([9, 10, 12, 14, 18, 21, 22, 24]);
const JEWELLERY_KARATS = Object.freeze([9, 10, 12, 14, 18, 21, 22]);
const STATUS = Object.freeze([
  "PENDING_INTEGRATION", "AVAILABLE", "RESERVED", "PENDING_TRANSFER", "WORKSHOP",
  "SOLD", "RETURNED", "MISSING", "MELTED", "REVERSAL_PENDING", "REVERSED",
]);

function fail(code, message = code, fields = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 422;
  error.fieldErrors = fields;
  return error;
}

function decimal(value, field, { required = false, min = 0 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw fail(`GBW_${field}_REQUIRED`);
    return null;
  }
  let parsed;
  try { parsed = new Decimal(String(value)); } catch (_) { throw fail(`GBW_${field}_INVALID`); }
  if (!parsed.isFinite() || parsed.lt(min)) throw fail(`GBW_${field}_INVALID`);
  return parsed;
}

function fixed(value, places = 8) {
  return new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

function canonicalProfile(value) {
  const raw = String(value || "").trim().toUpperCase();
  try {
    const profile = inventoryPolicy.normalizeProfile(raw);
    if (!PROFILES.includes(profile)) throw fail("GBW_PROFILE_UNSUPPORTED");
    return profile;
  } catch (error) {
    if (error?.code === "GBW_PROFILE_UNSUPPORTED") throw error;
    throw fail("GBW_PROFILE_REQUIRED");
  }
}

function assertNoProductQuantityAuthority(input = {}) {
  const forbidden = ["productId", "productCode", "quantity", "stockQuantity", "quantityOnHand", "quantityAvailable", "inventoryQuantity"];
  const field = forbidden.find((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (field) throw fail("GBW_PRODUCT_QUANTITY_AUTHORITY_FORBIDDEN", `Gold By Weight cannot use ${field} as physical inventory authority.`, { [field]: ["Use one canonical perPiece Asset payload."] });
}

function normalizeInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("GBW_INPUT_INVALID");
  assertNoProductQuantityAuthority(input);
  const profile = canonicalProfile(input.profile || input.inventoryProfile || input.strategy);
  const description = String(input.description || input.name || "").trim();
  if (!description) throw fail("GBW_DESCRIPTION_REQUIRED", "Item Description is required.", { description: ["Required"] });
  const karat = decimal(input.karat, "KARAT", { required: true, min: 1 });
  if (!KARATS.includes(karat.toNumber())) throw fail("GBW_KARAT_NOT_ALLOWED", "Karat must come from the server policy.");
  if (profile === PROFILE_BAR && !karat.eq(24)) throw fail("GBW_BAR_KARAT_REQUIRED", "Gold Bar requires 24K.");
  if (profile === PROFILE_JEWELLERY && !JEWELLERY_KARATS.includes(karat.toNumber())) throw fail("GBW_JEWELLERY_24K_BAR_SEPARATION", "24K is reserved for the Gold Bar strategy.");

  const grossWeight = decimal(input.grossWeight, "GROSS_WEIGHT", { required: true, min: 0 });
  if (grossWeight.lte(0)) throw fail("GBW_GROSS_WEIGHT_INVALID");
  const stoneWeight = decimal(input.stoneWeight ?? 0, "STONE_WEIGHT", { required: true, min: 0 });
  if (stoneWeight.gt(grossWeight)) throw fail("GBW_STONE_WEIGHT_EXCEEDS_GROSS");
  if (grossWeight.minus(stoneWeight).lte(0)) throw fail("GBW_NET_WEIGHT_INVALID");
  const makingPerGram = profile === PROFILE_JEWELLERY
    ? decimal(input.makingPerGram ?? input.makingCostPerGram, "MAKING_PER_GRAM", { required: true, min: 0 })
    : null;
  const certificateCost = profile === PROFILE_BAR
    ? decimal(input.certificateCost, "CERTIFICATE_COST", { required: true, min: 0 })
    : null;
  const purchaseGoldRate = decimal(input.purchaseGoldRate, "PURCHASE_GOLD_RATE", { min: 0 });
  const currentGoldRate = decimal(input.currentGoldRate, "CURRENT_GOLD_RATE", { min: 0 });
  const currentMakingPerGram = profile === PROFILE_JEWELLERY
    ? decimal(input.currentMakingPerGram ?? makingPerGram?.toString(), "CURRENT_MAKING_PER_GRAM", { required: true, min: 0 })
    : null;
  const minimumMakingPerGram = profile === PROFILE_JEWELLERY
    ? decimal(input.minimumMakingPerGram, "MINIMUM_MAKING_PER_GRAM", { min: 0 })
    : null;
  return Object.freeze({
    ...input,
    profile,
    description,
    karat: karat.toNumber(),
    grossWeight: fixed(grossWeight),
    stoneWeight: fixed(stoneWeight),
    makingPerGram: makingPerGram ? fixed(makingPerGram) : null,
    currentMakingPerGram: currentMakingPerGram ? fixed(currentMakingPerGram) : null,
    certificateCost: certificateCost ? fixed(certificateCost) : null,
    purchaseGoldRate: purchaseGoldRate ? fixed(purchaseGoldRate) : null,
    currentGoldRate: currentGoldRate ? fixed(currentGoldRate) : null,
    minimumMakingPerGram: minimumMakingPerGram ? fixed(minimumMakingPerGram) : null,
    netGoldWeight: fixed(grossWeight.minus(stoneWeight)),
    pureGoldWeight9999: fixed(grossWeight.minus(stoneWeight).times(karat).div(24)),
  });
}

function calculate({ input, configuredVatRate = null, purchaseGoldRate = null, currentGoldRate = null, sale = null } = {}) {
  const normalized = normalizeInput(input);
  const effectivePurchaseRate = normalized.purchaseGoldRate || (purchaseGoldRate == null ? null : fixed(purchaseGoldRate));
  const effectiveCurrentRate = normalized.currentGoldRate || (currentGoldRate == null ? null : fixed(currentGoldRate));
  if (effectivePurchaseRate === null) throw fail("GBW_PURCHASE_GOLD_RATE_REQUIRED");
  if (effectiveCurrentRate === null) throw fail("GBW_CURRENT_GOLD_RATE_REQUIRED");
  const valuation = goldValuationService.calculateReceiptGoldValuation({
    profile: normalized.profile,
    weights: { netGoldWeight: normalized.netGoldWeight },
    input: {
      purchaseGoldRate: effectivePurchaseRate,
      currentGoldRate: effectiveCurrentRate,
      makingPerGram: normalized.makingPerGram,
      currentMakingPerGram: normalized.currentMakingPerGram,
      certificateCost: normalized.certificateCost,
      vatRate: normalized.vatRate ?? configuredVatRate,
      currentVatRate: normalized.currentVatRate ?? configuredVatRate,
      purchaseRateSource: normalized.purchaseRateSource || (normalized.purchaseGoldRate ? "MANUAL" : "GOLD_CENTER"),
      currentRateSource: normalized.currentRateSource || (normalized.currentGoldRate ? "GOLD_CENTER" : "GOLD_CENTER"),
    },
    configuredVatRate,
  });
  let salePricing = null;
  if (sale) {
    salePricing = goldSalePricingService.calculateGoldSalePrice(normalized.profile, {
      netGoldWeight: normalized.netGoldWeight,
      itemWeightGrams: normalized.grossWeight,
      sellingGoldRate: sale.sellingGoldRate,
      makingChargePerGram: sale.makingPerGram,
      minimumMakingPerGram: sale.minimumMakingPerGram ?? normalized.minimumMakingPerGram,
      certificateSaleAmount: sale.certificateSaleAmount,
      minimumCertificateCharge: sale.minimumCertificateCharge,
      vatRate: sale.vatRate,
      configuredVatRate,
    });
  }
  return Object.freeze({
    profile: normalized.profile,
    strategy: normalized.profile === PROFILE_BAR ? "BAR_CERTIFICATE_STRATEGY" : "WEIGHT_BASED_MAKING_STRATEGY",
    input: normalized,
    weights: { grossWeight: normalized.grossWeight, stoneWeight: normalized.stoneWeight, netGoldWeight: normalized.netGoldWeight, pureGoldWeight9999: normalized.pureGoldWeight9999, karat: normalized.karat },
    purchase: valuation.purchase,
    current: valuation.current,
    sale: salePricing,
  });
}

module.exports = {
  PROFILE_JEWELLERY,
  PROFILE_BAR,
  PROFILES,
  KARATS,
  JEWELLERY_KARATS,
  STATUS,
  canonicalProfile,
  assertNoProductQuantityAuthority,
  normalizeInput,
  calculate,
};
