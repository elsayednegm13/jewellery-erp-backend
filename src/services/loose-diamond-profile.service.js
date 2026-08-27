"use strict";

const Decimal = require("decimal.js");
const transactionTaxContext = require("./transaction-tax-context.service");
const salePricing = require("./gold-sale-pricing.service");

const PROFILE = "LOOSE_DIAMOND";
const CARAT_TO_GRAMS = "0.20";
const MONEY_SCALE = 8;
const CATEGORIES = Object.freeze({
  STONE_NAME: "DIAMOND_NAME",
  TYPE: "DIAMOND_TYPE",
  TREATMENT: "DIAMOND_TREATMENT",
  COLOR: "DIAMOND_COLOR",
  TONE: "DIAMOND_TONE",
  TONE_LEVEL: "DIAMOND_TONE_LEVEL",
  SATURATION: "DIAMOND_SATURATION",
  CLARITY: "DIAMOND_CLARITY",
  CUT: "DIAMOND_CUT",
  SHAPE: "DIAMOND_SHAPE",
  ORIGIN: "DIAMOND_ORIGIN",
  CERTIFICATE: "CERTIFICATE_AUTHORITY",
});

const fixed = (value) => new Decimal(value || 0).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);
function dec(value, field, { required = false, min = null, maxPlaces = null } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error("LOOSE_DIAMOND_" + field + "_REQUIRED");
    return null;
  }
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error("LOOSE_DIAMOND_" + field + "_INVALID");
  const valueDecimal = new Decimal(raw);
  if (!valueDecimal.isFinite() || (min !== null && valueDecimal.lt(min)) || (maxPlaces !== null && valueDecimal.decimalPlaces() > maxPlaces)) {
    throw new Error("LOOSE_DIAMOND_" + field + "_INVALID");
  }
  return valueDecimal;
}
function text(value, field, required = false) {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  if (!normalized && required) throw new Error("LOOSE_DIAMOND_" + field + "_REQUIRED");
  return normalized || null;
}
function rowsFor(masters, category) {
  if (Array.isArray(masters)) return masters.filter((row) => row.category === category && row.isActive !== false);
  return Array.isArray(masters?.[category]) ? masters[category] : [];
}
function resolveMaster(masters, category, value, field, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error("LOOSE_DIAMOND_" + field + "_REQUIRED");
    return null;
  }
  const rows = rowsFor(masters, category);
  const rawValues = Array.isArray(value) ? value : [value];
  const resolved = rawValues.map((candidate) => {
    const found = rows.find((row) => String(row.id) === String(candidate) || String(row.value || "").toLowerCase() === String(candidate).trim().toLowerCase() || String(row.label || "").toLowerCase() === String(candidate).trim().toLowerCase());
    if (!found || found.isActive === false) throw new Error("LOOSE_DIAMOND_" + field + "_MASTER_INVALID");
    return { id: found.id, value: found.value, label: found.label };
  });
  return Array.isArray(value) ? resolved : resolved[0];
}
function resolveColors(masters, value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,|]/).map((row) => row.trim()).filter(Boolean);
  if (!raw.length) throw new Error("LOOSE_DIAMOND_COLOR_REQUIRED");
  const resolved = raw.map((candidate) => resolveMaster(masters, CATEGORIES.COLOR, candidate, "COLOR", true));
  const ids = new Set();
  for (const color of resolved) {
    if (ids.has(color.id)) throw new Error("LOOSE_DIAMOND_COLOR_DUPLICATE");
    ids.add(color.id);
  }
  return resolved;
}
function resolveTreatment(masters, type, treatment, description) {
  const natural = String(type.label || type.value).toLowerCase().includes("natural");
  if (natural && treatment) throw new Error("LOOSE_DIAMOND_NATURAL_TREATMENT_FORBIDDEN");
  const resolved = treatment ? resolveMaster(masters, CATEGORIES.TREATMENT, treatment, "TREATMENT", true) : null;
  if (resolved && String(resolved.label).toLowerCase() === "other" && !text(description, "TREATMENT_DESCRIPTION", true)) {
    throw new Error("LOOSE_DIAMOND_TREATMENT_DESCRIPTION_REQUIRED");
  }
  if (!resolved && !natural && String(type.label).toLowerCase().includes("treated")) {
    throw new Error("LOOSE_DIAMOND_TREATMENT_REQUIRED");
  }
  return resolved;
}
function normalizeInput(input = {}, masters = []) {
  const details = input.looseDetails || input;
  const stoneName = resolveMaster(masters, CATEGORIES.STONE_NAME, details.stoneName || details.name, "STONE_NAME", true);
  const diamondType = resolveMaster(masters, CATEGORIES.TYPE, details.diamondType || details.stoneType, "DIAMOND_TYPE", true);
  const treatment = resolveTreatment(masters, diamondType, details.treatment || details.treatmentType, details.treatmentDescription);
  const colors = resolveColors(masters, details.colors || details.color || details.stoneColor);
  const clarity = resolveMaster(masters, CATEGORIES.CLARITY, details.clarity, "CLARITY", true);
  const shape = resolveMaster(masters, CATEGORIES.SHAPE, details.shape || details.stoneShape, "SHAPE", true);
  const carat = dec(details.carat || details.caratWeight || details.stoneCaratWeight, "CARAT", { required: true, min: "0.00000001", maxPlaces: 3 });
  const cut = details.cut ? resolveMaster(masters, CATEGORIES.CUT, details.cut, "CUT") : null;
  const tone = details.tone ? resolveMaster(masters, CATEGORIES.TONE, details.tone, "TONE") : null;
  const toneLevel = details.toneLevel ? resolveMaster(masters, CATEGORIES.TONE_LEVEL, details.toneLevel, "TONE_LEVEL") : null;
  const saturation = details.saturation ? resolveMaster(masters, CATEGORIES.SATURATION, details.saturation, "SATURATION") : null;
  const origin = details.origin ? resolveMaster(masters, CATEGORIES.ORIGIN, details.origin, "ORIGIN") : null;
  const certificateNumber = text(details.certificateNumber || details.certificate?.number, "CERTIFICATE_NUMBER");
  const certificateAuthority = details.certificateAuthority || details.certificate?.authority;
  const certificate = certificateNumber || certificateAuthority
    ? resolveMaster(masters, CATEGORIES.CERTIFICATE, certificateAuthority, "CERTIFICATE_AUTHORITY", Boolean(certificateNumber))
    : null;
  if (certificateNumber && !certificate) throw new Error("LOOSE_DIAMOND_CERTIFICATE_AUTHORITY_REQUIRED");
  const purchasePrice = dec(input.purchasePricePreTax ?? input.purchasePrice ?? details.purchasePricePreTax ?? details.purchasePrice ?? details.purchaseCost ?? details.stoneCost, "PURCHASE_PRICE", { required: true, min: 0 });
  const stoneCost = details.stoneCost;
  if (stoneCost !== undefined && stoneCost !== null && stoneCost !== "" && !new Decimal(String(stoneCost)).eq(purchasePrice)) throw new Error("LOOSE_DIAMOND_PURCHASE_PRICE_STONE_COST_MISMATCH");
  const currentDiamondValue = dec(input.currentDiamondValue ?? details.currentDiamondValue, "CURRENT_DIAMOND_VALUE", { min: 0 });
  const sellingPrice = dec(input.sellingPrice ?? input.salePrice ?? details.sellingPrice ?? details.salePrice, "SELLING_PRICE", { required: true, min: 0 });
  const markupPercent = dec(input.markupPercent ?? details.markupPercent, "MARKUP_PERCENT", { min: 0 });
  const maximumDiscountPercent = dec(input.maximumDiscountPercent ?? details.maximumDiscountPercent, "MAXIMUM_DISCOUNT_PERCENT", { min: 0 });
  const taxTreatment = String(input.taxTreatment || details.taxTreatment || "").trim().toUpperCase();
  if (!taxTreatment) throw new Error("LOOSE_DIAMOND_TAX_TREATMENT_REQUIRED");
  return Object.freeze({
    profile: PROFILE,
    description: text(input.description || input.name || details.description, "DESCRIPTION", true),
    stoneName: stoneName.label,
    diamondType: diamondType.label,
    treatment: treatment?.label || null,
    treatmentDescription: text(details.treatmentDescription, "TREATMENT_DESCRIPTION"),
    colors: colors.map((row) => row.label),
    color: colors.map((row) => row.label).join(", "),
    clarity: clarity.label,
    cut: cut?.label || null,
    shape: shape.label,
    origin: origin?.label || null,
    tone: tone?.label || null,
    toneLevel: toneLevel?.label || null,
    saturation: saturation?.label || null,
    certificateNumber,
    certificateAuthority: certificate?.label || null,
    notes: text(input.notes || details.notes, "NOTES"),
    carat: fixed(carat),
    caratUnit: "CT",
    derivedWeightGrams: fixed(carat.times(CARAT_TO_GRAMS)),
    purchasePricePreTax: fixed(purchasePrice),
    stoneCostCanonical: fixed(purchasePrice),
    currentDiamondValuePreTax: currentDiamondValue ? fixed(currentDiamondValue) : null,
    markupPercent: markupPercent ? fixed(markupPercent) : null,
    maximumDiscountPercent: maximumDiscountPercent ? fixed(maximumDiscountPercent) : null,
    sellingPrice: fixed(sellingPrice),
    taxTreatment,
    masterData: {
      stoneName: stoneName.id,
      diamondType: diamondType.id,
      diamondColor: colors.map((row) => row.id),
      diamondTreatment: treatment?.id || null,
      clarity: clarity.id,
      cut: cut?.id || null,
      diamondShape: shape.id,
      diamondOrigin: origin?.id || null,
      diamondTone: tone?.id || null,
      diamondToneLevel: toneLevel?.id || null,
      diamondSaturation: saturation?.id || null,
      certificateAuthority: certificate?.id || null,
    },
  });
}
function taxFor({ taxTreatment, taxPolicy, taxContext, base }) {
  return transactionTaxContext.resolveTransactionTaxContext({
    requestedTaxTreatment: taxTreatment,
    companyPolicy: taxPolicy || {},
    rcmContext: taxContext || {},
    taxableBase: fixed(base),
    roundingScale: MONEY_SCALE,
  });
}
function calculatePreview({ input = {}, taxPolicy = {}, masters = [] }) {
  const piece = normalizeInput(input, masters);
  const purchaseBase = new Decimal(piece.purchasePricePreTax);
  const purchaseTax = taxFor({ taxTreatment: piece.taxTreatment, taxPolicy, taxContext: input.taxContext, base: purchaseBase });
  const currentBase = piece.currentDiamondValuePreTax === null ? null : new Decimal(piece.currentDiamondValuePreTax);
  const currentTax = currentBase === null ? null : taxFor({ taxTreatment: piece.taxTreatment, taxPolicy, taxContext: input.taxContext, base: currentBase });
  const currentTotal = currentBase === null ? new Decimal(0) : currentBase.plus(currentTax.vatAmount);
  const sale = salePricing.calculateLooseProfileSalePrice({
    profile: PROFILE,
    currentTotalCost: currentTotal,
    markupPercent: piece.markupPercent,
    sellingPrice: piece.sellingPrice,
    maximumDiscountPercent: piece.maximumDiscountPercent,
    configuredVatRate: taxPolicy.vatRate,
  });
  return Object.freeze({
    profile: PROFILE,
    piece,
    purchase: {
      purchaseBasePreTax: fixed(purchaseBase),
      purchaseVAT: fixed(purchaseTax.vatAmount),
      purchaseTotalTaxInclusive: fixed(purchaseBase.plus(purchaseTax.vatAmount)),
      vatRate: String(purchaseTax.effectiveVatRate),
      taxTreatment: purchaseTax.resolvedTaxTreatment,
      taxSnapshot: purchaseTax,
    },
    current: currentBase === null ? {
      currentDiamondValuePreTax: null, currentVAT: null, currentTotalTaxInclusive: null, taxSnapshot: null,
    } : {
      currentDiamondValuePreTax: fixed(currentBase),
      currentVAT: fixed(currentTax.vatAmount),
      currentTotalTaxInclusive: fixed(currentTotal),
      taxSnapshot: currentTax,
    },
    sale: {
      ...sale,
      minimumAllowedSellingPrice: sale.minAllowedSellingPrice,
      expectedProfit: sale.expectedProfit,
      profitMargin: sale.profitMarginPercent,
      priceAccepted: !sale.approvalRequired,
    },
    readiness: { profilePreview: "READY", salePriceAccepted: !sale.approvalRequired, currentValuationExplicit: currentBase !== null },
  });
}
function optionRows(masters, category) {
  return rowsFor(masters, category).map((row) => ({ id: row.id, value: row.value, label: row.label, isActive: row.isActive !== false }));
}
function contract({ masters = [], suppliers = [], locations = [], taxPolicy = null, barcode = null } = {}) {
  return Object.freeze({
    profile: PROFILE,
    masters,
    suppliers,
    locations,
    taxPolicy,
    barcode: { ...(barcode || {}), requiredInventoryCode: "DD", requiredItemCode: "LOS", requiredKaratCode: "00", source: "SERVER" },
    masterOptions: Object.fromEntries(Object.values(CATEGORIES).map((category) => [category, optionRows(masters, category)])),
    authority: { physicalInventory: "ASSET", quantityAuthority: "NOT_ALLOWED", receive: "SUPPLIER_V2_CANONICAL", barcode: "DD/LOS/00", goldFields: "NOT_APPLICABLE" },
  });
}

module.exports = { PROFILE, CATEGORIES, CARAT_TO_GRAMS, fixed, normalizeInput, calculatePreview, contract };
