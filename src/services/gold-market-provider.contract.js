"use strict";

const PROVIDER_IDS = Object.freeze({ GOLDAPI_IO: "GOLDAPI_IO", METALS_API: "METALS_API" });
const QUOTE_TYPES = Object.freeze({ BID: "BID", SPOT: "SPOT", ASK: "ASK" });
const QUOTE_UNITS = Object.freeze({ PER_GRAM: "PER_GRAM", PER_TROY_OUNCE: "PER_TROY_OUNCE" });
const NORMALIZED_QUOTE_UNIT = "PER_GRAM";
const METAL = "XAU";
const SUPPORTED_KARATS = Object.freeze([18, 21, 22, 24]);
const QUOTE_STATUSES = Object.freeze({ VALID: "VALID", STALE: "STALE", INVALID: "INVALID", UNAVAILABLE: "UNAVAILABLE" });
const KARAT_RATE_SOURCES = Object.freeze({ PROVIDER_DIRECT: "PROVIDER_DIRECT", DERIVED_FROM_BASE: "DERIVED_FROM_BASE" });
const TROY_OUNCE_GRAMS = "31.1034768";

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function assertCurrency(currency) {
  const value = String(currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) throw new Error("GOLD_MARKET_QUOTE_CURRENCY_INVALID");
  return value;
}

function assertPositiveDecimal(value, field) {
  if (!hasValue(value)) return;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`GOLD_MARKET_QUOTE_${field.toUpperCase()}_INVALID`);
}

function parseDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`GOLD_MARKET_QUOTE_${field.toUpperCase()}_INVALID`);
  return date;
}

function validateNormalizedQuote(input, { now = new Date(), futureSkewMs = 60_000 } = {}) {
  const quote = { ...input };
  if (!PROVIDER_IDS[quote.provider]) throw new Error("GOLD_MARKET_PROVIDER_UNKNOWN");
  if (String(quote.metal || "").toUpperCase() !== METAL) throw new Error("GOLD_MARKET_QUOTE_METAL_INVALID");
  quote.currency = assertCurrency(quote.currency);
  if (quote.unit !== NORMALIZED_QUOTE_UNIT) throw new Error("GOLD_MARKET_QUOTE_UNIT_INVALID");
  quote.quoteTimestamp = parseDate(quote.quoteTimestamp, "quote_timestamp");
  quote.receivedAt = parseDate(quote.receivedAt, "received_at");
  if (quote.quoteTimestamp.getTime() > now.getTime() + futureSkewMs) throw new Error("GOLD_MARKET_QUOTE_FUTURE_TIMESTAMP");
  if (quote.receivedAt.getTime() > now.getTime() + futureSkewMs) throw new Error("GOLD_MARKET_QUOTE_FUTURE_RECEIVED_AT");

  const valueFields = ["spot", "bid", "ask", "karat18Rate", "karat21Rate", "karat22Rate", "karat24Rate"];
  valueFields.forEach((field) => assertPositiveDecimal(quote[field], field));
  if (!valueFields.some((field) => hasValue(quote[field]))) throw new Error("GOLD_MARKET_QUOTE_VALUE_REQUIRED");
  if (quote.status && !Object.values(QUOTE_STATUSES).includes(quote.status)) throw new Error("GOLD_MARKET_QUOTE_STATUS_INVALID");
  if (quote.karatRateSource && !Object.values(KARAT_RATE_SOURCES).includes(quote.karatRateSource)) throw new Error("GOLD_MARKET_KARAT_RATE_SOURCE_INVALID");
  return { ...quote, metal: METAL, status: quote.status || QUOTE_STATUSES.VALID };
}

function assertQuoteTypeAvailable(quote, quoteType) {
  const field = { [QUOTE_TYPES.BID]: "bid", [QUOTE_TYPES.SPOT]: "spot", [QUOTE_TYPES.ASK]: "ask" }[quoteType];
  if (!field || !hasValue(quote[field]) || Number(quote[field]) <= 0) throw new Error("GOLD_MARKET_QUOTE_TYPE_UNAVAILABLE");
  return quote[field];
}

function quoteAgeMs(quote, now = new Date()) {
  const timestamp = parseDate(quote.quoteTimestamp, "quote_timestamp");
  return Math.max(0, now.getTime() - timestamp.getTime());
}

function isQuoteFresh(quote, staleThresholdSeconds, now = new Date()) {
  const threshold = Number(staleThresholdSeconds);
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error("GOLD_MARKET_STALE_THRESHOLD_INVALID");
  return quoteAgeMs(quote, now) <= threshold * 1000;
}

function quoteCapabilities(quote) {
  return Object.freeze({ supportsBid: hasValue(quote.bid), supportsAsk: hasValue(quote.ask), supportsSpot: hasValue(quote.spot), supportsPerGram: quote.unit === NORMALIZED_QUOTE_UNIT, supportsPerKarat: [quote.karat18Rate, quote.karat21Rate, quote.karat22Rate, quote.karat24Rate].some(hasValue), supportsProviderTimestamp: hasValue(quote.quoteTimestamp), supportsQuoteId: hasValue(quote.providerQuoteId) });
}

module.exports = {
  PROVIDER_IDS,
  QUOTE_TYPES,
  QUOTE_UNITS,
  NORMALIZED_QUOTE_UNIT,
  METAL,
  SUPPORTED_KARATS,
  QUOTE_STATUSES,
  KARAT_RATE_SOURCES,
  TROY_OUNCE_GRAMS,
  validateNormalizedQuote,
  assertQuoteTypeAvailable,
  quoteAgeMs,
  isQuoteFresh,
  quoteCapabilities,
};
