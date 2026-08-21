"use strict";

// Pure source-backed calculations for Loose Diamond, Loose Gemstone and Loose Pearl.  Durable
// facts continue to be written by inventory-v2-runtime into the existing
// purchase-revision/current-valuation authorities.
const Decimal = require("decimal.js");
const goldValuationService = require("./gold-valuation.service");

const PROFILES = new Set(["LOOSE_DIAMOND", "LOOSE_GEMSTONE", "LOOSE_PEARL"]);
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
  const explicitPurchase = input.purchasePricePreTax ?? input.purchasePrice ?? input.purchaseCost ?? input.baseCost;
  const legacyStoneCost = input.stoneCostCanonical ?? input.stoneCost;
  if (profile === "LOOSE_DIAMOND" && legacyStoneCost !== undefined && legacyStoneCost !== null && legacyStoneCost !== "" && explicitPurchase !== undefined && explicitPurchase !== null && explicitPurchase !== "" && !new Decimal(String(legacyStoneCost)).eq(new Decimal(String(explicitPurchase)))) {
    throw new Error("LOOSE_DIAMOND_PURCHASE_PRICE_STONE_COST_MISMATCH");
  }
  const base = decimal(explicitPurchase ?? legacyStoneCost, "PURCHASE_COST", { required: true });
  const additional = profile === "LOOSE_GEMSTONE" ? (decimal(input.additionalCost ?? 0, "ADDITIONAL_COST") || new Decimal(0)) : new Decimal(0);
  const vat = resolveVat({ requestedRate: input.vatRate, configuredRate: configuredVatRate });
  const vatAmount = base.times(vat.rate).div(100);
  return Object.freeze({ purchaseBaseCost: fixed(base), additionalCost: fixed(additional), vatRate: vat.rate, vatRateSource: vat.source, vatBase: fixed(base.plus(additional)), vatAmount: fixed(vatAmount), totalPurchaseCost: fixed(base.plus(additional).plus(vatAmount)), purchasePricePreTax: fixed(base), stoneCostCanonical: fixed(base) });
}
function calculateCurrent({ profile, input = {}, configuredVatRate = null }) {
  if (!isLooseProfile(profile)) throw new Error("LOOSE_FINANCE_PROFILE_UNSUPPORTED");
  const base = decimal(input.currentDiamondValuePreTax ?? input.currentValue ?? input.currentStoneValue ?? input.currentPearlCost, "CURRENT_VALUE");
  if (!base) return null;
  const vat = resolveVat({ requestedRate: input.currentVatRate ?? input.vatRate, configuredRate: configuredVatRate });
  const vatAmount = base.times(vat.rate).div(100);
  return Object.freeze({ rateSource: "MANUAL", goldRate: null, goldValue: null, makingValue: null, certificateValue: "0.00000000", componentValue: fixed(base), vatRate: vat.rate, vatRateSource: vat.source, vatBase: fixed(base), vatAmount: fixed(vatAmount), totalValue: fixed(base.plus(vatAmount)) });
}
async function configuredVatRate({ models, companyId, transaction }) { return goldValuationService.resolveConfiguredVatRate({ models, companyId, transaction }); }
module.exports = { PROFILES, isLooseProfile, calculatePurchase, calculateCurrent, configuredVatRate };
