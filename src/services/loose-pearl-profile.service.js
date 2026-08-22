"use strict";

// Loose Pearl is a single physical pearl profile.  This module owns only the
// profile contract and delegates transaction VAT and sale-price policy to the
// existing authorities; it deliberately contains no gold/karat calculation.
const Decimal = require("decimal.js");
const transactionTaxContext = require("./transaction-tax-context.service");
const salePricing = require("./gold-sale-pricing.service");

const PROFILE = "LOOSE_PEARL";
const CURRENCY = "AED";
const WEIGHT_UNIT = "CT";
const MONEY_SCALE = 8;
const CATEGORIES = Object.freeze({
  TYPE: "PEARL_TYPE", COLOR: "PEARL_COLOR", OVERTONE: "PEARL_OVERTONE",
  ORIENT: "PEARL_ORIENT", SHAPE: "PEARL_SHAPE", LUSTER: "PEARL_LUSTER",
  SURFACE: "PEARL_SURFACE_QUALITY", NACRE: "PEARL_NACRE_QUALITY",
  ORIGIN: "PEARL_ORIGIN", DESCRIPTION: "PEARL_ITEM_DESCRIPTION",
  CERTIFICATE: "CERTIFICATE_AUTHORITY",
});

const fixed = (value) => new Decimal(String(value ?? 0)).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);

function number(value, field, { required = false, maxPlaces = null } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) throw new Error(`LOOSE_PEARL_${field}_REQUIRED`);
    return null;
  }
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`LOOSE_PEARL_${field}_INVALID`);
  const parsed = new Decimal(raw);
  if (!parsed.isFinite() || parsed.lt(0) || (maxPlaces !== null && parsed.decimalPlaces() > maxPlaces)) {
    throw new Error(maxPlaces !== null && parsed.decimalPlaces() > maxPlaces ? `LOOSE_PEARL_${field}_PRECISION_EXCEEDED` : `LOOSE_PEARL_${field}_INVALID`);
  }
  return parsed;
}

function text(value, field, required = false) {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  if (!normalized && required) throw new Error(`LOOSE_PEARL_${field}_REQUIRED`);
  return normalized || null;
}

function rowsFor(masters, category) {
  if (Array.isArray(masters)) return masters.filter((row) => (row.category || row.categoryKey) === category && row.isActive !== false);
  return Array.isArray(masters?.[category]) ? masters[category] : [];
}

function master(masters, category, value, field, required = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) throw new Error(`LOOSE_PEARL_${field}_REQUIRED`);
    return null;
  }
  const candidate = String(value).trim().toLowerCase();
  const found = rowsFor(masters, category).find((row) => [row.id, row.value, row.label].some((v) => String(v ?? "").trim().toLowerCase() === candidate));
  if (!found) throw new Error(`LOOSE_PEARL_${field}_MASTER_INVALID`);
  return { id: found.id, value: found.value, label: found.label };
}

function pearlSize(pearlSizes, value, id) {
  if (value === undefined && id === undefined) return null;
  const candidate = String(id ?? value).trim().toLowerCase();
  const found = (pearlSizes || []).find((row) => [row.id, row.value, row.displayValue, row.label].some((v) => String(v ?? "").trim().toLowerCase() === candidate));
  if (!found) throw new Error("LOOSE_PEARL_SIZE_MASTER_DATA_ACTIVE_VALUE_REQUIRED");
  return { id: found.id, value: found.value, displayValue: found.displayValue, label: found.label, unit: "MM" };
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

function normalizeInput(input = {}, masters = [], pearlSizes = []) {
  const details = input.looseDetails || input;
  const size = pearlSize(pearlSizes, details.pearlSize ?? details.size, details.pearlSizeId);
  const descriptionMaster = master(masters, CATEGORIES.DESCRIPTION, input.description || input.name || details.description, "DESCRIPTION", true);
  const selected = {
    pearlType: master(masters, CATEGORIES.TYPE, details.pearlType, "PEARL_TYPE"),
    pearlColor: master(masters, CATEGORIES.COLOR, details.pearlColor, "PEARL_COLOR"),
    overtone: master(masters, CATEGORIES.OVERTONE, details.overtone, "OVERTONE"),
    orient: master(masters, CATEGORIES.ORIENT, details.orient, "ORIENT"),
    pearlShape: master(masters, CATEGORIES.SHAPE, details.pearlShape || details.shape, "PEARL_SHAPE"),
    luster: master(masters, CATEGORIES.LUSTER, details.luster, "LUSTER"),
    surfaceQuality: master(masters, CATEGORIES.SURFACE, details.surfaceQuality, "SURFACE_QUALITY"),
    nacreQuality: master(masters, CATEGORIES.NACRE, details.nacreQuality, "NACRE_QUALITY"),
    pearlOrigin: master(masters, CATEGORIES.ORIGIN, details.pearlOrigin || details.origin, "PEARL_ORIGIN"),
    certificateAuthority: master(masters, CATEGORIES.CERTIFICATE, details.certificateAuthority || details.certificate?.authority, "CERTIFICATE_AUTHORITY"),
  };
  const totalPearlWeight = number(details.totalPearlWeight ?? details.weight, "TOTAL_PEARL_WEIGHT", { required: true, maxPlaces: 2 });
  if (totalPearlWeight.lte(0)) throw new Error("LOOSE_PEARL_TOTAL_PEARL_WEIGHT_REQUIRED");
  const purchaseCost = number(input.looseFinancial?.purchasePricePreTax ?? input.purchasePricePreTax ?? input.purchasePrice ?? input.pearlCost ?? input.purchaseCost ?? details.purchaseCost, "PURCHASE_COST", { required: true });
  const currentPearlValue = number(input.currentPearlValue ?? input.currentPearlCost ?? input.currentValue ?? input.looseCurrentValuation?.currentPearlValuePreTax ?? input.currentValuation?.componentValue ?? details.currentPearlValue, "CURRENT_PEARL_VALUE", { required: true });
  const sellingPrice = number(input.sellingPrice ?? input.salePrice ?? details.sellingPrice, "SELLING_PRICE");
  const markupPercent = number(input.markupPercent ?? details.markupPercent, "MARKUP_PERCENT");
  const maximumDiscountPercent = number(input.maximumDiscountPercent ?? input.maxDiscount ?? details.maximumDiscountPercent, "MAXIMUM_DISCOUNT_PERCENT");
  const taxTreatment = String(input.taxTreatment || details.taxTreatment || "").trim().toUpperCase();
  if (!taxTreatment) throw new Error("LOOSE_PEARL_TAX_TREATMENT_REQUIRED");
  const certificateNumber = text(input.certificateNumber || details.certificateNumber || details.certificate?.number, "CERTIFICATE_NUMBER");
  if (certificateNumber && !selected.certificateAuthority) throw new Error("LOOSE_PEARL_CERTIFICATE_AUTHORITY_REQUIRED");
  return Object.freeze({
    profile: PROFILE,
    description: descriptionMaster.label,
    totalPearlWeight: fixed(totalPearlWeight), weightUnit: WEIGHT_UNIT,
    pearlSize: size?.label || null, pearlSizeId: size?.id || null, pearlSizeMaster: size,
    pearlType: selected.pearlType?.label || null, pearlColor: selected.pearlColor?.label || null,
    overtone: selected.overtone?.label || null, orient: selected.orient?.label || null,
    pearlShape: selected.pearlShape?.label || null, shape: selected.pearlShape?.label || null,
    luster: selected.luster?.label || null, surfaceQuality: selected.surfaceQuality?.label || null,
    nacreQuality: selected.nacreQuality?.label || null, pearlOrigin: selected.pearlOrigin?.label || null,
    origin: selected.pearlOrigin?.label || null, certificateAuthority: selected.certificateAuthority?.label || null,
    certificateNumber, notes: text(input.notes || input.remarks || details.notes || details.remarks, "NOTES"),
    purchaseCostPreTax: fixed(purchaseCost), currentPearlValuePreTax: fixed(currentPearlValue),
    sellingPrice: sellingPrice ? fixed(sellingPrice) : null,
    markupPercent: markupPercent ? fixed(markupPercent) : null,
    maximumDiscountPercent: maximumDiscountPercent ? fixed(maximumDiscountPercent) : null,
    taxTreatment, supplierId: input.supplierId || null, locationId: input.locationId || null,
    purchaseDate: input.purchaseDate || null,
    masterData: { pearlType: selected.pearlType?.id || null, pearlColor: selected.pearlColor?.id || null, overtone: selected.overtone?.id || null, orient: selected.orient?.id || null, pearlShape: selected.pearlShape?.id || null, luster: selected.luster?.id || null, surfaceQuality: selected.surfaceQuality?.id || null, nacreQuality: selected.nacreQuality?.id || null, pearlOrigin: selected.pearlOrigin?.id || null, description: descriptionMaster.id, certificateAuthority: selected.certificateAuthority?.id || null },
  });
}

function calculatePreview({ input = {}, taxPolicy = {}, masters = [], pearlSizes = [] }) {
  const piece = normalizeInput(input, masters, pearlSizes);
  const purchaseBase = new Decimal(piece.purchaseCostPreTax);
  const purchaseTax = taxFor({ taxTreatment: piece.taxTreatment, taxPolicy, taxContext: input.taxContext, base: purchaseBase });
  const currentBase = new Decimal(piece.currentPearlValuePreTax);
  const currentTax = taxFor({ taxTreatment: piece.taxTreatment, taxPolicy, taxContext: input.taxContext, base: currentBase });
  const currentTotal = currentBase.plus(currentTax.vatAmount);
  const sale = salePricing.calculateLooseProfileSalePrice({ profile: PROFILE, currentTotalCost: currentTotal, markupPercent: piece.markupPercent, sellingPrice: piece.sellingPrice, maximumDiscountPercent: piece.maximumDiscountPercent, configuredVatRate: taxPolicy.vatRate });
  return Object.freeze({
    profile: PROFILE, piece,
    purchase: { purchaseBasePreTax: fixed(purchaseBase), purchaseVAT: fixed(purchaseTax.vatAmount), purchaseTotalTaxInclusive: fixed(purchaseBase.plus(purchaseTax.vatAmount)), vatRate: String(purchaseTax.effectiveVatRate), taxTreatment: purchaseTax.resolvedTaxTreatment, taxSnapshot: purchaseTax },
    current: { currentValuationBasePreTax: fixed(currentBase), currentPearlValuePreTax: fixed(currentBase), currentVAT: fixed(currentTax.vatAmount), currentTotalTaxInclusive: fixed(currentTotal), taxSnapshot: currentTax },
    sale: { ...sale, minimumAllowedSellingPrice: sale.minAllowedSellingPrice, priceAccepted: !sale.approvalRequired },
    readiness: { profilePreview: "READY", salePriceAccepted: !sale.approvalRequired, currentValuationExplicit: true },
  });
}

function calculateReceiptPiece({ input = {}, taxPolicy = {}, masters = [], pearlSizes = [], requireSalePrice = true }) {
  const preview = calculatePreview({ input, taxPolicy, masters, pearlSizes });
  if (requireSalePrice && !preview.sale.priceAccepted) throw new Error("LOOSE_PEARL_SALE_PRICE_BELOW_MINIMUM");
  const { piece } = preview;
  const current = preview.current;
  return Object.freeze({
    profile: PROFILE, inventoryProfile: PROFILE, type: "pearl", category: "Loose Pearl", name: piece.description, description: piece.description,
    itemCode: "LOS", inventoryCode: "PL", karatCode: "00", karat: null,
    grossWeight: Number(piece.totalPearlWeight), netWeight: Number(piece.totalPearlWeight), purchaseCost: Number(preview.purchase.purchaseBasePreTax), unitCost: Number(preview.purchase.purchaseBasePreTax), sellingPrice: preview.sale.finalSalePrice,
    looseDetails: Object.freeze({ kind: "PEARL", totalPearlWeight: piece.totalPearlWeight, weightUnit: WEIGHT_UNIT, pearlSize: piece.pearlSize, pearlSizeId: piece.pearlSizeId, pearlSizeMaster: piece.pearlSizeMaster, pearlType: piece.pearlType, pearlColor: piece.pearlColor, overtone: piece.overtone, orient: piece.orient, pearlShape: piece.pearlShape, shape: piece.shape, luster: piece.luster, surfaceQuality: piece.surfaceQuality, nacreQuality: piece.nacreQuality, pearlOrigin: piece.pearlOrigin, origin: piece.origin, certificateAuthority: piece.certificateAuthority, certificateNumber: piece.certificateNumber, notes: piece.notes, masterData: piece.masterData }),
    loosePurchase: { purchaseBaseCost: preview.purchase.purchaseBasePreTax, additionalCost: "0.00000000", vatBase: preview.purchase.purchaseBasePreTax, vatRate: preview.purchase.vatRate, vatAmount: preview.purchase.purchaseVAT, totalPurchaseCost: preview.purchase.purchaseTotalTaxInclusive, purchasePricePreTax: preview.purchase.purchaseBasePreTax },
    looseFinancial: { purchasePricePreTax: preview.purchase.purchaseBasePreTax },
    looseCurrentValuation: { currentPearlValuePreTax: current.currentPearlValuePreTax, currentVatRate: current.currentVatRate ?? current.taxSnapshot.effectiveVatRate },
    currentValuation: { rateSource: "LOOSE_PEARL_VALUATION", goldRate: null, goldValue: null, makingValue: null, certificateValue: "0.00000000", componentValue: current.currentValuationBasePreTax, vatRate: current.taxSnapshot.effectiveVatRate, vatRateSource: "TAX_ENGINE", vatBase: current.currentValuationBasePreTax, vatAmount: current.currentVAT, totalValue: current.currentTotalTaxInclusive },
    vat: { vatBase: preview.purchase.purchaseBasePreTax, vatRate: preview.purchase.vatRate, vatAmount: preview.purchase.purchaseVAT, vatRateSource: "TAX_ENGINE" },
    pricing: { sellingPrice: preview.sale.finalSalePrice, markupPercent: piece.markupPercent, maximumDiscountPercent: piece.maximumDiscountPercent, minimumSellingPrice: preview.sale.minAllowedSellingPrice, manualPriceAllowed: false },
    supplierId: piece.supplierId, locationId: piece.locationId, purchaseDate: piece.purchaseDate, itemIndex: input.itemIndex, pieceIndex: input.pieceIndex, __loosePearlCalculation: preview,
  });
}

function optionRows(masters, category) { return rowsFor(masters, category).map((row) => ({ id: row.id, value: row.value, label: row.label, isActive: row.isActive !== false })); }
function contract({ masters = [], pearlSizes = [], suppliers = [], locations = [], taxPolicy = null, barcode = null } = {}) {
  return Object.freeze({ profile: PROFILE, currency: CURRENCY, weightUnit: WEIGHT_UNIT, masters, pearlSizes, suppliers, locations, taxPolicy, barcode: { ...(barcode || {}), requiredInventoryCode: "PL", requiredItemCode: "LOS", requiredKaratCode: "00", source: "SERVER" }, masterOptions: Object.fromEntries(Object.values(CATEGORIES).map((category) => [category, optionRows(masters, category)])), authority: { physicalInventory: "ASSET", quantityAuthority: "NOT_ALLOWED", receive: "SUPPLIER_V2_CANONICAL", barcode: "PL/LOS/00", weight: "CT", goldFields: "NOT_APPLICABLE", bulk: "DEFERRED_NO_SILENT_ALLOCATION", supplier: "REQUIRED_FOR_PURCHASE" } });
}

module.exports = { PROFILE, CATEGORIES, CURRENCY, WEIGHT_UNIT, MONEY_SCALE, fixed, normalizeInput, calculatePreview, calculateReceiptPiece, contract };
