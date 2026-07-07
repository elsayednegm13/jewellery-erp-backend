#!/usr/bin/env node
/**
 * Phase 21.4-Fix / relocated Phase 21.5-Fix — Idempotency Requests TTL Cleanup.
 *
 * Deletes ONLY expired `idempotency_requests` rows (expires_at < now). Each row's
 * `expires_at` is set to now + 24h when the request is first claimed
 * (idempotency.service). Once the window passes, the row is no longer needed for
 * replay/conflict detection and can be safely removed to bound table growth.
 *
 * Lives under backend/scripts so `require("dotenv")` and `require("../src/models")`
 * resolve against backend/node_modules — the root-level copy failed with
 * MODULE_NOT_FOUND because dotenv is only installed in the backend package.
 *
 * SAFETY:
 *   - Never TRUNCATEs, never resets, never deletes rows without the
 *     `expires_at < now` predicate. The WHERE is hard-coded to the expiry
 *     comparison, so a missing predicate cannot become a delete-all.
 *   - Read-only `--dry-run` counts the expired rows without deleting.
 *
 * USAGE (from repo root):
 *   npm run idempotency:cleanup            # delete expired rows
 *   npm run idempotency:cleanup -- --dry-run   # count only, no delete
 * Or directly:
 *   node backend/scripts/idempotency-cleanup.js [--dry-run]
 *
 * Intended to be run manually or from an external scheduler (cron), e.g. daily
 * during low-traffic hours. No in-app scheduler; no DB reset/seed/migrate.
 */
const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const { Op } = require("sequelize");
const { sequelize, IdempotencyRequest } = require("../src/models");

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();
  // The ONLY predicate: rows whose TTL has already elapsed (expires_at < now).
  const where = { expiresAt: { [Op.lt]: now } };

  try {
    if (dryRun) {
      const expired = await IdempotencyRequest.count({ where });
      console.log(`[idempotency-cleanup] DRY RUN — ${expired} expired row(s) would be deleted (expires_at < ${now.toISOString()}). No changes made.`);
    } else {
      const deleted = await IdempotencyRequest.destroy({ where });
      console.log(`[idempotency-cleanup] Deleted ${deleted} expired idempotency_requests row(s) (expires_at < ${now.toISOString()}).`);
    }
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error("[idempotency-cleanup] Error:", err && err.message ? err.message : err);
    try { await sequelize.close(); } catch (_) { /* connection may already be closed */ }
    process.exit(1);
  }
}

run();
