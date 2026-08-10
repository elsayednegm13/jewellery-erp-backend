"use strict";

const { getProvider } = require("./gold-market-provider-registry.service");
const contract = require("./gold-market-provider.contract");
const quoteRepository = require("../repositories/gold-market-quote.repository");

function assertProvider(providerId) {
  return getProvider(String(providerId || "").trim().toUpperCase());
}

async function ingestNormalizedQuote(input, options = {}) {
  assertProvider(input?.provider);
  const normalized = contract.validateNormalizedQuote(input, options);
  return quoteRepository.insertNormalizedQuote(normalized, options);
}

async function getLatestQuote(scope) {
  assertProvider(scope?.provider);
  return quoteRepository.findLatest(scope);
}

async function getLatestEligibleQuote(scope) {
  assertProvider(scope?.provider);
  return quoteRepository.findLatestEligible(scope);
}

module.exports = { ingestNormalizedQuote, getLatestQuote, getLatestEligibleQuote, assertProvider };
