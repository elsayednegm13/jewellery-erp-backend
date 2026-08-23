"use strict";

const models = require("../models");
const marketAdminService = require("./gold-market-admin.service");
const settingsService = require("./gold-market-settings.service");

function asPlain(value) {
  return value?.toJSON ? value.toJSON() : value || {};
}

function ageSeconds(quoteTimestamp, now) {
  if (!quoteTimestamp) return null;
  const timestamp = new Date(quoteTimestamp).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / 1000);
}

/**
 * Read-only, provider-neutral health projection. It intentionally reads the
 * canonical settings/quote state and never calls a provider or mutates data.
 */
async function readCanonicalGoldHealth({
  settingsModel = models.GoldMarketSetting,
  currentState = marketAdminService.currentState,
  now = new Date(),
} = {}) {
  const rows = await settingsModel.findAll({
    where: {
      enabled: true,
      pricingMode: settingsService.PRICING_MODES.LIVE_PROVIDER,
    },
    order: [["updatedAt", "DESC"]],
  });

  if (!rows.length) {
    return {
      status: "NOT_CONFIGURED",
      healthStatus: "NOT_CONFIGURED",
      provider: null,
      mode: null,
      configured: false,
      currency: null,
      quoteTimestamp: null,
      receivedAt: null,
      ageSeconds: null,
      fresh: false,
      stale: false,
      latestQuote: null,
      effectiveCgpRates: {},
      isMockFallback: false,
      sampleRates: null,
    };
  }

  // This product is single-company. Multiple enabled LIVE_PROVIDER settings
  // make a public aggregate health result ambiguous, so fail closed.
  if (rows.length > 1) {
    return {
      status: "UNAVAILABLE",
      healthStatus: "UNAVAILABLE",
      provider: null,
      mode: settingsService.PRICING_MODES.LIVE_PROVIDER,
      configured: false,
      currency: null,
      quoteTimestamp: null,
      receivedAt: null,
      ageSeconds: null,
      fresh: false,
      stale: false,
      latestQuote: null,
      effectiveCgpRates: {},
      isMockFallback: false,
      sampleRates: null,
      reason: "GOLD_MARKET_HEALTH_CONTEXT_AMBIGUOUS",
    };
  }

  const setting = asPlain(rows[0]);
  const state = await currentState(setting.companyId, { now });
  const settings = asPlain(state.settings);
  const latestQuote = state.latestQuote || null;
  const healthStatus = state.health?.status || "UNAVAILABLE";
  const currency = settings.marketCurrency || setting.marketCurrency || null;
  const quoteAge = ageSeconds(latestQuote?.quoteTimestamp, now);

  return {
    status: healthStatus === "HEALTHY" ? "UP" : healthStatus,
    healthStatus,
    provider: settings.activeProvider || setting.activeProvider || null,
    mode: settings.pricingMode || setting.pricingMode || null,
    configured: Boolean(settings.providerConfigured),
    currency,
    unit: latestQuote?.unit || null,
    quoteTimestamp: latestQuote?.quoteTimestamp || null,
    receivedAt: latestQuote?.receivedAt || null,
    ageSeconds: quoteAge,
    fresh: healthStatus === "HEALTHY",
    stale: healthStatus === "STALE",
    latestQuote,
    effectiveCgpRates: state.effectiveCgpRates || {},
    // Preserve the legacy field as a non-authoritative compatibility view.
    sampleRates: latestQuote?.karat24Rate == null || !currency ? null : { [currency]: latestQuote.karat24Rate },
    isMockFallback: false,
  };
}

module.exports = { readCanonicalGoldHealth, ageSeconds };
