"use strict";

const Decimal = require("decimal.js");
const goldCenterReferencePriceService = require("./gold-center-reference-price.service");
const transactionTaxContext = require("./transaction-tax-context.service");
const inventoryMasterDataPolicy = require("./inventory-master-data-policy.service");
const { ValidationError } = require("../utils/errors");

const PROFILE = "DIAMOND_JEWELLERY";
const CURRENCY = "AED";
const GOLD_UNIT = "PER_GRAM";
const CARAT_TO_GRAMS = new Decimal("0.20");
const SCALE = 8;
const KARATS = Object.freeze([9, 10, 12, 14, 18, 21, 22, 24]);
const ITEM_CODES = Object.freeze(["ANK", "BAR", "BGL", "BRC", "BRH", "CHN", "CHK", "CON", "CRW", "ERG", "FST", "NCK", "PND", "PCH", "RNG", "TRN", "WRN"]);
const ITEM_DESCRIPTION_MAP = Object.freeze({
  "Diamond Anklet": "ANK", "Diamond Bar": "BAR", "Diamond Bangle": "BGL", "Diamond Bracelet": "BRC",
  "Diamond Brooch": "BRH", "Diamond Chain": "CHN", "Diamond Choker": "CHK", "Diamond Coin": "CON",
  "Diamond Crown": "CRW", "Diamond Earrings": "ERG", "Diamond Full Set": "FST", "Diamond Necklace": "NCK",
  "Diamond Pendant": "PND", "Diamond Pendant Chain": "PCH", "Diamond Ring": "RNG", "Diamond Twins Ring": "TRN",
  "Diamond Wedding Band": "WRN",
});
const ITEM_DESCRIPTION_ALIASES = Object.freeze(Object.fromEntries(Object.keys(ITEM_DESCRIPTION_MAP).map((label) => [label.replace(/^Diamond /, ""), label])));
const ITEM_DESCRIPTIONS = Object.freeze(Object.keys(ITEM_DESCRIPTION_MAP));
const DIAMOND_TYPES = inventoryMasterDataPolicy.DIAMOND_TYPES;
const DIAMOND_COLORS = inventoryMasterDataPolicy.DIAMOND_COLORS;
const CLARITIES = inventoryMasterDataPolicy.DIAMOND_CLARITIES;
const CUTS = inventoryMasterDataPolicy.DIAMOND_CUTS;
const SHAPES = inventoryMasterDataPolicy.DIAMOND_SHAPES;
const TREATMENTS = inventoryMasterDataPolicy.DIAMOND_TREATMENTS;
const TONE_LEVELS = Object.freeze(["Extremely Light", "Very Light", "Light", "Medium Light", "Medium", "Medium Dark", "Dark", "Very Dark", "Extremely Dark"]);
const SATURATIONS = Object.freeze(["Brownish", "Exceptional Vivid", "Faint", "Grayish", "Moderate", "Moderately Strong", "Strong", "Very Strong", "Vivid", "Weak"]);
const STONE_NAMES = Object.freeze(["Diamond"]);
const MASTER_CATEGORIES = Object.freeze({
  GOLD_COLOR: "GOLD_COLOR", DIAMOND_TYPE: "DIAMOND_TYPE", DIAMOND_TREATMENT: "DIAMOND_TREATMENT",
  DIAMOND_COLOR: "DIAMOND_COLOR", DIAMOND_CLARITY: "DIAMOND_CLARITY", DIAMOND_CUT: "DIAMOND_CUT",
  DIAMOND_SHAPE: "DIAMOND_SHAPE", DIAMOND_ORIGIN: "DIAMOND_ORIGIN", DIAMOND_TONE: "DIAMOND_TONE",
  DIAMOND_TONE_LEVEL: "DIAMOND_TONE_LEVEL", DIAMOND_SATURATION: "DIAMOND_SATURATION",
  DIAMOND_POSITION: "DIAMOND_POSITION", DIAMOND_SETTING: "DIAMOND_SETTING", CERTIFICATE_AUTHORITY: "CERTIFICATE_AUTHORITY",
});

function masterValues(masters = [], category, fallback = []) {
  const rows = masters.filter((row) => String(row?.category || row?.categoryKey || row?.category_key || "").toUpperCase() === category && row?.isActive !== false);
  const values = rows.map((row) => String(row.label || row.displayLabel || row.display_label || row.value || row.canonicalValue || row.canonical_value || "").trim()).filter(Boolean);
  return [...new Set(values.length ? values : fallback)];
}

function masterIndex(masters = []) {
  return Object.freeze(Object.fromEntries(Object.entries(MASTER_CATEGORIES).map(([key, category]) => [key, masterValues(masters, category)])));
}

function valuesFor(masterData, key, fallback) {
  const values = Array.isArray(masterData?.[key]) ? masterData[key].filter(Boolean) : [];
  return values.length ? values : fallback;
}

function resolveItemDescription(value) {
  const raw = text(value, "DESCRIPTION", { required: true });
  const canonical = ITEM_DESCRIPTION_MAP[raw] ? raw : ITEM_DESCRIPTION_ALIASES[raw];
  if (!canonical) throw new Error("DIAMOND_DESCRIPTION_INVALID");
  return canonical;
}

function resolveItemCode(description, suppliedCode) {
  const canonicalDescription = resolveItemDescription(description);
  const canonicalCode = ITEM_DESCRIPTION_MAP[canonicalDescription];
  const itemCode = text(suppliedCode, "ITEM_CODE");
  if (itemCode && itemCode !== canonicalCode) throw new Error("DIAMOND_ITEM_CODE_MISMATCH");
  return { description: canonicalDescription, itemCode: canonicalCode };
}

function toValidationError(error) {
  const code = String(error?.errorCode || error?.message || "").trim();
  if (!/^DIAMOND_[A-Z0-9_]+$/.test(code)) return null;
  const wrapped = new ValidationError(code);
  wrapped.errorCode = code;
  return wrapped;
}

function fixed(value) { return new Decimal(value).toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP).toFixed(SCALE); }

function decimal(value, field, { required = false, min = null, max = null } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`DIAMOND_${field}_REQUIRED`);
    return null;
  }
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`DIAMOND_${field}_INVALID`);
  let parsed;
  try { parsed = new Decimal(raw); } catch (_) { throw new Error(`DIAMOND_${field}_INVALID`); }
  if (!parsed.isFinite() || parsed.decimalPlaces() > SCALE || (min !== null && parsed.lt(min)) || (max !== null && parsed.gt(max))) {
    throw new Error(`DIAMOND_${field}_INVALID`);
  }
  return parsed;
}

function text(value, field, { required = false, maxLength = 160 } = {}) {
  const result = value === undefined || value === null ? "" : String(value).trim();
  if (!result && required) throw new Error(`DIAMOND_${field}_REQUIRED`);
  if (result.length > maxLength) throw new Error(`DIAMOND_${field}_INVALID`);
  return result || null;
}

function oneOf(value, field, values, { required = false } = {}) {
  const normalized = text(value, field, { required });
  if (normalized === null) return null;
  if (!values.includes(normalized)) throw new Error(`DIAMOND_${field}_INVALID`);
  return normalized;
}

function normalizeDiamondType(value, masterData = null) {
  const raw = text(value, "DIAMOND_TYPE", { required: true });
  const aliases = { "Natural Diamond": "Natural", "Lab Grown Diamond": "Lab Grown", "Treated / Enhanced Diamond": "Treated" };
  const displayValues = valuesFor(masterData, "DIAMOND_TYPE", DIAMOND_TYPES);
  const display = displayValues.includes(raw) ? raw : Object.entries(aliases).find(([, canonical]) => canonical === raw)?.[0] || raw;
  return aliases[display] || oneOf(display, "DIAMOND_TYPE", displayValues, { required: true });
}

function normalizeColors(value, masterData = null) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,|]/);
  const colors = values.map((entry) => String(entry).trim()).filter(Boolean);
  if (!colors.length) throw new Error("DIAMOND_COLOR_REQUIRED");
  const allowed = valuesFor(masterData, "DIAMOND_COLOR", DIAMOND_COLORS);
  if (colors.some((entry) => !allowed.includes(entry))) throw new Error("DIAMOND_COLOR_INVALID");
  return [...new Set(colors)];
}

function requireKarat(value) {
  const karat = decimal(value, "KARAT", { required: true, min: 0 });
  if (!karat.isInteger() || !KARATS.includes(karat.toNumber())) throw new Error("DIAMOND_KARAT_UNSUPPORTED");
  return karat;
}

function normalizeCertificate(input, masterData = null) {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("DIAMOND_CERTIFICATE_INVALID");
  const number = text(input.certificateNumber ?? input.number, "CERTIFICATE_NUMBER");
  const authority = text(input.authority ?? input.issuer ?? input.certificateAuthority, "CERTIFICATE_AUTHORITY");
  if (number && !authority) throw new Error("DIAMOND_CERTIFICATE_AUTHORITY_REQUIRED");
  const authorities = valuesFor(masterData, "CERTIFICATE_AUTHORITY", []);
  if (authority && authorities.length && !authorities.includes(authority)) throw new Error("DIAMOND_CERTIFICATE_AUTHORITY_INVALID");
  return number ? Object.freeze({ certificateNumber: number, authority, issuerId: text(input.issuerId ?? input.certificateAuthorityId, "CERTIFICATE_AUTHORITY_ID"), issueDate: text(input.issueDate, "CERTIFICATE_ISSUE_DATE"), url: text(input.url, "CERTIFICATE_URL", { maxLength: 500 }) }) : null;
}

function normalizeComponents(input, { masterData = null } = {}) {
  if (!Array.isArray(input) || input.length < 1) throw new Error("DIAMOND_COMPONENTS_REQUIRED");
  const components = input.map((component, index) => {
    if (!component || typeof component !== "object" || Array.isArray(component)) throw new Error(`DIAMOND_COMPONENT_${index + 1}_INVALID`);
    const carat = decimal(component.stoneCaratWeight ?? component.componentCarat ?? component.carat, "STONE_CARAT_WEIGHT", { required: true, min: "0.00000001" });
    const diamondType = normalizeDiamondType(component.diamondType ?? component.componentType, masterData);
    const treatment = oneOf(component.treatment ?? component.treatmentType, "TREATMENT", valuesFor(masterData, "DIAMOND_TREATMENT", TREATMENTS));
    const treatmentDescription = text(component.treatmentDescription, "TREATMENT_DESCRIPTION");
    if (treatment === "Other" && !treatmentDescription) throw new Error("DIAMOND_TREATMENT_DESCRIPTION_REQUIRED");
    const colors = normalizeColors(component.color ?? component.stoneColor, masterData);
    const originValues = valuesFor(masterData, "DIAMOND_ORIGIN", []);
    const positionValues = valuesFor(masterData, "DIAMOND_POSITION", []);
    const settingValues = valuesFor(masterData, "DIAMOND_SETTING", []);
    const origin = originValues.length ? oneOf(component.origin, "ORIGIN", originValues) : text(component.origin, "ORIGIN");
    const position = positionValues.length ? oneOf(component.position, "POSITION", positionValues) : text(component.position, "POSITION");
    const setting = settingValues.length ? oneOf(component.setting, "SETTING", settingValues) : text(component.setting, "SETTING");
    if (origin === "Other" && !text(component.originDescription, "ORIGIN_DESCRIPTION")) throw new Error("DIAMOND_ORIGIN_DESCRIPTION_REQUIRED");
    if (position === "Other" && !text(component.positionDescription, "POSITION_DESCRIPTION")) throw new Error("DIAMOND_POSITION_DESCRIPTION_REQUIRED");
    if ((setting === "Other" || setting === "Other Setting") && !text(component.settingDescription, "SETTING_DESCRIPTION")) throw new Error("DIAMOND_SETTING_DESCRIPTION_REQUIRED");
    const certificate = normalizeCertificate(component.certificate, masterData);
    const stoneCost = decimal(component.stoneCost ?? component.purchaseCost ?? component.cost, "STONE_COST", { min: 0 });
    const stoneName = oneOf(component.stoneName ?? component.name ?? "Diamond", "STONE_NAME", valuesFor(masterData, "STONE_NAME", STONE_NAMES), { required: true });
    const clarity = oneOf(component.clarity, "CLARITY", valuesFor(masterData, "DIAMOND_CLARITY", CLARITIES), { required: true });
    const shape = oneOf(component.shape ?? component.stoneShape, "SHAPE", valuesFor(masterData, "DIAMOND_SHAPE", SHAPES), { required: true });
    const cut = oneOf(component.cut, "CUT", valuesFor(masterData, "DIAMOND_CUT", CUTS));
    const toneValues = valuesFor(masterData, "DIAMOND_TONE", []);
    const toneLevelValues = valuesFor(masterData, "DIAMOND_TONE_LEVEL", TONE_LEVELS);
    const saturationValues = valuesFor(masterData, "DIAMOND_SATURATION", SATURATIONS);
    const tone = toneValues.length ? oneOf(component.tone, "TONE", toneValues) : text(component.tone, "TONE");
    const toneLevel = oneOf(component.toneLevel, "TONE_LEVEL", toneLevelValues);
    const saturation = oneOf(component.saturation, "SATURATION", saturationValues);
    return Object.freeze({
      ...component,
      sequence: index,
      role: "EMBEDDED",
      componentKind: "DIAMOND",
      componentCount: 1,
      name: stoneName,
      componentCarat: fixed(carat),
      stoneCaratWeight: fixed(carat),
      componentWeight: fixed(carat.times(CARAT_TO_GRAMS)),
      measurementUnit: "CT",
      componentType: diamondType,
      diamondType,
      color: colors.join(", "),
      colors,
      clarity,
      shape,
      treatment,
      treatmentDescription,
      tone,
      toneLevel,
      saturation,
      cut,
      origin,
      originDescription: text(component.originDescription, "ORIGIN_DESCRIPTION"),
      position,
      positionDescription: text(component.positionDescription, "POSITION_DESCRIPTION"),
      setting,
      settingDescription: text(component.settingDescription, "SETTING_DESCRIPTION"),
      certificate,
      certificateId: component.certificateId || null,
      purchaseCost: stoneCost === null ? null : fixed(stoneCost),
      currentValue: component.currentValue === undefined || component.currentValue === null || component.currentValue === "" ? null : fixed(decimal(component.currentValue, "CURRENT_DIAMOND_VALUE", { min: 0 })),
      notes: text(component.notes, "COMPONENT_NOTES"),
      diamondDetails: Object.freeze({ treatment, color: colors.join(", "), tone, toneLevel, saturation, clarity, cut, shape, origin, originDescription: text(component.originDescription, "ORIGIN_DESCRIPTION"), position, positionDescription: text(component.positionDescription, "POSITION_DESCRIPTION"), setting, settingDescription: text(component.settingDescription, "SETTING_DESCRIPTION") }),
    });
  });
  return components;
}

function normalizePiece(input = {}, { masterData = null, requireSalePrice = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("DIAMOND_INPUT_INVALID");
  const resolvedIdentity = resolveItemCode(input.description ?? input.name, input.itemCode);
  const description = resolvedIdentity.description;
  const itemCode = resolvedIdentity.itemCode;
  const gross = decimal(input.grossWeight, "GROSS_WEIGHT", { required: true, min: "0.00000001" });
  const karat = requireKarat(input.karat);
  const components = normalizeComponents(input.components, { masterData });
  const totalCarat = components.reduce((sum, component) => sum.plus(component.componentCarat), new Decimal(0));
  const declaredCarat = decimal(input.totalDiamondWeight ?? input.totalDiamondCarat, "TOTAL_DIAMOND_WEIGHT", { required: true, min: 0 });
  if (!totalCarat.eq(declaredCarat)) throw new Error("DIAMOND_COMPONENT_CARAT_TOTAL_MISMATCH");
  const stoneWeightGrams = declaredCarat.times(CARAT_TO_GRAMS);
  const override = input.netGoldWeightOverride ?? input.finalNetGoldWeight ?? input.netGoldWeight;
  const net = override === undefined || override === null || override === "" ? gross.minus(stoneWeightGrams) : decimal(override, "NET_GOLD_WEIGHT", { min: 0 });
  if (net.lt(0) || net.gt(gross)) throw new Error("DIAMOND_NET_GOLD_WEIGHT_INVALID");
  const componentCost = components.reduce((sum, component) => sum.plus(component.purchaseCost || 0), new Decimal(0));
  const salePrice = decimal(input.salePrice ?? input.pieceSellingPrice, "SALE_PRICE", { required: requireSalePrice, min: "0.00000001" });
  return Object.freeze({
    ...input,
    profile: PROFILE,
    inventoryProfile: PROFILE,
    description,
    name: description,
    itemCode,
    grossWeight: fixed(gross),
    totalDiamondWeight: fixed(declaredCarat),
    stoneWeight: fixed(stoneWeightGrams),
    netGoldWeight: fixed(net),
    karat: karat.toNumber(),
    pureGoldWeight9999: fixed(net.times(karat).div(24)),
    components,
    componentCost: fixed(componentCost),
    certificate: normalizeCertificate(input.certificate, masterData),
    salePrice: salePrice === null ? null : fixed(salePrice),
  });
}

function taxFor({ taxTreatment, taxPolicy, taxContext, base }) {
  if (!taxTreatment) throw new Error("DIAMOND_TAX_TREATMENT_REQUIRED");
  return transactionTaxContext.resolveTransactionTaxContext({ requestedTaxTreatment: taxTreatment, companyPolicy: taxPolicy || {}, rcmContext: taxContext || {}, taxableBase: fixed(base), roundingScale: SCALE });
}

async function calculatePreview({ companyId, input = {}, settings = {}, taxPolicy = {}, masterData = null }) {
  const piece = normalizePiece(input, { masterData });
  const historicalRate = decimal(input.goldPurchasePrice ?? input.purchaseGoldRate, "GOLD_PURCHASE_PRICE", { required: true, min: "0.00000001" });
  const makingPerGram = decimal(input.makingPerGram, "MAKING_PER_GRAM", { min: 0 }) || new Decimal(0);
  const currentMakingPerGram = decimal(input.currentMakingPerGram, "CURRENT_MAKING_PER_GRAM", { min: 0 }) || makingPerGram;
  const currentRate = await goldCenterReferencePriceService.getGlobalRateForGoldByPiece(companyId, CURRENCY, piece.karat);
  const currentDiamondValue = decimal(input.currentDiamondValue, "CURRENT_DIAMOND_VALUE", { min: 0 }) || new Decimal(piece.componentCost);
  const historicalGoldValue = historicalRate.times(piece.netGoldWeight);
  const historicalMakingTotal = makingPerGram.times(piece.netGoldWeight);
  const historicalBase = historicalGoldValue.plus(historicalMakingTotal).plus(piece.componentCost);
  const currentGoldValue = new Decimal(currentRate.rate).times(piece.netGoldWeight);
  const currentMakingValue = currentMakingPerGram.times(piece.netGoldWeight);
  const currentBase = currentGoldValue.plus(currentMakingValue).plus(currentDiamondValue);
  const purchaseTax = taxFor({ taxTreatment: input.taxTreatment, taxPolicy, taxContext: input.taxContext, base: historicalBase });
  const currentTax = taxFor({ taxTreatment: input.taxTreatment, taxPolicy, taxContext: input.taxContext, base: currentBase });
  const salePrice = decimal(input.salePrice ?? input.pieceSellingPrice, "SALE_PRICE", { min: "0.00000001" });
  const currentTotal = currentBase.plus(currentTax.vatAmount);
  const sale = salePrice === null ? null : Object.freeze({ salePrice: fixed(salePrice), minimumAllowedPrice: fixed(currentTotal), expectedProfit: fixed(salePrice.minus(currentTotal)), profitMarginPercent: fixed(salePrice.isZero() ? 0 : salePrice.minus(currentTotal).div(salePrice).times(100)), markupPercent: input.markupPercent === undefined || input.markupPercent === null || input.markupPercent === "" ? null : fixed(decimal(input.markupPercent, "MARKUP_PERCENT", { min: 0 })), priceAccepted: salePrice.gte(currentTotal) });
  return Object.freeze({
    profile: PROFILE,
    piece,
    gold: { currency: CURRENCY, unit: GOLD_UNIT, karat: piece.karat, currentRate: fixed(currentRate.rate), currentRateType: "GLOBAL", source: currentRate.snapshot.provider || currentRate.snapshot.source, snapshot: currentRate.snapshot },
    weights: { grossWeight: piece.grossWeight, totalDiamondWeight: piece.totalDiamondWeight, stoneWeightGrams: piece.stoneWeight, netGoldWeight: piece.netGoldWeight, pureGoldWeight9999: piece.pureGoldWeight9999, karat: piece.karat, caratToGrams: "0.20" },
    historicalPurchase: { goldPurchasePrice: fixed(historicalRate), goldValue: fixed(historicalGoldValue), makingPerGram: fixed(makingPerGram), makingTotal: fixed(historicalMakingTotal), diamondCost: piece.componentCost, taxableBase: fixed(historicalBase), purchaseBasePreTax: fixed(historicalBase), historicalPurchaseBasePreTax: fixed(historicalBase), vatRate: String(purchaseTax.effectiveVatRate), vatAmount: fixed(purchaseTax.vatAmount), totalPurchaseCost: fixed(historicalBase.plus(purchaseTax.vatAmount)), purchaseTotalTaxInclusive: fixed(historicalBase.plus(purchaseTax.vatAmount)), historicalPurchaseTotalTaxInclusive: fixed(historicalBase.plus(purchaseTax.vatAmount)), taxTreatment: purchaseTax.resolvedTaxTreatment, taxSnapshot: purchaseTax },
    currentCost: { goldValue: fixed(currentGoldValue), makingPerGram: fixed(currentMakingPerGram), makingValue: fixed(currentMakingValue), diamondValue: fixed(currentDiamondValue), taxableBase: fixed(currentBase), currentValuationBasePreTax: fixed(currentBase), vatRate: String(currentTax.effectiveVatRate), vatAmount: fixed(currentTax.vatAmount), totalCurrentCost: fixed(currentTotal), currentValuationTotalTaxInclusive: fixed(currentTotal), taxTreatment: currentTax.resolvedTaxTreatment, taxSnapshot: currentTax },
    sale,
    readiness: { finalReceive: "NOT_RUN_IN_THIS_CONTROL", salePriceRequiredForFinalSave: salePrice === null, salePriceAccepted: salePrice !== null && salePrice.gte(currentTotal) },
  });
}

function contract({ masters = [], suppliers = [], locations = [], taxPolicy = null, gold = null, barcode = null } = {}) {
  const masterData = masterIndex(masters);
  return Object.freeze({
    profile: PROFILE, karats: KARATS, itemCodes: ITEM_CODES,
    itemDescriptions: ITEM_DESCRIPTIONS.map((label) => ({ value: label, itemCode: ITEM_DESCRIPTION_MAP[label], labelEn: label, labelAr: label })),
    diamondTypes: masterData.DIAMOND_TYPE.length ? masterData.DIAMOND_TYPE : DIAMOND_TYPES,
    diamondColors: masterData.DIAMOND_COLOR.length ? masterData.DIAMOND_COLOR : DIAMOND_COLORS,
    clarities: masterData.DIAMOND_CLARITY.length ? masterData.DIAMOND_CLARITY : CLARITIES,
    cuts: masterData.DIAMOND_CUT.length ? masterData.DIAMOND_CUT : CUTS,
    shapes: masterData.DIAMOND_SHAPE.length ? masterData.DIAMOND_SHAPE : SHAPES,
    treatments: masterData.DIAMOND_TREATMENT.length ? masterData.DIAMOND_TREATMENT : TREATMENTS,
    masterOptions: { ...masterData, STONE_NAME: STONE_NAMES },
    masters, suppliers, locations, taxPolicy, gold, barcode,
    authority: { physicalInventory: "ASSET", quantityAuthority: "NOT_ALLOWED", barcode: "ASSET_BARCODE_DD", receive: "SUPPLIER_V2_CANONICAL", finalReceiveInThisControl: "NOT_RUN" },
  });
}

module.exports = { PROFILE, CURRENCY, GOLD_UNIT, CARAT_TO_GRAMS: "0.20", SCALE, KARATS, ITEM_CODES, ITEM_DESCRIPTIONS, ITEM_DESCRIPTION_MAP, DIAMOND_TYPES, DIAMOND_COLORS, CLARITIES, CUTS, SHAPES, TREATMENTS, TONE_LEVELS, SATURATIONS, fixed, masterIndex, resolveItemDescription, resolveItemCode, toValidationError, normalizeCertificate, normalizeComponents, normalizePiece, calculatePreview, contract };
