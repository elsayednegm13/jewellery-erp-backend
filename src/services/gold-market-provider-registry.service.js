"use strict";

const { PROVIDER_IDS } = require("./gold-market-provider.contract");
const { GoldApiIoAdapter } = require("./goldapi-io.adapter");

class UnimplementedProviderAdapter {
  constructor(providerId, capabilities = {}) {
    this.providerId = providerId;
    this.capabilities = Object.freeze({ ...capabilities });
  }

  describe() {
    return { providerId: this.providerId, capabilities: this.capabilities, networkEnabled: false };
  }

  async fetchQuote() {
    const error = new Error("GOLD_MARKET_PROVIDER_ADAPTER_NOT_IMPLEMENTED");
    error.code = "GOLD_MARKET_PROVIDER_ADAPTER_NOT_IMPLEMENTED";
    throw error;
  }
}

const registry = new Map([
  [PROVIDER_IDS.GOLDAPI_IO, new GoldApiIoAdapter()],
  [PROVIDER_IDS.METALS_API, new UnimplementedProviderAdapter(PROVIDER_IDS.METALS_API, { supportsBid: true, supportsAsk: true, supportsSpot: true, supportsDirectCurrency: false, supportsPerGram: false, supportsPerKarat: false, supportsProviderTimestamp: true, supportsQuoteId: false })],
]);

function registerProvider(providerId, adapter) {
  if (!Object.values(PROVIDER_IDS).includes(providerId) || !adapter || typeof adapter.fetchQuote !== "function") throw new Error("GOLD_MARKET_PROVIDER_REGISTRATION_INVALID");
  registry.set(providerId, adapter);
}

function getProvider(providerId) {
  const adapter = registry.get(String(providerId || "").trim().toUpperCase());
  if (!adapter) throw new Error("GOLD_MARKET_PROVIDER_UNKNOWN");
  return adapter;
}

function listProviders() {
  return [...registry.values()].map((adapter) => adapter.describe());
}

module.exports = { UnimplementedProviderAdapter, registerProvider, getProvider, listProviders, PROVIDER_IDS };
