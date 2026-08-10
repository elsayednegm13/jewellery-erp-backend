"use strict";

// Narrow disposable-DB guard for the migration rehearsal only. It never accepts
// the persistent or named acceptance database and never runs all pending work.
const path = require("path");
const { Sequelize } = require("sequelize");
const Umzug = require("umzug");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const EXPECTED = "20260810010000-gold-live-feed-foundation.js";
const PREFIX = "darfus_erp_gold_live_feed_01_rehearsal_";
const PERSISTENT = "darfus_erp";
const ACCEPTANCE = "darfus_erp_inventory_rehearsal_20260804_160500z";

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function resolveTarget(env = process.env) {
  const target = String(env.DB_NAME || "").trim();
  if (!target || !target.startsWith(PREFIX) || target === PERSISTENT || target === ACCEPTANCE) fail("GOLD_LIVE_FEED_REHEARSAL_TARGET_REJECTED");
  const config = resolveDatabaseEnv({ ...env, DATABASE_URL: "", DB_NAME: target });
  if (config.database !== target) fail("GOLD_LIVE_FEED_REHEARSAL_TARGET_MISMATCH");
  return config;
}

async function main() {
  if (!process.argv.includes("--execute")) { console.log(JSON.stringify({ dryRun: true, expected: EXPECTED })); return; }
  const config = resolveTarget();
  const sequelize = new Sequelize(config.database, config.username, config.password, { host: config.host, port: config.port, dialect: "postgres", logging: false });
  try {
    await sequelize.authenticate();
    const [[current]] = await sequelize.query("SELECT current_database() AS db");
    if (current.db !== config.database) fail("GOLD_LIVE_FEED_REHEARSAL_ACTUAL_TARGET_MISMATCH");
    const migrator = new Umzug({ migrations: { path: path.join(__dirname, "../migrations"), params: [sequelize.getQueryInterface(), Sequelize] }, storage: "sequelize", storageOptions: { sequelize, tableName: "SequelizeMeta" }, logging: false });
    const pending = (await migrator.pending()).map((migration) => path.basename(migration.file));
    if (pending.length !== 1 || pending[0] !== EXPECTED) fail("GOLD_LIVE_FEED_REHEARSAL_PENDING_SET_REJECTED");
    await migrator.up({ migrations: [EXPECTED] });
    const [[after]] = await sequelize.query("SELECT count(*)::int AS count FROM \"SequelizeMeta\" WHERE name = :name", { replacements: { name: EXPECTED } });
    if (Number(after.count) !== 1) fail("GOLD_LIVE_FEED_REHEARSAL_MIGRATION_NOT_RECORDED");
    console.log(JSON.stringify({ database: current.db, migration: EXPECTED, applied: 1 }));
  } finally { await sequelize.close(); }
}

main().catch((error) => { console.error(error.code || "GOLD_LIVE_FEED_REHEARSAL_FAILED"); process.exitCode = 1; });
