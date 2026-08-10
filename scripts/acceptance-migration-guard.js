"use strict";

const path = require("path");
const { Sequelize } = require("sequelize");
const Umzug = require("umzug");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const ACCEPTANCE_MIGRATION = "20260807130000-returned-asset-review-and-restock-permission.js";
const CGP_IMP_01_MIGRATIONS = Object.freeze([
  "20260809010000-cgp-aggregate-lifecycle-pricing-foundation.js",
  "20260809020000-create-cgp-pricing-snapshots.js",
]);
const CGP_IMP_02_MIGRATIONS = Object.freeze([
  "20260809030000-create-durable-event-infrastructure.js",
  "20260809040000-create-integration-statuses.js",
]);
const CGP_IMP_11_MIGRATIONS = Object.freeze([
  "20260809050000-add-cgp-future-capabilities.js",
]);
const CGP_IMP_03_MIGRATIONS = Object.freeze([
  "20260809060000-cgp-canonical-posting-facts.js",
]);
const CGP_PRICE_AUTHORITY_CLOSURE_MIGRATIONS = Object.freeze([
  "20260809070000-gold-center-approved-price-authority.js",
]);
const CGP_IMP_04_MIGRATIONS = Object.freeze([
  "20260809080000-cgp-inventory-pending-integration-origin.js",
]);
const CGP_IMP_05A_MIGRATIONS = Object.freeze([
  "20260809090000-customer-creditor-account-foundation.js",
]);
const CGP_IMP_05_MIGRATIONS = Object.freeze([
  "20260809100000-cgp-accounting-recognition-and-customer-financial-liabilities.js",
]);
const CGP_IMP_06_MIGRATIONS = Object.freeze([
  "20260809110000-create-gold-core-events.js",
]);
const CGP_IMP_08_MIGRATIONS = Object.freeze([
  "20260809120000-create-customer-crm-projections.js",
]);
const CGP_IMP_09A_MIGRATIONS = Object.freeze([
  "20260809130000-create-financial-approval-policy-foundation.js",
]);
const CGP_IMP_09_MIGRATIONS = Object.freeze([
  "20260809140000-create-financial-settlement-foundation.js",
]);
const CGP_IMP_10A_MIGRATIONS = Object.freeze([
  "20260809150000-create-cgp-reversal-hold-foundation.js",
]);
const CGP_IMP_10_MIGRATIONS = Object.freeze([
  "20260809160000-cgp-reversal-compensation-finalization.js",
]);
const GOLD_LIVE_FEED_01_MIGRATIONS = Object.freeze([
  "20260810010000-gold-live-feed-foundation.js",
]);
const GOLD_LIVE_FEED_03_MIGRATIONS = Object.freeze([
  "20260810020000-gold-cgp-pricing-policies.js",
]);
const DISCRETE_KEYS = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_PASS", "DB_SSL"];

class AcceptanceMigrationGuardError extends Error {
  constructor(code) {
    super(code);
    this.name = "AcceptanceMigrationGuardError";
    this.code = code;
  }
}

function hasValue(value) {
  return value !== undefined && String(value).trim() !== "";
}

function reject(code) {
  throw new AcceptanceMigrationGuardError(code);
}

function resolveAcceptanceMigrationConfig(env = process.env) {
  const environment = String(env.NODE_ENV || "").trim().toLowerCase();
  if (environment !== "development") reject("ACCEPTANCE_MIGRATION_NODE_ENV_REQUIRED");

  const hasUrl = hasValue(env.DATABASE_URL);
  const hasDiscrete = DISCRETE_KEYS.some((key) => hasValue(env[key]));
  if (hasUrl && hasDiscrete) reject("ACCEPTANCE_MIGRATION_CONFIG_CONFLICT");
  if (!hasUrl) {
    const hasPassword = hasValue(env.DB_PASSWORD) || hasValue(env.DB_PASS);
    const missing = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_SSL"].filter((key) => !hasValue(env[key]));
    if (!hasPassword) missing.push("DB_PASSWORD");
    if (missing.length) reject("ACCEPTANCE_MIGRATION_TARGET_MISSING");
  }

  let resolved;
  try {
    resolved = resolveDatabaseEnv(env);
  } catch {
    reject("ACCEPTANCE_MIGRATION_CONFIG_INVALID");
  }
  if (resolved.database !== ACCEPTANCE_DATABASE) reject("ACCEPTANCE_MIGRATION_TARGET_REJECTED");
  return resolved;
}

function createSequelize(config) {
  if (config.connectionString) {
    return new Sequelize(config.connectionString, {
      dialect: "postgres",
      logging: false,
      ...(config.ssl ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } } : {}),
    });
  }
  return new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    port: config.port,
    dialect: "postgres",
    logging: false,
    ...(config.ssl ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } } : {}),
  });
}

function createMigrationRunner(sequelize) {
  return new Umzug({
    migrations: {
      path: path.join(__dirname, "../migrations"),
      params: [sequelize.getQueryInterface(), Sequelize],
    },
    storage: "sequelize",
    storageOptions: { sequelize, tableName: "SequelizeMeta" },
    logging: false,
  });
}

function normalizeExpectedMigrations(expectedMigrations) {
  if (!Array.isArray(expectedMigrations) || !expectedMigrations.length || expectedMigrations.some((name) => typeof name !== "string" || !name.endsWith(".js"))) {
    reject("ACCEPTANCE_MIGRATION_SET_INVALID");
  }
  return expectedMigrations;
}

async function runAcceptanceMigrationCommand({
  env = process.env,
  dryRun = true,
  makeConnection = createSequelize,
  makeMigrator = createMigrationRunner,
  expectedMigrations = [ACCEPTANCE_MIGRATION],
} = {}) {
  const expected = normalizeExpectedMigrations(expectedMigrations);
  const config = resolveAcceptanceMigrationConfig(env);
  const sequelize = makeConnection(config);
  try {
    await sequelize.authenticate();
    const [rows] = await sequelize.query("SELECT current_database() AS db");
    const actualDatabase = rows?.[0]?.db;
    if (actualDatabase !== ACCEPTANCE_DATABASE) reject("ACCEPTANCE_MIGRATION_ACTUAL_TARGET_MISMATCH");

    const result = {
      database: actualDatabase,
      hostClass: config.host === "localhost" || config.host === "127.0.0.1" ? "local" : "remote",
      migrationExecution: dryRun ? "BLOCKED_BY_DRY_RUN" : "EXECUTED",
      expectedMigrations: expected,
    };
    if (dryRun) return result;

    // The migrator receives this already-verified Sequelize connection; it does
    // not reload config or start a second process with a different target.
    const migrator = makeMigrator(sequelize);
    const pendingNames = (await migrator.pending()).map((migration) => path.basename(migration.file));
    if (pendingNames.length !== expected.length || pendingNames.some((name, index) => name !== expected[index])) {
      reject("ACCEPTANCE_MIGRATION_PENDING_SET_REJECTED");
    }
    await migrator.up({ migrations: expected });
    return result;
  } finally {
    await sequelize.close();
  }
}

module.exports = {
  ACCEPTANCE_DATABASE,
  ACCEPTANCE_MIGRATION,
  CGP_IMP_01_MIGRATIONS,
  CGP_IMP_02_MIGRATIONS,
  CGP_IMP_11_MIGRATIONS,
  CGP_IMP_03_MIGRATIONS,
  CGP_PRICE_AUTHORITY_CLOSURE_MIGRATIONS,
  CGP_IMP_04_MIGRATIONS,
  CGP_IMP_05A_MIGRATIONS,
  CGP_IMP_05_MIGRATIONS,
  CGP_IMP_06_MIGRATIONS,
  CGP_IMP_08_MIGRATIONS,
  CGP_IMP_09A_MIGRATIONS,
  CGP_IMP_09_MIGRATIONS,
  CGP_IMP_10A_MIGRATIONS,
  CGP_IMP_10_MIGRATIONS,
  GOLD_LIVE_FEED_01_MIGRATIONS,
  GOLD_LIVE_FEED_03_MIGRATIONS,
  AcceptanceMigrationGuardError,
  resolveAcceptanceMigrationConfig,
  runAcceptanceMigrationCommand,
};
