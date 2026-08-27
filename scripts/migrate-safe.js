"use strict";

require("dotenv").config();

const path = require("path");
const { Sequelize } = require("sequelize");
const Umzug = require("umzug");
const { resolveDatabaseEnv } = require("../src/config/database-env");

const PROTECTED_DB_NAME = "darfus_erp";
const TARGET_MODE_ENV = "DARFUS_MIGRATION_TARGET_MODE";
const OFFICIAL_APPROVAL_ENV = "DARFUS_OFFICIAL_MIGRATION_APPROVED";
const TARGET_MODES = new Set(["disposable", "official"]);

class MigrationSafetyError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "MigrationSafetyError";
    this.code = code;
  }
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function parseArguments(argv = process.argv.slice(2)) {
  const result = { execute: false, migrations: null, help: false, revert: false };
  for (const argument of argv) {
    if (argument === "--execute") {
      result.execute = true;
    } else if (argument === "--revert") {
      result.revert = true;
    } else if (argument === "--dry-run") {
      result.execute = false;
    } else if (argument === "--help" || argument === "-h") {
      result.help = true;
    } else if (argument.startsWith("--migrations=")) {
      const value = argument.slice("--migrations=".length).trim();
      result.migrations = value ? value.split(",").map((name) => name.trim()).filter(Boolean) : [];
    } else {
      throw new MigrationSafetyError("MIGRATION_ARGUMENT_INVALID", `Unsupported argument: ${argument}`);
    }
  }
  return result;
}

function resolveExplicitTarget(env = process.env) {
  const targetMode = String(env[TARGET_MODE_ENV] || "").trim().toLowerCase();
  if (!TARGET_MODES.has(targetMode)) {
    throw new MigrationSafetyError("MIGRATION_TARGET_MODE_REQUIRED");
  }

  const hasDatabaseUrl = nonEmpty(env.DATABASE_URL);
  const hasExplicitDatabaseName = nonEmpty(env.DB_NAME);
  if (!hasDatabaseUrl && !hasExplicitDatabaseName) {
    throw new MigrationSafetyError("MIGRATION_TARGET_EXPLICIT_REQUIRED");
  }

  let config;
  try {
    config = resolveDatabaseEnv(env);
  } catch (error) {
    throw new MigrationSafetyError("MIGRATION_TARGET_CONFIG_INVALID", error.message);
  }

  return Object.freeze({
    config,
    targetMode,
    intendedDatabase: config.database,
    officialApproval: String(env[OFFICIAL_APPROVAL_ENV] || "").trim(),
  });
}

function assertTargetPolicy({ intendedDatabase, actualDatabase, targetMode, officialApproval }) {
  if (!nonEmpty(actualDatabase)) {
    throw new MigrationSafetyError("MIGRATION_ACTUAL_DATABASE_UNKNOWN");
  }
  if (actualDatabase !== intendedDatabase) {
    throw new MigrationSafetyError("MIGRATION_TARGET_MISMATCH");
  }
  if (targetMode === "official" && actualDatabase !== PROTECTED_DB_NAME) {
    throw new MigrationSafetyError("OFFICIAL_TARGET_MUST_BE_PROTECTED_DB");
  }
  if (actualDatabase === PROTECTED_DB_NAME && (targetMode !== "official" || officialApproval !== "YES")) {
    throw new MigrationSafetyError("OFFICIAL_DB_MIGRATION_NOT_AUTHORIZED");
  }
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

function migrationNamesEqual(actual, expected) {
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

async function runSafeMigration({ env = process.env, argv = process.argv.slice(2), makeConnection = createSequelize, makeMigrator = createMigrationRunner, log = console.log } = {}) {
  const args = parseArguments(argv);
  if (args.help) {
    log("Usage: DARFUS_MIGRATION_TARGET_MODE=disposable DB_NAME=<db> npm run db:migrate:safe -- --migrations=<file[,file]> [--execute] [--revert]");
    return { help: true };
  }

  const target = resolveExplicitTarget(env);
  const sequelize = makeConnection(target.config);
  try {
    await sequelize.authenticate();
    const [rows] = await sequelize.query("SELECT current_database() AS db");
    const actualDatabase = rows?.[0]?.db;
    log(`MIGRATION_TARGET_DATABASE=${actualDatabase || "UNKNOWN"}`);
    assertTargetPolicy({
      intendedDatabase: target.intendedDatabase,
      actualDatabase,
      targetMode: target.targetMode,
      officialApproval: target.officialApproval,
    });

    // This is intentionally after the actual-database guard. The migrator is
    // never constructed for a protected target without explicit approval.
    const migrator = makeMigrator(sequelize);
    if (args.revert) {
      // Reversion is a clone-only rehearsal operation. It is never a route to
      // alter the official database, including one that has an approval flag.
      if (target.targetMode !== "disposable" || actualDatabase === PROTECTED_DB_NAME) {
        throw new MigrationSafetyError("OFFICIAL_DB_REVERT_NOT_AUTHORIZED");
      }
      if (!args.migrations?.length) {
        throw new MigrationSafetyError("APPROVED_MIGRATION_LIST_REQUIRED");
      }
      const executedNames = (await migrator.executed()).map((migration) => path.basename(migration.file));
      const trailingNames = executedNames.slice(-args.migrations.length);
      log(`MIGRATION_EXECUTED_COUNT=${executedNames.length}`);
      if (!migrationNamesEqual(trailingNames, args.migrations)) {
        throw new MigrationSafetyError("UNEXPECTED_MIGRATION_REVERT_SET");
      }
      if (!args.execute) {
        log("SAFE_MIGRATION_REVERT_DRY_RUN=YES");
        return { database: actualDatabase, reverted: [], executed: false, dryRun: true };
      }
      await migrator.down({ migrations: args.migrations });
      log(`SAFE_MIGRATION_REVERTED_COUNT=${args.migrations.length}`);
      return { database: actualDatabase, reverted: args.migrations, executed: true, dryRun: false };
    }

    const pendingNames = (await migrator.pending()).map((migration) => path.basename(migration.file));
    log(`MIGRATION_PENDING_COUNT=${pendingNames.length}`);

    if (!pendingNames.length) {
      log("SAFE_MIGRATION_NO_PENDING=YES");
      return { database: actualDatabase, pending: [], executed: false, dryRun: !args.execute };
    }
    if (!args.migrations?.length) {
      throw new MigrationSafetyError("APPROVED_MIGRATION_LIST_REQUIRED");
    }
    if (!migrationNamesEqual(pendingNames, args.migrations)) {
      throw new MigrationSafetyError("UNEXPECTED_MIGRATION_SET");
    }
    if (!args.execute) {
      log("SAFE_MIGRATION_DRY_RUN=YES");
      return { database: actualDatabase, pending: pendingNames, executed: false, dryRun: true };
    }

    await migrator.up({ migrations: args.migrations });
    const [afterRows] = await sequelize.query('SELECT COUNT(*)::int AS count FROM "SequelizeMeta"');
    const afterCount = Number(afterRows?.[0]?.count || 0);
    log(`SAFE_MIGRATION_EXECUTED_COUNT=${args.migrations.length}`);
    log(`MIGRATION_META_COUNT_AFTER=${afterCount}`);
    return { database: actualDatabase, pending: pendingNames, executed: true, dryRun: false, afterCount };
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  runSafeMigration().catch((error) => {
    console.error(error?.code || "MIGRATION_SAFETY_GUARD_FAILED");
    process.exitCode = 1;
  });
}

module.exports = {
  PROTECTED_DB_NAME,
  TARGET_MODE_ENV,
  OFFICIAL_APPROVAL_ENV,
  MigrationSafetyError,
  parseArguments,
  resolveExplicitTarget,
  assertTargetPolicy,
  createMigrationRunner,
  runSafeMigration,
};
