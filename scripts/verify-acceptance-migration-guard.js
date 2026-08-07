"use strict";

const assert = require("node:assert/strict");
const {
  ACCEPTANCE_DATABASE,
  ACCEPTANCE_MIGRATION,
  AcceptanceMigrationGuardError,
  resolveAcceptanceMigrationConfig,
  runAcceptanceMigrationCommand,
} = require("./acceptance-migration-guard");

const baseEnv = Object.freeze({
  NODE_ENV: "development",
  DB_HOST: "localhost",
  DB_PORT: "5432",
  DB_NAME: ACCEPTANCE_DATABASE,
  DB_USER: "guard_test_user",
  DB_PASSWORD: "guard_test_password",
  DB_SSL: "false",
});

function expectGuard(code, callback) {
  assert.throws(callback, (error) => error instanceof AcceptanceMigrationGuardError && error.code === code);
}

function fakeConnection(database, calls) {
  return {
    async authenticate() { calls.authenticate += 1; },
    async query(sql) { calls.query += 1; assert.equal(sql, "SELECT current_database() AS db"); return [[{ db: database }], {}]; },
    async close() { calls.close += 1; },
  };
}

async function main() {
  // Case 1: exact target validates, but the default remains dry-run.
  const acceptanceCalls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  const acceptance = await runAcceptanceMigrationCommand({
    env: baseEnv,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, acceptanceCalls),
    makeMigrator: () => ({ up: async () => { acceptanceCalls.migrations += 1; } }),
  });
  assert.equal(acceptance.database, ACCEPTANCE_DATABASE);
  assert.equal(acceptance.migrationExecution, "BLOCKED_BY_DRY_RUN");
  assert.equal(acceptanceCalls.migrations, 0);

  // Cases 2-4: dangerous, missing, and unknown resolved targets never connect.
  expectGuard("ACCEPTANCE_MIGRATION_TARGET_REJECTED", () => resolveAcceptanceMigrationConfig({ ...baseEnv, DB_NAME: "darfus_erp" }));
  expectGuard("ACCEPTANCE_MIGRATION_TARGET_MISSING", () => resolveAcceptanceMigrationConfig({ ...baseEnv, DB_NAME: "" }));
  expectGuard("ACCEPTANCE_MIGRATION_TARGET_REJECTED", () => resolveAcceptanceMigrationConfig({ ...baseEnv, DB_NAME: "unknown_database" }));

  // Case 5: config and actual server target differ; migration runner is never reached.
  const mismatchCalls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await assert.rejects(
    runAcceptanceMigrationCommand({
      env: baseEnv,
      makeConnection: () => fakeConnection("darfus_erp", mismatchCalls),
      makeMigrator: () => ({ up: async () => { mismatchCalls.migrations += 1; } }),
    }),
    (error) => error instanceof AcceptanceMigrationGuardError && error.code === "ACCEPTANCE_MIGRATION_ACTUAL_TARGET_MISMATCH",
  );
  assert.equal(mismatchCalls.migrations, 0);

  // Execute mode remains unit-testable without a database migration and refuses
  // any pending set other than migration 61.
  const executeCalls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, executeCalls),
    makeMigrator: () => ({ pending: async () => [{ file: ACCEPTANCE_MIGRATION }], up: async ({ migrations }) => { assert.deepEqual(migrations, [ACCEPTANCE_MIGRATION]); executeCalls.migrations += 1; } }),
  });
  assert.equal(executeCalls.migrations, 1);
  await assert.rejects(
    runAcceptanceMigrationCommand({
      env: baseEnv,
      dryRun: false,
      makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, { authenticate: 0, query: 0, close: 0, migrations: 0 }),
      makeMigrator: () => ({ pending: async () => [] }),
    }),
    (error) => error instanceof AcceptanceMigrationGuardError && error.code === "ACCEPTANCE_MIGRATION_PENDING_SET_REJECTED",
  );

  // Case 6 and 7: conflicting authority fails, and errors never contain a URL secret.
  const secretUrl = "postgres://guard_user:never-log-this-secret@localhost:5432/" + ACCEPTANCE_DATABASE;
  let captured;
  try { resolveAcceptanceMigrationConfig({ ...baseEnv, DATABASE_URL: secretUrl }); } catch (error) { captured = String(error); }
  assert.equal(captured, "AcceptanceMigrationGuardError: ACCEPTANCE_MIGRATION_CONFIG_CONFLICT");
  assert.equal(captured.includes("never-log-this-secret"), false);

  console.log("ACCEPTANCE_MIGRATION_GUARD_CASE_1: PASS");
  console.log("ACCEPTANCE_MIGRATION_GUARD_CASE_2: PASS");
  console.log("ACCEPTANCE_MIGRATION_GUARD_CASE_3: PASS");
  console.log("ACCEPTANCE_MIGRATION_GUARD_CASE_4: PASS");
  console.log("ACCEPTANCE_MIGRATION_GUARD_CASE_5: PASS");
  console.log("ACCEPTANCE_MIGRATION_GUARD_CASE_6: PASS");
  console.log("ACCEPTANCE_MIGRATION_GUARD_CASE_7: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
