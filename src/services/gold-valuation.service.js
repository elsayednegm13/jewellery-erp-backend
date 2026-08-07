"use strict";

const Decimal = require("decimal.js");

const TARGET_PROFILES = new Set(["GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K"]);
const BAR_PROFILE = "GOLD_BAR_24K";

function decimal(value, field, { required = false, min = 0 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`GOLD_VALUATION_${field}_REQUIRED`);
    return null;
  }
  let parsed;
  try { parsed = new Decimal(String(value)); } catch { throw new Error(`GOLD_VALUATION_${field}_INVALID`); }
  if (!parsed.isFinite() || parsed.lt(min)) throw new Error(`GOLD_VALUATION_${field}_INVALID`);
  return parsed;
}

function fixed(value) {
  return new Decimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

function isTargetProfile(profile) {
  return TARGET_PROFILES.has(profile);
}

async function resolveConfiguredVatRate({ models, companyId, transaction }) {
  const rows = await models.Setting.findAll({
    where: { companyId, key: ["purchaseVatRate", "vatRate"] },
    transaction,
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const configured = values.has("purchaseVatRate") ? values.get("purchaseVatRate") : values.get("vatRate");
  if (configured === undefined || configured === null || configured === "") return null;
  return fixed(decimal(configured, "SETTINGS_VAT_RATE", { required: true, min: 0 }));
}

function resolveVatRate({ requestedRate, configuredRate, required }) {
  const manual = decimal(requestedRate, "VAT_RATE", { min: 0 });
  if (manual !== null) return Object.freeze({ rate: fixed(manual), source: "MANUAL" });
  if (configuredRate !== undefined && configuredRate !== null && configuredRate !== "") {
    return Object.freeze({ rate: fixed(decimal(configuredRate, "SETTINGS_VAT_RATE", { required: true, min: 0 })), source: "SETTINGS_DEFAULT" });
  }
  if (required) throw new Error("GOLD_VALUATION_VAT_RATE_NOT_CONFIGURED");
  return Object.freeze({ rate: "0.000000", source: "NOT_APPLICABLE" });
}

function goldValue(rate, netGoldWeight) {
  return fixed(decimal(rate, "GOLD_RATE", { required: true, min: 0 }).times(decimal(netGoldWeight, "NET_GOLD_WEIGHT", { required: true, min: 0 })));
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("GOLD_VALUATION_INPUT_INVALID");
  return input;
}

function calculateReceiptGoldValuation({ profile, weights, input, configuredVatRate }) {
  if (!isTargetProfile(profile) || input === undefined || input === null) return null;
  const value = validateInput(input);
  const netGoldWeight = weights?.netGoldWeight;
  if (!netGoldWeight) throw new Error("GOLD_VALUATION_WEIGHT_FACTS_REQUIRED");

  const purchaseGoldRate = decimal(value.purchaseGoldRate, "PURCHASE_GOLD_RATE", { required: true, min: 0 });
  const currentGoldRate = decimal(value.currentGoldRate, "CURRENT_GOLD_RATE", { required: true, min: 0 });
  const purchaseGoldValue = goldValue(purchaseGoldRate, netGoldWeight);
  const currentGoldValue = goldValue(currentGoldRate, netGoldWeight);

  if (profile === BAR_PROFILE) {
    const certificateCost = decimal(value.certificateCost, "PURCHASE_CERTIFICATE_COST", { required: true, min: 0 });
    const currentCertificateCost = decimal(value.currentCertificateCost ?? value.certificateCost, "CURRENT_CERTIFICATE_COST", { required: true, min: 0 });
    const purchaseVat = resolveVatRate({ requestedRate: value.vatRate, configuredRate: configuredVatRate, required: true });
    const currentVat = resolveVatRate({ requestedRate: value.currentVatRate ?? value.vatRate, configuredRate: configuredVatRate, required: true });
    const purchaseVatBase = fixed(certificateCost);
    const currentVatBase = fixed(currentCertificateCost);
    const purchaseVatAmount = fixed(certificateCost.times(purchaseVat.rate).div(100));
    const currentVatAmount = fixed(currentCertificateCost.times(currentVat.rate).div(100));
    return Object.freeze({
      purchase: Object.freeze({
        purchaseGoldRate: fixed(purchaseGoldRate), goldRateSource: "MANUAL", goldValue: purchaseGoldValue,
        makingPerGram: null, makingTotal: null, certificateCost: fixed(certificateCost),
        vatRate: purchaseVat.rate, vatRateSource: purchaseVat.source, vatBase: purchaseVatBase, vatAmount: purchaseVatAmount,
        totalPurchaseCost: fixed(new Decimal(purchaseGoldValue).plus(certificateCost).plus(purchaseVatAmount)),
      }),
      current: Object.freeze({
        rateSource: "MANUAL", goldRate: fixed(currentGoldRate), goldValue: currentGoldValue, makingValue: null,
        certificateValue: fixed(currentCertificateCost), componentValue: null,
        vatRate: currentVat.rate, vatRateSource: currentVat.source, vatBase: currentVatBase, vatAmount: currentVatAmount,
        totalValue: fixed(new Decimal(currentGoldValue).plus(currentCertificateCost).plus(currentVatAmount)),
      }),
    });
  }

  const makingPerGram = decimal(value.makingPerGram ?? 0, "PURCHASE_MAKING_PER_GRAM", { min: 0 });
  const currentMakingPerGram = decimal(value.currentMakingPerGram ?? makingPerGram, "CURRENT_MAKING_PER_GRAM", { min: 0 });
  const makingTotal = fixed(decimal(netGoldWeight, "NET_GOLD_WEIGHT", { required: true, min: 0 }).times(makingPerGram));
  const currentMakingValue = fixed(decimal(netGoldWeight, "NET_GOLD_WEIGHT", { required: true, min: 0 }).times(currentMakingPerGram));
  const purchaseVat = resolveVatRate({ requestedRate: value.vatRate, configuredRate: null, required: false });
  const currentVat = resolveVatRate({ requestedRate: value.currentVatRate ?? value.vatRate, configuredRate: null, required: false });
  const purchaseVatBase = fixed(new Decimal(purchaseGoldValue).plus(makingTotal));
  const currentVatBase = fixed(new Decimal(currentGoldValue).plus(currentMakingValue));
  const purchaseVatAmount = fixed(new Decimal(purchaseVatBase).times(purchaseVat.rate).div(100));
  const currentVatAmount = fixed(new Decimal(currentVatBase).times(currentVat.rate).div(100));
  return Object.freeze({
    purchase: Object.freeze({
      purchaseGoldRate: fixed(purchaseGoldRate), goldRateSource: "MANUAL", goldValue: purchaseGoldValue,
      makingPerGram: fixed(makingPerGram), makingTotal, certificateCost: "0.00000000",
      vatRate: purchaseVat.rate, vatRateSource: purchaseVat.source, vatBase: purchaseVatBase, vatAmount: purchaseVatAmount,
      totalPurchaseCost: fixed(new Decimal(purchaseGoldValue).plus(makingTotal).plus(purchaseVatAmount)),
    }),
    current: Object.freeze({
      rateSource: "MANUAL", goldRate: fixed(currentGoldRate), goldValue: currentGoldValue, makingValue: currentMakingValue,
      certificateValue: "0.00000000", componentValue: null,
      vatRate: currentVat.rate, vatRateSource: currentVat.source, vatBase: currentVatBase, vatAmount: currentVatAmount,
      totalValue: fixed(new Decimal(currentGoldValue).plus(currentMakingValue).plus(currentVatAmount)),
    }),
  });
}

function calculateCurrentGoldValuation({ profile, goldDetails, input, configuredVatRate }) {
  if (!isTargetProfile(profile)) throw new Error("GOLD_VALUATION_PROFILE_UNSUPPORTED");
  const value = validateInput(input);
  const netGoldWeight = goldDetails?.net_gold_weight ?? goldDetails?.netGoldWeight;
  if (netGoldWeight === undefined || netGoldWeight === null) throw new Error("GOLD_VALUATION_WEIGHT_FACTS_REQUIRED");
  const currentGoldRate = decimal(value.currentGoldRate, "CURRENT_GOLD_RATE", { required: true, min: 0 });
  const currentGoldValue = goldValue(currentGoldRate, netGoldWeight);
  if (profile === BAR_PROFILE) {
    const currentCertificateCost = decimal(value.currentCertificateCost, "CURRENT_CERTIFICATE_COST", { required: true, min: 0 });
    const vat = resolveVatRate({ requestedRate: value.currentVatRate, configuredRate: configuredVatRate, required: true });
    const vatBase = fixed(currentCertificateCost);
    const vatAmount = fixed(currentCertificateCost.times(vat.rate).div(100));
    return Object.freeze({ rateSource: "MANUAL", goldRate: fixed(currentGoldRate), goldValue: currentGoldValue, makingValue: null, certificateValue: fixed(currentCertificateCost), componentValue: null, vatRate: vat.rate, vatRateSource: vat.source, vatBase, vatAmount, totalValue: fixed(new Decimal(currentGoldValue).plus(currentCertificateCost).plus(vatAmount)) });
  }
  const currentMakingPerGram = decimal(value.currentMakingPerGram ?? 0, "CURRENT_MAKING_PER_GRAM", { min: 0 });
  const makingValue = fixed(decimal(netGoldWeight, "NET_GOLD_WEIGHT", { required: true, min: 0 }).times(currentMakingPerGram));
  const vat = resolveVatRate({ requestedRate: value.currentVatRate, configuredRate: null, required: false });
  const vatBase = fixed(new Decimal(currentGoldValue).plus(makingValue));
  const vatAmount = fixed(new Decimal(vatBase).times(vat.rate).div(100));
  return Object.freeze({ rateSource: "MANUAL", goldRate: fixed(currentGoldRate), goldValue: currentGoldValue, makingValue, certificateValue: "0.00000000", componentValue: null, vatRate: vat.rate, vatRateSource: vat.source, vatBase, vatAmount, totalValue: fixed(new Decimal(currentGoldValue).plus(makingValue).plus(vatAmount)) });
}

module.exports = { TARGET_PROFILES, isTargetProfile, resolveConfiguredVatRate, calculateReceiptGoldValuation, calculateCurrentGoldValuation };
