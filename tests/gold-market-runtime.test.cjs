const test = require("node:test");
const assert = require("node:assert/strict");

const runtime = require("../src/services/gold-market-runtime.service");

function setting(overrides = {}) {
  return {
    companyId: "CMP-1",
    pricingMode: "LIVE_PROVIDER",
    activeProvider: "GOLDAPI_IO",
    marketCurrency: "AED",
    refreshIntervalSeconds: 30,
    staleAfterSeconds: 120,
    enabled: true,
    ...overrides,
  };
}

test("runtime is fail-closed when REDIS_URL is absent", async () => {
  const result = await runtime.start({ redisUrl: "" });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "REDIS_NOT_CONFIGURED");
});

test("scheduler registration is deterministic and duplicate-safe", async () => {
  const schedulers = new Map();
  const queue = {
    async upsertJobScheduler(id, repeat, template) {
      schedulers.set(id, { id, repeat, template });
    },
    async getJobSchedulers() { return [...schedulers.values()]; },
    async removeJobScheduler(id) { schedulers.delete(id); },
  };
  const scope = runtime.normalizeScope(setting());
  const first = await runtime.reconcileSchedules({ queue, scopes: [scope] });
  const second = await runtime.reconcileSchedules({ queue, scopes: [scope] });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(schedulers.size, 1);
  assert.equal([...schedulers.keys()][0], "gold-market-refresh:CMP-1:GOLDAPI_IO:AED:XAU");
  assert.equal(schedulers.values().next().value.repeat.every, 30000);
  assert.equal(schedulers.values().next().value.template.opts.attempts, 3);
});

test("reconciliation removes only stale Gold Market schedules", async () => {
  const removed = [];
  const queue = {
    async upsertJobScheduler() {},
    async getJobSchedulers() { return [{ id: "gold-market-refresh:old:GOLDAPI_IO:AED:XAU" }, { id: "other-queue:scheduler" }]; },
    async removeJobScheduler(id) { removed.push(id); },
  };
  await runtime.reconcileSchedules({ queue, scopes: [runtime.normalizeScope(setting())] });
  assert.deepEqual(removed, ["gold-market-refresh:old:GOLDAPI_IO:AED:XAU"]);
});

test("worker callback resolves current settings and never trusts stale job provider data", async () => {
  const calls = [];
  const settingModel = {
    async findOne() { return { ...setting({ activeProvider: "GOLDAPI_IO", marketCurrency: "AED", staleAfterSeconds: 120 }) }; },
  };
  const result = await runtime.refreshCurrentSettings({ companyId: "CMP-1", providerId: "METALS_API", currency: "USD" }, {
    settingModel,
    refresh: async (input) => { calls.push(input); return { ok: true }; },
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls[0], { companyId: "CMP-1", providerId: "GOLDAPI_IO", currency: "AED", metal: "XAU", staleAfterSeconds: 120 });
});

test("disabled settings are skipped without an external refresh", async () => {
  let called = false;
  const settingModel = { async findOne() { return { ...setting({ enabled: false }) }; } };
  const result = await runtime.refreshCurrentSettings({ companyId: "CMP-1" }, { settingModel, refresh: async () => { called = true; } });
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});

test("start registers one schedule and shutdown closes the worker/queue", async () => {
  const calls = { upsert: 0, close: 0 };
  const queue = {
    async upsertJobScheduler() { calls.upsert += 1; },
    async getJobSchedulers() { return []; },
    async removeJobScheduler() {},
  };
  const worker = { on() {} };
  const infrastructure = { enabled: true, queue, worker, close: async () => { calls.close += 1; } };
  const settingModel = { async findAll() { return [setting()]; } };
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const result = await runtime.start({ redisUrl: "redis://example.invalid", settingModel, infrastructureFactory: () => infrastructure });
  assert.equal(result.enabled, true);
  assert.equal(calls.upsert, 1);
  assert.equal(await runtime.stop(), true);
  assert.equal(calls.close, 1);
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
});
