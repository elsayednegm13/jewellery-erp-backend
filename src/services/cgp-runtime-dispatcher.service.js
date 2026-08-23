"use strict";

// CGP-only runtime delivery.  The generic Outbox dispatcher remains dormant;
// this service claims only newly eligible CustomerGoldPurchasePostedEvent v1
// rows after an explicit, restart-stable activation watermark.
const crypto = require("crypto");
const models = require("../models");
const outbox = require("./outbox.service");
const dispatcher = require("./outbox-dispatcher.service");
const inventory = require("./cgp-inventory-consumer.service");
const accounting = require("./cgp-accounting-consumer.service");
const goldCenter = require("./cgp-gold-center-consumer.service");
const crm = require("./cgp-crm-consumer.service");
const availability = require("./cgp-availability-evaluator.service");

const EVENT_TYPE = "CustomerGoldPurchasePostedEvent";
const EVENT_VERSION = 1;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MIN_POLL_INTERVAL_MS = 250;
const MAX_POLL_INTERVAL_MS = 60000;
const ENABLE_ENV = "CGP_RUNTIME_DISPATCH_ENABLED";
const WATERMARK_ENV = "CGP_RUNTIME_DISPATCH_MIN_CREATED_AT";
const POLL_ENV = "CGP_RUNTIME_DISPATCH_POLL_MS";

let activeRuntime = null;

function parseWatermark(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getTime());
  }
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveConfig(env = process.env) {
  const enabled = String(env[ENABLE_ENV] || "").trim().toLowerCase() === "true";
  const watermark = parseWatermark(env[WATERMARK_ENV]);
  const rawPoll = env[POLL_ENV] === undefined ? DEFAULT_POLL_INTERVAL_MS : Number(env[POLL_ENV]);
  const pollIntervalMs = Number.isInteger(rawPoll) && rawPoll >= MIN_POLL_INTERVAL_MS && rawPoll <= MAX_POLL_INTERVAL_MS
    ? rawPoll : null;
  if (!enabled) return { enabled: false, valid: true, reason: "DISABLED", watermark: null, pollIntervalMs: pollIntervalMs || DEFAULT_POLL_INTERVAL_MS };
  if (!watermark) return { enabled: true, valid: false, reason: "ACTIVATION_WATERMARK_REQUIRED", watermark: null, pollIntervalMs: pollIntervalMs || DEFAULT_POLL_INTERVAL_MS };
  if (!pollIntervalMs) return { enabled: true, valid: false, reason: "POLL_INTERVAL_INVALID", watermark, pollIntervalMs: DEFAULT_POLL_INTERVAL_MS };
  return { enabled: true, valid: true, reason: "ENABLED", watermark, pollIntervalMs };
}

function workerId(prefix = "cgp-runtime") {
  return `${prefix}:${process.pid}:${crypto.randomUUID()}`;
}

function createCgpConsumerRegistry({ consumers = {} } = {}) {
  const selected = {
    inventory: consumers.inventory || inventory,
    accounting: consumers.accounting || accounting,
    goldCenter: consumers.goldCenter || goldCenter,
    crm: consumers.crm || crm,
    availability: consumers.availability || availability,
  };
  const registry = dispatcher.createHandlerRegistry();
  registry.register({
    eventType: EVENT_TYPE,
    eventVersion: EVENT_VERSION,
    handler: async (event) => {
      const eventId = event.event_id || event.eventId;
      // The order preserves the hard economic gates. CRM is intentionally last
      // and soft; it cannot prevent Inventory availability.
      const result = {
        inventory: await selected.inventory.consumePostedEvent({ eventId }),
        accounting: await selected.accounting.consumePostedEvent({ eventId }),
        goldCenter: await selected.goldCenter.consumePostedEvent({ eventId }),
      };
      result.availability = await selected.availability.evaluateAvailability({ eventId });
      result.crm = await selected.crm.consumePostedEvent({ eventId });
      return result;
    },
  });
  return registry;
}

async function claimEligible({ transaction, workerId: claimant, now, limit, config, sequelize = models.sequelize } = {}) {
  if (!config?.enabled || !config.valid) return [];
  return outbox.claimDueEvents({
    transaction,
    workerId: claimant,
    now,
    limit,
    eventType: EVENT_TYPE,
    eventVersion: EVENT_VERSION,
    minCreatedAt: config.watermark,
    sequelize,
  });
}

async function processOnce({ config = resolveConfig(), now = new Date(), limit = 1, claimant = workerId(), registry = createCgpConsumerRegistry() } = {}) {
  if (!config.enabled || !config.valid) return { processed: 0, claimed: 0, skipped: true, reason: config.reason };
  const claimed = await models.sequelize.transaction((transaction) => claimEligible({ transaction, workerId: claimant, now, limit, config }));
  const results = [];
  for (const event of claimed) {
    const eventId = event.event_id || event.eventId;
    try {
      const result = await outbox.dispatchClaimedEvent({ event, handlers: registry.snapshot() });
      await models.sequelize.transaction((transaction) => outbox.markPublished({ transaction, eventId, workerId: claimant, now }));
      results.push({ eventId, state: "PUBLISHED", result });
    } catch (error) {
      let retryState = "RETRYABLE_FAILED";
      try {
        await models.sequelize.transaction((transaction) => outbox.markRetryableFailure({ transaction, eventId, workerId: claimant, error, now }));
      } catch (markError) {
        retryState = "CLAIM_STATE_ERROR";
        results.push({ eventId, state: retryState, error: markError });
      }
      if (retryState === "RETRYABLE_FAILED") results.push({ eventId, state: retryState, error });
    }
  }
  return { processed: results.filter((row) => row.state === "PUBLISHED").length, claimed: claimed.length, skipped: false, results };
}

// Explicit pre-activation recovery. The caller supplies one protected event
// id; no backlog scan, watermark change, or alternate handler is possible.
async function processProtectedEvent({
  eventId,
  activationWatermark,
  now = new Date(),
  claimant = workerId("cgp-recovery"),
  registry = createCgpConsumerRegistry(),
  config = resolveConfig(),
  sequelize = models.sequelize,
} = {}) {
  if (!config.enabled || !config.valid) {
    return { eventId, state: "BLOCKED", reason: config.reason };
  }
  const cutoff = parseWatermark(activationWatermark);
  if (!cutoff || !config.watermark || cutoff.getTime() !== config.watermark.getTime()) {
    return { eventId, state: "BLOCKED", reason: "RECOVERY_WATERMARK_MISMATCH" };
  }
  const claimed = await sequelize.transaction((transaction) => outbox.claimProtectedEventById({
    transaction,
    eventId,
    eventType: EVENT_TYPE,
    eventVersion: EVENT_VERSION,
    maxCreatedAt: cutoff,
    now,
    workerId: claimant,
    sequelize,
  }));
  if (!claimed.length) return { eventId, state: "BLOCKED", reason: "EVENT_NOT_ELIGIBLE_AT_CLAIM" };
  const event = claimed[0];
  try {
    const result = await outbox.dispatchClaimedEvent({ event, handlers: registry.snapshot() });
    await sequelize.transaction((transaction) => outbox.markPublished({ transaction, eventId, workerId: claimant, now }));
    return { eventId, state: "PUBLISHED", result };
  } catch (error) {
    await sequelize.transaction((transaction) => outbox.markRetryableFailure({ transaction, eventId, workerId: claimant, error, now }));
    throw error;
  }
}

async function start({ env = process.env, logger = console, registry = createCgpConsumerRegistry(), now = () => new Date() } = {}) {
  if (activeRuntime) return { ...activeRuntime, started: false, reason: "ALREADY_RUNNING" };
  const config = resolveConfig(env);
  if (!config.enabled || !config.valid) {
    if (config.enabled && !config.valid) logger.warn(`[CGPRuntime] disabled fail-closed: ${config.reason}`);
    return { enabled: false, started: false, reason: config.reason, config };
  }
  const claimant = workerId();
  let running = true;
  const tick = async () => {
    if (!running) return;
    try { await processOnce({ config, claimant, registry, now: now() }); }
    catch (error) { logger.error(`[CGPRuntime] dispatch tick failed: ${error.message}`); }
  };
  const timer = setInterval(tick, config.pollIntervalMs);
  timer.unref?.();
  activeRuntime = { enabled: true, started: true, config, claimant, timer, processOnce: tick, close: async () => { running = false; clearInterval(timer); if (activeRuntime?.claimant === claimant) activeRuntime = null; } };
  await tick();
  return activeRuntime;
}

async function stop() {
  if (!activeRuntime) return false;
  const runtime = activeRuntime;
  await runtime.close();
  return true;
}

function getActiveRuntime() { return activeRuntime; }

module.exports = {
  EVENT_TYPE,
  EVENT_VERSION,
  ENABLE_ENV,
  WATERMARK_ENV,
  POLL_ENV,
  DEFAULT_POLL_INTERVAL_MS,
  parseWatermark,
  resolveConfig,
  createCgpConsumerRegistry,
  claimEligible,
  processOnce,
  processProtectedEvent,
  start,
  stop,
  getActiveRuntime,
};
