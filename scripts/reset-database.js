#!/usr/bin/env node
"use strict";

// RESET-1 default-deny local/test reset entry point. This command intentionally
// never invokes demo seeders. It only permits an explicitly named disposable
// database and prints a masked target summary before any SQL is run.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch { /* optional */ }

const cfg = {
  environment: String(process.env.APP_ENV || process.env.NODE_ENV || "development").toLowerCase(),
  nodeEnv: String(process.env.NODE_ENV || "development").toLowerCase(),
  host: String(process.env.DB_HOST || "localhost").toLowerCase(),
  database: String(process.env.DB_NAME || "darfus_erp"),
  confirm: process.env.RESET1_CONFIRM || "",
  dryRun: process.argv.includes("--dry-run"),
};
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|::1)$/;
const APPROVED_NAME = /^darfus_(?:[a-z0-9_]*_)?(?:qa|test|reset1_qa)$/i;
const REMOTE_OR_PROD = /(prod|production|render|railway|supabase|neon|amazonaws|azure|google|live|staging)/i;

function fail(message) {
  console.error(`[RESET-1] REFUSED: ${message}`);
  process.exitCode = 1;
}

function targetSummary() {
  return {
    targetDatabase: cfg.database,
    hostCategory: LOCAL_HOST.test(cfg.host) ? "local" : "non-local",
    environment: cfg.environment,
    demoRecords: "skipped (explicit demo command only)",
  };
}

function guard() {
  if (!["development", "test", "local"].includes(cfg.environment)) return "environment must be explicitly local/test";
  if (cfg.nodeEnv === "production") return "NODE_ENV=production is never allowed";
  if (!LOCAL_HOST.test(cfg.host) || REMOTE_OR_PROD.test(cfg.host)) return "database host is not an approved local host";
  if (!APPROVED_NAME.test(cfg.database) || REMOTE_OR_PROD.test(cfg.database)) return "database name is not an approved local/test target";
  if (cfg.confirm !== "RESET1_LOCAL_DATABASE") return "RESET1_CONFIRM=RESET1_LOCAL_DATABASE is required";
  return null;
}

function resetPlanBlocker() {
  const migrationsDir = path.resolve(__dirname, "..", "migrations");
  const forwardOnly = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".js"))
    .find((file) => fs.readFileSync(path.join(migrationsDir, file), "utf8").includes("Rollback disabled"));
  return forwardOnly ? `forward-only migration '${forwardOnly}' prevents an automatic destructive reset` : null;
}

const rejection = guard();
console.log(JSON.stringify({ reset1: targetSummary(), mode: cfg.dryRun ? "dry-run" : "execute" }));
if (rejection) {
  fail(rejection);
} else if (cfg.dryRun) {
  console.log("[RESET-1] dry-run passed; no SQL was executed.");
} else {
  const planBlocker = resetPlanBlocker();
  if (planBlocker) {
    fail(planBlocker);
  } else {
  const backend = path.resolve(__dirname, "..");
  try {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const commandOptions = { cwd: backend, stdio: "inherit", shell: process.platform === "win32" };
    execFileSync(npx, ["sequelize", "db:migrate:undo:all"], commandOptions);
    execFileSync(npx, ["sequelize", "db:migrate"], commandOptions);
    console.log(JSON.stringify({ reset1: { ...targetSummary(), tablesReset: true, systemRecords: "migrations only", companyBootstrap: "explicit command required", readinessBlockers: [], smokeTest: "migration complete" } }));
  } catch (error) {
    console.error(`[RESET-1] reset failed without invoking demo seeders: ${error.message}`);
    process.exitCode = error.status || 1;
  }
  }
}
