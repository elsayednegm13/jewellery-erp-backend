#!/usr/bin/env node
/**
 * Database backup utility.
 *
 *   node scripts/backup.js [--env development|production] [--keep N]
 *
 * Runs pg_dump (custom format) into backend/backups/ with a timestamped name
 * and prunes old dumps, keeping the newest N (default 14).
 *
 * Connection details come from env first (DB_*), then src/config/config.json.
 * Set PG_DUMP to an explicit pg_dump path if it is not on PATH (e.g. on Windows
 * "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe").
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { spawnSync } = require("child_process");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const env = arg("env", process.env.NODE_ENV || "development");
const keep = parseInt(arg("keep", "14"), 10);

let cfg = {};
try {
  cfg = require("../src/config/config.json")[env] || {};
} catch {
  /* fall back to env vars only */
}

const conn = {
  host: process.env.DB_HOST || cfg.host || "127.0.0.1",
  port: process.env.DB_PORT || cfg.port || 5432,
  user: process.env.DB_USER || cfg.username || "postgres",
  password: process.env.DB_PASSWORD || cfg.password || "",
  database: process.env.DB_NAME || cfg.database
};

if (!conn.database) {
  console.error("[backup] No database configured. Set DB_NAME or config.json.");
  process.exit(1);
}

const backupsDir = path.join(__dirname, "..", "backups");
fs.mkdirSync(backupsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(backupsDir, `${conn.database}_${env}_${stamp}.dump`);

const pgDump = process.env.PG_DUMP || "pg_dump";
console.log(`[backup] Dumping ${conn.database}@${conn.host}:${conn.port} -> ${outFile}`);

const result = spawnSync(
  pgDump,
  ["-h", String(conn.host), "-p", String(conn.port), "-U", conn.user, "-F", "c", "-f", outFile, conn.database],
  { env: { ...process.env, PGPASSWORD: conn.password }, stdio: "inherit" }
);

if (result.error) {
  console.error(`[backup] Failed to run pg_dump (${pgDump}): ${result.error.message}`);
  console.error("[backup] Set PG_DUMP to the full pg_dump path if it is not on PATH.");
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[backup] pg_dump exited with code ${result.status}`);
  process.exit(result.status || 1);
}

const { size } = fs.statSync(outFile);
console.log(`[backup] OK — ${(size / 1024).toFixed(1)} KB written.`);

// Retention: keep the newest `keep` dumps, delete the rest.
const dumps = fs
  .readdirSync(backupsDir)
  .filter((f) => f.endsWith(".dump"))
  .map((f) => ({ f, t: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

for (const old of dumps.slice(keep)) {
  fs.unlinkSync(path.join(backupsDir, old.f));
  console.log(`[backup] Pruned old backup: ${old.f}`);
}
console.log(`[backup] Retained ${Math.min(dumps.length, keep)} backup(s) in ${backupsDir}.`);
