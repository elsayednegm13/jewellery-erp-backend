"use strict";

const { Op } = require("sequelize");
const { v4: uuidv4 } = require("uuid");
const { GoldMarketQuote } = require("../models");
const { validateNormalizedQuote, isQuoteFresh, QUOTE_STATUSES } = require("../services/gold-market-provider.contract");

function whereForScope({ companyId, provider, currency, metal = "XAU" }) {
  if (!companyId || !provider || !currency) throw new Error("GOLD_MARKET_QUOTE_SCOPE_REQUIRED");
  return { companyId, provider, currency: String(currency).toUpperCase(), metal };
}

async function findExistingIdentity(quote, { transaction } = {}) {
  const scope = { companyId: quote.companyId, provider: quote.provider };
  if (quote.providerQuoteId) {
    return GoldMarketQuote.findOne({ where: { ...scope, providerQuoteId: quote.providerQuoteId }, transaction });
  }
  if (quote.rawPayloadHash) {
    return GoldMarketQuote.findOne({ where: { ...scope, rawPayloadHash: quote.rawPayloadHash, quoteTimestamp: quote.quoteTimestamp }, transaction });
  }
  return null;
}

async function insertNormalizedQuote(input, { transaction, now = new Date() } = {}) {
  const quote = validateNormalizedQuote(input, { now });
  if (!quote.companyId) throw new Error("GOLD_MARKET_QUOTE_COMPANY_REQUIRED");
  const existing = await findExistingIdentity(quote, { transaction });
  if (existing) return { quote: existing, replayed: true };
  try {
    const created = await GoldMarketQuote.create({ ...quote, id: quote.id || uuidv4() }, { transaction });
    return { quote: created, replayed: false };
  } catch (error) {
    if (error?.name === "SequelizeUniqueConstraintError") {
      const replay = await findExistingIdentity(quote, { transaction });
      if (replay) return { quote: replay, replayed: true };
    }
    throw error;
  }
}

async function findLatest({ companyId, provider, currency, metal = "XAU", transaction } = {}) {
  return GoldMarketQuote.findOne({ where: whereForScope({ companyId, provider, currency, metal }), order: [["quoteTimestamp", "DESC"], ["receivedAt", "DESC"], ["id", "DESC"]], transaction });
}

async function findLatestEligible({ companyId, provider, currency, metal = "XAU", staleAfterSeconds, now = new Date(), transaction } = {}) {
  const quote = await findLatest({ companyId, provider, currency, metal, transaction });
  if (!quote || quote.status !== QUOTE_STATUSES.VALID) return null;
  return isQuoteFresh(quote, staleAfterSeconds, now) ? quote : null;
}

async function countByCompany(companyId, { transaction } = {}) {
  return GoldMarketQuote.count({ where: { companyId }, transaction });
}

module.exports = { insertNormalizedQuote, findLatest, findLatestEligible, countByCompany };
