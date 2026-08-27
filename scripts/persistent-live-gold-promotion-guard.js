"use strict";

const path = require("path");
const { Sequelize } = require("sequelize");
const Umzug = require("umzug");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const PERSISTENT_DATABASE = "darfus_erp";
const REHEARSAL_PREFIX = "darfus_erp_live_gold_promotion_01_rehearsal_";
const INITIAL_MIGRATION_COUNT = 77;
const FINAL_MIGRATION_COUNT = 80;
const APPROVED_MIGRATIONS = Object.freeze([
  "20260810010000-gold-live-feed-foundation.js",
  "20260810020000-gold-cgp-pricing-policies.js",
  "20260810030000-cgp-live-pricing-snapshot-lineage.js",
]);

class PersistentLiveGoldPromotionGuardError extends Error {
  constructor(code) { super(code); this.name = "PersistentLiveGoldPromotionGuardError"; this.code = code; }
}

const fail = (code) => { throw new PersistentLiveGoldPromotionGuardError(code); };
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
    host: config.host,
    port: config.port,
    dialect: "postgres",
    logging: false,
    ...(config.ssl ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } } : {}),
  });
}

function createMigrationRunner(sequelize) {
  return new Umzug({
    migrations: { path: path.join(__dirname, "../migrations"), params: [sequelize.getQueryInterface(), Sequelize] },
    storage: "sequelize",
    storageOptions: { sequelize, tableName: "SequelizeMeta" },
    logging: false,
  });
}

async function runPromotion({ env = process.env, target, dryRun = true, makeConnection = createSequelize, makeMigrator = createMigrationRunner } = {}) {
  const config = resolvePromotionConfig({ env, target });
  const sequelize = makeConnection(config);
  try {
    await sequelize.authenticate();
    const [databaseRows] = await sequelize.query("SELECT current_database() AS db");
    const actualDatabase = databaseRows?.[0]?.db;
    if (actualDatabase !== config.database) fail("PROMOTION_ACTUAL_TARGET_MISMATCH");
    if (target === "persistent" && actualDatabase !== PERSISTENT_DATABASE) fail("PROMOTION_PERSISTENT_TARGET_REJECTED");
    if (target === "rehearsal" && (!actualDatabase || !actualDatabase.startsWith(REHEARSAL_PREFIX))) fail("PROMOTION_REHEARSAL_TARGET_REJECTED");

    const [[meta]] = await sequelize.query('SELECT count(*)::int AS count FROM "SequelizeMeta"');
    if (Number(meta?.count) !== INITIAL_MIGRATION_COUNT) fail("PROMOTION_INITIAL_MIGRATION_BASELINE_REJECTED");

    const [[activeWrites]] = await sequelize.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND query NOT ILIKE 'SELECT%' AND pid <> pg_backend_pid()",
    );
    if (Number(activeWrites?.count) !== 0) fail("PROMOTION_ACTIVE_BUSINESS_WRITES");

    const migrator = makeMigrator(sequelize);
    const pending = (await migrator.pending()).map((migration) => path.basename(migration.file));
    if (pending.length !== APPROVED_MIGRATIONS.length || pending.some((name, index) => name !== APPROVED_MIGRATIONS[index])) {
      fail("PROMOTION_PENDING_SET_REJECTED");
    }

    const result = {
      database: actualDatabase,
      initialMigrations: Number(meta.count),
      activeBusinessWrites: Number(activeWrites.count),
      expectedMigrations: [...APPROVED_MIGRATIONS],
      migrationExecution: dryRun ? "BLOCKED_BY_DRY_RUN" : "EXECUTED",
    };
    if (dryRun) return result;

    await migrator.up({ migrations: [...APPROVED_MIGRATIONS] });
    const [[after]] = await sequelize.query('SELECT count(*)::int AS count FROM "SequelizeMeta"');
    if (Number(after?.count) !== FINAL_MIGRATION_COUNT) fail("PROMOTION_FINAL_MIGRATION_COUNT_REJECTED");
    return { ...result, finalMigrations: Number(after.count) };
  } finally {
    await sequelize.close();
  }
}

module.exports = {
  PERSISTENT_DATABASE,
  REHEARSAL_PREFIX,
  INITIAL_MIGRATION_COUNT,
  FINAL_MIGRATION_COUNT,
  APPROVED_MIGRATIONS,
  PersistentLiveGoldPromotionGuardError,
  resolvePromotionConfig,
  runPromotion,
};
