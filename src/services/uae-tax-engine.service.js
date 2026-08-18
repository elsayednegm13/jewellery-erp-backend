"use strict";

const SUPPORTED_TAX_TREATMENTS = Object.freeze([
  "STANDARD_VAT",
  "ZERO_RATED",
  "REVERSE_CHARGE",
  "EXEMPT",
  "OUT_OF_SCOPE",
]);

const JURISDICTION = "UAE";
const LEGAL_STANDARD_VAT_RATE = 5;

function policyError(message, field, code) {
  const error = new Error(message);
  error.statusCode = 422;
  error.errorCode = code;
  error.field = field;
  return error;
}

function validateConfiguredVatRateAgainstCurrentUaeRule(rate) {
  if (rate === null || rate === undefined) return null;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw policyError("vatRate must be a finite number between 0 and 100.", "vatRate", "UAE_VAT_RATE_INVALID");
  }
  return rate;
}

function validateTaxTreatmentList(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw policyError("enabledTaxTreatments must be an array.", "enabledTaxTreatments", "TAX_TREATMENTS_ARRAY_REQUIRED");
  if (new Set(value).size !== value.length) throw policyError("enabledTaxTreatments must contain unique values.", "enabledTaxTreatments", "TAX_TREATMENTS_DUPLICATE");
  for (const treatment of value) {
    if (typeof treatment !== "string" || !SUPPORTED_TAX_TREATMENTS.includes(treatment)) {
      throw policyError("enabledTaxTreatments contains an unsupported treatment.", "enabledTaxTreatments", "TAX_TREATMENT_UNSUPPORTED");
    }
  }
  return value;
}

function validateCompanyTaxPolicy(policy = {}) {
  if (policy.vatRegistered !== undefined && policy.vatRegistered !== null && typeof policy.vatRegistered !== "boolean") {
    throw policyError("vatRegistered must be a boolean or null.", "vatRegistered", "VAT_REGISTERED_BOOLEAN_REQUIRED");
  }
  validateConfiguredVatRateAgainstCurrentUaeRule(policy.vatRate);
  const enabled = validateTaxTreatmentList(policy.enabledTaxTreatments);
  if (policy.defaultTaxTreatment !== undefined && policy.defaultTaxTreatment !== null) {
    if (!SUPPORTED_TAX_TREATMENTS.includes(policy.defaultTaxTreatment)) {
      throw policyError("defaultTaxTreatment is unsupported.", "defaultTaxTreatment", "DEFAULT_TAX_TREATMENT_UNSUPPORTED");
    }
    if (!enabled || !enabled.includes(policy.defaultTaxTreatment)) {
      throw policyError("defaultTaxTreatment must be enabled.", "defaultTaxTreatment", "DEFAULT_TAX_TREATMENT_NOT_ENABLED");
    }
  }
  if (policy.preciousGoodsRcmEnabled !== undefined && policy.preciousGoodsRcmEnabled !== null && typeof policy.preciousGoodsRcmEnabled !== "boolean") {
    throw policyError("preciousGoodsRcmEnabled must be a boolean or null.", "preciousGoodsRcmEnabled", "RCM_CAPABILITY_BOOLEAN_REQUIRED");
  }
  if (policy.vatEnabled !== undefined && policy.vatEnabled !== null && typeof policy.vatEnabled !== "boolean") {
    throw policyError("vatEnabled must be a boolean or null.", "vatEnabled", "VAT_ENABLED_BOOLEAN_REQUIRED");
  }
  return true;
}

function getSupportedTaxTreatments() {
  return [...SUPPORTED_TAX_TREATMENTS];
}

function getUaeTaxEngineMetadata() {
  return {
    jurisdiction: JURISDICTION,
    supportedTaxTreatments: getSupportedTaxTreatments(),
    legalStandardVatRate: LEGAL_STANDARD_VAT_RATE,
    transactionLegalEligibilityImplemented: true,
  };
}

module.exports = {
  JURISDICTION,
  LEGAL_STANDARD_VAT_RATE,
  SUPPORTED_TAX_TREATMENTS,
  getSupportedTaxTreatments,
  getUaeTaxEngineMetadata,
  validateConfiguredVatRateAgainstCurrentUaeRule,
  validateCompanyTaxPolicy,
};
