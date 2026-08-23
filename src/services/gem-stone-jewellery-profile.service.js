"use strict";

const Decimal = require("decimal.js");
const goldCenterReferencePriceService = require("./gold-center-reference-price.service");
const transactionTaxContext = require("./transaction-tax-context.service");
const inventoryMasterDataPolicy = require("./inventory-master-data-policy.service");

const PROFILE = "GEMSTONE_JEWELLERY";
const CURRENCY = "AED";
const GOLD_UNIT = "PER_GRAM";
const CARAT_TO_GRAMS = new Decimal("0.20");
const SCALE = 8;
const KARATS = Object.freeze([9, 10, 12, 14, 18, 21, 22, 24]);
const ITEM_CODES = Object.freeze(["ANK", "BAR", "BGL", "BRC", "BRH", "CHN", "CHK", "CON", "CRW", "ERG", "FST", "LOS", "NCK", "PND", "PCH", "RNG", "TRN", "WRN"]);
const ITEM_DESCRIPTIONS = Object.freeze([
  "Gem Stone Anklet", "Gem Stone Bar", "Gem Stone Bangle", "Gem Stone Bracelet", "Gem Stone Brooch",
  "Gem Stone Chain", "Gem Stone Choker", "Gem Stone Coin", "Gem Stone Crown", "Gem Stone Earrings",
  "Gem Stone Full Set", "Loose Gem Stone", "Gem Stone Necklace", "Gem Stone Pendant", "Gem Stone Pendant Chain",
  "Gem Stone Ring", "Gem Stone Twins Ring", "Gem Stone Wedding Band",
]);
const ITEM_DESCRIPTION_MAP = Object.freeze(Object.fromEntries(ITEM_DESCRIPTIONS.map((label, index) => [label, ITEM_CODES[index]])));
const MASTER_CATEGORIES = Object.freeze({
  GEMSTONE_NAME: "GEMSTONE_NAME", GEMSTONE_TYPE: "GEMSTONE_TYPE", GEMSTONE_TREATMENT: "GEMSTONE_TREATMENT",
  GEMSTONE_SHAPE: "GEMSTONE_SHAPE", GEMSTONE_COLOR: "GEMSTONE_COLOR", GEMSTONE_TONE: "GEMSTONE_TONE",
  GEMSTONE_TONE_LEVEL: "GEMSTONE_TONE_LEVEL", GEMSTONE_SATURATION: "GEMSTONE_SATURATION",
  GEMSTONE_OPTICAL_EFFECT: "GEMSTONE_OPTICAL_EFFECT", GEMSTONE_ORIGIN: "GEMSTONE_ORIGIN",
  GEMSTONE_POSITION: "GEMSTONE_POSITION", GEMSTONE_SETTING: "GEMSTONE_SETTING", CERTIFICATE_AUTHORITY: "CERTIFICATE_AUTHORITY",
});

const fallback = Object.freeze({
  GEMSTONE_NAME: inventoryMasterDataPolicy.GEMSTONE_NAMES,
  GEMSTONE_TYPE: inventoryMasterDataPolicy.GEMSTONE_TYPES,
  GEMSTONE_SHAPE: inventoryMasterDataPolicy.GEMSTONE_SHAPES,
  GEMSTONE_COLOR: inventoryMasterDataPolicy.GEMSTONE_COLORS,
  GEMSTONE_TONE: inventoryMasterDataPolicy.GEMSTONE_TONES,
  GEMSTONE_TONE_LEVEL: inventoryMasterDataPolicy.GEMSTONE_TONE_LEVELS,
  GEMSTONE_SATURATION: inventoryMasterDataPolicy.GEMSTONE_SATURATIONS,
  GEMSTONE_OPTICAL_EFFECT: inventoryMasterDataPolicy.GEMSTONE_OPTICAL_EFFECTS,
  GEMSTONE_ORIGIN: inventoryMasterDataPolicy.GEMSTONE_ORIGINS,
  GEMSTONE_TREATMENT: [], GEMSTONE_POSITION: [], GEMSTONE_SETTING: [], CERTIFICATE_AUTHORITY: [],
});

function fixed(value) { return new Decimal(value).toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP).toFixed(SCALE); }
function text(value, field, { required = false, maxLength = 160 } = {}) {
  const result = value === undefined || value === null ? "" : String(value).trim();
  if (!result && required) throw new Error(`GEMSTONE_${field}_REQUIRED`);
  if (result.length > maxLength) throw new Error(`GEMSTONE_${field}_INVALID`);
  return result || null;
}
function decimal(value, field, { required = false, min = null } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`GEMSTONE_${field}_REQUIRED`);
    return null;
  }
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`GEMSTONE_${field}_INVALID`);
  const parsed = new Decimal(raw);
  if (!parsed.isFinite() || parsed.decimalPlaces() > SCALE || (min !== null && parsed.lt(min))) throw new Error(`GEMSTONE_${field}_INVALID`);
  return parsed;
}
function valuesFor(masterData, category) {
  const values = Array.isArray(masterData?.[category]) ? masterData[category].filter(Boolean) : [];
  return values.length ? values : (fallback[category] || []);
}
function masterIndex(masters = []) {
  return Object.freeze(Object.fromEntries(Object.values(MASTER_CATEGORIES).map((category) => [category, [...new Set(masters.filter((row) => String(row?.category || row?.categoryKey || row?.category_key || "").toUpperCase() === category && row?.isActive !== false).map((row) => String(row.label || row.displayLabel || row.display_label || row.value || "").trim()).filter(Boolean))]])));
}
function oneOf(value, field, allowed, { required = false } = {}) {
  const normalized = text(value, field, { required });
  if (normalized === null) return null;
  if (allowed.length && !allowed.includes(normalized)) throw new Error(`GEMSTONE_${field}_INVALID`);
  if (!allowed.length) throw new Error(`GEMSTONE_${field}_MASTER_UNAVAILABLE`);
  return normalized;
}
function manyOf(value, field, allowed) {
  const values = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  const normalized = [...new Set(values.map((entry) => text(entry, field)).filter(Boolean))];
  if (normalized.some((entry) => !allowed.includes(entry))) throw new Error(`GEMSTONE_${field}_INVALID`);
  return normalized;
}
function normalizeCertificate(input, masterData) {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("GEMSTONE_CERTIFICATE_INVALID");
  const authority = oneOf(input.authority ?? input.issuer ?? input.certificateAuthority, "CERTIFICATE_AUTHORITY", valuesFor(masterData, "CERTIFICATE_AUTHORITY"), { required: true });
  const certificateNumber = text(input.certificateNumber ?? input.number, "CERTIFICATE_NUMBER", { required: true });
  const issueDate = text(input.issueDate, "CERTIFICATE_ISSUE_DATE", { required: true });
  return Object.freeze({ authority, issuer: authority, certificateNumber, issueDate, url: text(input.url, "CERTIFICATE_URL", { maxLength: 500 }) });
}
function normalizeComponents(components, { masterData = null } = {}) {
  if (!Array.isArray(components) || components.length < 1) throw new Error("GEMSTONE_COMPONENTS_REQUIRED");
  return components.map((component, index) => {
    if (!component || typeof component !== "object" || Array.isArray(component)) throw new Error(`GEMSTONE_COMPONENT_${index + 1}_INVALID`);
    const carat = decimal(component.stoneCaratWeight ?? component.componentCarat ?? component.carat, "STONE_CARAT_WEIGHT", { required: true, min: "0.00000001" });
    const stoneName = oneOf(component.stoneName ?? component.name, "STONE_NAME", valuesFor(masterData, "GEMSTONE_NAME"), { required: true });
    const stoneType = oneOf(component.stoneType ?? component.componentType, "STONE_TYPE", valuesFor(masterData, "GEMSTONE_TYPE"));
    const treatment = oneOf(component.treatment ?? component.treatmentType, "TREATMENT", valuesFor(masterData, "GEMSTONE_TREATMENT"));
    const shape = oneOf(component.shape ?? component.stoneShape, "SHAPE", valuesFor(masterData, "GEMSTONE_SHAPE"));
    const color = oneOf(component.color ?? component.stoneColor, "COLOR", valuesFor(masterData, "GEMSTONE_COLOR"));
    const tone = oneOf(component.tone, "TONE", valuesFor(masterData, "GEMSTONE_TONE"));
    const toneLevel = oneOf(component.toneLevel, "TONE_LEVEL", valuesFor(masterData, "GEMSTONE_TONE_LEVEL"));
    const saturation = oneOf(component.saturation, "SATURATION", valuesFor(masterData, "GEMSTONE_SATURATION"));
    const opticalEffect = oneOf(component.opticalEffect, "OPTICAL_EFFECT", valuesFor(masterData, "GEMSTONE_OPTICAL_EFFECT"));
    const origin = oneOf(component.origin, "ORIGIN", valuesFor(masterData, "GEMSTONE_ORIGIN"));
    const position = oneOf(component.position, "POSITION", valuesFor(masterData, "GEMSTONE_POSITION"));
    const settings = manyOf(component.settings ?? component.setting, "SETTING", valuesFor(masterData, "GEMSTONE_SETTING"));
    const purchaseCost = decimal(component.stoneCost ?? component.purchaseCost ?? component.cost, "STONE_COST", { min: 0 }) || new Decimal(0);
    const currentValue = decimal(component.currentValue ?? component.currentGemStoneValue, "CURRENT_GEMSTONE_VALUE", { min: 0 });
    return Object.freeze({ ...component, sequence: index, role: "EMBEDDED", componentKind: "GEMSTONE", componentCount: 1, name: stoneName, componentType: stoneType, stoneName, stoneType, componentCarat: fixed(carat), stoneCaratWeight: fixed(carat), componentWeight: fixed(carat.times(CARAT_TO_GRAMS)), measurementUnit: "CT", treatment, shape, color, tone, toneLevel, saturation, opticalEffect, origin, position, settings, setting: settings.length === 1 ? settings[0] : null, purchaseCost: fixed(purchaseCost), currentValue: currentValue === null ? null : fixed(currentValue), certificate: normalizeCertificate(component.certificate, masterData), notes: text(component.notes, "COMPONENT_NOTES") });
  });
}
function normalizePiece(input = {}, { masterData = null, requireSalePrice = false } = {}) {
  const description = text(input.description ?? input.name, "DESCRIPTION", { required: true });
  const itemCode = text(input.itemCode, "ITEM_CODE", { required: true });
  if (!ITEM_CODES.includes(itemCode)) throw new Error("GEMSTONE_ITEM_CODE_INVALID");
  const grossWeight = decimal(input.grossWeight, "GROSS_WEIGHT", { required: true, min: "0.00000001" });
  const karat = decimal(input.karat, "KARAT", { required: true, min: 0 });
  if (!karat.isInteger() || !KARATS.includes(karat.toNumber())) throw new Error("GEMSTONE_KARAT_UNSUPPORTED");
  const components = normalizeComponents(input.components, { masterData });
  const totalGemStoneWeightCt = components.reduce((sum, component) => sum.plus(component.componentCarat), new Decimal(0));
  const declaredCt = decimal(input.totalGemStoneWeightCt ?? input.totalGemStoneCarat ?? input.totalGemstoneWeight, "TOTAL_GEMSTONE_WEIGHT_CT", { required: true, min: 0 });
  if (!totalGemStoneWeightCt.eq(declaredCt)) throw new Error("GEMSTONE_TOTAL_CARAT_MISMATCH");
  const stoneWeight = declaredCt.times(CARAT_TO_GRAMS);
  const override = input.netGoldWeightOverride ?? input.netGoldWeight;
  const netGoldWeight = override === undefined || override === null || override === "" ? grossWeight.minus(stoneWeight) : decimal(override, "NET_GOLD_WEIGHT", { min: 0 });
  if (netGoldWeight.lt(0) || netGoldWeight.gt(grossWeight)) throw new Error("GEMSTONE_NET_GOLD_WEIGHT_INVALID");
  const goldPurchasePrice = decimal(input.goldPurchasePrice ?? input.purchaseGoldRate, "GOLD_PURCHASE_PRICE", { required: true, min: "0.00000001" });
  const makingPerGram = decimal(input.makingPerGram, "MAKING_PER_GRAM", { required: true, min: 0 });
  const currentMakingPerGram = decimal(input.currentMakingPerGram, "CURRENT_MAKING_PER_GRAM", { required: true, min: 0 });
  const currentGemStoneValue = decimal(input.currentGemStoneValue, "CURRENT_GEMSTONE_VALUE", { required: true, min: 0 });
  const salePrice = decimal(input.sellingPrice ?? input.salePrice ?? input.pieceSellingPrice, "SALE_PRICE", { required: requireSalePrice, min: "0.00000001" });
  const stoneCost = components.reduce((sum, component) => sum.plus(component.purchaseCost), new Decimal(0));
  return Object.freeze({ ...input, profile: PROFILE, inventoryProfile: PROFILE, description, name: description, itemCode, grossWeight: fixed(grossWeight), karat: karat.toNumber(), totalGemStoneWeightCt: fixed(declaredCt), totalGemstoneWeight: fixed(declaredCt), stoneWeight: fixed(stoneWeight), netGoldWeight: fixed(netGoldWeight), pureGoldWeight9999: fixed(netGoldWeight.times(karat).div(24)), components, componentCost: fixed(stoneCost), goldPurchasePrice: fixed(goldPurchasePrice), purchaseGoldRate: fixed(goldPurchasePrice), makingPerGram: fixed(makingPerGram), currentMakingPerGram: fixed(currentMakingPerGram), currentGemStoneValue: fixed(currentGemStoneValue), salePrice: salePrice === null ? null : fixed(salePrice) });
}
function taxFor({ taxTreatment, taxPolicy, taxContext, base }) {
  if (!taxTreatment) throw new Error("GEMSTONE_TAX_TREATMENT_REQUIRED");
  return transactionTaxContext.resolveTransactionTaxContext({ requestedTaxTreatment: taxTreatment, companyPolicy: taxPolicy || {}, rcmContext: taxContext || {}, taxableBase: fixed(base), roundingScale: SCALE });
}
async function calculatePreview({ companyId, input = {}, settings = {}, taxPolicy = {}, masterData = null, requireSalePrice = false }) {
  const piece = normalizePiece(input, { masterData, requireSalePrice });
  const currentRate = await goldCenterReferencePriceService.getGlobalRateForGoldByPiece(companyId, CURRENCY, piece.karat);
  const historicalGoldValue = new Decimal(piece.netGoldWeight).times(piece.goldPurchasePrice);
  const historicalMakingTotal = new Decimal(piece.netGoldWeight).times(piece.makingPerGram);
  const historicalBase = historicalGoldValue.plus(historicalMakingTotal).plus(piece.componentCost);
  const currentGoldValue = new Decimal(currentRate.rate).times(piece.netGoldWeight);
  const currentMakingValue = new Decimal(piece.netGoldWeight).times(piece.currentMakingPerGram);
  const currentBase = currentGoldValue.plus(currentMakingValue).plus(piece.currentGemStoneValue);
  const purchaseTax = taxFor({ taxTreatment: input.taxTreatment, taxPolicy, taxContext: input.taxContext, base: historicalBase });
  const currentTax = taxFor({ taxTreatment: input.taxTreatment, taxPolicy, taxContext: input.taxContext, base: currentBase });
  const currentTotal = currentBase.plus(currentTax.vatAmount);
  const sale = piece.salePrice === null ? null : { salePrice: piece.salePrice, minimumAllowedPrice: fixed(currentTotal), expectedProfit: fixed(new Decimal(piece.salePrice).minus(currentTotal)), profitMarginPercent: fixed(new Decimal(piece.salePrice).isZero() ? 0 : new Decimal(piece.salePrice).minus(currentTotal).div(piece.salePrice).times(100)), priceAccepted: new Decimal(piece.salePrice).gte(currentTotal) };
  return Object.freeze({ profile: PROFILE, piece, gold: { currency: CURRENCY, unit: GOLD_UNIT, karat: piece.karat, currentRate: fixed(currentRate.rate), currentRateType: "GLOBAL", source: currentRate.snapshot.provider || currentRate.snapshot.source, snapshot: currentRate.snapshot }, weights: { grossWeight: piece.grossWeight, totalGemStoneWeightCt: piece.totalGemStoneWeightCt, stoneWeightGrams: piece.stoneWeight, netGoldWeight: piece.netGoldWeight, pureGoldWeight9999: piece.pureGoldWeight9999, karat: piece.karat, caratToGrams: "0.20" }, historicalPurchase: { goldPurchasePrice: piece.goldPurchasePrice, goldValue: fixed(historicalGoldValue), makingPerGram: piece.makingPerGram, makingTotal: fixed(historicalMakingTotal), gemStoneCost: piece.componentCost, taxableBase: fixed(historicalBase), purchaseBasePreTax: fixed(historicalBase), vatRate: String(purchaseTax.effectiveVatRate), vatAmount: fixed(purchaseTax.vatAmount), totalPurchaseCost: fixed(historicalBase.plus(purchaseTax.vatAmount)), taxTreatment: purchaseTax.resolvedTaxTreatment, taxSnapshot: purchaseTax }, currentCost: { goldValue: fixed(currentGoldValue), makingPerGram: piece.currentMakingPerGram, makingValue: fixed(currentMakingValue), gemStoneValue: piece.currentGemStoneValue, taxableBase: fixed(currentBase), currentValuationBasePreTax: fixed(currentBase), vatRate: String(currentTax.effectiveVatRate), vatAmount: fixed(currentTax.vatAmount), totalCurrentCost: fixed(currentTotal), currentValuationTotalTaxInclusive: fixed(currentTotal), taxTreatment: currentTax.resolvedTaxTreatment, taxSnapshot: currentTax }, sale, readiness: { finalReceive: "NOT_RUN_IN_THIS_CONTROL", salePriceRequiredForFinalSave: sale === null, salePriceAccepted: sale !== null && sale.priceAccepted } });
}
async function calculateReceiptPiece({ companyId, input, settings, taxPolicy, masterData, requireSalePrice = true }) {
  const preview = await calculatePreview({ companyId, input, settings, taxPolicy, masterData, requireSalePrice });
  if (requireSalePrice && !preview.sale?.priceAccepted) throw new Error("GEMSTONE_SALE_PRICE_BELOW_MINIMUM");
  const historical = preview.historicalPurchase;
  const current = preview.currentCost;
  return Object.freeze({ ...input, profile: PROFILE, inventoryProfile: PROFILE, grossWeight: preview.piece.grossWeight, karat: preview.piece.karat, netGoldWeight: preview.piece.netGoldWeight, goldWeight: preview.piece.netGoldWeight, stoneWeight: preview.piece.stoneWeight, totalGemStoneWeightCt: preview.piece.totalGemStoneWeightCt, pureGoldWeight9999: preview.piece.pureGoldWeight9999, weights: { grossWeight: preview.piece.grossWeight, stoneWeight: preview.piece.stoneWeight, netGoldWeight: preview.piece.netGoldWeight, karat: Number(preview.piece.karat).toFixed(6), purityRatio: new Decimal(preview.piece.karat).div(24).toFixed(8), pureGold9999: preview.piece.pureGoldWeight9999 }, components: preview.piece.components, purchaseCost: historical.purchaseBasePreTax, unitCost: historical.purchaseBasePreTax, goldValue: historical.goldValue, makingPerGram: historical.makingPerGram, makingTotal: historical.makingTotal, componentCost: historical.gemStoneCost, vatBase: historical.purchaseBasePreTax, vatRate: historical.vatRate, vat: { vatBase: historical.taxableBase, vatRate: historical.vatRate, vatAmount: historical.vatAmount, vatRateSource: "TAX_ENGINE" }, currentValuation: { rateSource: "GOLD_CENTER_GLOBAL_SPOT", goldRate: preview.gold.currentRate, goldValue: current.goldValue, makingValue: current.makingValue, certificateValue: "0.00000000", componentValue: current.gemStoneValue, vatRate: current.vatRate, vatRateSource: "TAX_ENGINE", vatBase: current.currentValuationBasePreTax, vatAmount: current.vatAmount, totalValue: current.currentValuationTotalTaxInclusive }, pricing: { ...(input.pricing || {}), sellingPrice: preview.sale?.salePrice || input.sellingPrice || input.salePrice, minimumSellingPrice: preview.sale?.minimumAllowedPrice || null, manualPriceAllowed: false }, __gemStoneCalculation: preview });
}
function toValidationError(error) { return /^GEMSTONE_[A-Z0-9_]+$/.test(String(error?.message || "")) ? Object.assign(new Error(String(error.message)), { errorCode: String(error.message) }) : null; }
function contract({ masters = [], suppliers = [], locations = [], taxPolicy = null, gold = null, barcode = null } = {}) { const masterData = masterIndex(masters); return Object.freeze({ profile: PROFILE, karats: KARATS, itemCodes: ITEM_CODES, itemDescriptions: ITEM_DESCRIPTIONS.map((label) => ({ value: label, itemCode: ITEM_DESCRIPTION_MAP[label], labelEn: label, labelAr: label })), masterOptions: Object.fromEntries(Object.values(MASTER_CATEGORIES).map((key) => [key, valuesFor(masterData, key)])), masters, suppliers, locations, taxPolicy, gold, barcode, authority: { physicalInventory: "ASSET", quantityAuthority: "NOT_ALLOWED", receive: "SUPPLIER_V2_CANONICAL", treatmentSource: "DB_MASTER", treatmentValuesMayBeEmpty: true } }); }

module.exports = { PROFILE, CURRENCY, GOLD_UNIT, CARAT_TO_GRAMS: "0.20", SCALE, KARATS, ITEM_CODES, ITEM_DESCRIPTIONS, ITEM_DESCRIPTION_MAP, MASTER_CATEGORIES, masterIndex, normalizeComponents, normalizePiece, calculatePreview, calculateReceiptPiece, contract, toValidationError };
