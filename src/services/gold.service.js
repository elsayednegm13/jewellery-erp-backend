const axios = require("axios");
const logger = require("../utils/logger");

// Grams in one troy ounce — gold is quoted per troy ounce internationally.
const TROY_OUNCE_GRAMS = 31.1034768;

// Karat purity factors (fraction of pure gold). 24K is taken as fine gold.
const KARAT_PURITY = {
  24: 0.999,
  22: 0.9167,
  21: 0.875,
  18: 0.75,
  14: 0.5833,
  12: 0.5,
  9: 0.375
};

class GoldPriceService {
  constructor() {
    this.cache = {
      data: null,
      updatedAt: 0
    };
    // Base gold price per ounce in USD
    this.baseOunceUsd = 2330.0;
  }

  /** Purity fraction for a karat (defaults to 24K factor when unknown). */
  static purityFor(karat) {
    return KARAT_PURITY[Number(karat)] ?? KARAT_PURITY[24];
  }

  /**
   * Derives per-gram prices for the requested karats in the given currency,
   * from the live per-ounce price. Returns the snapshot the Gold Center uses.
   */
  async getKaratPrices(currency = "AED", karats = [24, 22, 21, 18, 14]) {
    const live = await this.getLivePrice();
    const ouncePrice = (live.gold_24k && live.gold_24k[currency]) || live.gold_24k.USD || this.baseOunceUsd;
    // Per-gram price of pure (24K) gold in the target currency.
    const fineGram = ouncePrice / TROY_OUNCE_GRAMS;
    const prices = karats.map((k) => {
      const purity = GoldPriceService.purityFor(k);
      return {
        karat: Number(k),
        purity,
        pricePerGram: Math.round(fineGram * purity * 100) / 100,
        currency
      };
    });
    return {
      currency,
      ouncePrice,
      finePricePerGram: Math.round(fineGram * 100) / 100,
      updatedAt: live.last_update,
      isFallback: !process.env.GOLD_API_KEY,
      prices
    };
  }

  /**
   * Prices a jewellery item: metal value + making charge + stone value, + VAT.
   *   metalValue = grossWeight × perGram(karat)
   */
  async quoteItem({ grossWeight = 0, karat = 21, makingCharge = 0, stoneValue = 0, currency = "AED", vatRate = 0, perGram = null }) {
    const purity = GoldPriceService.purityFor(karat);
    // Prefer an explicitly supplied (e.g. manually-fixed) rate, else derive live.
    if (perGram == null || perGram <= 0) {
      const snap = await this.getKaratPrices(currency, [Number(karat)]);
      perGram = snap.prices[0].pricePerGram;
    }
    const metalValue = Math.round(Number(grossWeight) * perGram * 100) / 100;
    const subtotal = Math.round((metalValue + Number(makingCharge) + Number(stoneValue)) * 100) / 100;
    const vat = Math.round(subtotal * vatRate * 100) / 100;
    return {
      currency,
      karat: Number(karat),
      purity,
      perGram,
      grossWeight: Number(grossWeight),
      fineWeight: Math.round(Number(grossWeight) * purity * 1000) / 1000,
      metalValue,
      makingCharge: Number(makingCharge),
      stoneValue: Number(stoneValue),
      subtotal,
      vat,
      total: Math.round((subtotal + vat) * 100) / 100
    };
  }

  /**
   * FOUNDATION ONLY (not wired into POS yet). Compute an item's sale price for
   * a given pricing mode. Pure/synchronous — caller supplies the karat rate.
   *
   *  - manual_sale_price           → keep the stored sale price as-is.
   *  - dynamic_by_karat            → goldWeight × perGram.
   *  - dynamic_by_karat_plus_making→ goldWeight × perGram + makingCharge + stoneValue.
   *
   * NOTE: this never touches purchase cost / COGS — those stay at original cost.
   */
  computeItemSalePrice({
    mode = "manual_sale_price",
    goldWeight = 0,
    perGram = 0,
    makingCharge = 0,
    stoneValue = 0,
    manualSalePrice = 0,
  }) {
    const round = (n) => Math.round(Number(n) * 100) / 100;
    const metal = round(Number(goldWeight) * Number(perGram));
    switch (mode) {
      case "dynamic_by_karat":
        return metal;
      case "dynamic_by_karat_plus_making":
        return round(metal + Number(makingCharge) + Number(stoneValue));
      case "manual_sale_price":
      default:
        return round(Number(manualSalePrice));
    }
  }

  /**
   * FOUNDATION ONLY (read-only, no journal entry). Inventory valuation for a
   * single item: cost vs. current market value and the unrealized gain/loss.
   * Does NOT modify inventory cost and does NOT post any revaluation entry.
   */
  valuationFor({ goldWeight = 0, perGram = 0, cost = 0 }) {
    const round = (n) => Math.round(Number(n) * 100) / 100;
    const costValue = round(cost);
    const marketValue = round(Number(goldWeight) * Number(perGram));
    return {
      costValue,
      marketValue,
      unrealizedGainLoss: round(marketValue - costValue),
    };
  }

  /**
   * Retrieves gold price. Serves from cache if updated less than 60 seconds ago.
   */
  async getLivePrice() {
    const now = Date.now();
    const cacheAge = now - this.cache.updatedAt;

    if (this.cache.data && cacheAge < 60000) {
      logger.info(`Serving gold price from cache (Age: ${Math.round(cacheAge / 1000)}s)`);
      return this.cache.data;
    }

    logger.info("Gold price cache expired or empty. Fetching fresh prices...");
    try {
      const prices = await this.fetchPrices();
      this.cache.data = {
        gold_24k: prices,
        last_update: new Date().toISOString()
      };
      this.cache.updatedAt = now;
      return this.cache.data;
    } catch (error) {
      logger.error("Failed to fetch fresh gold prices. Using fallback cache if available.", error);
      if (this.cache.data) {
        return this.cache.data;
      }
      // Generate emergency fallback values immediately if no cache exists
      const fallbackPrices = this.generateFallbackPrices();
      this.cache.data = {
        gold_24k: fallbackPrices,
        last_update: new Date().toISOString()
      };
      this.cache.updatedAt = now;
      return this.cache.data;
    }
  }

  /**
   * Orchestrates fetching from API or mock provider depending on environment variables.
   */
  async fetchPrices() {
    const provider = process.env.GOLD_API_PROVIDER || "goldapi";
    const apiKey = process.env.GOLD_API_KEY;

    if (!apiKey) {
      logger.warn("GOLD_API_KEY is not set. Falling back to simulated live Gold Price Feed.");
      return this.generateFallbackPrices();
    }

    try {
      if (provider === "goldapi") {
        return await this.fetchFromGoldApi(apiKey);
      } else if (provider === "metalsapi") {
        return await this.fetchFromMetalsApi(apiKey);
      } else if (provider === "goldpriceapi") {
        return await this.fetchFromGoldPriceApi(apiKey);
      } else {
        throw new Error(`Unsupported gold provider: ${provider}`);
      }
    } catch (err) {
      logger.error(`API fetch error with provider ${provider}: ${err.message}. Falling back to simulated feed.`);
      return this.generateFallbackPrices();
    }
  }

  async fetchFromGoldApi(apiKey) {
    // Query XAU/USD (gold price per ounce)
    const url = "https://www.goldapi.io/api/XAU/USD";
    const response = await axios.get(url, {
      headers: {
        "x-access-token": apiKey
      }
    });

    if (response.data && response.data.price) {
      const ounceUsd = response.data.price;
      return this.calculateAllCurrencies(ounceUsd);
    }
    throw new Error("Invalid response from GoldAPI.io");
  }

  async fetchFromMetalsApi(apiKey) {
    // Metals-API returns rates relative to base currency (e.g. USD)
    const url = `https://metals-api.com/api/latest?access_key=${apiKey}&base=USD&symbols=XAU`;
    const response = await axios.get(url);

    if (response.data && response.data.success && response.data.rates && response.data.rates.XAU) {
      // Rates are 1 USD = X XAU, so XAU price in USD is 1 / rate
      const rate = response.data.rates.XAU;
      const ounceUsd = 1 / rate;
      return this.calculateAllCurrencies(ounceUsd);
    }
    throw new Error("Invalid response from Metals-API.com");
  }

  async fetchFromGoldPriceApi(apiKey) {
    const url = `https://api.goldpriceapi.com/v1/latest?api_key=${apiKey}&base=USD&symbols=XAU`;
    const response = await axios.get(url);

    if (response.data && response.data.success && response.data.rates && response.data.rates.XAU) {
      const ounceUsd = response.data.rates.XAU;
      return this.calculateAllCurrencies(ounceUsd);
    }
    throw new Error("Invalid response from GoldPriceAPI.com");
  }

  /**
   * Helper to convert USD base price per ounce to EGP, SAR, AED, etc. using standard cross-rates
   */
  calculateAllCurrencies(ounceUsd) {
    // Fixed reference exchange rates (approximate for ERP dashboard mapping purposes)
    const rates = {
      USD: 1.0,
      EUR: 0.92,
      GBP: 0.79,
      EGP: 47.65,
      SAR: 3.75,
      AED: 3.67
    };

    return {
      USD: Math.round(ounceUsd),
      EUR: Math.round(ounceUsd * rates.EUR),
      GBP: Math.round(ounceUsd * rates.GBP),
      EGP: Math.round(ounceUsd * rates.EGP),
      SAR: Math.round(ounceUsd * rates.SAR),
      AED: Math.round(ounceUsd * rates.AED)
    };
  }

  /**
   * Generates realistic simulated prices with slight volatility
   */
  generateFallbackPrices() {
    // Add minor random fluctuation (-0.3% to +0.3%)
    const fluctuation = 1 + (Math.random() * 0.006 - 0.003);
    this.baseOunceUsd = this.baseOunceUsd * fluctuation;

    return this.calculateAllCurrencies(this.baseOunceUsd);
  }
}

module.exports = new GoldPriceService();
