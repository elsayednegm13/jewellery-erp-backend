"use strict";

const Decimal = require("decimal.js");
const marketAdminService = require("./gold-market-admin.service");

const TROY_OUNCE_GRAMS = new Decimal("31.1034768");
const REFERENCE_BASIS = "SPOT";
const DEFAULT_STALE_THRESHOLD_SECONDS = 120;
// The canonical reference layer owns the full karat matrix used by the
// serialized Gold By Piece profile.  Existing consumers still receive the
// same SPOT-derived values for their previously supported karats.
const REFERENCE_KARATS = Object.freeze([24, 22, 21, 18, 14, 12, 10, 9]);

function round(value, scale = 8) {
  return new Decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toNumber();
}

function ageSeconds(timestamp, now = new Date()) {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 1000));
}

function statusFor(healthStatus) {
  if (healthStatus === "HEALTHY") return "FRESH";
  if (healthStatus === "STALE") return "STALE";
  if (healthStatus === "UNAVAILABLE") return "UNAVAILABLE";
  return "NOT_CONFIGURED";
}

function buildReferenceSnapshot(state, { currency, now = new Date() } = {}) {
  const settings = state?.settings || {};
  const requestedCurrency = String(currency || settings.marketCurrency || "AED").trim().toUpperCase();
  const configuredCurrency = String(settings.marketCurrency || requestedCurrency).trim().toUpperCase();
  const quote = state?.latestQuote || null;
  const healthStatus = statusFor(state?.health?.status);
  const quoteCurrency = String(quote?.currency || configuredCurrency).trim().toUpperCase();
  const quoteAgeSeconds = ageSeconds(quote?.quoteTimestamp, now);
  const staleAfterSeconds = Number(settings.staleAfterSeconds || DEFAULT_STALE_THRESHOLD_SECONDS);
  const currencyMismatch = Boolean(quote && quoteCurrency !== requestedCurrency);
  const status = currencyMismatch ? "UNAVAILABLE" : healthStatus;
  const usableQuote = quote && !currencyMismatch && Number(quote.spot) > 0;
  const prices = [];

  // The lower Gold Center is a generic market-reference calculator.  It uses
  // one fine-gold SPOT quote and applies karat/24 exactly once for display.
  // It intentionally does not consume CGP BID policy or provider-direct
  // karat fields (which prevents a second purity application).
  if (usableQuote && status !== "UNAVAILABLE" && status !== "NOT_CONFIGURED") {
    const fineSpot = new Decimal(String(quote.spot));
    for (const karat of REFERENCE_KARATS) {
      const purity = new Decimal(karat).div(24);
      prices.push({
        karat,
        rateType: "GLOBAL",
        purity: round(purity, 8),
        pricePerGram: round(fineSpot.mul(purity), 8),
        currency: requestedCurrency,
        source: "live",
      });
    }
  }

  const warning = status === "STALE"
    ? "GOLD_MARKET_QUOTE_STALE"
    : status === "UNAVAILABLE"
      ? (currencyMismatch ? "GOLD_MARKET_QUOTE_CURRENCY_UNAVAILABLE" : "GOLD_MARKET_QUOTE_UNAVAILABLE")
      : status === "NOT_CONFIGURED"
        ? "GOLD_MARKET_NOT_CONFIGURED"
        : null;
  const finePricePerGram = usableQuote && prices.length ? round(quote.spot, 8) : null;
  return {
    currency: requestedCurrency,
    ouncePrice: finePricePerGram == null ? null : round(new Decimal(finePricePerGram).mul(TROY_OUNCE_GRAMS), 8),
    finePricePerGram,
    updatedAt: quote?.quoteTimestamp || null,
    receivedAt: quote?.receivedAt || null,
    isFallback: false,
    prices,
    status,
    freshness: status,
    provider: quote?.provider || settings.activeProvider || null,
    quoteType: REFERENCE_BASIS,
    unit: quote?.unit || "PER_GRAM",
    rateType: "GLOBAL",
    source: "CANONICAL_GOLD_MARKET_QUOTE",
    staleAfterSeconds,
    ageSeconds: quoteAgeSeconds,
    warning,
    quoteId: quote?.id || null,
    configuredCurrency,
    currencyMatch: quoteCurrency === requestedCurrency,
  };
}

async function getReferenceSnapshot(companyId, currency, { now = new Date() } = {}) {
  const state = await marketAdminService.currentState(companyId, { now });
  return buildReferenceSnapshot(state, { currency, now });
}

async function getReferenceRate(companyId, currency, karat, { now = new Date() } = {}) {
  const snapshot = await getReferenceSnapshot(companyId, currency, { now });
  const row = snapshot.prices.find((price) => Number(price.karat) === Number(karat));
  if (!row) {
    const error = new Error(snapshot.warning || "GOLD_MARKET_REFERENCE_RATE_UNAVAILABLE");
    error.code = snapshot.warning || "GOLD_MARKET_REFERENCE_RATE_UNAVAILABLE";
    throw error;
  }
  return { rate: row.pricePerGram, snapshot };
}

/**
 * Gold By Piece rate contract.  This is deliberately a separate named
 * authority from the legacy CGP/GBW helpers: GBP always consumes the
 * canonical 24K SPOT base and the central K/24 derivation, and never a
 * provider-direct karat field or BID/ASK policy.
 */
async function getGlobalRateForGoldByPiece(companyId, currency, karat, { now = new Date() } = {}) {
  const snapshot = await getReferenceSnapshot(companyId, currency, { now });
  if (snapshot.status !== "FRESH") {
    const error = new Error(snapshot.warning || "GOLD_BY_PIECE_GLOBAL_RATE_UNAVAILABLE");
    error.code = snapshot.warning || "GOLD_BY_PIECE_GLOBAL_RATE_UNAVAILABLE";
    throw error;
  }
  if (String(snapshot.currency).toUpperCase() !== "AED" || String(snapshot.unit).toUpperCase() !== "PER_GRAM") {
    const error = new Error("GOLD_BY_PIECE_GLOBAL_RATE_CONTRACT_MISMATCH");
    error.code = "GOLD_BY_PIECE_GLOBAL_RATE_CONTRACT_MISMATCH";
    throw error;
  }
  const row = snapshot.prices.find((price) => Number(price.karat) === Number(karat));
  if (!row || row.rateType !== "GLOBAL" || !(Number(row.pricePerGram) > 0)) {
    const error = new Error("GOLD_BY_PIECE_GLOBAL_RATE_UNAVAILABLE");
    error.code = "GOLD_BY_PIECE_GLOBAL_RATE_UNAVAILABLE";
    throw error;
  }
  return {
    rate: new Decimal(String(row.pricePerGram)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8),
    snapshot: {
      ...snapshot,
      rateType: "GLOBAL",
      karat: Number(karat),
      unit: "PER_GRAM",
      sourceTimestamp: snapshot.updatedAt,
      resolvedAt: now.toISOString(),
      derivation: "CANONICAL_GLOBAL_24K_SPOT_TIMES_K_DIV_24",
    },
  };
}

module.exports = {
  DEFAULT_STALE_THRESHOLD_SECONDS,
  REFERENCE_BASIS,
  REFERENCE_KARATS,
  ageSeconds,
  buildReferenceSnapshot,
  getReferenceSnapshot,
  getReferenceRate,
  getGlobalRateForGoldByPiece,
};
