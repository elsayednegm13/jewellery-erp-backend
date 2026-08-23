"use strict";

const assert = require("node:assert/strict");
const {
  ACCEPTANCE_DATABASE,
  ACCEPTANCE_MIGRATION,
  CGP_IMP_01_MIGRATIONS,
  CGP_IMP_02_MIGRATIONS,
  CGP_IMP_11_MIGRATIONS,
  CGP_IMP_03_MIGRATIONS,
  CGP_IMP_04_MIGRATIONS,
  CGP_IMP_05A_MIGRATIONS,
  CGP_IMP_05_MIGRATIONS,
  CGP_IMP_06_MIGRATIONS,
  GOLD_LIVE_FEED_04_MIGRATIONS,
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
  assert.deepEqual(acceptance.expectedMigrations, [ACCEPTANCE_MIGRATION]);
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

  // A named CGP batch is still an exact, fail-closed migration set rather
  // than a permissive "run every pending migration" path.
  const cgpCalls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    expectedMigrations: CGP_IMP_01_MIGRATIONS,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, cgpCalls),
    makeMigrator: () => ({ pending: async () => CGP_IMP_01_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, CGP_IMP_01_MIGRATIONS); cgpCalls.migrations += 1; } }),
  });
  assert.equal(cgpCalls.migrations, 1);

  const cgpImp02Calls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    expectedMigrations: CGP_IMP_02_MIGRATIONS,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, cgpImp02Calls),
    makeMigrator: () => ({ pending: async () => CGP_IMP_02_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, CGP_IMP_02_MIGRATIONS); cgpImp02Calls.migrations += 1; } }),
  });
  assert.equal(cgpImp02Calls.migrations, 1);

  const cgpImp11Calls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    expectedMigrations: CGP_IMP_11_MIGRATIONS,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, cgpImp11Calls),
    makeMigrator: () => ({ pending: async () => CGP_IMP_11_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, CGP_IMP_11_MIGRATIONS); cgpImp11Calls.migrations += 1; } }),
  });
  assert.equal(cgpImp11Calls.migrations, 1);

  const cgpImp03Calls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    expectedMigrations: CGP_IMP_03_MIGRATIONS,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, cgpImp03Calls),
    makeMigrator: () => ({ pending: async () => CGP_IMP_03_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, CGP_IMP_03_MIGRATIONS); cgpImp03Calls.migrations += 1; } }),
  });
  assert.equal(cgpImp03Calls.migrations, 1);

  const cgpImp04Calls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    expectedMigrations: CGP_IMP_04_MIGRATIONS,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, cgpImp04Calls),
    makeMigrator: () => ({ pending: async () => CGP_IMP_04_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, CGP_IMP_04_MIGRATIONS); cgpImp04Calls.migrations += 1; } }),
  });
  assert.equal(cgpImp04Calls.migrations, 1);

  const cgpImp05aCalls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    expectedMigrations: CGP_IMP_05A_MIGRATIONS,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, cgpImp05aCalls),
    makeMigrator: () => ({ pending: async () => CGP_IMP_05A_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, CGP_IMP_05A_MIGRATIONS); cgpImp05aCalls.migrations += 1; } }),
  });
  assert.equal(cgpImp05aCalls.migrations, 1);

  const cgpImp05Calls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    expectedMigrations: CGP_IMP_05_MIGRATIONS,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, cgpImp05Calls),
    makeMigrator: () => ({ pending: async () => CGP_IMP_05_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, CGP_IMP_05_MIGRATIONS); cgpImp05Calls.migrations += 1; } }),
  });
  assert.equal(cgpImp05Calls.migrations, 1);
  const cgpImp06Calls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    expectedMigrations: CGP_IMP_06_MIGRATIONS,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, cgpImp06Calls),
    makeMigrator: () => ({ pending: async () => CGP_IMP_06_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, CGP_IMP_06_MIGRATIONS); cgpImp06Calls.migrations += 1; } }),
  });
  assert.equal(cgpImp06Calls.migrations, 1);
  const goldLiveFeed04Calls = { authenticate: 0, query: 0, close: 0, migrations: 0 };
  await runAcceptanceMigrationCommand({
    env: baseEnv,
    dryRun: false,
    expectedMigrations: GOLD_LIVE_FEED_04_MIGRATIONS,
    makeConnection: () => fakeConnection(ACCEPTANCE_DATABASE, goldLiveFeed04Calls),
    makeMigrator: () => ({ pending: async () => GOLD_LIVE_FEED_04_MIGRATIONS.map((file) => ({ file })), up: async ({ migrations }) => { assert.deepEqual(migrations, GOLD_LIVE_FEED_04_MIGRATIONS); goldLiveFeed04Calls.migrations += 1; } }),
  });
  assert.equal(goldLiveFeed04Calls.migrations, 1);
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
