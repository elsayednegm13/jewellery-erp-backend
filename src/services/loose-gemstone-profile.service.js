"use strict";

// The Loose Gem Stone profile is deliberately separate from Gem Stone
// Jewellery. It owns only the client-defined loose-stone facts and delegates
// VAT to the canonical transaction tax engine.
const Decimal = require("decimal.js");
const transactionTaxContext = require("./transaction-tax-context.service");
const salePricing = require("./gold-sale-pricing.service");

const PROFILE = "LOOSE_GEMSTONE";
const CT_TO_GRAMS = "0.20";
const MONEY_SCALE = 8;
const CATEGORIES = Object.freeze({
  STONE_NAME: "GEMSTONE_NAME", TYPE: "GEMSTONE_TYPE", SHAPE: "GEMSTONE_SHAPE",
  COLOR: "GEMSTONE_COLOR", TONE: "GEMSTONE_TONE", TONE_LEVEL: "GEMSTONE_TONE_LEVEL",
  SATURATION: "GEMSTONE_SATURATION", OPTICAL_EFFECT: "GEMSTONE_OPTICAL_EFFECT",
  ORIGIN: "GEMSTONE_ORIGIN", CERTIFICATE: "CERTIFICATE_AUTHORITY",
});

const fixed = (value) => new Decimal(value || 0).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);
function number(value, field, { required = false, maxPlaces = null } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) throw new Error(`LOOSE_GEMSTONE_${field}_REQUIRED`);
    return null;
  }
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`LOOSE_GEMSTONE_${field}_INVALID`);
  const parsed = new Decimal(raw);
  if (!parsed.isFinite() || parsed.lt(0) || (maxPlaces !== null && parsed.decimalPlaces() > maxPlaces)) throw new Error(`LOOSE_GEMSTONE_${field}_INVALID`);
  return parsed;
}
function text(value, field, required = false) {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  if (!normalized && required) throw new Error(`LOOSE_GEMSTONE_${field}_REQUIRED`);
  return normalized || null;
}
function rowsFor(masters, category) {
  if (Array.isArray(masters)) return masters.filter((row) => row.category === category && row.isActive !== false);
  return Array.isArray(masters?.[category]) ? masters[category] : [];
}
function master(masters, category, value, field, required = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) throw new Error(`LOOSE_GEMSTONE_${field}_REQUIRED`);
    return null;
  }
  const candidate = String(value).trim().toLowerCase();
  const found = rowsFor(masters, category).find((row) => [row.id, row.value, row.label].some((v) => String(v || "").trim().toLowerCase() === candidate));
  if (!found) throw new Error(`LOOSE_GEMSTONE_${field}_MASTER_INVALID`);
  return { id: found.id, value: found.value, label: found.label };
}
function taxFor({ taxTreatment, taxPolicy, taxContext, base }) {
  return transactionTaxContext.resolveTransactionTaxContext({
    requestedTaxTreatment: taxTreatment, companyPolicy: taxPolicy || {}, rcmContext: taxContext || {},
    taxableBase: fixed(base), roundingScale: MONEY_SCALE,
  });
}
function normalizeInput(input = {}, masters = []) {
  const details = input.looseDetails || input;
  const stoneName = master(masters, CATEGORIES.STONE_NAME, details.stoneName || details.name, "STONE_NAME", true);
  const stoneType = master(masters, CATEGORIES.TYPE, details.stoneType || details.gemstoneType, "STONE_TYPE");
  const shape = master(masters, CATEGORIES.SHAPE, details.shape || details.stoneShape, "SHAPE");
  const color = master(masters, CATEGORIES.COLOR, details.color || details.stoneColor, "COLOR");
  const tone = master(masters, CATEGORIES.TONE, details.tone || details.stoneTone, "TONE");
  const toneLevel = master(masters, CATEGORIES.TONE_LEVEL, details.toneLevel || details.toneLevels, "TONE_LEVEL");
  const saturation = master(masters, CATEGORIES.SATURATION, details.saturation || details.saturationLevels, "SATURATION");
  const opticalEffect = master(masters, CATEGORIES.OPTICAL_EFFECT, details.opticalEffect || details.stoneOpticalEffect, "OPTICAL_EFFECT");
  const origin = master(masters, CATEGORIES.ORIGIN, details.origin || details.stoneOrigin, "ORIGIN");
  const certificateNumber = text(details.certificateNumber || details.certificate?.number, "CERTIFICATE_NUMBER");
  const certificateAuthority = master(masters, CATEGORIES.CERTIFICATE, details.certificateAuthority || details.certificate?.authority, "CERTIFICATE_AUTHORITY", Boolean(certificateNumber));
  const selectedMasters = [stoneName, stoneType, shape, color, tone, toneLevel, saturation, opticalEffect, origin];
  const otherDescription = text(details.otherDescription || input.otherDescription, "OTHER_DESCRIPTION", selectedMasters.some((entry) => entry && /\bother\b/i.test(entry.label)));
  const carat = number(details.carat || details.stoneCaratWeight, "CARAT", { required: true, maxPlaces: 3 });
  const purchaseCost = number(input.purchasePricePreTax ?? input.purchasePrice ?? details.purchasePrice ?? details.purchaseCost, "PURCHASE_COST", { required: true });
  const additionalCost = number(input.additionalCost ?? details.additionalCost, "ADDITIONAL_COST") || new Decimal(0);
  const currentStoneValue = number(input.currentStoneValue ?? details.currentStoneValue ?? input.currentValue, "CURRENT_STONE_VALUE", { required: true });
  const sellingPrice = number(input.sellingPrice ?? input.salePrice ?? details.sellingPrice, "SELLING_PRICE", { required: true });
  const markupPercent = number(input.markupPercent ?? details.markupPercent, "MARKUP_PERCENT");
  const maximumDiscountPercent = number(input.maximumDiscountPercent ?? details.maximumDiscountPercent, "MAXIMUM_DISCOUNT_PERCENT");
  const taxTreatment = String(input.taxTreatment || details.taxTreatment || "").trim().toUpperCase();
  if (!taxTreatment) throw new Error("LOOSE_GEMSTONE_TAX_TREATMENT_REQUIRED");
  return Object.freeze({
    profile: PROFILE, description: text(input.description || input.name || details.description, "DESCRIPTION", true),
    stoneName: stoneName.label, stoneType: stoneType?.label || null, shape: shape?.label || null, color: color?.label || null,
    tone: tone?.label || null, toneLevel: toneLevel?.label || null, saturation: saturation?.label || null,
    opticalEffect: opticalEffect?.label || null, origin: origin?.label || null, certificateNumber,
    certificateAuthority: certificateAuthority?.label || null, otherDescription, notes: text(input.notes || details.notes, "NOTES"),
    carat: fixed(carat), caratUnit: "CT", derivedWeightGrams: fixed(carat.times(CT_TO_GRAMS)),
    purchaseCostPreTax: fixed(purchaseCost), additionalCost: fixed(additionalCost),
    purchaseBasePreTax: fixed(purchaseCost.plus(additionalCost)), currentStoneValuePreTax: fixed(currentStoneValue),
    sellingPrice: fixed(sellingPrice), markupPercent: markupPercent ? fixed(markupPercent) : null,
    maximumDiscountPercent: maximumDiscountPercent ? fixed(maximumDiscountPercent) : null, taxTreatment,
    masterData: { stoneName: stoneName.id, stoneType: stoneType?.id || null, shape: shape?.id || null, color: color?.id || null, tone: tone?.id || null, toneLevel: toneLevel?.id || null, saturation: saturation?.id || null, opticalEffect: opticalEffect?.id || null, origin: origin?.id || null, certificateAuthority: certificateAuthority?.id || null },
  });
}
function calculatePreview({ input = {}, taxPolicy = {}, masters = [] }) {
  const piece = normalizeInput(input, masters);
  const purchaseBase = new Decimal(piece.purchaseBasePreTax);
  const purchaseTax = taxFor({ taxTreatment: piece.taxTreatment, taxPolicy, taxContext: input.taxContext, base: purchaseBase });
  const currentBase = new Decimal(piece.currentStoneValuePreTax);
  const currentTax = taxFor({ taxTreatment: piece.taxTreatment, taxPolicy, taxContext: input.taxContext, base: currentBase });
  const currentTotal = currentBase.plus(currentTax.vatAmount);
  const sale = salePricing.calculateLooseProfileSalePrice({ profile: PROFILE, currentTotalCost: currentTotal, markupPercent: piece.markupPercent, sellingPrice: piece.sellingPrice, maximumDiscountPercent: piece.maximumDiscountPercent, configuredVatRate: taxPolicy.vatRate });
  return Object.freeze({ profile: PROFILE, piece, purchase: { purchaseCostPreTax: piece.purchaseCostPreTax, additionalCost: piece.additionalCost, purchaseBasePreTax: fixed(purchaseBase), purchaseVAT: fixed(purchaseTax.vatAmount), purchaseTotalTaxInclusive: fixed(purchaseBase.plus(purchaseTax.vatAmount)), vatRate: String(purchaseTax.effectiveVatRate), taxTreatment: purchaseTax.resolvedTaxTreatment, taxSnapshot: purchaseTax }, current: { currentStoneValuePreTax: fixed(currentBase), currentVAT: fixed(currentTax.vatAmount), currentTotalTaxInclusive: fixed(currentTotal), taxSnapshot: currentTax }, sale: { ...sale, minimumAllowedSellingPrice: sale.minAllowedSellingPrice, priceAccepted: !sale.approvalRequired }, readiness: { profilePreview: "READY", salePriceAccepted: !sale.approvalRequired, currentValuationExplicit: true } });
}
function optionRows(masters, category) { return rowsFor(masters, category).map((row) => ({ id: row.id, value: row.value, label: row.label, isActive: row.isActive !== false })); }
function contract({ masters = [], suppliers = [], locations = [], taxPolicy = null, barcode = null } = {}) {
  return Object.freeze({ profile: PROFILE, masters, suppliers, locations, taxPolicy, barcode: { ...(barcode || {}), requiredInventoryCode: "GS", requiredItemCode: "LOS", requiredKaratCode: "00", source: "SERVER" }, masterOptions: Object.fromEntries(Object.values(CATEGORIES).map((category) => [category, optionRows(masters, category)])), authority: { physicalInventory: "ASSET", quantityAuthority: "NOT_ALLOWED", receive: "SUPPLIER_V2_CANONICAL", barcode: "GS/LOS/00", weight: "CT_AUTHORITY_GRAMS_DERIVED" } });
}
module.exports = { PROFILE, CATEGORIES, CT_TO_GRAMS, fixed, normalizeInput, calculatePreview, contract };
