"use strict";

// Pure source-backed calculations for Loose Gemstone and Loose Pearl.  Durable
// facts continue to be written by inventory-v2-runtime into the existing
// purchase-revision/current-valuation authorities.
const Decimal = require("decimal.js");
const goldValuationService = require("./gold-valuation.service");

const PROFILES = new Set(["LOOSE_GEMSTONE", "LOOSE_PEARL"]);
const fixed = (value) => new Decimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
function decimal(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === "") { if (required) throw new Error(`LOOSE_FINANCE_${field}_REQUIRED`); return null; }
  let result; try { result = new Decimal(String(value)); } catch { throw new Error(`LOOSE_FINANCE_${field}_INVALID`); }
  if (!result.isFinite() || result.lt(0)) throw new Error(`LOOSE_FINANCE_${field}_INVALID`);
  return result;
}
function isLooseProfile(profile) { return PROFILES.has(profile); }
function resolveVat({ requestedRate, configuredRate }) {
  const manual = decimal(requestedRate, "VAT_RATE");
  if (manual) { if (manual.gt(100)) throw new Error("LOOSE_FINANCE_VAT_RATE_INVALID"); return { rate: fixed(manual), source: "MANUAL" }; }
  if (configuredRate !== undefined && configuredRate !== null && configuredRate !== "") return { rate: fixed(decimal(configuredRate, "SETTINGS_VAT_RATE", { required: true })), source: "SETTINGS_DEFAULT" };
  return { rate: "0.00000000", source: "NOT_APPLICABLE" };
}
function calculatePurchase({ profile, input = {}, configuredVatRate = null }) {
  if (!isLooseProfile(profile)) return null;
  const base = decimal(input.purchaseCost ?? input.baseCost, "PURCHASE_COST", { required: true });
  const additional = profile === "LOOSE_GEMSTONE" ? (decimal(input.additionalCost ?? 0, "ADDITIONAL_COST") || new Decimal(0)) : new Decimal(0);
  const vat = resolveVat({ requestedRate: input.vatRate, configuredRate: configuredVatRate });
  const vatAmount = base.times(vat.rate).div(100);
  return Object.freeze({ purchaseBaseCost: fixed(base), additionalCost: fixed(additional), vatRate: vat.rate, vatRateSource: vat.source, vatBase: fixed(base), vatAmount: fixed(vatAmount), totalPurchaseCost: fixed(base.plus(additional).plus(vatAmount)) });
}
function calculateCurrent({ profile, input = {}, configuredVatRate = null }) {
  if (!isLooseProfile(profile)) throw new Error("LOOSE_FINANCE_PROFILE_UNSUPPORTED");
  const base = decimal(input.currentValue ?? input.currentStoneValue ?? input.currentPearlCost, "CURRENT_VALUE", { required: true });
  const vat = resolveVat({ requestedRate: input.currentVatRate ?? input.vatRate, configuredRate: configuredVatRate });
  const vatAmount = base.times(vat.rate).div(100);
  return Object.freeze({ rateSource: "MANUAL", goldRate: null, goldValue: null, makingValue: null, certificateValue: "0.00000000", componentValue: fixed(base), vatRate: vat.rate, vatRateSource: vat.source, vatBase: fixed(base), vatAmount: fixed(vatAmount), totalValue: fixed(base.plus(vatAmount)) });
}
async function configuredVatRate({ models, companyId, transaction }) { return goldValuationService.resolveConfiguredVatRate({ models, companyId, transaction }); }
module.exports = { PROFILES, isLooseProfile, calculatePurchase, calculateCurrent, configuredVatRate };
