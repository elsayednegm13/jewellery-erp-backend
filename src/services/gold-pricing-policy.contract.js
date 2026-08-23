"use strict";

const Decimal = require("decimal.js");
const { assertQuoteTypeAvailable, isQuoteFresh, QUOTE_TYPES, SUPPORTED_KARATS, QUOTE_STATUSES } = require("./gold-market-provider.contract");
const { AppError, ValidationError } = require("../utils/errors");

const BUSINESS_CONTEXT = "CGP";
const PRICING_MODES = Object.freeze({ MANUAL_APPROVED: "MANUAL_APPROVED", LIVE_PROVIDER: "LIVE_PROVIDER" });
const SCOPE_TYPES = Object.freeze({ DEFAULT: "DEFAULT", KARAT: "KARAT" });
const ADJUSTMENT_TYPES = Object.freeze({ NONE: "NONE", FIXED_PER_GRAM: "FIXED_PER_GRAM", PERCENTAGE: "PERCENTAGE" });
const POLICY_STATUSES = Object.freeze({ ACTIVE: "ACTIVE", INACTIVE: "INACTIVE", SUPERSEDED: "SUPERSEDED", EXPIRED: "EXPIRED" });
const FINAL_RATE_SCALE = 4;
const MARKET_RATE_SCALE = 8;
const ROUNDING_MODE = Decimal.ROUND_HALF_UP;

function text(value) { return String(value ?? "").trim(); }

function normalizedDecimal(value, field, { allowZero = true } = {}) {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  let decimal;
  try { decimal = new Decimal(String(value)); } catch { throw new ValidationError(`${field} is invalid`, { [field]: ["invalid"] }); }
  if (!decimal.isFinite() || (!allowZero && decimal.lte(0))) throw new ValidationError(`${field} is invalid`, { [field]: ["invalid"] });
  return decimal;
}

function normalizePolicyInput(input = {}, { now = new Date() } = {}) {
  const businessContext = text(input.businessContext || BUSINESS_CONTEXT).toUpperCase();
  if (businessContext !== BUSINESS_CONTEXT) throw new ValidationError("Only CGP pricing policies are supported", { businessContext: ["unsupported"] });

  const pricingMode = text(input.pricingMode).toUpperCase();
  if (!Object.values(PRICING_MODES).includes(pricingMode)) throw new ValidationError("pricingMode is invalid", { pricingMode: ["invalid"] });

  const scopeType = text(input.scopeType || SCOPE_TYPES.DEFAULT).toUpperCase();
  if (!Object.values(SCOPE_TYPES).includes(scopeType)) throw new ValidationError("scopeType is invalid", { scopeType: ["invalid"] });

  const karat = input.karat === null || input.karat === undefined || input.karat === "" ? null : Number(input.karat);
  if (scopeType === SCOPE_TYPES.DEFAULT && karat !== null) throw new ValidationError("Default policy cannot specify karat", { karat: ["must_be_null_for_default"] });
  if (scopeType === SCOPE_TYPES.KARAT && !SUPPORTED_KARATS.includes(karat)) throw new ValidationError("karat is unsupported", { karat: ["unsupported"] });

  const baseQuoteType = text(input.baseQuoteType).toUpperCase();
  if (!Object.values(QUOTE_TYPES).includes(baseQuoteType)) throw new ValidationError("baseQuoteType is invalid", { baseQuoteType: ["invalid"] });

  const adjustmentType = text(input.adjustmentType || ADJUSTMENT_TYPES.NONE).toUpperCase();
  if (!Object.values(ADJUSTMENT_TYPES).includes(adjustmentType)) throw new ValidationError("adjustmentType is invalid", { adjustmentType: ["invalid"] });
  const adjustmentValue = normalizedDecimal(input.adjustmentValue, "adjustmentValue");
  if (adjustmentType === ADJUSTMENT_TYPES.NONE && !adjustmentValue.isZero()) throw new ValidationError("NONE adjustment must be zero", { adjustmentValue: ["must_be_zero"] });

  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(now);
  const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
  if (Number.isNaN(effectiveFrom.getTime())) throw new ValidationError("effectiveFrom is invalid", { effectiveFrom: ["invalid"] });
  if (effectiveUntil && Number.isNaN(effectiveUntil.getTime())) throw new ValidationError("effectiveUntil is invalid", { effectiveUntil: ["invalid"] });
  if (effectiveUntil && effectiveUntil <= effectiveFrom) throw new ValidationError("effectiveUntil must be later than effectiveFrom", { effectiveUntil: ["invalid_window"] });

  return Object.freeze({
    businessContext,
    pricingMode,
    scopeType,
    karat,
    baseQuoteType,
    adjustmentType,
    adjustmentValue: adjustmentValue.toFixed(MARKET_RATE_SCALE),
    effectiveFrom,
    effectiveUntil,
  });
}

function policyScopeKey(policy) {
  return [policy.companyId, policy.businessContext, policy.scopeType, policy.karat === null || policy.karat === undefined ? "DEFAULT" : String(policy.karat)].join(":");
}

function assertQuoteUsable(quote, { currency, staleAfterSeconds = 120, now = new Date(), quoteType } = {}) {
  if (!quote || quote.status && quote.status !== QUOTE_STATUSES.VALID) throw new AppError("A valid market quote is required", 422, "GOLD_MARKET_QUOTE_INVALID");
  if (String(quote.metal || "").toUpperCase() !== "XAU") throw new AppError("Market quote metal is invalid", 422, "GOLD_MARKET_QUOTE_INVALID");
  if (String(quote.unit || "").toUpperCase() !== "PER_GRAM") throw new AppError("Market quote unit is invalid", 422, "GOLD_MARKET_QUOTE_INVALID");
  if (String(quote.currency || "").toUpperCase() !== String(currency || "").toUpperCase()) throw new AppError("Market quote currency does not match the transaction", 422, "GOLD_MARKET_QUOTE_CURRENCY_MISMATCH");
  if (!isQuoteFresh(quote, staleAfterSeconds, now)) throw new AppError("Market quote is stale", 422, "GOLD_MARKET_QUOTE_STALE");
  try { return assertQuoteTypeAvailable(quote, quoteType); } catch { throw new AppError("Required market quote type is unavailable", 422, "GOLD_MARKET_QUOTE_TYPE_UNAVAILABLE"); }
}

function calculateEffectiveRate({ quote, policy, companyId, karat, currency, now = new Date(), staleAfterSeconds = 120, marketQuoteId = null } = {}) {
  if (!policy) throw new AppError("An active CGP pricing policy is required", 422, "GOLD_PRICING_POLICY_MISSING");
  const numericKarat = Number(karat);
  if (!SUPPORTED_KARATS.includes(numericKarat)) throw new ValidationError("karat is unsupported", { karat: ["unsupported"] });
  if (companyId && policy.companyId && String(policy.companyId) !== String(companyId)) throw new AppError("Pricing policy company scope is invalid", 403, "GOLD_PRICING_COMPANY_SCOPE_INVALID");
  if (String(currency || "").toUpperCase() !== String(policy.currency || currency || "").toUpperCase() && policy.currency) throw new AppError("Pricing policy currency is invalid", 422, "GOLD_PRICING_CURRENCY_MISMATCH");

  const baseQuoteType = String(policy.baseQuoteType || "").toUpperCase();
  assertQuoteUsable(quote, { currency, staleAfterSeconds, now, quoteType: baseQuoteType });
  const directRateField = `karat${numericKarat}Rate`;
  const directRate = quote && quote[directRateField] !== undefined && quote[directRateField] !== null ? normalizedDecimal(quote[directRateField], directRateField, { allowZero: false }) : null;
  const rawBaseRate = normalizedDecimal(({ BID: quote.bid, SPOT: quote.spot, ASK: quote.ask })[baseQuoteType], "baseMarketRate", { allowZero: false });
  // GoldAPI's direct karat fields are spot-derived.  They are authoritative
  // only for SPOT policies. BID/ASK policies derive the same karat from the
  // selected fine-gold base quote so the quote semantics are never relabeled.
  const useDirectKarat = baseQuoteType === QUOTE_TYPES.SPOT && directRate;
  const selectedKaratRate = useDirectKarat ? directRate : rawBaseRate.mul(new Decimal(numericKarat).div(24));
  const adjustmentValue = normalizedDecimal(policy.adjustmentValue, "adjustmentValue");
  let effective = selectedKaratRate;
  if (policy.adjustmentType === ADJUSTMENT_TYPES.FIXED_PER_GRAM) effective = selectedKaratRate.plus(adjustmentValue);
  else if (policy.adjustmentType === ADJUSTMENT_TYPES.PERCENTAGE) effective = selectedKaratRate.mul(new Decimal(1).plus(adjustmentValue.div(100)));
  else if (policy.adjustmentType !== ADJUSTMENT_TYPES.NONE) throw new ValidationError("adjustmentType is invalid", { adjustmentType: ["invalid"] });
  if (!effective.isFinite() || effective.lte(0)) throw new AppError("Effective CGP buy rate must be positive", 422, "GOLD_PRICING_EFFECTIVE_RATE_NON_POSITIVE");
  const rounded = effective.toDecimalPlaces(FINAL_RATE_SCALE, ROUNDING_MODE).toFixed(FINAL_RATE_SCALE);
  if (new Decimal(rounded).lte(0)) throw new AppError("Effective CGP buy rate must be positive", 422, "GOLD_PRICING_EFFECTIVE_RATE_NON_POSITIVE");
  return Object.freeze({
    pricingMode: policy.pricingMode,
    businessContext: BUSINESS_CONTEXT,
    companyId: companyId || policy.companyId,
    karat: numericKarat,
    currency: String(currency).toUpperCase(),
    baseQuoteType,
    baseMarketRate: rawBaseRate.toDecimalPlaces(MARKET_RATE_SCALE, ROUNDING_MODE).toFixed(MARKET_RATE_SCALE),
    karatMarketRate: selectedKaratRate.toDecimalPlaces(MARKET_RATE_SCALE, ROUNDING_MODE).toFixed(MARKET_RATE_SCALE),
    baseRateSource: useDirectKarat ? "PROVIDER_DIRECT_KARAT_SPOT" : "DERIVED_FROM_BASE_QUOTE",
    adjustmentType: policy.adjustmentType,
    adjustmentValue: adjustmentValue.toDecimalPlaces(MARKET_RATE_SCALE, ROUNDING_MODE).toFixed(MARKET_RATE_SCALE),
    effectiveRate: rounded,
    policyId: policy.id || null,
    policyVersion: policy.version || null,
    policyScope: policy.scopeType,
    calculatedAt: new Date(now).toISOString(),
    marketQuoteId: marketQuoteId || quote?.id || null,
    provider: quote?.provider || null,
    providerQuoteId: quote?.providerQuoteId || null,
    quoteTimestamp: quote?.quoteTimestamp ? new Date(quote.quoteTimestamp).toISOString() : null,
    precision: { marketRateScale: MARKET_RATE_SCALE, adjustmentScale: MARKET_RATE_SCALE, finalRateScale: FINAL_RATE_SCALE, roundingMode: "HALF_UP", purityApplication: "NONE_IN_PRICING_ENGINE_KARAT_RATE", derivationMethod: useDirectKarat ? "PROVIDER_DIRECT_SPOT_KARAT" : "BASE_QUOTE_TIMES_KARAT_OVER_24" },
  });
}

module.exports = { BUSINESS_CONTEXT, PRICING_MODES, SCOPE_TYPES, ADJUSTMENT_TYPES, POLICY_STATUSES, FINAL_RATE_SCALE, MARKET_RATE_SCALE, ROUNDING_MODE, normalizePolicyInput, policyScopeKey, calculateEffectiveRate, assertQuoteUsable };
