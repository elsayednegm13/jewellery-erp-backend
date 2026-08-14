"use strict";

const Decimal = require("decimal.js");

const CONDITION = Object.freeze({ REQUIRED: "REQUIRED", OPTIONAL: "OPTIONAL", NOT_APPLICABLE: "NOT_APPLICABLE" });

const COMMON_OPTIONAL_FIELDS = Object.freeze(["goldColor", "brand", "model", "modelNumber", "supplierReference", "locationId", "rfid", "certificate", "attachments", "components"]);
const LOOSE_DETAIL_CONTRACTS = Object.freeze({
  LOOSE_DIAMOND: Object.freeze({ kind: "DIAMOND", required: ["stoneName", "diamondType", "carat", "color", "clarity", "shape"], caratUnit: "CT", measurement: Object.freeze({ field: "carat", unit: "CT", inputPrecision: 3, displayPrecision: 2, commercialRounding: "CIBJO_GIA_9_RULE", excessPrecision: "REJECT" }) }),
  LOOSE_GEMSTONE: Object.freeze({ kind: "GEMSTONE", required: ["stoneName", "carat"], caratUnit: "CT", measurement: Object.freeze({ field: "carat", unit: "CT", inputPrecision: 3, displayPrecision: 2, commercialRounding: "CIBJO_9_RULE", excessPrecision: "REJECT" }) }),
  LOOSE_PEARL: Object.freeze({ kind: "PEARL", required: ["totalPearlWeight"], weightUnit: "CT", pearlSizeUnit: "MM", measurement: Object.freeze({ field: "totalPearlWeight", unit: "CT", inputPrecision: 2, displayPrecision: 2, commercialRounding: "NONE", excessPrecision: "REJECT" }), pearlSize: Object.freeze({ unit: "MM", authority: "SERVER_MASTER_DATA", freeTextForNewRecords: false, automaticRounding: "NONE" }) }),
});
const PROFILE_REGISTRY = Object.freeze({
  GOLD_BY_WEIGHT_JEWELLERY: Object.freeze({ aliases: ["GOLD_BY_WEIGHT"], assetType: "gold-weight", family: "GOLD", condition: CONDITION.OPTIONAL, pricing: "WEIGHT_BASED_MAKING_STRATEGY", required: ["description", "grossWeight", "karat", "purchaseCost"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: true, componentsSupported: true, rfidAllowed: true, locationOptional: true, goldValuation: Object.freeze({ enabled: true, purchaseGoldRateRequired: true, currentGoldRateRequired: true, makingPerGramSupported: true, certificateCostsSupported: false, certificateOnlyVat: false }) }),
  GOLD_BAR_24K: Object.freeze({ aliases: ["GOLD_BY_WEIGHT_24", "GOLD_BAR"], assetType: "gold-weight", family: "GOLD", condition: CONDITION.NOT_APPLICABLE, pricing: "BAR_CERTIFICATE_STRATEGY", required: ["description", "grossWeight", "karat", "purchaseCost"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: true, componentsSupported: false, rfidAllowed: true, locationOptional: true, goldValuation: Object.freeze({ enabled: true, purchaseGoldRateRequired: true, currentGoldRateRequired: true, makingPerGramSupported: false, certificateCostsSupported: true, certificateOnlyVat: true }) }),
  GOLD_BY_PIECE: Object.freeze({ aliases: [], assetType: "gold-piece", family: "GOLD", condition: CONDITION.REQUIRED, pricing: "PIECE_MARKUP_STRATEGY", required: ["description", "grossWeight", "karat", "purchaseCost", "condition"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: true, componentsSupported: true, rfidAllowed: true, locationOptional: true }),
  DIAMOND_JEWELLERY: Object.freeze({ aliases: [], assetType: "diamond", family: "DIAMOND", condition: CONDITION.OPTIONAL, pricing: "DIAMOND_PROFILE_STRATEGY", required: ["description", "grossWeight", "purchaseCost"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: true, componentsSupported: true, rfidAllowed: true, locationOptional: true }),
  LOOSE_DIAMOND: Object.freeze({ aliases: [], assetType: "diamond", family: "DIAMOND", condition: CONDITION.OPTIONAL, pricing: "LOOSE_ASSET_STRATEGY", required: ["description", "grossWeight", "purchaseCost"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: true, componentsSupported: false, rfidAllowed: true, locationOptional: true, looseDetails: LOOSE_DETAIL_CONTRACTS.LOOSE_DIAMOND }),
  GEMSTONE_JEWELLERY: Object.freeze({ aliases: [], assetType: "gemstone", family: "GEMSTONE", condition: CONDITION.OPTIONAL, pricing: "GEMSTONE_PROFILE_STRATEGY", required: ["description", "grossWeight", "purchaseCost"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: true, componentsSupported: true, rfidAllowed: true, locationOptional: true }),
  LOOSE_GEMSTONE: Object.freeze({ aliases: [], assetType: "gemstone", family: "GEMSTONE", condition: CONDITION.OPTIONAL, pricing: "LOOSE_ASSET_STRATEGY", required: ["description", "grossWeight", "purchaseCost"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: true, componentsSupported: false, rfidAllowed: true, locationOptional: true, looseDetails: LOOSE_DETAIL_CONTRACTS.LOOSE_GEMSTONE }),
  PEARL_JEWELLERY: Object.freeze({ aliases: [], assetType: "pearl", family: "PEARL", condition: CONDITION.OPTIONAL, pricing: "PEARL_PROFILE_STRATEGY", required: ["description", "grossWeight", "purchaseCost"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: true, componentsSupported: true, rfidAllowed: true, locationOptional: true }),
  LOOSE_PEARL: Object.freeze({ aliases: [], assetType: "pearl", family: "PEARL", condition: CONDITION.OPTIONAL, pricing: "LOOSE_ASSET_STRATEGY", required: ["description", "grossWeight", "purchaseCost"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: true, componentsSupported: false, rfidAllowed: true, locationOptional: true, looseDetails: LOOSE_DETAIL_CONTRACTS.LOOSE_PEARL }),
  CGP_CUSTOMER_GOLD_PURCHASE: Object.freeze({ aliases: ["CGP"], assetType: "gold-weight", family: "CGP", condition: CONDITION.NOT_APPLICABLE, pricing: null, required: ["description", "grossWeight", "karat", "purchaseCost"], optional: COMMON_OPTIONAL_FIELDS, weightApplicable: true, certificateSupported: false, componentsSupported: false, rfidAllowed: true, locationOptional: true }),
});

const PROFILE_ALIASES = Object.freeze(Object.fromEntries(Object.entries(PROFILE_REGISTRY).flatMap(([key, contract]) => [[key, key], ...contract.aliases.map((alias) => [alias, key])])));

function normalizeProfile(profile) {
  const raw = String(profile || "").trim().toUpperCase();
  const canonical = PROFILE_ALIASES[raw];
  if (!canonical) throw new Error("INVENTORY_PROFILE_INVALID");
  return canonical;
}

const decimal = (value, field) => {
  if (value === null || value === undefined || value === "") return null;
  let parsed;
  try { parsed = new Decimal(String(value)); } catch { throw new Error(`INVENTORY_DECIMAL_INVALID:${field}`); }
  if (!parsed.isFinite()) throw new Error(`INVENTORY_DECIMAL_INVALID:${field}`);
  return parsed;
};

// Measurement intake deliberately uses a plain-decimal lexical gate before
// Decimal.js.  This prevents scientific notation and floating point rendering
// from turning `1.7691` into an ambiguous precision decision.
function measurementDecimal(value, field, maxPlaces) {
  const raw = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`INVENTORY_LOOSE_${field}_INVALID`);
  const parsed = new Decimal(raw);
  if (!parsed.isFinite() || parsed.lte(0)) throw new Error(`INVENTORY_LOOSE_${field}_REQUIRED`);
  if (parsed.decimalPlaces() > maxPlaces) throw new Error(`INVENTORY_LOOSE_${field}_PRECISION_EXCEEDED`);
  return parsed;
}

function commercialNineRule(value) {
  const measured = value instanceof Decimal ? value : new Decimal(String(value));
  const truncated = measured.toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const thirdDigit = measured.times(1000).floor().mod(10);
  return (thirdDigit.eq(9) ? truncated.plus("0.01") : truncated).toFixed(2);
}

function describeLooseMeasurement(profile, looseDetails) {
  const canonical = normalizeProfile(profile);
  const contract = LOOSE_DETAIL_CONTRACTS[canonical];
  if (!contract || !looseDetails) return null;
  const measurement = contract.measurement;
  const measuredValue = looseDetails[measurement.field];
  const result = {
    measuredField: measurement.field,
    measuredValue,
    unit: measurement.unit,
    inputPrecision: measurement.inputPrecision,
    displayPrecision: measurement.displayPrecision,
    excessPrecision: measurement.excessPrecision,
    commercialRounding: measurement.commercialRounding,
  };
  if (measurement.commercialRounding !== "NONE") result.commercialDisplayValue = commercialNineRule(measuredValue);
  else result.commercialDisplayValue = new Decimal(String(measuredValue)).toFixed(measurement.displayPrecision);
  if (contract.pearlSize) result.pearlSize = contract.pearlSize;
  return Object.freeze(result);
}

const fixed8 = (value) => value.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);

function requireProfile(profile) {
  return PROFILE_REGISTRY[normalizeProfile(profile)];
}

function validateCondition(profile, condition) {
  const contract = requireProfile(profile);
  const normalized = condition === null || condition === undefined || condition === "" ? null : String(condition).toUpperCase();
  if (normalized !== null && !["NEW", "USED"].includes(normalized)) throw new Error("INVENTORY_CONDITION_INVALID");
  if (contract.condition === CONDITION.REQUIRED && normalized === null) throw new Error("INVENTORY_CONDITION_REQUIRED");
  if (contract.condition === CONDITION.NOT_APPLICABLE && normalized !== null) throw new Error("INVENTORY_CONDITION_NOT_APPLICABLE");
  return normalized;
}

function validateComponent({ role, componentCount }) {
  const count = decimal(componentCount, "componentCount");
  if (!count || !count.isInteger() || count.lt(1)) throw new Error("INVENTORY_COMPONENT_COUNT_INVALID");
  if (role === "PRIMARY_SUBJECT" && count.gt(1)) throw new Error("INVENTORY_LOOSE_PRIMARY_MULTI_PIECE_FORBIDDEN");
  return count.toNumber();
}

function normalizeLooseDetails(profile, input = {}) {
  const canonical = normalizeProfile(profile);
  const contract = LOOSE_DETAIL_CONTRACTS[canonical];
  if (!contract) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVENTORY_LOOSE_DETAILS_REQUIRED");
  const text = (value) => value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim();
  const positive = (value, field, maxPlaces) => {
    const parsed = maxPlaces === undefined ? decimal(value, field) : measurementDecimal(value, field, maxPlaces);
    if (!parsed || parsed.lte(0)) throw new Error(`INVENTORY_LOOSE_${field}_REQUIRED`);
    // DECIMAL(20,8) is a storage boundary, not the unfinished business
    // precision policy for loose profiles.  Never silently alter a physical
    // measurement that cannot be represented by that normalized storage.
    if (parsed.decimalPlaces() > 8) throw new Error(`INVENTORY_LOOSE_${field}_STORAGE_PRECISION_EXCEEDED`);
    return parsed.toFixed(8);
  };
  const result = {
    kind: contract.kind,
    stoneName: text(input.stoneName || input.name),
    diamondType: text(input.diamondType || input.stoneType),
    carat: input.carat ?? input.stoneCaratWeight ?? null,
    totalPearlWeight: input.totalPearlWeight ?? input.weight ?? null,
    treatment: text(input.treatment || input.treatmentType), color: text(input.color || input.stoneColor),
    tone: text(input.tone || input.stoneTone), toneLevel: text(input.toneLevel || input.toneLevels),
    saturation: text(input.saturation || input.saturationLevels), clarity: text(input.clarity), cut: text(input.cut),
    shape: text(input.shape || input.stoneShape), opticalEffect: text(input.opticalEffect || input.stoneOpticalEffect),
    origin: text(input.origin || input.stoneOrigin), pearlType: text(input.pearlType), pearlSize: text(input.pearlSize || input.size), pearlSizeId: text(input.pearlSizeId),
    overtone: text(input.overtone || input.pearlOvertone), orient: text(input.orient || input.pearlOrient),
    luster: text(input.luster || input.pearlLuster), surfaceQuality: text(input.surfaceQuality || input.pearlSurfaceQuality), nacreQuality: text(input.nacreQuality),
    notes: text(input.notes || input.remarks),
    masterData: input.masterData || input.masterDataIds || {},
  };
  for (const field of contract.required) {
    if (field === "carat") result.carat = positive(result.carat, "CARAT", contract.measurement.inputPrecision);
    else if (field === "totalPearlWeight") result.totalPearlWeight = positive(result.totalPearlWeight, "TOTAL_PEARL_WEIGHT", contract.measurement.inputPrecision);
    else if (!result[field]) throw new Error(`INVENTORY_LOOSE_${field.toUpperCase()}_REQUIRED`);
  }
  return Object.freeze(result);
}

function assertPieceBasedPayload(payload = {}) {
  const forbidden = ["quantity", "stockQuantity", "quantityOnHand", "quantityAvailable", "inventoryQuantity"];
  const leaked = forbidden.find((field) => Object.prototype.hasOwnProperty.call(payload, field));
  if (leaked) throw new Error(`INVENTORY_STOCK_QUANTITY_FORBIDDEN:${leaked}`);
  return true;
}

function calculateGoldWeights({ grossWeight, stoneWeight, karat }) {
  const gross = decimal(grossWeight, "grossWeight");
  const stone = decimal(stoneWeight, "stoneWeight");
  const k = decimal(karat, "karat");
  if (!gross || !stone || !k) throw new Error("INVENTORY_WEIGHT_FACTS_REQUIRED");
  if (gross.lt(0) || stone.lt(0) || stone.gt(gross) || k.lte(0) || k.gt(24)) throw new Error("INVENTORY_WEIGHT_FACTS_INVALID");
  const net = gross.minus(stone);
  const purity = k.div(24);
  return Object.freeze({
    grossWeight: fixed8(gross),
    stoneWeight: fixed8(stone),
    netGoldWeight: fixed8(net),
    karat: k.toDecimalPlaces(6).toFixed(6),
    purityRatio: fixed8(purity),
    pureGold9999: fixed8(net.times(purity)),
  });
}

function calculateVat({ base, rate }) {
  const vatBase = decimal(base, "vatBase");
  const vatRate = decimal(rate, "vatRate");
  if (!vatBase || !vatRate || vatBase.lt(0) || vatRate.lt(0) || vatRate.gt(100)) throw new Error("INVENTORY_VAT_INPUT_INVALID");
  return Object.freeze({ vatBase: fixed8(vatBase), vatRate: vatRate.toDecimalPlaces(6).toFixed(6), vatAmount: fixed8(vatBase.times(vatRate).div(100)) });
}

function priceAsset(strategy, input = {}) {
  if (strategy === "BAR_CERTIFICATE_STRATEGY") {
    const gold = decimal(input.goldValue, "goldValue");
    const certificate = decimal(input.certificateCharge, "certificateCharge");
    if (!gold || !certificate || gold.lt(0) || certificate.lt(0)) throw new Error("INVENTORY_PRICING_INPUT_INVALID");
    const vat = calculateVat({ base: certificate, rate: input.vatRate });
    const total = gold.plus(certificate).plus(vat.vatAmount);
    const minimum = decimal(input.minimumCertificateCharge, "minimumCertificateCharge");
    return Object.freeze({ ...vat, goldVatBaseContribution: "0.00000000", total: fixed8(total), approvalRequired: Boolean(minimum && certificate.lt(minimum)) });
  }
  if (strategy === "WEIGHT_BASED_MAKING_STRATEGY") {
    const gold = decimal(input.goldValue, "goldValue");
    const weight = decimal(input.netGoldWeight, "netGoldWeight");
    const makingRate = decimal(input.makingPerGram, "makingPerGram");
    const minimumRate = decimal(input.minimumMakingPerGram, "minimumMakingPerGram");
    if (!gold || !weight || !makingRate || gold.lt(0) || weight.lt(0) || makingRate.lt(0)) throw new Error("INVENTORY_PRICING_INPUT_INVALID");
    const making = weight.times(makingRate);
    return Object.freeze({ makingTotal: fixed8(making), subtotal: fixed8(gold.plus(making)), approvalRequired: Boolean(minimumRate && makingRate.lt(minimumRate)) });
  }
  if (strategy === "PIECE_MARKUP_STRATEGY") {
    const cost = decimal(input.purchaseCost, "purchaseCost");
    const markup = decimal(input.markupPercent, "markupPercent");
    const discount = decimal(input.discountPercent || 0, "discountPercent");
    const maxDiscount = decimal(input.maximumDiscountPercent, "maximumDiscountPercent");
    if (!cost || !markup || !discount || cost.lt(0) || markup.lt(0) || discount.lt(0) || discount.gt(100)) throw new Error("INVENTORY_PRICING_INPUT_INVALID");
    const list = cost.times(new Decimal(1).plus(markup.div(100)));
    const selling = list.times(new Decimal(1).minus(discount.div(100)));
    const minimum = decimal(input.minimumSellingPrice, "minimumSellingPrice");
    return Object.freeze({ listPrice: fixed8(list), sellingPrice: fixed8(selling), profit: fixed8(selling.minus(cost)), approvalRequired: Boolean((maxDiscount && discount.gt(maxDiscount)) || (minimum && selling.lt(minimum))) });
  }
  throw new Error("INVENTORY_PRICING_STRATEGY_UNSUPPORTED");
}

module.exports = { CONDITION, PROFILE_REGISTRY, normalizeProfile, requireProfile, validateCondition, validateComponent, normalizeLooseDetails, describeLooseMeasurement, commercialNineRule, assertPieceBasedPayload, calculateGoldWeights, calculateVat, priceAsset };
