"use strict";

const Decimal = require("decimal.js");
const { AppError } = require("../utils/errors");
const { SUPPORTED_TAX_TREATMENTS } = require("./uae-tax-engine.service");

const TAX_LAW_RULE_VERSION = "UAE-VATP043-2025-02-26";
const TAX_LAW_EFFECTIVE_DATE = "2025-02-26";
const TAX_CALCULATION_VERSION = "DARFUS-UAE-TAX-03B-G2A2-V1";

const RCM_REASON_CODES = Object.freeze({
  COMPANY_RCM_DISABLED: "COMPANY_RCM_DISABLED",
  RECIPIENT_NOT_VAT_REGISTERED: "RECIPIENT_NOT_VAT_REGISTERED",
  SUPPLIER_VAT_NOT_VERIFIED: "SUPPLIER_VAT_NOT_VERIFIED",
  RESALE_OR_PRODUCTION_INTENT_MISSING: "RESALE_OR_PRODUCTION_INTENT_MISSING",
  RECIPIENT_DECLARATION_MISSING: "RECIPIENT_DECLARATION_MISSING",
  SUPPLIER_EVIDENCE_NOT_RETAINED: "SUPPLIER_EVIDENCE_NOT_RETAINED",
  PRECIOUS_GOODS_CATEGORY_NOT_ELIGIBLE: "PRECIOUS_GOODS_CATEGORY_NOT_ELIGIBLE",
  PRECIOUS_COMPONENT_DOMINANCE_NOT_PROVEN: "PRECIOUS_COMPONENT_DOMINANCE_NOT_PROVEN",
  ZERO_RATED_ARTICLE_45_EXCLUSION: "ZERO_RATED_ARTICLE_45_EXCLUSION",
  SUPPLY_STRUCTURE_NOT_ELIGIBLE: "SUPPLY_STRUCTURE_NOT_ELIGIBLE",
});

function taxError(message, code = "TRANSACTION_TAX_INVALID", field = null) {
  return new AppError(message, 422, code, field ? { [field]: message } : null);
}

function normalizeTreatment(value) {
  const treatment = String(value || "").trim().toUpperCase();
  if (!SUPPORTED_TAX_TREATMENTS.includes(treatment)) {
    throw taxError("Tax treatment is unsupported.", "TAX_TREATMENT_UNSUPPORTED", "taxTreatment");
  }
  return treatment;
}

function assertTreatmentEnabled(treatment, companyPolicy = {}) {
  const enabled = companyPolicy.enabledTaxTreatments;
  if (!Array.isArray(enabled) || !enabled.includes(treatment)) {
    throw taxError("Tax treatment is not enabled by the company policy.", "TAX_TREATMENT_NOT_ENABLED", "taxTreatment");
  }
}

function decimalOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const result = new Decimal(String(value));
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}

function checkBoolean(context, key) {
  return context[key] === true;
}

function assessRcmEligibility({ companyPolicy = {}, context = {} } = {}) {
  const checks = {
    companyRcmEnabled: companyPolicy.preciousGoodsRcmEnabled === true,
    supplierVatRegistrationVerified: checkBoolean(context, "supplierVatRegistrationVerified"),
    recipientVatRegistered: companyPolicy.vatRegistered === true,
    intendedForResaleOrProduction: checkBoolean(context, "intendedForResaleOrProduction"),
    requiredRecipientDeclarationObtained: checkBoolean(context, "requiredRecipientDeclarationObtained"),
    supplierRetainedRequiredEvidence: checkBoolean(context, "supplierRetainedRequiredEvidence"),
    zeroRatedArticle45Excluded: context.zeroRatedArticle45Excluded === true || context.article45ZeroRatedEligible === true,
    preciousGoodsCategoryEligible: checkBoolean(context, "preciousGoodsCategoryEligible"),
    preciousComponentValueDominanceSatisfied: false,
    supplyStructureEligible: checkBoolean(context, "supplyStructureEligible"),
  };

  const dominanceRequired = context.preciousComponentValueDominanceRequired === true
    || String(context.supplyKind || "").trim().toUpperCase() === "JEWELLERY";
  checks.preciousComponentValueDominanceRequired = dominanceRequired;
  const precious = decimalOrNull(context.preciousComponentValue);
  const other = decimalOrNull(context.otherComponentValue);
  checks.preciousComponentValueDominanceSatisfied = !dominanceRequired
    || (precious !== null && other !== null && precious.gt(other));

  const reasonCodes = [];
  if (!checks.companyRcmEnabled) reasonCodes.push(RCM_REASON_CODES.COMPANY_RCM_DISABLED);
  if (!checks.recipientVatRegistered) reasonCodes.push(RCM_REASON_CODES.RECIPIENT_NOT_VAT_REGISTERED);
  if (!checks.supplierVatRegistrationVerified) reasonCodes.push(RCM_REASON_CODES.SUPPLIER_VAT_NOT_VERIFIED);
  if (!checks.intendedForResaleOrProduction) reasonCodes.push(RCM_REASON_CODES.RESALE_OR_PRODUCTION_INTENT_MISSING);
  if (!checks.requiredRecipientDeclarationObtained) reasonCodes.push(RCM_REASON_CODES.RECIPIENT_DECLARATION_MISSING);
  if (!checks.supplierRetainedRequiredEvidence) reasonCodes.push(RCM_REASON_CODES.SUPPLIER_EVIDENCE_NOT_RETAINED);
  if (!checks.preciousGoodsCategoryEligible) reasonCodes.push(RCM_REASON_CODES.PRECIOUS_GOODS_CATEGORY_NOT_ELIGIBLE);
  if (!checks.preciousComponentValueDominanceSatisfied) reasonCodes.push(RCM_REASON_CODES.PRECIOUS_COMPONENT_DOMINANCE_NOT_PROVEN);
  if (checks.zeroRatedArticle45Excluded) reasonCodes.push(RCM_REASON_CODES.ZERO_RATED_ARTICLE_45_EXCLUSION);
  if (!checks.supplyStructureEligible) reasonCodes.push(RCM_REASON_CODES.SUPPLY_STRUCTURE_NOT_ELIGIBLE);

  return {
    eligible: reasonCodes.length === 0,
    reasonCodes,
    checks,
    ruleVersion: TAX_LAW_RULE_VERSION,
    effectiveRuleDate: TAX_LAW_EFFECTIVE_DATE,
  };
}

function resolveTransactionTaxContext({ requestedTaxTreatment, companyPolicy = {}, rcmContext = {}, taxableBase = 0, vatAmount = 0, roundingScale = 2 } = {}) {
  const treatment = normalizeTreatment(requestedTaxTreatment);
  assertTreatmentEnabled(treatment, companyPolicy);

  if (treatment === "STANDARD_VAT" && companyPolicy.vatRegistered !== true) {
    throw taxError("STANDARD_VAT requires a VAT-registered company.", "RECIPIENT_NOT_VAT_REGISTERED", "taxTreatment");
  }
  const rcmEligibility = treatment === "REVERSE_CHARGE"
    ? assessRcmEligibility({ companyPolicy, context: rcmContext })
    : { eligible: false, reasonCodes: ["NOT_REQUESTED"], checks: {}, ruleVersion: TAX_LAW_RULE_VERSION, effectiveRuleDate: TAX_LAW_EFFECTIVE_DATE };
  if (treatment === "REVERSE_CHARGE" && !rcmEligibility.eligible) {
    throw taxError("Reverse charge legal eligibility could not be proven.", "RCM_NOT_ELIGIBLE", "taxTreatment");
  }

  const configuredRate = decimalOrNull(companyPolicy.vatRate);
  const effectiveVatRate = treatment === "STANDARD_VAT" || treatment === "REVERSE_CHARGE"
    ? (configuredRate || new Decimal(0)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber()
    : 0;
  const base = decimalOrNull(taxableBase) || new Decimal(0);
  const scale = Number.isInteger(Number(roundingScale)) && Number(roundingScale) >= 0 ? Number(roundingScale) : 2;
  const amount = treatment === "STANDARD_VAT"
    ? base.times(effectiveVatRate).div(100).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toNumber()
    : treatment === "REVERSE_CHARGE"
      ? base.times(effectiveVatRate).div(100).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toNumber()
      : 0;

  return {
    requestedTaxTreatment: treatment,
    resolvedTaxTreatment: treatment,
    effectiveVatRate,
    taxableBase: base.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toNumber(),
    vatAmount: amount,
    vatRegisteredSnapshot: companyPolicy.vatRegistered === true,
    companyVatRateSnapshot: configuredRate ? configuredRate.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber() : null,
    enabledTaxTreatmentsSnapshot: Array.isArray(companyPolicy.enabledTaxTreatments) ? [...companyPolicy.enabledTaxTreatments] : null,
    preciousGoodsRcmEnabledSnapshot: companyPolicy.preciousGoodsRcmEnabled === true,
    rcmEligibilityResult: rcmEligibility.eligible ? "ELIGIBLE" : "NOT_REQUESTED",
    rcmEligibilityChecks: rcmEligibility.checks,
    rcmReasonCodes: rcmEligibility.reasonCodes,
    taxLawRuleVersion: TAX_LAW_RULE_VERSION,
    taxLawEffectiveDate: TAX_LAW_EFFECTIVE_DATE,
    taxCalculationVersion: TAX_CALCULATION_VERSION,
    sourceVatAmount: Number(vatAmount) || 0,
    roundingScale: scale,
  };
}

function buildImmutableTaxSnapshot(args = {}) {
  const context = resolveTransactionTaxContext(args);
  const snapshot = {
    jurisdiction: "UAE",
    requestedTaxTreatment: context.requestedTaxTreatment,
    resolvedTaxTreatment: context.resolvedTaxTreatment,
    effectiveVatRate: context.effectiveVatRate,
    vatRegisteredSnapshot: context.vatRegisteredSnapshot,
    companyVatRateSnapshot: context.companyVatRateSnapshot,
    enabledTaxTreatmentsSnapshot: context.enabledTaxTreatmentsSnapshot,
    preciousGoodsRcmEnabledSnapshot: context.preciousGoodsRcmEnabledSnapshot,
    rcmEligibilityResult: context.rcmEligibilityResult,
    rcmEligibilityChecks: context.rcmEligibilityChecks,
    rcmReasonCodes: context.rcmReasonCodes,
    taxLawRuleVersion: context.taxLawRuleVersion,
    taxLawEffectiveDate: context.taxLawEffectiveDate,
    taxableBase: context.taxableBase,
    vatAmount: context.vatAmount,
    taxCalculationVersion: context.taxCalculationVersion,
    roundingScale: context.roundingScale,
    createdAt: new Date().toISOString(),
  };
  return Object.freeze(snapshot);
}

function taxTreatmentRequestedFromBody(body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, "taxTreatment")) return normalizeTreatment(body.taxTreatment);
  if (body.isRcm || body.isDRC || body.reverseVat || body.useReverseCharge) return "REVERSE_CHARGE";
  if (body.applyVat === true) return "STANDARD_VAT";
  return null;
}

function rcmContextFromBody(body = {}) {
  const source = body.taxContext && typeof body.taxContext === "object" ? body.taxContext : body;
  return {
    supplierVatRegistrationVerified: source.supplierVatRegistrationVerified,
    intendedForResaleOrProduction: source.intendedForResaleOrProduction,
    requiredRecipientDeclarationObtained: source.requiredRecipientDeclarationObtained,
    supplierRetainedRequiredEvidence: source.supplierRetainedRequiredEvidence,
    zeroRatedArticle45Excluded: source.zeroRatedArticle45Excluded,
    article45ZeroRatedEligible: source.article45ZeroRatedEligible,
    preciousGoodsCategoryEligible: source.preciousGoodsCategoryEligible,
    preciousComponentValue: source.preciousComponentValue,
    otherComponentValue: source.otherComponentValue,
    supplyStructureEligible: source.supplyStructureEligible,
    preciousComponentValueDominanceRequired: source.preciousComponentValueDominanceRequired,
    supplyKind: source.supplyKind,
  };
}

module.exports = {
  TAX_LAW_RULE_VERSION,
  TAX_LAW_EFFECTIVE_DATE,
  TAX_CALCULATION_VERSION,
  RCM_REASON_CODES,
  assessRcmEligibility,
  buildImmutableTaxSnapshot,
  normalizeTreatment,
  resolveTransactionTaxContext,
  rcmContextFromBody,
  taxTreatmentRequestedFromBody,
};
