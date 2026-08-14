"use strict";

const { Op } = require("sequelize");
const { v4: uuidv4 } = require("uuid");
const models = require("../models");
const logger = require("../utils/logger");
const auditService = require("./audit.service");
const permissionService = require("./permission.service");
const pricingPolicyService = require("./gold-pricing-policy.service");
const settingsService = require("./gold-market-settings.service");
const { getProvider, listProviders } = require("./gold-market-provider-registry.service");
const { testConnection } = require("./gold-market-test-connection.service");
const { isQuoteFresh, SUPPORTED_KARATS } = require("./gold-market-provider.contract");
const { AppError, ForbiddenError, ValidationError } = require("../utils/errors");

const MANAGE_PERMISSION = pricingPolicyService.PRICING_POLICY_PERMISSION;
const READ_PERMISSION = pricingPolicyService.READ_PERMISSION;
const SECRET_OR_URL_KEY = /(secret|api.?key|token|password|url|endpoint)/i;

function contextRequired(companyId) {
  if (!companyId) throw new AppError("Gold market company context is required", 422, "GOLD_MARKET_COMPANY_CONTEXT_REQUIRED");
}

function schemaUnavailable(error) {
  return error?.parent?.code === "42P01" || error?.original?.code === "42P01" || /relation .* does not exist/i.test(String(error?.message || ""));
}

function assertSafeInput(input = {}) {
  for (const key of Object.keys(input)) {
    if (SECRET_OR_URL_KEY.test(key)) throw new ValidationError("Provider secrets and URLs are server-managed", { [key]: ["forbidden"] });
  }
}

function publicProvider(provider) {
  const description = provider.describe();
  return {
    providerId: description.providerId,
    networkEnabled: Boolean(description.networkEnabled),
    capabilities: description.capabilities,
    configured: typeof provider.isConfigured === "function" ? Boolean(provider.isConfigured()) : false,
  };
}

function publicSettings(row, companyId) {
  const value = row ? row.toJSON() : settingsService.buildDefaultSettings(companyId);
  let configured = false;
  if (value.activeProvider) {
    try { configured = typeof getProvider(value.activeProvider).isConfigured === "function" && Boolean(getProvider(value.activeProvider).isConfigured()); } catch { configured = false; }
  }
  return {
    id: value.id || null,
    pricingMode: value.pricingMode,
    activeProvider: value.activeProvider || null,
    marketCurrency: value.marketCurrency,
    refreshIntervalSeconds: value.refreshIntervalSeconds,
    staleAfterSeconds: value.staleAfterSeconds,
    enabled: Boolean(value.enabled),
    providerConfigured: configured,
    version: value.version || 1,
    updatedAt: value.updatedAt || null,
    updatedBy: value.updatedBy || null,
  };
}

function publicQuote(row) {
  if (!row) return null;
  const value = row.toJSON ? row.toJSON() : row;
  return {
    id: value.id,
    provider: value.provider,
    metal: value.metal,
    currency: value.currency,
    unit: value.unit,
    quoteTimestamp: value.quoteTimestamp,
    receivedAt: value.receivedAt,
    spot: value.spot,
    bid: value.bid,
    ask: value.ask,
    karat18Rate: value.karat18Rate,
    karat21Rate: value.karat21Rate,
    karat22Rate: value.karat22Rate,
    karat24Rate: value.karat24Rate,
    karatRateSource: value.karatRateSource,
    providerQuoteId: value.providerQuoteId,
    status: value.status,
    quality: value.quality,
  };
}

async function currentState(companyId, { now = new Date() } = {}) {
  contextRequired(companyId);
  let row;
  try { row = await settingsService.getSettings(companyId); } catch (error) { if (schemaUnavailable(error)) throw new AppError("Gold market foundation is not installed on this database", 503, "GOLD_MARKET_FOUNDATION_NOT_AVAILABLE"); throw error; }
  const settings = publicSettings(row, companyId);
  const providers = listProviders().map((entry) => {
    try { return publicProvider(getProvider(entry.providerId)); } catch { return { providerId: entry.providerId, networkEnabled: false, capabilities: entry.capabilities, configured: false }; }
  });
  let quote = null;
  if (settings.activeProvider) {
    quote = await models.GoldMarketQuote.findOne({ where: { companyId, provider: settings.activeProvider, currency: settings.marketCurrency, metal: "XAU" }, order: [["quoteTimestamp", "DESC"], ["receivedAt", "DESC"]] });
  }
  const effectiveCgpRates = {};
  if (quote) {
    for (const karat of [18, 21, 22, 24]) {
      try {
        const resolved = await pricingPolicyService.resolvePolicy({ companyId, karat, businessContext: "CGP", now });
        const calculated = pricingPolicyService.calculateFromPolicy({ quote: quote.toJSON ? quote.toJSON() : quote, policy: resolved.policy.toJSON ? resolved.policy.toJSON() : resolved.policy, companyId, karat, currency: settings.marketCurrency, now, staleAfterSeconds: settings.staleAfterSeconds, marketQuoteId: quote.id });
        effectiveCgpRates[karat] = calculated.effectiveRate;
      } catch { effectiveCgpRates[karat] = null; }
    }
  }
  let status = "NOT_CONFIGURED";
  if (settings.pricingMode === settingsService.PRICING_MODES.LIVE_PROVIDER && settings.enabled) {
    if (!settings.providerConfigured) status = "NOT_CONFIGURED";
    else if (!quote) status = "UNAVAILABLE";
    else status = isQuoteFresh(quote, settings.staleAfterSeconds, now) ? "HEALTHY" : "STALE";
  }
  return { settings, providers, health: { status, lastQuoteAt: quote?.quoteTimestamp || null, receivedAt: quote?.receivedAt || null, failureCode: null }, latestQuote: publicQuote(quote), effectiveCgpRates };
}

async function assertLiveReady({ companyId, settings, now = new Date() }) {
  const provider = getProvider(settings.activeProvider);
  const connection = await testConnection({ providerId: settings.activeProvider, currency: settings.marketCurrency, staleAfterSeconds: settings.staleAfterSeconds, now, provider });
  if (!connection.configured || !connection.reachable || connection.status !== "HEALTHY") {
    throw new AppError("Live provider is not ready", 422, "GOLD_MARKET_LIVE_PROVIDER_NOT_READY", { provider: [connection.reason || connection.status || "unavailable"] });
  }
  const activePolicies = await models.GoldPricingPolicy.count({ where: { companyId, businessContext: "CGP", status: "ACTIVE", effectiveFrom: { [Op.lte]: now } } });
  if (activePolicies < 1) throw new AppError("An active CGP pricing policy is required before live mode", 422, "GOLD_MARKET_LIVE_POLICY_REQUIRED");
  return connection;
}

async function updateSettings({ context, input = {} } = {}) {
  contextRequired(context?.companyId);
  if (!context.user) throw new ForbiddenError(`${MANAGE_PERMISSION} is required`);
  assertSafeInput(input);
  if (!(await permissionService.userHasPermission(context.user, MANAGE_PERMISSION))) throw new ForbiddenError(`${MANAGE_PERMISSION} is required`);
  let current;
  try { current = await settingsService.getSettings(context.companyId); } catch (error) { if (schemaUnavailable(error)) throw new AppError("Gold market foundation is not installed on this database", 503, "GOLD_MARKET_FOUNDATION_NOT_AVAILABLE"); throw error; }
  const base = current ? current.toJSON() : settingsService.buildDefaultSettings(context.companyId);
  const beforeSnapshot = publicSettings(current, context.companyId);
  const normalized = settingsService.validateSettingsInput({
    pricingMode: input.pricingMode ?? base.pricingMode,
    activeProvider: input.activeProvider ?? base.activeProvider,
    marketCurrency: input.marketCurrency ?? base.marketCurrency,
    refreshIntervalSeconds: input.refreshIntervalSeconds ?? base.refreshIntervalSeconds,
    staleAfterSeconds: input.staleAfterSeconds ?? base.staleAfterSeconds,
    enabled: input.enabled ?? base.enabled,
  });
  const run = async (transaction) => {
    if (normalized.pricingMode === settingsService.PRICING_MODES.LIVE_PROVIDER && normalized.enabled) await assertLiveReady({ companyId: context.companyId, settings: normalized });
    const existing = await models.GoldMarketSetting.findOne({ where: { companyId: context.companyId }, transaction, lock: transaction.LOCK.UPDATE });
    const row = existing
      ? await existing.update({ ...normalized, updatedBy: context.user.id, version: Number(existing.version || 1) + 1 }, { transaction })
      : await models.GoldMarketSetting.create({ id: `GMS-${uuidv4()}`, companyId: context.companyId, ...normalized, updatedBy: context.user.id, version: 1 }, { transaction });
    await auditService.record(context.companyId, { action: "gold_market_settings.updated", description: `Gold market settings ${row.id} updated`, user: context.user.email || context.user.username || context.user.id, userId: context.user.id, place: "GoldCenter", sourceDocument: row.id, before: JSON.stringify(beforeSnapshot), after: JSON.stringify(publicSettings(row, context.companyId)) }, { transaction });
    return publicSettings(row, context.companyId);
  };
  const result = await models.sequelize.transaction(run);
  // If the recurring runtime is active, immediately reconcile its stable
  // BullMQ schedules with the newly committed canonical settings. The lazy
  // require avoids a module cycle during application startup.
  try {
    const goldMarketRuntime = require("./gold-market-runtime.service");
    await goldMarketRuntime.reconcileActiveRuntime();
  } catch (error) {
    // Settings remain committed; runtime health remains fail-closed and the
    // next process restart/reconciliation can recover without a second source
    // of pricing authority.
    logger.warn(`[GoldMarketAdmin] runtime schedule reconciliation failed: ${error.message}`);
  }
  return result;
}

async function listQuoteHistory({ companyId, provider, currency, page = 1, pageSize = 25 } = {}) {
  contextRequired(companyId);
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 25));
  let settings;
  try { settings = await settingsService.getSettings(companyId); } catch (error) { if (schemaUnavailable(error)) throw new AppError("Gold market foundation is not installed on this database", 503, "GOLD_MARKET_FOUNDATION_NOT_AVAILABLE"); throw error; }
  const where = { companyId, metal: "XAU" };
  if (provider || settings?.activeProvider) where.provider = provider || settings.activeProvider;
  if (currency || settings?.marketCurrency) where.currency = String(currency || settings.marketCurrency).toUpperCase();
  const result = await models.GoldMarketQuote.findAndCountAll({ where, order: [["quoteTimestamp", "DESC"], ["receivedAt", "DESC"], ["id", "DESC"]], limit: safePageSize, offset: (safePage - 1) * safePageSize });
  return { items: result.rows.map(publicQuote), page: safePage, pageSize: safePageSize, total: result.count, hasMore: safePage * safePageSize < result.count };
}

module.exports = { MANAGE_PERMISSION, READ_PERMISSION, currentState, updateSettings, listQuoteHistory, publicSettings, publicQuote, assertLiveReady, SUPPORTED_KARATS };
