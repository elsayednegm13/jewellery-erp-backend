"use strict";

const path = require("path");
const { Sequelize } = require("sequelize");
const Umzug = require("umzug");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const PERSISTENT_DATABASE = "darfus_erp";
const REHEARSAL_PREFIX = "darfus_erp_prod_promotion_rehearsal_";
const INITIAL_MIGRATION_COUNT = 61;
const APPROVED_MIGRATIONS = Object.freeze([
  "20260809010000-cgp-aggregate-lifecycle-pricing-foundation.js",
  "20260809020000-create-cgp-pricing-snapshots.js",
  "20260809030000-create-durable-event-infrastructure.js",
  "20260809040000-create-integration-statuses.js",
  "20260809050000-add-cgp-future-capabilities.js",
  "20260809060000-cgp-canonical-posting-facts.js",
  "20260809070000-gold-center-approved-price-authority.js",
  "20260809080000-cgp-inventory-pending-integration-origin.js",
  "20260809090000-customer-creditor-account-foundation.js",
  "20260809100000-cgp-accounting-recognition-and-customer-financial-liabilities.js",
  "20260809110000-create-gold-core-events.js",
  "20260809120000-create-customer-crm-projections.js",
  "20260809130000-create-financial-approval-policy-foundation.js",
  "20260809140000-create-financial-settlement-foundation.js",
  "20260809150000-create-cgp-reversal-hold-foundation.js",
  "20260809160000-cgp-reversal-compensation-finalization.js",
]);

class PersistentPromotionGuardError extends Error {
  constructor(code) { super(code); this.name = "PersistentPromotionGuardError"; this.code = code; }
}

const fail = (code) => { throw new PersistentPromotionGuardError(code); };
const present = (value) => value !== undefined && String(value).trim() !== "";

function resolvePromotionConfig({ env = process.env, target } = {}) {
  if (!target || !["persistent", "rehearsal"].includes(target)) fail("PROMOTION_TARGET_MODE_REQUIRED");
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "development") fail("PROMOTION_NODE_ENV_REQUIRED");
  if (present(env.DATABASE_URL)) fail("PROMOTION_DATABASE_URL_FORBIDDEN");
  const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_SSL"];
  const missing = required.filter((key) => !present(env[key]));
  if (!present(env.DB_PASSWORD) && !present(env.DB_PASS)) missing.push("DB_PASSWORD");
  if (missing.length) fail("PROMOTION_DATABASE_CONFIG_MISSING");
  let config;
  try { config = resolveDatabaseEnv(env); } catch { fail("PROMOTION_DATABASE_CONFIG_INVALID"); }
  if (target === "persistent" && config.database !== PERSISTENT_DATABASE) fail("PROMOTION_PERSISTENT_TARGET_REJECTED");
  if (target === "rehearsal" && (!config.database.startsWith(REHEARSAL_PREFIX) || config.database === PERSISTENT_DATABASE)) fail("PROMOTION_REHEARSAL_TARGET_REJECTED");
  return config;
}

function createSequelize(config) {
  return new Sequelize(config.database, config.username, config.password, {
    host: config.host, port: config.port, dialect: "postgres", logging: false,
    ...(config.ssl ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } } : {}),
  });
}

function createMigrationRunner(sequelize) {
  return new Umzug({
    migrations: { path: path.join(__dirname, "../migrations"), params: [sequelize.getQueryInterface(), Sequelize] },
    storage: "sequelize", storageOptions: { sequelize, tableName: "SequelizeMeta" }, logging: false,
  });
}

async function runPersistentPromotionMigrationCommand({ env = process.env, target, dryRun = true, makeConnection = createSequelize, makeMigrator = createMigrationRunner } = {}) {
  const config = resolvePromotionConfig({ env, target });
  const sequelize = makeConnection(config);
  try {
    await sequelize.authenticate();
    const [databaseRows] = await sequelize.query("SELECT current_database() AS database");
    const actualDatabase = databaseRows?.[0]?.database;
    if (actualDatabase !== config.database) fail("PROMOTION_ACTUAL_TARGET_MISMATCH");
    if (target === "persistent" && actualDatabase !== PERSISTENT_DATABASE) fail("PROMOTION_PERSISTENT_TARGET_REJECTED");
    if (target === "rehearsal" && !actualDatabase.startsWith(REHEARSAL_PREFIX)) fail("PROMOTION_REHEARSAL_TARGET_REJECTED");
    const [[meta]] = await sequelize.query('SELECT count(*)::int AS count FROM "SequelizeMeta"');
    if (Number(meta?.count) !== INITIAL_MIGRATION_COUNT) fail("PROMOTION_INITIAL_MIGRATION_BASELINE_REJECTED");
    const [[activeWrites]] = await sequelize.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND query NOT ILIKE 'SELECT%' AND pid <> pg_backend_pid()");
    if (Number(activeWrites?.count) !== 0) fail("PROMOTION_ACTIVE_BUSINESS_WRITES");
    const migrator = makeMigrator(sequelize);
    const pending = (await migrator.pending()).map((migration) => path.basename(migration.file));
    if (pending.length !== APPROVED_MIGRATIONS.length || pending.some((name, index) => name !== APPROVED_MIGRATIONS[index])) fail("PROMOTION_PENDING_SET_REJECTED");
    const result = { database: actualDatabase, initialMigrations: Number(meta.count), activeBusinessWrites: Number(activeWrites.count), expectedMigrations: APPROVED_MIGRATIONS, migrationExecution: dryRun ? "BLOCKED_BY_DRY_RUN" : "EXECUTED" };
    if (dryRun) return result;
    await migrator.up({ migrations: APPROVED_MIGRATIONS });
    const [[after]] = await sequelize.query('SELECT count(*)::int AS count FROM "SequelizeMeta"');
    if (Number(after?.count) !== INITIAL_MIGRATION_COUNT + APPROVED_MIGRATIONS.length) fail("PROMOTION_FINAL_MIGRATION_COUNT_REJECTED");
    return { ...result, finalMigrations: Number(after.count) };
  } finally { await sequelize.close(); }
}

module.exports = { PERSISTENT_DATABASE, REHEARSAL_PREFIX, INITIAL_MIGRATION_COUNT, APPROVED_MIGRATIONS, PersistentPromotionGuardError, resolvePromotionConfig, runPersistentPromotionMigrationCommand };
