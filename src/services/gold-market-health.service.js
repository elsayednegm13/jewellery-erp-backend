"use strict";

const { isQuoteFresh } = require("./gold-market-provider.contract");

const HEALTH_STATES = Object.freeze({ HEALTHY: "HEALTHY", DEGRADED: "DEGRADED", STALE: "STALE", UNAVAILABLE: "UNAVAILABLE", AUTH_ERROR: "AUTH_ERROR", RATE_LIMITED: "RATE_LIMITED" });

class GoldMarketHealthService {
  constructor() { this.states = new Map(); }

  key({ companyId, providerId, currency, metal = "XAU" }) { return `${companyId}:${providerId}:${currency}:${metal}`; }

  recordSuccess(scope, quote, { staleAfterSeconds, now = new Date() } = {}) {
    const fresh = isQuoteFresh(quote, staleAfterSeconds, now);
    const value = { ...scope, status: fresh ? HEALTH_STATES.HEALTHY : HEALTH_STATES.STALE, lastSuccessAt: new Date(), lastFailureAt: null, lastFailureCode: null, quoteTimestamp: quote.quoteTimestamp, receivedAt: quote.receivedAt, quoteAgeMs: Math.max(0, now.getTime() - new Date(quote.quoteTimestamp).getTime()) };
    this.states.set(this.key(scope), value);
    return { ...value };
  }

  recordFailure(scope, error, { now = new Date() } = {}) {
    const providerCode = error?.providerCode || error?.code || "UNAVAILABLE";
    const status = providerCode.includes("AUTH") || providerCode.includes("SECRET") ? HEALTH_STATES.AUTH_ERROR : providerCode.includes("RATE") ? HEALTH_STATES.RATE_LIMITED : HEALTH_STATES.UNAVAILABLE;
    const previous = this.states.get(this.key(scope)) || {};
    const value = { ...previous, ...scope, status, lastFailureAt: now, lastFailureCode: providerCode };
    this.states.set(this.key(scope), value);
    return { ...value };
  }

  get(scope) { return this.states.get(this.key(scope)) || { ...scope, status: HEALTH_STATES.UNAVAILABLE, lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null }; }

  clear() { this.states.clear(); }
}

module.exports = { GoldMarketHealthService, HEALTH_STATES };
