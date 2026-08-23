"use strict";

const { getProvider } = require("./gold-market-provider-registry.service");
const { isQuoteFresh, quoteCapabilities } = require("./gold-market-provider.contract");

async function testConnection({ providerId, currency, metal = "XAU", staleAfterSeconds = 120, now = new Date(), provider } = {}) {
  const adapter = provider || getProvider(providerId);
  const description = adapter.describe();
  const configured = typeof adapter.isConfigured === "function" ? adapter.isConfigured() : false;
  if (!configured) return { provider: description.providerId, configured: false, reachable: false, normalized: false, status: "UNAVAILABLE", reason: "MISSING_PROVIDER_SECRET", capabilities: description.capabilities };
  try {
    const quote = await adapter.fetchQuote(metal, currency, { now });
    return { provider: description.providerId, configured: true, reachable: true, normalized: true, status: isQuoteFresh(quote, staleAfterSeconds, now) ? "HEALTHY" : "STALE", currency: quote.currency, quoteTimestamp: quote.quoteTimestamp, receivedAt: quote.receivedAt, freshness: isQuoteFresh(quote, staleAfterSeconds, now), capabilities: { ...description.capabilities, ...quoteCapabilities(quote) } };
  } catch (error) {
    return { provider: description.providerId, configured: true, reachable: false, normalized: false, status: error.providerCode === "RATE_LIMITED" ? "RATE_LIMITED" : error.providerCode === "AUTH_ERROR" ? "AUTH_ERROR" : "UNAVAILABLE", reason: error.providerCode || "PROVIDER_ERROR", capabilities: description.capabilities };
  }
}

module.exports = { testConnection };
