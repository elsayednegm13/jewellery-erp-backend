"use strict";

const Decimal = require("decimal.js");
const goldCenterReferencePriceService = require("./gold-center-reference-price.service");
const transactionTaxContext = require("./transaction-tax-context.service");
const goldSalePricingService = require("./gold-sale-pricing.service");
const { ValidationError } = require("../utils/errors");

const PROFILE = "PEARL_JEWELLERY";
const CURRENCY = "AED";
const GOLD_UNIT = "PER_GRAM";
const SCALE = 8;
const KARATS = Object.freeze([9, 10, 12, 14, 18, 21, 22, 24]);
const ITEM_DESCRIPTIONS = Object.freeze([
  "Pearl Anklet", "Pearl Bar", "Pearl Bangle", "Pearl Bracelet", "Pearl Brooch", "Pearl Chain",
  "Pearl Choker", "Pearl Coin", "Pearl Crown", "Pearl Earrings", "Pearl Full Set", "Pearl Necklace",
  "Pearl Pendant", "Pearl Pendant Chain", "Pearl Ring", "Pearl Twins Ring", "Pearl Wedding Band",
]);
const ITEM_CODES = Object.freeze(["ANK", "BAR", "BGL", "BRC", "BRH", "CHN", "CHK", "CON", "CRW", "ERG", "FST", "NCK", "PND", "PCH", "RNG", "TRN", "WRN"]);
const ITEM_DESCRIPTION_MAP = Object.freeze(Object.fromEntries(ITEM_DESCRIPTIONS.map((label, index) => [label, ITEM_CODES[index]])));
const MASTER_CATEGORIES = Object.freeze({
  GOLD_COLOR: "GOLD_COLOR", PEARL_TYPE: "PEARL_TYPE", PEARL_COLOR: "PEARL_COLOR", PEARL_OVERTONE: "PEARL_OVERTONE",
  PEARL_ORIENT: "PEARL_ORIENT", PEARL_SHAPE: "PEARL_SHAPE", PEARL_LUSTER: "PEARL_LUSTER",
  PEARL_SURFACE_QUALITY: "PEARL_SURFACE_QUALITY", PEARL_NACRE_QUALITY: "PEARL_NACRE_QUALITY",
  PEARL_ORIGIN: "PEARL_ORIGIN", CERTIFICATE_AUTHORITY: "CERTIFICATE_AUTHORITY",
});

function fixed(value) { return new Decimal(value).toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP).toFixed(SCALE); }
function text(value, field, { required = false, maxLength = 160 } = {}) {
  const result = value === undefined || value === null ? "" : String(value).trim();
  if (!result && required) throw new Error(`PEARL_${field}_REQUIRED`);
  if (result.length > maxLength) throw new Error(`PEARL_${field}_INVALID`);
  return result || null;
}
function decimal(value, field, { required = false, min = null } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`PEARL_${field}_REQUIRED`);
    return null;
  }
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`PEARL_${field}_INVALID`);
  const result = new Decimal(raw);
  if (!result.isFinite() || result.decimalPlaces() > SCALE || (min !== null && result.lt(min))) throw new Error(`PEARL_${field}_INVALID`);
  return result;
}
function masterValues(masterData, category) { return Array.isArray(masterData?.[category]) ? masterData[category].filter(Boolean) : []; }
function oneOf(value, field, allowed, { required = false } = {}) {
  const result = text(value, field, { required });
  if (result === null) return null;
  if (!allowed.length || !allowed.includes(result)) throw new Error(`PEARL_${field}_MASTER_VALUE_REQUIRED`);
  return result;
}
function masterIndex(masters = []) {
  const result = {};
  for (const category of Object.values(MASTER_CATEGORIES)) {
    result[category] = [...new Set(masters.filter((row) => String(row?.category || "").toUpperCase() === category && row?.isActive !== false).map((row) => String(row.label || row.value || "").trim()).filter(Boolean))];
  }
  return Object.freeze(result);
}
function resolveItem(description, itemCode) {
  const value = text(description, "DESCRIPTION", { required: true });
  if (value === "Loose Pearl") throw new Error("PEARL_LOOSE_PEARL_DESCRIPTION_FORBIDDEN");
  const canonicalCode = ITEM_DESCRIPTION_MAP[value];
  if (!canonicalCode) throw new Error("PEARL_DESCRIPTION_INVALID");
  const supplied = text(itemCode, "ITEM_CODE");
  if (supplied && supplied !== canonicalCode) throw new Error("PEARL_ITEM_CODE_MISMATCH");
  return { description: value, itemCode: canonicalCode };
}
function normalizePearlGroup(input, index, { masterData = null, pearlSizes = [] } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`PEARL_GROUP_${index + 1}_INVALID`);
  const quantity = decimal(input.quantity ?? input.componentCount ?? 1, "GROUP_QUANTITY", { min: 1 });
  if (!quantity.isInteger()) throw new Error("PEARL_GROUP_QUANTITY_INVALID");
  const totalWeight = decimal(input.totalPearlWeight ?? input.totalWeight ?? input.componentWeight, "TOTAL_PEARL_WEIGHT", { required: true, min: "0.00000001" });
  const pearlCost = decimal(input.pearlCost ?? input.purchaseCost ?? input.cost ?? 0, "PEARL_COST", { min: 0 }) || new Decimal(0);
  const currentValue = decimal(input.currentValue ?? input.currentPearlValue ?? pearlCost, "CURRENT_PEARL_VALUE", { min: 0 }) || new Decimal(0);
  const pearlSizeId = text(input.pearlSizeId ?? input.sizeId, "PEARL_SIZE_ID");
  const pearlSize = text(input.pearlSize ?? input.size, "PEARL_SIZE");
  if (pearlSizeId && Array.isArray(pearlSizes) && pearlSizes.length && !pearlSizes.some((row) => String(row.id) === pearlSizeId)) throw new Error("PEARL_SIZE_MASTER_VALUE_REQUIRED");
  const details = {
    pearlSizeId, pearlSize: pearlSize || (pearlSizeId ? pearlSizes.find((row) => String(row.id) === pearlSizeId)?.displayValue : null),
    pearlType: oneOf(input.pearlType ?? input.type, "TYPE", masterValues(masterData, "PEARL_TYPE")),
    pearlColor: oneOf(input.pearlColor ?? input.color, "COLOR", masterValues(masterData, "PEARL_COLOR")),
    overtone: oneOf(input.overtone, "OVERTONE", masterValues(masterData, "PEARL_OVERTONE")),
    orient: oneOf(input.orient, "ORIENT", masterValues(masterData, "PEARL_ORIENT")),
    pearlShape: oneOf(input.pearlShape ?? input.shape, "SHAPE", masterValues(masterData, "PEARL_SHAPE")),
    luster: oneOf(input.luster, "LUSTER", masterValues(masterData, "PEARL_LUSTER")),
    surfaceQuality: oneOf(input.surfaceQuality, "SURFACE_QUALITY", masterValues(masterData, "PEARL_SURFACE_QUALITY")),
    nacreQuality: oneOf(input.nacreQuality, "NACRE_QUALITY", masterValues(masterData, "PEARL_NACRE_QUALITY")),
    pearlOrigin: oneOf(input.pearlOrigin ?? input.origin, "ORIGIN", masterValues(masterData, "PEARL_ORIGIN")),
  };
  const certificate = input.certificate || null;
  if (certificate && (certificate.certificateNumber || certificate.number)) {
    details.certificate = { ...certificate, authority: oneOf(certificate.authority ?? certificate.issuer, "CERTIFICATE_AUTHORITY", masterValues(masterData, "CERTIFICATE_AUTHORITY"), { required: true }), certificateNumber: text(certificate.certificateNumber ?? certificate.number, "CERTIFICATE_NUMBER", { required: true }) };
  }
  return Object.freeze({
    ...input, sequence: index, role: "EMBEDDED", componentKind: "PEARL", componentCount: quantity.toNumber(),
    componentWeight: fixed(totalWeight), totalPearlWeight: fixed(totalWeight), measurementUnit: "GRAM", name: "Pearl",
    componentType: details.pearlType, purchaseCost: fixed(pearlCost), currentValue: fixed(currentValue), pearlCost: fixed(pearlCost), pearlDetails: details,
    ...details, notes: text(input.notes ?? input.remarks, "GROUP_NOTES"),
  });
}
function normalizeOtherComponent(input, index) {
  const kind = String(input?.componentKind || input?.kind || "").trim().toUpperCase();
  if (!["DIAMOND", "GEMSTONE", "OTHER"].includes(kind)) throw new Error(`PEARL_COMPONENT_${index + 1}_KIND_INVALID`);
  const weight = decimal(input.componentWeight ?? input.weight ?? input.stoneWeight ?? 0, "OTHER_STONE_WEIGHT", { min: 0 }) || new Decimal(0);
  const purchaseCost = decimal(input.purchaseCost ?? input.stoneCost ?? input.cost ?? 0, "OTHER_STONE_COST", { min: 0 }) || new Decimal(0);
  const currentValue = decimal(input.currentValue ?? purchaseCost, "OTHER_CURRENT_VALUE", { min: 0 }) || new Decimal(0);
  return Object.freeze({ ...input, sequence: index, role: "EMBEDDED", componentKind: kind, componentCount: 1, componentWeight: fixed(weight), measurementUnit: "GRAM", purchaseCost: fixed(purchaseCost), currentValue: fixed(currentValue), name: text(input.name, "OTHER_STONE_NAME") || (kind === "DIAMOND" ? "Diamond" : kind === "GEMSTONE" ? "Gemstone" : "Component") });
}
function normalizePiece(input = {}, { masterData = null, pearlSizes = [], requireSalePrice = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("PEARL_INPUT_INVALID");
  const identity = resolveItem(input.description ?? input.name, input.itemCode);
  const karat = decimal(input.karat, "KARAT", { required: true, min: 0 });
  if (!karat.isInteger() || !KARATS.includes(karat.toNumber())) throw new Error("PEARL_KARAT_UNSUPPORTED");
  const grossWeight = decimal(input.grossWeight, "GROSS_WEIGHT", { required: true, min: "0.00000001" });
  const goldColor = oneOf(input.goldColor, "GOLD_COLOR", masterValues(masterData, "GOLD_COLOR"), { required: true });
  const rawComponents = Array.isArray(input.components) ? input.components : Array.isArray(input.pearlGroups) ? input.pearlGroups.map((group) => ({ ...group, componentKind: "PEARL" })) : [];
  if (!rawComponents.length) throw new Error("PEARL_GROUPS_REQUIRED");
  const components = rawComponents.map((component, index) => String(component.componentKind || component.kind || "PEARL").toUpperCase() === "PEARL" ? normalizePearlGroup(component, index, { masterData, pearlSizes }) : normalizeOtherComponent(component, index));
  const pearlWeight = components.filter((component) => component.componentKind === "PEARL").reduce((sum, component) => sum.plus(component.componentWeight), new Decimal(0));
  const otherStoneWeight = components.filter((component) => component.componentKind !== "PEARL").reduce((sum, component) => sum.plus(component.componentWeight), new Decimal(0));
  const netGoldWeight = grossWeight.minus(pearlWeight).minus(otherStoneWeight);
  if (netGoldWeight.lt(0)) throw new Error("PEARL_NET_GOLD_WEIGHT_INVALID");
  const purchaseGoldPrice = decimal(input.purchaseGoldPrice ?? input.goldPurchasePrice, "PURCHASE_GOLD_PRICE", { required: true, min: "0.00000001" });
  const makingPerGram = decimal(input.makingPerGram, "MAKING_PER_GRAM", { required: true, min: 0 });
  const currentMakingPerGram = decimal(input.currentMakingPerGram ?? input.makingPerGram, "CURRENT_MAKING_PER_GRAM", { required: true, min: 0 });
  const sellingPrice = decimal(input.sellingPrice ?? input.salePrice, "SELLING_PRICE", { required: requireSalePrice, min: "0.00000001" });
  const pearlCostTotal = components.filter((component) => component.componentKind === "PEARL").reduce((sum, component) => sum.plus(component.purchaseCost), new Decimal(0));
  const otherStoneCostTotal = components.filter((component) => component.componentKind !== "PEARL").reduce((sum, component) => sum.plus(component.purchaseCost), new Decimal(0));
  const currentPearlValue = components.filter((component) => component.componentKind === "PEARL").reduce((sum, component) => sum.plus(component.currentValue), new Decimal(0));
  const currentOtherStoneValue = components.filter((component) => component.componentKind !== "PEARL").reduce((sum, component) => sum.plus(component.currentValue), new Decimal(0));
  return Object.freeze({ ...input, profile: PROFILE, inventoryProfile: PROFILE, ...identity, name: identity.description, goldColor, karat: karat.toNumber(), grossWeight: fixed(grossWeight), pearlWeight: fixed(pearlWeight), otherStonesWeight: fixed(otherStoneWeight), netGoldWeight: fixed(netGoldWeight), pureGoldWeight9999: fixed(netGoldWeight.times(karat).div(24)), components, pearlCostTotal: fixed(pearlCostTotal), otherStoneCostTotal: fixed(otherStoneCostTotal), purchaseGoldPrice: fixed(purchaseGoldPrice), goldPurchasePrice: fixed(purchaseGoldPrice), makingPerGram: fixed(makingPerGram), currentMakingPerGram: fixed(currentMakingPerGram), currentPearlValue: fixed(currentPearlValue), currentOtherStoneValue: fixed(currentOtherStoneValue), sellingPrice: sellingPrice === null ? null : fixed(sellingPrice) });
}
function taxFor({ taxTreatment, taxPolicy, taxContext, base }) {
  if (!taxTreatment) throw new Error("PEARL_TAX_TREATMENT_REQUIRED");
  return transactionTaxContext.resolveTransactionTaxContext({ requestedTaxTreatment: taxTreatment, companyPolicy: taxPolicy || {}, rcmContext: taxContext || {}, taxableBase: fixed(base), roundingScale: SCALE });
}
async function calculatePreview({ companyId, input = {}, taxPolicy = {}, masterData = null, pearlSizes = [], requireSalePrice = false }) {
  const piece = normalizePiece(input, { masterData, pearlSizes, requireSalePrice });
  const currentRate = await goldCenterReferencePriceService.getGlobalRateForGoldByPiece(companyId, CURRENCY, piece.karat);
  const historicalGoldValue = new Decimal(piece.netGoldWeight).times(piece.purchaseGoldPrice);
  const historicalMakingTotal = new Decimal(piece.netGoldWeight).times(piece.makingPerGram);
  const historicalBase = historicalGoldValue.plus(historicalMakingTotal).plus(piece.pearlCostTotal).plus(piece.otherStoneCostTotal);
  const currentGoldValue = new Decimal(currentRate.rate).times(piece.netGoldWeight);
  const currentMakingValue = new Decimal(piece.netGoldWeight).times(piece.currentMakingPerGram);
  const currentBase = currentGoldValue.plus(currentMakingValue).plus(piece.currentPearlValue).plus(piece.currentOtherStoneValue);
  const purchaseTax = taxFor({ taxTreatment: input.taxTreatment, taxPolicy, taxContext: input.taxContext, base: historicalBase });
  const currentTax = taxFor({ taxTreatment: input.taxTreatment, taxPolicy, taxContext: input.taxContext, base: currentBase });
  const currentTotal = currentBase.plus(currentTax.vatAmount);
  const sale = piece.sellingPrice === null ? null : goldSalePricingService.calculateLooseProfileSalePrice({ profile: PROFILE, currentTotalCost: currentBase, sellingPrice: piece.sellingPrice, markupPercent: input.markupPercent, maximumDiscountPercent: input.maximumDiscountPercent, configuredVatRate: currentTax.effectiveVatRate });
  return Object.freeze({ profile: PROFILE, piece, gold: { currency: CURRENCY, unit: GOLD_UNIT, karat: piece.karat, currentRate: fixed(currentRate.rate), currentRateType: "GLOBAL", source: currentRate.snapshot.provider || currentRate.snapshot.source, snapshot: currentRate.snapshot }, weights: { grossWeight: piece.grossWeight, pearlWeight: piece.pearlWeight, otherStonesWeight: piece.otherStonesWeight, netGoldWeight: piece.netGoldWeight, pureGoldWeight9999: piece.pureGoldWeight9999, karat: piece.karat }, historicalPurchase: { purchaseGoldPrice: piece.purchaseGoldPrice, goldValue: fixed(historicalGoldValue), makingPerGram: piece.makingPerGram, makingTotal: fixed(historicalMakingTotal), pearlCostTotal: piece.pearlCostTotal, otherStoneCostTotal: piece.otherStoneCostTotal, taxableBase: fixed(historicalBase), purchaseBasePreTax: fixed(historicalBase), vatRate: String(purchaseTax.effectiveVatRate), vatAmount: fixed(purchaseTax.vatAmount), totalPurchaseCost: fixed(historicalBase.plus(purchaseTax.vatAmount)), taxTreatment: purchaseTax.resolvedTaxTreatment, taxSnapshot: purchaseTax }, currentCost: { goldRate: fixed(currentRate.rate), goldValue: fixed(currentGoldValue), makingPerGram: piece.currentMakingPerGram, makingValue: fixed(currentMakingValue), pearlValue: piece.currentPearlValue, otherStoneValue: piece.currentOtherStoneValue, currentValuationBasePreTax: fixed(currentBase), vatRate: String(currentTax.effectiveVatRate), vatAmount: fixed(currentTax.vatAmount), totalCurrentCost: fixed(currentTotal), currentValuationTotalTaxInclusive: fixed(currentTotal), taxTreatment: currentTax.resolvedTaxTreatment, taxSnapshot: currentTax }, sale, readiness: { finalReceive: "NOT_RUN_IN_THIS_CONTROL", salePriceRequiredForFinalSave: sale === null, salePriceAccepted: sale !== null && !sale.approvalRequired } });
}
async function calculateReceiptPiece({ companyId, input, taxPolicy, masterData, pearlSizes, requireSalePrice = true }) {
  const preview = await calculatePreview({ companyId, input, taxPolicy, masterData, pearlSizes, requireSalePrice });
  if (requireSalePrice && (!preview.sale || preview.sale.approvalRequired || Number(preview.sale.finalSalePrice || 0) <= 0)) throw new Error("PEARL_SALE_PRICE_BELOW_MINIMUM");
  const historical = preview.historicalPurchase; const current = preview.currentCost;
  return Object.freeze({ ...input, profile: PROFILE, inventoryProfile: PROFILE, description: preview.piece.description, name: preview.piece.description, itemCode: preview.piece.itemCode, goldColor: preview.piece.goldColor, grossWeight: preview.piece.grossWeight, karat: preview.piece.karat, netGoldWeight: preview.piece.netGoldWeight, goldWeight: preview.piece.netGoldWeight, stoneWeight: fixed(new Decimal(preview.piece.pearlWeight).plus(preview.piece.otherStonesWeight)), weights: { grossWeight: preview.piece.grossWeight, stoneWeight: fixed(new Decimal(preview.piece.pearlWeight).plus(preview.piece.otherStonesWeight)), netGoldWeight: preview.piece.netGoldWeight, karat: Number(preview.piece.karat).toFixed(6), purityRatio: new Decimal(preview.piece.karat).div(24).toFixed(8), pureGold9999: preview.piece.pureGoldWeight9999 }, components: preview.piece.components, purchaseCost: historical.purchaseBasePreTax, unitCost: historical.purchaseBasePreTax, goldValue: historical.goldValue, makingPerGram: historical.makingPerGram, makingTotal: historical.makingTotal, componentCost: fixed(new Decimal(historical.pearlCostTotal).plus(historical.otherStoneCostTotal)), vatBase: historical.purchaseBasePreTax, vatRate: historical.vatRate, vat: { vatBase: historical.taxableBase, vatRate: historical.vatRate, vatAmount: historical.vatAmount, vatRateSource: "TAX_ENGINE" }, currentValuation: { rateSource: "GOLD_CENTER_GLOBAL_SPOT", goldRate: current.goldRate, goldValue: current.goldValue, makingValue: current.makingValue, certificateValue: "0.00000000", componentValue: fixed(new Decimal(current.pearlValue).plus(current.otherStoneValue)), vatRate: current.vatRate, vatRateSource: "TAX_ENGINE", vatBase: current.currentValuationBasePreTax, vatAmount: current.vatAmount, totalValue: current.currentValuationTotalTaxInclusive }, pricing: { ...(input.pricing || {}), sellingPrice: preview.sale?.finalSalePrice || preview.piece.sellingPrice, minimumSellingPrice: preview.sale?.minAllowedSellingPrice || null, markupPercent: preview.sale?.markupPercent || null, manualPriceAllowed: false }, __pearlCalculation: preview });
}
function toValidationError(error) { const code = String(error?.errorCode || error?.message || ""); return /^PEARL_[A-Z0-9_]+$/.test(code) ? Object.assign(new Error(code), { errorCode: code }) : null; }
function contract({ masters = [], pearlSizes = [], suppliers = [], locations = [], taxPolicy = null, gold = null, barcode = null } = {}) { const masterData = masterIndex(masters); return Object.freeze({ profile: PROFILE, karats: KARATS, itemCodes: ITEM_CODES, itemDescriptions: ITEM_DESCRIPTIONS.map((label) => ({ value: label, itemCode: ITEM_DESCRIPTION_MAP[label], labelEn: label, labelAr: label })), masterOptions: Object.fromEntries(Object.values(MASTER_CATEGORIES).map((key) => [key, masterValues(masterData, key)])), pearlSizes, masters, suppliers, locations, taxPolicy, gold, barcode, authority: { physicalInventory: "ASSET", quantityAuthority: "NOT_ALLOWED", receive: "SUPPLIER_V2_CANONICAL", treatmentSource: "DB_MASTER", loosePearlExcluded: true } }); }

module.exports = { PROFILE, CURRENCY, GOLD_UNIT, SCALE, KARATS, ITEM_CODES, ITEM_DESCRIPTIONS, ITEM_DESCRIPTION_MAP, MASTER_CATEGORIES, masterIndex, normalizePearlGroup, normalizePiece, calculatePreview, calculateReceiptPiece, contract, toValidationError };
