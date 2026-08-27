"use strict";

const axios = require("axios");
const crypto = require("crypto");
const Decimal = require("decimal.js");
const { PROVIDER_IDS, NORMALIZED_QUOTE_UNIT, METAL, KARAT_RATE_SOURCES, TROY_OUNCE_GRAMS, validateNormalizedQuote } = require("./gold-market-provider.contract");

const GOLDAPI_BASE_URL = "https://www.goldapi.io/api";
const GOLDAPI_SECRET_ENV_NAME = "GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY";
const GOLDAPI_TIMEOUT_MS = 5000;

function configuredSecret(env = process.env) {
  const value = String(env[GOLDAPI_SECRET_ENV_NAME] || "").trim();
  return value || null;
}

function hashSelectedPayload(data) {
  const selected = {};
  ["timestamp", "metal", "currency", "exchange", "symbol", "price", "bid", "ask", "price_gram_24k", "price_gram_22k", "price_gram_21k", "price_gram_18k"].forEach((key) => {
    if (data && Object.prototype.hasOwnProperty.call(data, key)) selected[key] = data[key];
  });
  return crypto.createHash("sha256").update(JSON.stringify(selected)).digest("hex");
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function perGram(value) {
  if (!positive(value)) return null;
  return new Decimal(String(value)).div(new Decimal(TROY_OUNCE_GRAMS)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

function directGram(value) {
  if (!positive(value)) return null;
  return new Decimal(String(value)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

function classifyGoldApiError(error) {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return { code: "AUTH_ERROR", retryable: false, status };
  if (status === 429) return { code: "RATE_LIMITED", retryable: true, status, retryAfter: error.response?.headers?.["retry-after"] || null };
  if (status >= 500 && status <= 599) return { code: "PROVIDER_5XX", retryable: true, status };
  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT" || error?.code === "ENETUNREACH" || error?.request && !error.response) return { code: "NETWORK_ERROR", retryable: true, status: null };
  return { code: "PROVIDER_BAD_RESPONSE", retryable: false, status: status || null };
}

function parseError(error) {
  const classified = classifyGoldApiError(error);
  const wrapped = new Error(`GOLDAPI_IO_${classified.code}`);
  wrapped.code = `GOLDAPI_IO_${classified.code}`;
  wrapped.providerCode = classified.code;
  wrapped.retryable = classified.retryable;
  wrapped.httpStatus = classified.status;
  wrapped.retryAfter = classified.retryAfter;
  return wrapped;
}

class GoldApiIoAdapter {
  constructor({ httpClient = axios, env = process.env, timeoutMs = GOLDAPI_TIMEOUT_MS } = {}) {
    this.httpClient = httpClient;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.providerId = PROVIDER_IDS.GOLDAPI_IO;
    this.capabilities = Object.freeze({ supportsBid: true, supportsAsk: true, supportsSpot: true, supportsDirectCurrency: true, supportsPerGram: true, supportsPerKarat: true, supportsProviderTimestamp: true, supportsQuoteId: false });
  }

  describe() {
    return { providerId: this.providerId, capabilities: this.capabilities, networkEnabled: true, baseUrl: GOLDAPI_BASE_URL };
  }

  isConfigured() { return Boolean(configuredSecret(this.env)); }

  async fetchQuote(metal = METAL, currency = "AED", { now = new Date() } = {}) {
    if (String(metal).toUpperCase() !== METAL) throw Object.assign(new Error("GOLDAPI_IO_METAL_UNSUPPORTED"), { code: "GOLDAPI_IO_METAL_UNSUPPORTED", retryable: false });
    const normalizedCurrency = String(currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw Object.assign(new Error("GOLDAPI_IO_CURRENCY_INVALID"), { code: "GOLDAPI_IO_CURRENCY_INVALID", retryable: false });
    const secret = configuredSecret(this.env);
    if (!secret) throw Object.assign(new Error("GOLDAPI_IO_SECRET_MISSING"), { code: "GOLDAPI_IO_SECRET_MISSING", retryable: false });
    let response;
    try {
      response = await this.httpClient.get(`${GOLDAPI_BASE_URL}/${METAL}/${normalizedCurrency}`, { timeout: this.timeoutMs, headers: { "x-access-token": secret, Accept: "application/json" } });
    } catch (error) {
      throw parseError(error);
    }
    const data = response?.data;
    if (!data || String(data.metal || "").toUpperCase() !== METAL || String(data.currency || "").toUpperCase() !== normalizedCurrency) {
      throw Object.assign(new Error("GOLDAPI_IO_SCHEMA_INVALID"), { code: "GOLDAPI_IO_SCHEMA_INVALID", retryable: false });
    }
    const quoteTimestamp = new Date(Number(data.timestamp) * 1000);
    if (!Number.isFinite(Number(data.timestamp)) || Number.isNaN(quoteTimestamp.getTime())) throw Object.assign(new Error("GOLDAPI_IO_TIMESTAMP_INVALID"), { code: "GOLDAPI_IO_TIMESTAMP_INVALID", retryable: false });
    const receivedAt = new Date();
    const normalized = {
      companyId: undefined,
      provider: this.providerId,
      metal: METAL,
      currency: normalizedCurrency,
      unit: NORMALIZED_QUOTE_UNIT,
      quoteTimestamp,
      receivedAt,
      spot: perGram(data.price),
      bid: perGram(data.bid),
      ask: perGram(data.ask),
      karat18Rate: directGram(data.price_gram_18k),
      karat21Rate: directGram(data.price_gram_21k),
      karat22Rate: directGram(data.price_gram_22k),
      karat24Rate: directGram(data.price_gram_24k),
      karatRateSource: KARAT_RATE_SOURCES.PROVIDER_DIRECT,
      providerQuoteId: null,
      rawPayloadHash: hashSelectedPayload(data),
      status: "VALID",
      quality: "OFFICIAL_RESPONSE",
    };
    validateNormalizedQuote(normalized, { now });
    return normalized;
  }
}

module.exports = { GoldApiIoAdapter, GOLDAPI_BASE_URL, GOLDAPI_SECRET_ENV_NAME, GOLDAPI_TIMEOUT_MS, configuredSecret, classifyGoldApiError };
