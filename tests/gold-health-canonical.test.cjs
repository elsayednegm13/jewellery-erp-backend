const test = require("node:test");
const assert = require("node:assert/strict");

const { readCanonicalGoldHealth } = require("../src/services/gold-market-health-endpoint.service");

function model(rows) {
  return {
    async findAll(options) {
      assert.deepEqual(options.where, { enabled: true, pricingMode: "LIVE_PROVIDER" });
      return rows;
    },
  };
}

const quote = {
  provider: "GOLDAPI_IO",
  metal: "XAU",
  currency: "AED",
  unit: "PER_GRAM",
  quoteTimestamp: "2026-08-11T12:00:00.000Z",
  receivedAt: "2026-08-11T12:00:01.000Z",
  bid: 500,
  spot: 501,
  ask: 502,
  karat24Rate: 501,
};

test("canonical health reports healthy live state without fallback", async () => {
  let currentStateCalls = 0;
  const result = await readCanonicalGoldHealth({
    settingsModel: model([{ companyId: "COMP-1", activeProvider: "GOLDAPI_IO", pricingMode: "LIVE_PROVIDER", marketCurrency: "AED" }]),
    currentState: async (companyId) => {
      currentStateCalls += 1;
      assert.equal(companyId, "COMP-1");
      return { settings: { activeProvider: "GOLDAPI_IO", pricingMode: "LIVE_PROVIDER", marketCurrency: "AED", providerConfigured: true }, health: { status: "HEALTHY" }, latestQuote: quote, effectiveCgpRates: { 24: 500 } };
    },
    now: new Date("2026-08-11T12:00:30.000Z"),
  });
  assert.equal(currentStateCalls, 1);
  assert.equal(result.status, "UP");
  assert.equal(result.healthStatus, "HEALTHY");
  assert.equal(result.isMockFallback, false);
  assert.equal(result.provider, "GOLDAPI_IO");
  assert.equal(result.sampleRates.AED, 501);
  assert.equal(result.ageSeconds, 30);
});

test("stale canonical quote degrades without fake price", async () => {
  const result = await readCanonicalGoldHealth({
    settingsModel: model([{ companyId: "COMP-1", activeProvider: "GOLDAPI_IO", pricingMode: "LIVE_PROVIDER", marketCurrency: "AED" }]),
    currentState: async () => ({ settings: { activeProvider: "GOLDAPI_IO", pricingMode: "LIVE_PROVIDER", marketCurrency: "AED", providerConfigured: true }, health: { status: "STALE" }, latestQuote: quote, effectiveCgpRates: {} }),
    now: new Date("2026-08-11T12:03:00.000Z"),
  });
  assert.equal(result.status, "STALE");
  assert.equal(result.fresh, false);
  assert.equal(result.stale, true);
  assert.equal(result.isMockFallback, false);
});

test("missing provider configuration is explicit and has no generated rate", async () => {
  const result = await readCanonicalGoldHealth({ settingsModel: model([]), currentState: async () => { throw new Error("must not be called"); } });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(result.configured, false);
  assert.equal(result.latestQuote, null);
  assert.equal(result.sampleRates, null);
  assert.equal(result.isMockFallback, false);
});

test("multiple company settings fail closed instead of choosing a pricing authority", async () => {
  const result = await readCanonicalGoldHealth({ settingsModel: model([{ companyId: "COMP-1" }, { companyId: "COMP-2" }]), currentState: async () => { throw new Error("must not be called"); } });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "GOLD_MARKET_HEALTH_CONTEXT_AMBIGUOUS");
  assert.equal(result.isMockFallback, false);
});
