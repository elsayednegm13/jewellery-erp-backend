const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildReferenceSnapshot } = require("../src/services/gold-center-reference-price.service");

const now = new Date("2026-08-11T10:00:00.000Z");
const quote = {
  id: "quote-1",
  provider: "GOLDAPI_IO",
  currency: "AED",
  unit: "PER_GRAM",
  quoteTimestamp: "2026-08-11T09:59:30.000Z",
  receivedAt: "2026-08-11T09:59:31.000Z",
  spot: "516.18420035",
  bid: "516.13638254",
  ask: "516.23320130",
};

const state = {
  settings: { marketCurrency: "AED", activeProvider: "GOLDAPI_IO", staleAfterSeconds: 120 },
  health: { status: "HEALTHY" },
  latestQuote: quote,
};

const fresh = buildReferenceSnapshot(state, { currency: "AED", now });
assert.equal(fresh.status, "FRESH");
assert.equal(fresh.quoteType, "SPOT");
assert.equal(fresh.provider, "GOLDAPI_IO");
assert.equal(fresh.prices.length, 5);
assert.equal(fresh.prices.find((row) => row.karat === 24).pricePerGram, 516.18420035);
assert.equal(fresh.prices.find((row) => row.karat === 14).pricePerGram, 301.1074502);
assert.equal(fresh.isFallback, false);

const stale = buildReferenceSnapshot({ ...state, health: { status: "STALE" } }, { currency: "AED", now });
assert.equal(stale.status, "STALE");
assert.equal(stale.warning, "GOLD_MARKET_QUOTE_STALE");
assert.equal(stale.prices.length, 5);

const unavailable = buildReferenceSnapshot({ ...state, health: { status: "UNAVAILABLE" }, latestQuote: null }, { currency: "AED", now });
assert.equal(unavailable.prices.length, 0);
assert.equal(unavailable.warning, "GOLD_MARKET_QUOTE_UNAVAILABLE");

const notConfigured = buildReferenceSnapshot({ ...state, health: { status: "NOT_CONFIGURED" } }, { currency: "AED", now });
assert.equal(notConfigured.prices.length, 0);
assert.equal(notConfigured.warning, "GOLD_MARKET_NOT_CONFIGURED");

const routeSource = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
const lowerGetStart = routeSource.indexOf('router.get("/gold/karat-prices"');
const lowerGetEnd = routeSource.indexOf('router.post("/gold/karat-prices"', lowerGetStart);
const lowerGetBlock = routeSource.slice(lowerGetStart, lowerGetEnd);
assert.equal(lowerGetBlock.includes("goldService.getKaratPrices"), false);
assert.equal(lowerGetBlock.includes("generateFallbackPrices"), false);

const pageSource = fs.readFileSync(path.join(__dirname, "../../app/[locale]/(dashboard)/gold-center/page.tsx"), "utf8");
assert.equal(pageSource.includes("t(\"simulatedFeed\")"), false);
assert.equal(pageSource.includes("snapshot?.quoteType"), true);

console.log("gold-center-legacy-price-sync: PASS");
