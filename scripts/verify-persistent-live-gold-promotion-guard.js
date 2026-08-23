"use strict";

const assert = require("node:assert/strict");
const {
  PERSISTENT_DATABASE,
  REHEARSAL_PREFIX,
  APPROVED_MIGRATIONS,
  PersistentLiveGoldPromotionGuardError,
  resolvePromotionConfig,
  runPromotion,
} = require("./persistent-live-gold-promotion-guard");

const baseEnv = Object.freeze({
  NODE_ENV: "development",
  DB_HOST: "localhost",
  DB_PORT: "5432",
  DB_USER: "guard_test_user",
  DB_PASSWORD: "guard_test_password",
  DB_SSL: "false",
});

function expectGuard(code, fn) {
  assert.throws(fn, (error) => error instanceof PersistentLiveGoldPromotionGuardError && error.code === code);
}

function fakeConnection(database, calls) {
  return {
    async authenticate() { calls.authenticate += 1; },
    async query(sql) {
      calls.query += 1;
      if (sql === "SELECT current_database() AS db") return [[{ db: database }], {}];
      if (sql.includes('"SequelizeMeta"')) {
        calls.metaQueries = (calls.metaQueries || 0) + 1;
        return [[{ count: calls.metaQueries > 1 ? 80 : 77 }], {}];
      }
      if (sql.includes("pg_stat_activity")) return [[{ count: 0 }], {}];
      throw new Error(`unexpected query: ${sql}`);
    },
    async close() { calls.close += 1; },
  };
}

async function main() {
  const persistentEnv = { ...baseEnv, DB_NAME: PERSISTENT_DATABASE };
  const rehearsalEnv = { ...baseEnv, DB_NAME: `${REHEARSAL_PREFIX}guard_test` };

  // Exact persistent target is accepted, but default execution is dry-run.
  const calls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  const result = await runPromotion({
    env: persistentEnv,
    target: "persistent",
    makeConnection: () => fakeConnection(PERSISTENT_DATABASE, calls),
    makeMigrator: () => ({ pending: async () => APPROVED_MIGRATIONS.map((file) => ({ file })), up: async () => { calls.migrations += 1; } }),
  });
  assert.equal(result.database, PERSISTENT_DATABASE);
  assert.equal(result.migrationExecution, "BLOCKED_BY_DRY_RUN");
  assert.equal(calls.migrations, 0);
  console.log("PROMOTION_GUARD_CASE_1_EXACT_TARGET_DRY_RUN: PASS");

  // Rehearsal mode uses only the explicit disposable prefix.
  const rehearsalCalls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  const rehearsal = await runPromotion({
    env: rehearsalEnv,
    target: "rehearsal",
    makeConnection: () => fakeConnection(rehearsalEnv.DB_NAME, rehearsalCalls),
    makeMigrator: () => ({ pending: async () => APPROVED_MIGRATIONS.map((file) => ({ file })), up: async () => { rehearsalCalls.migrations += 1; } }),
  });
  assert.equal(rehearsal.database, rehearsalEnv.DB_NAME);
  assert.equal(rehearsalCalls.migrations, 0);
  console.log("PROMOTION_GUARD_CASE_2_REHEARSAL_DRY_RUN: PASS");

  expectGuard("PROMOTION_PERSISTENT_TARGET_REJECTED", () => resolvePromotionConfig({ env: { ...persistentEnv, DB_NAME: "darfus_erp_inventory_rehearsal_20260804_160500z" }, target: "persistent" }));
  expectGuard("PROMOTION_REHEARSAL_TARGET_REJECTED", () => resolvePromotionConfig({ env: { ...rehearsalEnv, DB_NAME: PERSISTENT_DATABASE }, target: "rehearsal" }));
  expectGuard("PROMOTION_DATABASE_CONFIG_MISSING", () => resolvePromotionConfig({ env: { ...persistentEnv, DB_NAME: "" }, target: "persistent" }));
  expectGuard("PROMOTION_REHEARSAL_TARGET_REJECTED", () => resolvePromotionConfig({ env: { ...rehearsalEnv, DB_NAME: "unknown_database" }, target: "rehearsal" }));
  console.log("PROMOTION_GUARD_CASE_3_WRONG_TARGET: PASS");

  const mismatchCalls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await assert.rejects(
    runPromotion({ env: persistentEnv, target: "persistent", makeConnection: () => fakeConnection("another_database", mismatchCalls), makeMigrator: () => ({ pending: async () => APPROVED_MIGRATIONS.map((file) => ({ file })), up: async () => { mismatchCalls.migrations += 1; } }) }),
    (error) => error instanceof PersistentLiveGoldPromotionGuardError && error.code === "PROMOTION_ACTUAL_TARGET_MISMATCH",
  );
  assert.equal(mismatchCalls.migrations, 0);
  console.log("PROMOTION_GUARD_CASE_4_ACTUAL_TARGET_MISMATCH: PASS");

  const pendingCases = [
    [],
    [APPROVED_MIGRATIONS[0], APPROVED_MIGRATIONS[2]],
    [APPROVED_MIGRATIONS[0], APPROVED_MIGRATIONS[1], "20260811010000-migration81.js"],
    [APPROVED_MIGRATIONS[1], APPROVED_MIGRATIONS[0], APPROVED_MIGRATIONS[2]],
    [...APPROVED_MIGRATIONS, "20260811010000-migration81.js"],
  ];
  for (const pending of pendingCases) {
    await assert.rejects(
      runPromotion({ env: persistentEnv, target: "persistent", makeConnection: () => fakeConnection(PERSISTENT_DATABASE, { authenticate: 0, query: 0, close: 0, migrations: 0 }), makeMigrator: () => ({ pending: async () => pending.map((file) => ({ file })), up: async () => { throw new Error("must not execute"); } }) }),
      (error) => error instanceof PersistentLiveGoldPromotionGuardError && error.code === "PROMOTION_PENDING_SET_REJECTED",
    );
  }
  console.log("PROMOTION_GUARD_CASE_5_PENDING_ALLOWLIST: PASS");

  expectGuard("PROMOTION_DATABASE_URL_FORBIDDEN", () => resolvePromotionConfig({ env: { ...persistentEnv, DATABASE_URL: "postgres://secret@localhost/darfus_erp" }, target: "persistent" }));
  expectGuard("PROMOTION_NODE_ENV_REQUIRED", () => resolvePromotionConfig({ env: { ...persistentEnv, NODE_ENV: "production" }, target: "persistent" }));
  console.log("PROMOTION_GUARD_CASE_6_CONFIG_FAIL_CLOSED_NO_SECRET_LEAK: PASS");

  const executeCalls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  const executed = await runPromotion({
    env: persistentEnv,
    target: "persistent",
    dryRun: false,
    makeConnection: () => fakeConnection(PERSISTENT_DATABASE, executeCalls),
    makeMigrator: () => ({ pending: async () => APPROVED_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, APPROVED_MIGRATIONS); executeCalls.migrations += 1; } }),
  });
  assert.equal(executed.migrationExecution, "EXECUTED");
  assert.equal(executeCalls.migrations, 1);
  console.log("PROMOTION_GUARD_CASE_7_EXPLICIT_EXECUTE_ALLOWLIST: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
