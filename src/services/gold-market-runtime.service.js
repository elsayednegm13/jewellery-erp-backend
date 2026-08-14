"use strict";

// Gold Market is a scheduled integration, not a request-time pricing path.
// This module owns only the runtime wiring: one BullMQ scheduler per
// company/provider/currency scope and one worker callback that resolves the
// current settings before calling the existing canonical refreshOnce path.

const { Op } = require("sequelize");
const models = require("../models");
const logger = require("../utils/logger");
const settingsService = require("./gold-market-settings.service");
const {
  DEFAULT_QUEUE_NAME,
  refreshKey,
  refreshOnce,
  createBullMqRefreshInfrastructure,
} = require("./gold-market-refresh.service");

const SCHEDULER_PREFIX = "gold-market-refresh";
const JOB_NAME = "gold-market-refresh";
const DEFAULT_METAL = "XAU";

let activeRuntime = null;

function schedulerId(scope) {
  return `${SCHEDULER_PREFIX}:${refreshKey({ ...scope, metal: scope.metal || DEFAULT_METAL })}`;
}

function normalizeScope(row, fallback = {}) {
  const value = row?.toJSON ? row.toJSON() : row || {};
  const companyId = String(value.companyId || fallback.companyId || "").trim();
  const providerId = String(value.activeProvider || value.providerId || fallback.providerId || "").trim().toUpperCase();
  const currency = String(value.marketCurrency || value.currency || fallback.currency || "").trim().toUpperCase();
  const metal = String(value.metal || fallback.metal || DEFAULT_METAL).trim().toUpperCase();
  if (!companyId || !providerId || !currency) return null;
  const refreshIntervalSeconds = Number(value.refreshIntervalSeconds ?? fallback.refreshIntervalSeconds);
  const staleAfterSeconds = Number(value.staleAfterSeconds ?? fallback.staleAfterSeconds ?? 120);
  if (!Number.isInteger(refreshIntervalSeconds) || refreshIntervalSeconds <= 0) return null;
  if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds < refreshIntervalSeconds) return null;
  return { companyId, providerId, currency, metal, refreshIntervalSeconds, staleAfterSeconds };
}

async function loadEnabledScopes({ settingModel = models.GoldMarketSetting } = {}) {
  const rows = await settingModel.findAll({
    where: {
      enabled: true,
      pricingMode: settingsService.PRICING_MODES.LIVE_PROVIDER,
      activeProvider: { [Op.ne]: null },
    },
    order: [["companyId", "ASC"]],
  });
  return rows.map((row) => normalizeScope(row)).filter(Boolean);
}

function repeatOptions(scope) {
  return {
    every: scope.refreshIntervalSeconds * 1000,
    // Run once immediately after registration, then continue at the
    // configured interval. BullMQ stores the schedule in Redis, so this is
    // safe across process restarts and multiple API instances.
    immediately: true,
  };
}

function jobTemplate(scope) {
  return {
    name: JOB_NAME,
    data: {
      companyId: scope.companyId,
      providerId: scope.providerId,
      currency: scope.currency,
      metal: scope.metal,
    },
    opts: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 1000 },
    },
  };
}

async function registerScope({ queue, scope }) {
  if (!queue || typeof queue.upsertJobScheduler !== "function") {
    throw new Error("GOLD_MARKET_REPEAT_SCHEDULER_UNSUPPORTED");
  }
  const id = schedulerId(scope);
  await queue.upsertJobScheduler(id, repeatOptions(scope), jobTemplate(scope));
  return { id, everyMs: scope.refreshIntervalSeconds * 1000 };
}

async function reconcileSchedules({ queue, scopes }) {
  const desired = new Map(scopes.map((scope) => [schedulerId(scope), scope]));
  const registered = [];
  for (const scope of scopes) registered.push(await registerScope({ queue, scope }));

  // Remove schedules belonging to this queue that no longer have an enabled
  // LIVE_PROVIDER setting. The stable prefix prevents touching unrelated
  // queues/schedulers in Redis.
  if (typeof queue.getJobSchedulers === "function" && typeof queue.removeJobScheduler === "function") {
    const existing = await queue.getJobSchedulers(0, -1, false);
    for (const item of existing || []) {
      const id = String(item?.id || item?.key || "");
      if (id.startsWith(`${SCHEDULER_PREFIX}:`) && !desired.has(id)) await queue.removeJobScheduler(id);
    }
  }
  return registered;
}

async function refreshCurrentSettings(jobData, {
  settingModel = models.GoldMarketSetting,
  refresh = refreshOnce,
} = {}) {
  const companyId = String(jobData?.companyId || "").trim();
  if (!companyId) throw Object.assign(new Error("GOLD_MARKET_COMPANY_CONTEXT_REQUIRED"), { code: "GOLD_MARKET_COMPANY_CONTEXT_REQUIRED", retryable: false });
  const row = await settingModel.findOne({ where: { companyId } });
  const scope = normalizeScope(row, jobData);
  if (!scope || !row?.enabled || row.pricingMode !== settingsService.PRICING_MODES.LIVE_PROVIDER) {
    return { skipped: true, reason: "GOLD_MARKET_LIVE_MODE_DISABLED", companyId };
  }
  return refresh({
    companyId: scope.companyId,
    providerId: scope.providerId,
    currency: scope.currency,
    metal: scope.metal,
    staleAfterSeconds: scope.staleAfterSeconds,
  });
}

function disabledResult(reason) {
  return {
    enabled: false,
    reason,
    close: async () => {},
    reconcile: async () => [],
  };
}

async function start({
  redisUrl = process.env.REDIS_URL,
  settingModel = models.GoldMarketSetting,
  infrastructureFactory = createBullMqRefreshInfrastructure,
  refresh = refreshOnce,
  queueName = DEFAULT_QUEUE_NAME,
  loggerInstance = logger,
} = {}) {
  if (activeRuntime) return { ...activeRuntime, started: false, reason: "already-running" };
  if (String(process.env.NODE_ENV || "").toLowerCase() === "test") return disabledResult("TEST_ENVIRONMENT");
  if (String(process.env.DISABLE_GOLD_MARKET_RUNTIME || "").toLowerCase() === "true") return disabledResult("DISABLED_BY_ENVIRONMENT");
  if (!String(redisUrl || "").trim()) {
    loggerInstance.warn("[GoldMarketRuntime] REDIS_URL is not configured; recurring Live Gold refresh is disabled.");
    return disabledResult("REDIS_NOT_CONFIGURED");
  }

  let infrastructure;
  try {
    infrastructure = infrastructureFactory({
      redisUrl,
      queueName,
      process: (job) => refreshCurrentSettings(job, { settingModel, refresh }),
    });
    if (!infrastructure?.enabled) return disabledResult(infrastructure?.reason || "REDIS_UNAVAILABLE");
    const scopes = await loadEnabledScopes({ settingModel });
    const schedules = await reconcileSchedules({ queue: infrastructure.queue, scopes });
    infrastructure.worker?.on?.("completed", (job, result) => {
      const data = job?.data || {};
      loggerInstance.info(`[GoldMarketRuntime] refresh success job=${job?.id || "unknown"} company=${data.companyId || "unknown"} provider=${data.providerId || "unknown"} currency=${data.currency || "unknown"} quoteTimestamp=${result?.quoteTimestamp || "unknown"}`);
    });
    infrastructure.worker?.on?.("failed", (job, error) => {
      const data = job?.data || {};
      loggerInstance.warn(`[GoldMarketRuntime] refresh failure job=${job?.id || "unknown"} company=${data.companyId || "unknown"} provider=${data.providerId || "unknown"} currency=${data.currency || "unknown"} code=${error?.code || "UNKNOWN"}`);
    });
    activeRuntime = {
      enabled: true,
      started: true,
      queueName,
      schedules,
      queue: infrastructure.queue,
      worker: infrastructure.worker,
      infrastructure,
      reconcile: async () => reconcileSchedules({ queue: infrastructure.queue, scopes: await loadEnabledScopes({ settingModel }) }),
      close: async () => {
        if (!activeRuntime) return;
        activeRuntime = null;
        await infrastructure.close();
      },
    };
    loggerInstance.info(`[GoldMarketRuntime] scheduler registered queue=${queueName} schedules=${schedules.length}`);
    return activeRuntime;
  } catch (error) {
    try { await infrastructure?.close?.(); } catch { /* best effort cleanup */ }
    loggerInstance.error(`[GoldMarketRuntime] startup failed: ${error.message}`);
    return disabledResult("RUNTIME_START_FAILED");
  }
}

async function stop() {
  if (!activeRuntime) return false;
  const runtime = activeRuntime;
  activeRuntime = null;
  await runtime.infrastructure.close();
  return true;
}

function getActiveRuntime() { return activeRuntime; }

async function reconcileActiveRuntime() {
  if (!activeRuntime || typeof activeRuntime.reconcile !== "function") return [];
  return activeRuntime.reconcile();
}

module.exports = {
  SCHEDULER_PREFIX,
  JOB_NAME,
  schedulerId,
  normalizeScope,
  loadEnabledScopes,
  repeatOptions,
  jobTemplate,
  registerScope,
  reconcileSchedules,
  refreshCurrentSettings,
  start,
  stop,
  getActiveRuntime,
  reconcileActiveRuntime,
};
