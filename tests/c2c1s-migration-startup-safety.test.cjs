const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MigrationSafetyError,
  assertTargetPolicy,
  resolveExplicitTarget,
  runSafeMigration,
} = require("../scripts/migrate-safe.js");

const workspace = path.resolve(__dirname, "../..");
const compose = fs.readFileSync(path.join(workspace, "docker-compose.yml"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(workspace, "backend/package.json"), "utf8"));
const guardSource = fs.readFileSync(path.join(workspace, "backend/scripts/migrate-safe.js"), "utf8");

function disposableEnv(overrides = {}) {
  return {
    NODE_ENV: "development",
    DB_HOST: "127.0.0.1",
    DB_PORT: "5433",
    DB_NAME: "darfus_c2c1s_test_target",
    DB_USER: "postgres",
    DB_PASSWORD: "postgres",
    DB_SSL: "false",
    DARFUS_MIGRATION_TARGET_MODE: "disposable",
    ...overrides,
  };
}

function mockConnection(database, pending = []) {
  return {
    authenticate: async () => {},
    query: async (sql) => {
      if (sql.includes("current_database")) return [[{ db: database }]];
      return [[{ count: 0 }]];
    },
    close: async () => {},
    pending,
  };
}

test("normal Compose startup has no automatic migration", () => {
  assert.match(compose, /command:\s*npm start/);
  assert.doesNotMatch(compose, /command:.*db:migrate/);
  assert.doesNotMatch(compose, /DARFUS_OFFICIAL_MIGRATION_APPROVED/);
  assert.equal(packageJson.scripts.start, "node src/server.js");
  assert.equal(packageJson.scripts["db:migrate"], "node scripts/migrate-safe.js");
  assert.equal(packageJson.scripts["db:migrate:safe"], "node scripts/migrate-safe.js");
});

test("target identity and explicit mode are required", () => {
  assert.throws(() => resolveExplicitTarget(disposableEnv({ DARFUS_MIGRATION_TARGET_MODE: "" })), (error) => error.code === "MIGRATION_TARGET_MODE_REQUIRED");
  assert.throws(() => resolveExplicitTarget(disposableEnv({ DB_NAME: "" })), (error) => error.code === "MIGRATION_TARGET_EXPLICIT_REQUIRED");
  assert.equal(resolveExplicitTarget(disposableEnv()).intendedDatabase, "darfus_c2c1s_test_target");
});

test("protected official DB denies without exact approval", () => {
  assert.throws(
    () => assertTargetPolicy({ intendedDatabase: "darfus_erp", actualDatabase: "darfus_erp", targetMode: "official", officialApproval: "" }),
    (error) => error instanceof MigrationSafetyError && error.code === "OFFICIAL_DB_MIGRATION_NOT_AUTHORIZED",
  );
  assert.doesNotThrow(() => assertTargetPolicy({ intendedDatabase: "darfus_erp", actualDatabase: "darfus_erp", targetMode: "official", officialApproval: "YES" }));
});

test("actual target mismatch denies before migration", () => {
  assert.throws(
    () => assertTargetPolicy({ intendedDatabase: "darfus_c2c1s_test_target", actualDatabase: "darfus_erp", targetMode: "disposable", officialApproval: "" }),
    (error) => error.code === "MIGRATION_TARGET_MISMATCH",
  );
});

test("protected refusal happens before migration runner construction", async () => {
  let runnerCalls = 0;
  const env = disposableEnv({ DB_NAME: "darfus_erp" });
  await assert.rejects(
    runSafeMigration({
      env,
      argv: ["--execute", "--migrations=20260824010000-create-asset-revision-schema.js"],
      makeConnection: () => mockConnection("darfus_erp"),
      makeMigrator: () => {
        runnerCalls += 1;
        throw new Error("runner must not start");
      },
      log: () => {},
    }),
    (error) => error.code === "OFFICIAL_DB_MIGRATION_NOT_AUTHORIZED",
  );
  assert.equal(runnerCalls, 0);
});

test("safe disposable target can be inspected without execution", async () => {
  let runnerCalls = 0;
  const result = await runSafeMigration({
    env: disposableEnv(),
    argv: [],
    makeConnection: () => mockConnection("darfus_c2c1s_test_target", []),
    makeMigrator: () => {
      runnerCalls += 1;
      return { pending: async () => [] };
    },
    log: () => {},
  });
  assert.equal(result.executed, false);
  assert.equal(runnerCalls, 1);
});

test("guard source performs actual database proof before creating the migrator", () => {
  assert.ok(guardSource.indexOf('SELECT current_database() AS db') < guardSource.indexOf('const migrator = makeMigrator(sequelize)'));
  assert.match(guardSource, /DARFUS_OFFICIAL_MIGRATION_APPROVED/);
  assert.match(guardSource, /officialApproval !== "YES"/);
});
