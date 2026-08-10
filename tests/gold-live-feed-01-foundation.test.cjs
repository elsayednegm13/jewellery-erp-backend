const test = require("node:test");
const assert = require("node:assert/strict");

const contract = require("../src/services/gold-market-provider.contract");
const registry = require("../src/services/gold-market-provider-registry.service");
const settings = require("../src/services/gold-market-settings.service");
const feed = require("../src/services/gold-market-feed.service");
const { GoldApiIoAdapter, GOLDAPI_BASE_URL } = require("../src/services/goldapi-io.adapter");
const { testConnection } = require("../src/services/gold-market-test-connection.service");
const { enqueueRefresh, refreshKey, createBullMqRefreshInfrastructure } = require("../src/services/gold-market-refresh.service");
const { GoldMarketHealthService } = require("../src/services/gold-market-health.service");

function quote(overrides = {}) {
  return {
    companyId: "CMP-TEST",
    provider: "GOLDAPI_IO",
    metal: "XAU",
    currency: "AED",
    unit: "PER_GRAM",
    quoteTimestamp: new Date("2026-08-10T10:00:00.000Z"),
    receivedAt: new Date("2026-08-10T10:00:01.000Z"),
    bid: "400.12345678",
    spot: "401.12345678",
    ask: "402.12345678",
    karatRateSource: "PROVIDER_DIRECT",
    ...overrides,
  };
}

test("provider IDs are controlled and adapters are network-disabled stubs", async () => {
  assert.deepEqual(Object.keys(contract.PROVIDER_IDS).sort(), ["GOLDAPI_IO", "METALS_API"]);
  const adapter = registry.getProvider("GOLDAPI_IO");
  assert.equal(adapter.describe().networkEnabled, true);
  assert.equal(registry.getProvider("METALS_API").describe().networkEnabled, false);
  assert.throws(() => registry.getProvider("ARBITRARY_URL"), /GOLD_MARKET_PROVIDER_UNKNOWN/);
  assert.throws(() => feed.assertProvider("ARBITRARY_URL"), /GOLD_MARKET_PROVIDER_UNKNOWN/);
});

test("normalized quote validation rejects unsafe values and future timestamps", () => {
  const valid = contract.validateNormalizedQuote(quote(), { now: new Date("2026-08-10T10:00:10.000Z") });
  assert.equal(valid.currency, "AED");
  assert.throws(() => contract.validateNormalizedQuote(quote({ bid: "0" })), /BID_INVALID/);
  assert.throws(() => contract.validateNormalizedQuote(quote({ currency: "AED" , quoteTimestamp: new Date("2030-01-01") }), { now: new Date("2026-08-10T10:00:10.000Z") }), /FUTURE_TIMESTAMP/);
  assert.throws(() => contract.validateNormalizedQuote(quote({ bid: null, spot: null, ask: null })), /VALUE_REQUIRED/);
});

test("quote type capability is explicit and freshness uses server time", () => {
  const q = contract.validateNormalizedQuote(quote(), { now: new Date("2026-08-10T10:00:10.000Z") });
  assert.equal(contract.assertQuoteTypeAvailable(q, contract.QUOTE_TYPES.BID), "400.12345678");
  assert.throws(() => contract.assertQuoteTypeAvailable({ ...q, bid: null }, contract.QUOTE_TYPES.BID), /QUOTE_TYPE_UNAVAILABLE/);
  assert.equal(contract.isQuoteFresh(q, 120, new Date("2026-08-10T10:01:50.000Z")), true);
  assert.equal(contract.isQuoteFresh(q, 120, new Date("2026-08-10T10:02:01.000Z")), false);
});

test("settings foundation is non-secret and does not accept arbitrary providers", () => {
  const value = settings.validateSettingsInput({ pricingMode: "LIVE_PROVIDER", activeProvider: "GOLDAPI_IO", marketCurrency: "AED", refreshIntervalSeconds: 30, staleAfterSeconds: 120, enabled: false });
  assert.equal(value.activeProvider, "GOLDAPI_IO");
  assert.equal(Object.keys(value).some((key) => /key|secret|password|token/i.test(key)), false);
  assert.throws(() => settings.validateSettingsInput({ pricingMode: "LIVE_PROVIDER", activeProvider: "https://example.invalid" }), /GOLD_MARKET_PROVIDER_UNKNOWN/);
  assert.throws(() => settings.validateSettingsInput({ pricingMode: "LIVE_PROVIDER" }), /GOLD_MARKET_PROVIDER_REQUIRED/);
});

test("GoldAPI official response maps ounce market fields and direct gram karats", async () => {
  const timestamp = Math.floor((Date.now() - 1000) / 1000);
  const calls = [];
  const adapter = new GoldApiIoAdapter({ env: { GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY: "test-only-secret" }, httpClient: { get: async (url, config) => { calls.push({ url, config }); return { data: { timestamp, metal: "XAU", currency: "AED", exchange: "GOLDAPI", symbol: "GOLDAPI:XAUAED", price: 15500, bid: 15490, ask: 15510, price_gram_24k: 498.3456, price_gram_22k: 456.1234, price_gram_21k: 435.9876, price_gram_18k: 373.7654 } }; } } });
  const quote = await adapter.fetchQuote("XAU", "AED", { now: new Date() });
  assert.equal(calls[0].url, `${GOLDAPI_BASE_URL}/XAU/AED`);
  assert.equal(calls[0].config.headers["x-access-token"], "test-only-secret");
  assert.equal(quote.unit, "PER_GRAM");
  assert.equal(quote.currency, "AED");
  assert.equal(quote.karatRateSource, "PROVIDER_DIRECT");
  assert.equal(quote.karat24Rate, "498.34560000");
  assert.equal(quote.bid, "498.01506435");
  assert.equal(quote.providerQuoteId, null);
  assert.equal(quote.rawPayloadHash.length, 64);
});

test("GoldAPI adapter fails closed for missing secret, auth, rate-limit and malformed responses", async () => {
  const missing = new GoldApiIoAdapter({ env: {} });
  await assert.rejects(() => missing.fetchQuote("XAU", "AED"), /GOLDAPI_IO_SECRET_MISSING/);
  const auth = new GoldApiIoAdapter({ env: { GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY: "x" }, httpClient: { get: async () => { const e = new Error("401"); e.response = { status: 401 }; throw e; } } });
  await assert.rejects(() => auth.fetchQuote("XAU", "AED"), (error) => error.code === "GOLDAPI_IO_AUTH_ERROR" && error.retryable === false);
  const limited = new GoldApiIoAdapter({ env: { GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY: "x" }, httpClient: { get: async () => { const e = new Error("429"); e.response = { status: 429, headers: { "retry-after": "10" } }; throw e; } } });
  await assert.rejects(() => limited.fetchQuote("XAU", "AED"), (error) => error.code === "GOLDAPI_IO_RATE_LIMITED" && error.retryable === true);
  const malformed = new GoldApiIoAdapter({ env: { GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY: "x" }, httpClient: { get: async () => ({ data: { timestamp: 1, metal: "XAG", currency: "AED" } }) } });
  await assert.rejects(() => malformed.fetchQuote("XAU", "AED"), /GOLDAPI_IO_SCHEMA_INVALID/);
});

test("Test Connection is sanitized and does not persist a quote", async () => {
  const result = await testConnection({ providerId: "GOLDAPI_IO", currency: "AED", provider: new GoldApiIoAdapter({ env: {} }) });
  assert.deepEqual({ configured: result.configured, reachable: result.reachable, normalized: result.normalized, reason: result.reason }, { configured: false, reachable: false, normalized: false, reason: "MISSING_PROVIDER_SECRET" });
  assert.equal(JSON.stringify(result).includes("test-only-secret"), false);
});

test("refresh queue uses deterministic job identity and disables safely without Redis", async () => {
  assert.equal(refreshKey({ companyId: "C", providerId: "GOLDAPI_IO", currency: "AED", metal: "XAU" }), "C:GOLDAPI_IO:AED:XAU");
  const added = [];
  const queued = await enqueueRefresh({ queue: { add: async (...args) => { added.push(args); return { id: args[2].jobId }; } }, companyId: "C", providerId: "GOLDAPI_IO", currency: "AED" });
  assert.equal(queued.mode, "redis");
  assert.equal(added[0][2].attempts, 3);
  assert.equal(added[0][2].backoff.type, "exponential");
  assert.equal((await createBullMqRefreshInfrastructure({ redisUrl: "" })).enabled, false);
});

test("provider health classifies success, stale and auth/unavailable failures", () => {
  const service = new GoldMarketHealthService();
  const scope = { companyId: "C", providerId: "GOLDAPI_IO", currency: "AED", metal: "XAU" };
  const fresh = contract.validateNormalizedQuote(quote({ quoteTimestamp: new Date("2026-08-10T10:00:00.000Z"), receivedAt: new Date("2026-08-10T10:00:01.000Z") }), { now: new Date("2026-08-10T10:00:10.000Z") });
  assert.equal(service.recordSuccess(scope, fresh, { staleAfterSeconds: 120, now: new Date("2026-08-10T10:00:10.000Z") }).status, "HEALTHY");
  const error = Object.assign(new Error(), { providerCode: "AUTH_ERROR" });
  assert.equal(service.recordFailure(scope, error).status, "AUTH_ERROR");
});
