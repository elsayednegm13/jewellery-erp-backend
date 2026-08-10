"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRICING_MODES,
  SCOPE_TYPES,
  ADJUSTMENT_TYPES,
  normalizePolicyInput,
  calculateEffectiveRate,
} = require("../src/services/gold-pricing-policy.contract");

const now = new Date("2026-08-10T12:00:00.000Z");
const quote = Object.freeze({
  id: "QUOTE-1",
  provider: "GOLDAPI_IO",
  metal: "XAU",
  currency: "AED",
  unit: "PER_GRAM",
  status: "VALID",
  quoteTimestamp: new Date("2026-08-10T11:59:30.000Z"),
  receivedAt: new Date("2026-08-10T11:59:31.000Z"),
  bid: "300.12345678",
  spot: "301.12345678",
  ask: "302.12345678",
  karat18Rate: "225.09259259",
  karat21Rate: "262.60763889",
  karat22Rate: "275.33333333",
  karat24Rate: "300.12345678",
});

function policy(overrides = {}) {
  return {
    companyId: "COMPANY-1",
    businessContext: "CGP",
    pricingMode: PRICING_MODES.LIVE_PROVIDER,
    scopeType: SCOPE_TYPES.DEFAULT,
    baseQuoteType: "BID",
    adjustmentType: ADJUSTMENT_TYPES.NONE,
    adjustmentValue: "0",
    version: 1,
    status: "ACTIVE",
    effectiveFrom: new Date("2026-08-10T00:00:00.000Z"),
    effectiveUntil: null,
    ...overrides,
  };
}

test("policy input accepts only frozen CGP modes, scopes and controlled adjustments", () => {
  const normalized = normalizePolicyInput({ pricingMode: "LIVE_PROVIDER", scopeType: "KARAT", karat: 22, baseQuoteType: "BID", adjustmentType: "PERCENTAGE", adjustmentValue: "-0.50000001" }, { now });
  assert.equal(normalized.businessContext, "CGP");
  assert.equal(normalized.adjustmentValue, "-0.50000001");
  assert.throws(() => normalizePolicyInput({ pricingMode: "LIVE_PROVIDER", scopeType: "DEFAULT", karat: 22, baseQuoteType: "BID" }, { now }), (error) => error.fieldErrors?.karat?.[0] === "must_be_null_for_default");
  assert.throws(() => normalizePolicyInput({ pricingMode: "LIVE_PROVIDER", scopeType: "KARAT", karat: 20, baseQuoteType: "BID" }, { now }), (error) => error.fieldErrors?.karat?.[0] === "unsupported");
});

test("NONE, fixed negative/positive and percentage negative/positive calculations are Decimal and HALF_UP", () => {
  assert.equal(calculateEffectiveRate({ quote, policy: policy(), companyId: "COMPANY-1", karat: 24, currency: "AED", now }).effectiveRate, "300.1235");
  assert.equal(calculateEffectiveRate({ quote, policy: policy({ adjustmentType: "FIXED_PER_GRAM", adjustmentValue: "-2" }), companyId: "COMPANY-1", karat: 24, currency: "AED", now }).effectiveRate, "298.1235");
  assert.equal(calculateEffectiveRate({ quote, policy: policy({ adjustmentType: "FIXED_PER_GRAM", adjustmentValue: "2" }), companyId: "COMPANY-1", karat: 24, currency: "AED", now }).effectiveRate, "302.1235");
  assert.equal(calculateEffectiveRate({ quote, policy: policy({ adjustmentType: "PERCENTAGE", adjustmentValue: "-0.5" }), companyId: "COMPANY-1", karat: 24, currency: "AED", now }).effectiveRate, "298.6228");
  assert.equal(calculateEffectiveRate({ quote, policy: policy({ adjustmentType: "PERCENTAGE", adjustmentValue: "0.5" }), companyId: "COMPANY-1", karat: 24, currency: "AED", now }).effectiveRate, "301.6241");
});

test("direct provider karat rates are used once without a second purity multiplication", () => {
  const result = calculateEffectiveRate({ quote, policy: policy({ baseQuoteType: "SPOT" }), companyId: "COMPANY-1", karat: 22, currency: "AED", now });
  assert.equal(result.baseRateSource, "PROVIDER_DIRECT_KARAT");
  assert.equal(result.baseMarketRate, "275.33333333");
  assert.equal(result.effectiveRate, "275.3333");
  assert.equal(result.precision.purityApplication, "NONE_IN_PRICING_ENGINE_KARAT_RATE");
});

test("quote type, freshness, currency, karat and effective-rate gates fail closed", () => {
  assert.throws(() => calculateEffectiveRate({ quote: { ...quote, bid: null }, policy: policy(), companyId: "COMPANY-1", karat: 24, currency: "AED", now }), (error) => error.errorCode === "GOLD_PRICING_QUOTE_TYPE_REQUIRED");
  assert.throws(() => calculateEffectiveRate({ quote: { ...quote, quoteTimestamp: new Date("2026-08-10T11:50:00.000Z") }, policy: policy(), companyId: "COMPANY-1", karat: 24, currency: "AED", now }), (error) => error.errorCode === "GOLD_PRICING_QUOTE_STALE");
  assert.throws(() => calculateEffectiveRate({ quote, policy: policy(), companyId: "COMPANY-1", karat: 24, currency: "USD", now }), (error) => error.errorCode === "GOLD_PRICING_CURRENCY_MISMATCH");
  assert.throws(() => calculateEffectiveRate({ quote, policy: policy(), companyId: "COMPANY-1", karat: 20, currency: "AED", now }), (error) => error.fieldErrors?.karat?.[0] === "unsupported");
  assert.throws(() => calculateEffectiveRate({ quote: { ...quote, bid: "0", karat24Rate: "0" }, policy: policy(), companyId: "COMPANY-1", karat: 24, currency: "AED", now }), (error) => ["GOLD_PRICING_QUOTE_TYPE_REQUIRED", "GOLD_PRICING_EFFECTIVE_RATE_NON_POSITIVE"].includes(error.errorCode));
});

test("company scope and lineage are explicit", () => {
  assert.throws(() => calculateEffectiveRate({ quote, policy: policy(), companyId: "COMPANY-2", karat: 24, currency: "AED", now }), (error) => error.errorCode === "GOLD_PRICING_COMPANY_SCOPE_INVALID");
  const result = calculateEffectiveRate({ quote, policy: policy({ adjustmentType: "FIXED_PER_GRAM", adjustmentValue: "-2", version: 7 }), companyId: "COMPANY-1", karat: 24, currency: "AED", now, marketQuoteId: "QUOTE-1" });
  assert.deepEqual({ policyId: result.policyId, policyVersion: result.policyVersion, marketQuoteId: result.marketQuoteId, provider: result.provider }, { policyId: null, policyVersion: 7, marketQuoteId: "QUOTE-1", provider: "GOLDAPI_IO" });
});
