#!/usr/bin/env node
"use strict";

// Owner-authorized, one-event-at-a-time recovery for the four protected
// pre-activation CGP outbox rows. This script is deliberately not a generic
// dispatcher: the caller must provide the exact protected set and one event id.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const models = require("../src/models");
const { QueryTypes } = require("sequelize");
const runtime = require("../src/services/cgp-runtime-dispatcher.service");

const WATERMARK = "2026-08-12T08:32:21.028Z";
const EVENT_TYPE = "CustomerGoldPurchasePostedEvent";
const EVENT_VERSION = 1;
const PERSISTENT_DB = "darfus_erp";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] || null;
}

function fail(message) {
  throw new Error(message);
}

function listArg(name) {
  const value = arg(name);
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

async function query(sql, replacements = {}) {
  return models.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

async function readEligibility(eventId, protectedIds) {
  const db = (await query("SELECT current_database() AS db"))[0]?.db;
  if (db !== PERSISTENT_DB) fail(`RECOVERY_DATABASE_MISMATCH:${db || "UNKNOWN"}`);
  const migrations = Number((await query('SELECT COUNT(*)::int AS count FROM "SequelizeMeta"'))[0]?.count || 0);
  if (migrations !== 80) fail(`RECOVERY_MIGRATION_BASELINE_MISMATCH:${migrations}`);
  if (!protectedIds.includes(eventId) || protectedIds.length !== 4 || unique(protectedIds).length !== 4) {
    fail("RECOVERY_EVENT_SET_MISMATCH");
  }
  const outbox = (await query(`SELECT id,event_id,event_type,event_version,aggregate_type,aggregate_id,payload,status,attempt_count,created_at,available_at,published_at
    FROM outbox_events WHERE event_id=:eventId`, { eventId }))[0];
  if (!outbox) fail("EVENT_NOT_FOUND");
  const watermark = new Date(WATERMARK);
  const reasons = [];
  if (outbox.event_type !== EVENT_TYPE || Number(outbox.event_version) !== EVENT_VERSION) reasons.push("EVENT_CONTRACT_MISMATCH");
  if (!(new Date(outbox.created_at) < watermark)) reasons.push("EVENT_NOT_PRE_WATERMARK");
  if (outbox.status !== "PENDING" || Number(outbox.attempt_count) !== 0) reasons.push("OUTBOX_NOT_UNTOUCHED_PENDING");
  const document = (await query(`SELECT id,draft_number,business_status,governance_status,voided_at,customer_id,company_id,branch_id,total_gold_value,total_payable_to_customer
    FROM customer_gold_purchase_documents WHERE id=:documentId`, { documentId: outbox.aggregate_id }))[0];
  if (!document) reasons.push("DOCUMENT_NOT_FOUND");
  if (document && (document.business_status !== "POSTED" || document.voided_at)) reasons.push("DOCUMENT_STATE_NOT_ELIGIBLE");
  const items = document ? await query(`SELECT id,line_number FROM customer_gold_purchase_items WHERE document_id=:documentId AND deleted_at IS NULL ORDER BY line_number`, { documentId: document.id }) : [];
  const snapshots = document ? await query(`SELECT cgp_item_id FROM cgp_pricing_snapshots WHERE cgp_document_id=:documentId AND company_id=:companyId AND branch_id=:branchId`, { documentId: document.id, companyId: document.company_id, branchId: document.branch_id }) : [];
  if (!document || items.length === 0 || snapshots.length !== items.length || new Set(snapshots.map((row) => row.cgp_item_id)).size !== items.length) reasons.push("PRICING_SNAPSHOT_INCOMPLETE");
  const itemIds = items.map((row) => row.id);
  const assets = itemIds.length ? await query("SELECT asset_id,cgp_item_id FROM asset_origins WHERE cgp_item_id IN (:itemIds)", { itemIds }) : [];
  const journals = await query("SELECT id FROM journal_entries WHERE source_type='CGP_PURCHASE' AND source_id=:eventId", { eventId });
  const liabilities = await query("SELECT id FROM customer_financial_liabilities WHERE source_event_id=:eventId OR source_document_id=:documentId", { eventId, documentId: outbox.aggregate_id });
  const gold = await query("SELECT id FROM gold_core_events WHERE source_event_id=:eventId OR source_document_id=:documentId", { eventId, documentId: outbox.aggregate_id });
  const crm = await query("SELECT id FROM customer_timelines WHERE source_event_id=:eventId OR source_document_id=:documentId UNION ALL SELECT id FROM customer_transaction_history WHERE source_event_id=:eventId OR source_document_id=:documentId", { eventId, documentId: outbox.aggregate_id });
  const processed = await query("SELECT consumer_name,status FROM processed_events WHERE event_id=:eventId", { eventId });
  const integrations = await query("SELECT consumer_name,status,attempt_count FROM integration_statuses WHERE source_event_id=:eventId", { eventId });
  const settlements = await query("SELECT id FROM financial_settlements WHERE source_document_id=:documentId", { documentId: outbox.aggregate_id });
  const treasury = await query("SELECT id FROM cash_transactions WHERE reference=:eventId OR reference=:documentId", { eventId, documentId: outbox.aggregate_id });
  const legacyPools = await query("SELECT id FROM inventory_gold_pools WHERE cgp_id=:documentId", { documentId: outbox.aggregate_id });
  if (assets.length || journals.length || liabilities.length || gold.length || crm.length || processed.length || integrations.length || settlements.length || treasury.length || legacyPools.length) reasons.push("PREEXISTING_EFFECT");
  return {
    eventId,
    documentNumber: document?.draft_number || null,
    createdAt: outbox.created_at,
    outbox,
    document,
    itemCount: items.length,
    snapshotCount: snapshots.length,
    preexisting: { assets: assets.length, journals: journals.length, liabilities: liabilities.length, gold: gold.length, crm: crm.length, processed: processed.length, integrations: integrations.length, settlements: settlements.length, treasury: treasury.length, legacyPools: legacyPools.length },
    eligible: reasons.length === 0,
    reasons,
  };
}

async function main() {
  const eventId = arg("event-id");
  const protectedIds = listArg("protected-event-ids");
  const dryRun = process.argv.includes("--dry-run");
  const execute = process.argv.includes("--execute");
  if (!eventId || (!dryRun && !execute) || (dryRun && execute)) fail("Use exactly one of --dry-run or --execute and provide --event-id");
  const eligibility = await readEligibility(eventId, protectedIds);
  if (dryRun) {
    console.log(JSON.stringify({ mode: "DRY_RUN", watermark: WATERMARK, eligibility }, null, 2));
    return;
  }
  if (!eligibility.eligible) fail(`EVENT_NOT_ELIGIBLE:${eligibility.reasons.join(",")}`);
  // Re-read every guard immediately before the same-process claim/write.
  const second = await readEligibility(eventId, protectedIds);
  if (!second.eligible) fail(`EVENT_NOT_ELIGIBLE_AT_WRITE:${second.reasons.join(",")}`);
  const result = await runtime.processProtectedEvent({ eventId, activationWatermark: WATERMARK, now: new Date() });
  if (result.state !== "PUBLISHED") fail(`RECOVERY_NOT_PUBLISHED:${result.reason || "UNKNOWN"}`);
  console.log(JSON.stringify({ mode: "EXECUTE", watermark: WATERMARK, eligibility: second, result: { eventId: result.eventId, state: result.state, consumerResult: result.result } }, null, 2));
}

main().catch((error) => {
  console.error(`[controlled-recovery] ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await models.sequelize.close();
});

