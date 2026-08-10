"use strict";

const { Queue, Worker, UnrecoverableError } = require("bullmq");
const IORedis = require("ioredis");
const feedService = require("./gold-market-feed.service");
const { getProvider } = require("./gold-market-provider-registry.service");
const { GoldMarketHealthService } = require("./gold-market-health.service");

const DEFAULT_QUEUE_NAME = "gold-market-refresh";
const inflight = new Map();

function refreshKey({ companyId, providerId, currency, metal = "XAU" }) { return `${companyId}:${providerId}:${currency}:${metal}`; }

async function refreshOnce({ companyId, providerId, currency, metal = "XAU", staleAfterSeconds = 120, now = new Date(), provider, health = new GoldMarketHealthService(), repositoryOptions = {} } = {}) {
  const key = refreshKey({ companyId, providerId, currency, metal });
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    const adapter = provider || getProvider(providerId);
    const scope = { companyId, providerId, currency: String(currency).toUpperCase(), metal };
    if (typeof adapter.isConfigured === "function" && !adapter.isConfigured()) {
      const error = Object.assign(new Error("GOLD_MARKET_PROVIDER_SECRET_MISSING"), { code: "GOLD_MARKET_PROVIDER_SECRET_MISSING", providerCode: "SECRET_MISSING", retryable: false });
      health.recordFailure(scope, error, { now });
      throw error;
    }
    try {
      const quote = await adapter.fetchQuote(metal, currency, { now });
      const stored = await feedService.ingestNormalizedQuote({ ...quote, companyId }, repositoryOptions);
      const healthState = health.recordSuccess(scope, quote, { staleAfterSeconds, now });
      return { ...stored, health: healthState };
    } catch (error) {
      health.recordFailure(scope, error, { now });
      throw error;
    }
  })();
  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}

async function enqueueRefresh({ queue, companyId, providerId, currency, metal = "XAU" } = {}) {
  if (!queue || typeof queue.add !== "function") return { mode: "disabled", reason: "REDIS_NOT_CONFIGURED" };
  const jobId = `gold-refresh:${refreshKey({ companyId, providerId, currency, metal })}`;
  const job = await queue.add("gold-market-refresh", { companyId, providerId, currency, metal }, { jobId, attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } });
  return { mode: "redis", jobId: job.id };
}

function createBullMqRefreshInfrastructure({ redisUrl = process.env.REDIS_URL, process = refreshOnce, queueName = DEFAULT_QUEUE_NAME } = {}) {
  if (!redisUrl) return { enabled: false, reason: "REDIS_NOT_CONFIGURED", close: async () => {} };
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false, connectTimeout: 5000, retryStrategy: (times) => Math.min(times * 1000, 10000) });
  const queue = new Queue(queueName, { connection });
  const worker = new Worker(queueName, async (job) => {
    try { return await process(job.data); }
    catch (error) { if (error?.retryable === false || error?.code === "GOLD_MARKET_PROVIDER_SECRET_MISSING") throw new UnrecoverableError(error.message); throw error; }
  }, { connection, concurrency: 1 });
  return { enabled: true, queue, worker, connection, close: async () => { await worker.close(); await queue.close(); await connection.quit(); } };
}

module.exports = { DEFAULT_QUEUE_NAME, refreshKey, refreshOnce, enqueueRefresh, createBullMqRefreshInfrastructure };
