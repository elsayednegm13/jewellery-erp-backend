"use strict";

const { GoldMarketSetting } = require("../models");
const { PROVIDER_IDS } = require("./gold-market-provider.contract");

const PRICING_MODES = Object.freeze({ MANUAL_APPROVED: "MANUAL_APPROVED", LIVE_PROVIDER: "LIVE_PROVIDER" });
const PROVIDER_SECRET_ENV_NAMES = Object.freeze({ GOLDAPI_IO: "GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY", METALS_API: "GOLD_MARKET_PROVIDER_METALS_API_API_KEY" });

function validateSettingsInput(input = {}) {
  const pricingMode = String(input.pricingMode || PRICING_MODES.MANUAL_APPROVED).trim().toUpperCase();
  if (!Object.values(PRICING_MODES).includes(pricingMode)) throw new Error("GOLD_MARKET_PRICING_MODE_INVALID");
  const provider = input.activeProvider == null ? null : String(input.activeProvider).trim().toUpperCase();
  if (provider && !Object.values(PROVIDER_IDS).includes(provider)) throw new Error("GOLD_MARKET_PROVIDER_UNKNOWN");
  const currency = String(input.marketCurrency || "AED").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("GOLD_MARKET_SETTINGS_CURRENCY_INVALID");
  const refresh = Number(input.refreshIntervalSeconds ?? 30);
  const stale = Number(input.staleAfterSeconds ?? 120);
  if (!Number.isInteger(refresh) || refresh <= 0 || !Number.isInteger(stale) || stale < refresh) throw new Error("GOLD_MARKET_SETTINGS_INTERVAL_INVALID");
  if (pricingMode === PRICING_MODES.LIVE_PROVIDER && !provider) throw new Error("GOLD_MARKET_PROVIDER_REQUIRED_FOR_LIVE_MODE");
  return { pricingMode, activeProvider: provider, marketCurrency: currency, refreshIntervalSeconds: refresh, staleAfterSeconds: stale, enabled: Boolean(input.enabled) };
}

async function getSettings(companyId, { transaction } = {}) {
  if (!companyId) throw new Error("GOLD_MARKET_COMPANY_CONTEXT_REQUIRED");
  return GoldMarketSetting.findOne({ where: { companyId }, transaction });
}

function buildDefaultSettings(companyId) {
  if (!companyId) throw new Error("GOLD_MARKET_COMPANY_CONTEXT_REQUIRED");
  return { id: undefined, companyId, ...validateSettingsInput({}) };
}

module.exports = { PRICING_MODES, PROVIDER_SECRET_ENV_NAMES, validateSettingsInput, getSettings, buildDefaultSettings };
