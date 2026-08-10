"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
delete process.env.DATABASE_URL;
process.env.DB_NAME = ACCEPTANCE_DATABASE;

const models = require("../src/models");
const { CGP_FUTURE_CAPABILITIES } = require("../src/bootstrap/cgp-permission-catalog-v3");
const {
  CGP_LEGACY_ISOLATION_ENV,
  assertLegacyCustomerGoldAcquisitionAllowed,
  assertCgpDispositionConversionAllowed,
  assertSupplierReceiveDoesNotMasqueradeAsCgp,
} = require("../src/services/cgp-legacy-isolation.service");

const EVENT_TYPE = "CustomerGoldPurchasePostedEvent";
const REVERSAL_HOLD_EVENT_TYPE = "CustomerGoldPurchaseReversalHoldRequestedEvent";
const REVERSAL_COMPENSATION_EVENT_TYPE = "CustomerGoldPurchaseReversalRequestedEvent";
const REVERSAL_FINAL_EVENT_TYPE = "CustomerGoldPurchaseReversedEvent";
const AUTHORIZED_IMP10_REVERSED_DOCUMENT_ID = "CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:2883073b-8ce1-4676-a948-938c956c04fb";
const CANONICAL_CURRENT_CONSUMERS = new Set(["INVENTORY", "ACCOUNTING", "GOLD_CENTER", "CRM"]);
// These are evidence-bound IMP04 records only. CGP_INVENTORY is not a
// runtime alias and must never be accepted for a newly created CGP event.
const FROZEN_HISTORICAL_CGP_INVENTORY_EVENT_IDS = new Set([
  "CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:689c0867-8e1d-4e63-ac56-f8f29eee26a6",
  "CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:b7f40ada-9275-42d6-a90c-fbb2d35d8929",
]);

async function one(sql, replacements = {}) {
  const [rows] = await models.sequelize.query(sql, { replacements });
  return rows[0];
}

function receiptKey(consumerName, eventId) {
  return `${consumerName}:${eventId}`;
}

function classifyReceipt(row) {
  const canonicalHold = row.event_type === REVERSAL_HOLD_EVENT_TYPE
    && Number(row.event_version) === 1
    && row.aggregate_type === "CgpReversalRequest"
    && row.aggregate_id === row.reversal_request_id
    && row.outbox_aggregate_id === row.reversal_request_id
    && row.outbox_status === "PENDING"
    && ["POSTED", "REVERSED"].includes(row.business_status)
    && row.status === "SUCCEEDED"
    && row.correlation_id === row.outbox_correlation_id
    && row.consumer_name === "INVENTORY";
  if (canonicalHold) return "LEGITIMATE_CGP_REVERSAL_HOLD_RECEIPT";
  const canonicalCompensation = row.event_type === REVERSAL_COMPENSATION_EVENT_TYPE
    && Number(row.event_version) === 1
    && row.aggregate_type === "CgpReversalRequest"
    && row.aggregate_id === row.reversal_request_id
    && row.outbox_aggregate_id === row.reversal_request_id
    && row.outbox_status === "PENDING"
    && row.business_status === "REVERSED"
    && row.status === "SUCCEEDED"
    && row.correlation_id === row.outbox_correlation_id
    && ["ACCOUNTING", "GOLD_CENTER"].includes(row.consumer_name);
  if (canonicalCompensation) return "LEGITIMATE_CGP_REVERSAL_COMPENSATION_RECEIPT";
  const canonicalFinal = row.event_type === REVERSAL_FINAL_EVENT_TYPE
    && Number(row.event_version) === 1
    && row.aggregate_type === "CustomerGoldPurchaseDocument"
    && row.aggregate_id === row.document_id
    && row.outbox_aggregate_id === row.document_id
    && row.outbox_status === "PENDING"
    && row.business_status === "REVERSED"
    && row.status === "SUCCEEDED"
    && row.correlation_id === row.outbox_correlation_id
    && row.consumer_name === "CRM";
  if (canonicalFinal) return "LEGITIMATE_CGP_REVERSAL_FINAL_RECEIPT";
  const canonicalSource = row.event_type === EVENT_TYPE
    && Number(row.event_version) === 1
    && row.aggregate_type === "CustomerGoldPurchaseDocument"
    && row.aggregate_id === row.document_id
    && row.outbox_aggregate_id === row.document_id
    && row.outbox_status === "PENDING"
    && (row.business_status === "POSTED" || (row.business_status === "REVERSED" && row.document_id === AUTHORIZED_IMP10_REVERSED_DOCUMENT_ID))
    && row.status === "SUCCEEDED"
    && row.correlation_id === row.outbox_correlation_id;
  if (!canonicalSource) return "UNKNOWN_OR_UNAUTHORIZED";
  if (row.consumer_name === "CGP_INVENTORY") {
    return FROZEN_HISTORICAL_CGP_INVENTORY_EVENT_IDS.has(row.event_id)
      ? "FROZEN_HISTORICAL_ACCEPTANCE_EVIDENCE"
      : "UNKNOWN_OR_UNAUTHORIZED";
  }
  return CANONICAL_CURRENT_CONSUMERS.has(row.consumer_name)
    ? "LEGITIMATE_CURRENT_STAGE_RECEIPT"
    : "UNKNOWN_OR_UNAUTHORIZED";
}

async function technicalSnapshot() {
  const [processed] = await models.sequelize.query(`
    SELECT consumer_name, event_id, event_type, event_version, status, correlation_id, processed_at
      FROM processed_events
     ORDER BY consumer_name, event_id
  `);
  const [integration] = await models.sequelize.query(`
    SELECT consumer_name, source_event_id, aggregate_type, aggregate_id, status,
           attempt_count, correlation_id, succeeded_at
      FROM integration_statuses
     ORDER BY consumer_name, source_event_id
  `);
  const [outbox] = await models.sequelize.query(`
    SELECT event_id, status, attempt_count, claimed_at, claimed_by, published_at, updated_at
      FROM outbox_events
     WHERE event_type = :eventType
     ORDER BY event_id
  `, { replacements: { eventType: EVENT_TYPE } });
  return { processed, integration, outbox };
}

async function assertStageAwareReceipts() {
  const [processed] = await models.sequelize.query(`
    SELECT pe.consumer_name, pe.event_id, pe.event_type, pe.event_version, pe.status,
           pe.correlation_id, o.aggregate_type, o.aggregate_id, o.aggregate_id AS outbox_aggregate_id,
           o.status AS outbox_status, o.correlation_id AS outbox_correlation_id,
           d.id AS document_id, COALESCE(d.business_status,rd.business_status) AS business_status, r.id AS reversal_request_id
      FROM processed_events pe
      LEFT JOIN outbox_events o ON o.event_id = pe.event_id
      LEFT JOIN customer_gold_purchase_documents d ON d.id = o.aggregate_id
      LEFT JOIN cgp_reversal_requests r ON r.id = o.aggregate_id
      LEFT JOIN customer_gold_purchase_documents rd ON rd.id = r.cgp_document_id
     ORDER BY pe.consumer_name, pe.event_id
  `);
  const [integrations] = await models.sequelize.query(`
    SELECT consumer_name, source_event_id, aggregate_type, aggregate_id, status, correlation_id
      FROM integration_statuses
     ORDER BY consumer_name, source_event_id
  `);
  const [processedDuplicates] = await models.sequelize.query(`
    SELECT count(*)::int AS count FROM (
      SELECT consumer_name, event_id FROM processed_events
       GROUP BY consumer_name, event_id HAVING count(*) > 1
    ) duplicates
  `);
  const [integrationDuplicates] = await models.sequelize.query(`
    SELECT count(*)::int AS count FROM (
      SELECT consumer_name, source_event_id FROM integration_statuses
       GROUP BY consumer_name, source_event_id HAVING count(*) > 1
    ) duplicates
  `);
  assert.equal(Number(processedDuplicates[0]?.count || 0), 0, "Processed-event uniqueness drifted");
  assert.equal(Number(integrationDuplicates[0]?.count || 0), 0, "Integration-status uniqueness drifted");

  const integrationByKey = new Map(integrations.map((row) => [receiptKey(row.consumer_name, row.source_event_id), row]));
  const processedByKey = new Map(processed.map((row) => [receiptKey(row.consumer_name, row.event_id), row]));
  const classifications = processed.map((row) => ({ ...row, classification: classifyReceipt(row) }));
  for (const row of classifications) {
    const integration = integrationByKey.get(receiptKey(row.consumer_name, row.event_id));
    assert.ok(integration, `Processed receipt lacks an integration status: ${row.consumer_name}/${row.event_id}`);
    const requestReceipt = ["LEGITIMATE_CGP_REVERSAL_HOLD_RECEIPT", "LEGITIMATE_CGP_REVERSAL_COMPENSATION_RECEIPT"].includes(row.classification);
    assert.equal(integration.aggregate_type, requestReceipt ? "CgpReversalRequest" : "CustomerGoldPurchaseDocument", "Integration aggregate type drifted");
    assert.equal(integration.aggregate_id, requestReceipt ? row.reversal_request_id : row.document_id, "Integration aggregate identity drifted");
    assert.equal(integration.status, "SUCCEEDED", "Integration status drifted");
    assert.equal(integration.correlation_id, row.correlation_id, "Integration correlation drifted");
  }
  for (const row of integrations) {
    assert.ok(processedByKey.has(receiptKey(row.consumer_name, row.source_event_id)), `Integration status lacks a processed receipt: ${row.consumer_name}/${row.source_event_id}`);
  }
  const unknownProcessed = classifications.filter((row) => row.classification === "UNKNOWN_OR_UNAUTHORIZED");
  const unknownIntegration = integrations.filter((row) => {
    const processedRow = processedByKey.get(receiptKey(row.consumer_name, row.source_event_id));
    return !processedRow || classifyReceipt(processedRow) === "UNKNOWN_OR_UNAUTHORIZED";
  });
  assert.deepEqual(unknownProcessed, [], "Unknown or unauthorized processed-event receipt detected");
  assert.deepEqual(unknownIntegration, [], "Unknown or unauthorized integration status detected");
  return { classifications, integrations };
}

async function main() {
  await models.sequelize.authenticate();
  assert.equal((await one("SELECT current_database() AS db")).db, ACCEPTANCE_DATABASE, "STOP — acceptance DB required");
  const before = await technicalSnapshot();
  const names = CGP_FUTURE_CAPABILITIES.map(({ name }) => name);
  const catalog = await models.sequelize.query(`
    SELECT p.name, p.module, p.action,
      (SELECT count(*)::int FROM role_permissions rp WHERE rp.permission_id=p.id) AS role_assignments,
      (SELECT count(*)::int FROM employee_permission_grants epg WHERE epg.permission_id=p.id) AS user_assignments
    FROM permissions p WHERE p.name IN (:names) ORDER BY p.name
  `, { replacements: { names }, type: models.sequelize.QueryTypes.SELECT });
  assert.equal(catalog.length, names.length, "all future CGP capabilities must be durable");
  for (const row of catalog) {
    assert.equal(Number(row.role_assignments), 0, `${row.name} must not be assigned to a role`);
    assert.equal(Number(row.user_assignments), 0, `${row.name} must not be assigned to a user`);
  }
  assert.doesNotThrow(() => assertLegacyCustomerGoldAcquisitionAllowed({ env: {} }));
  assert.throws(
    () => assertLegacyCustomerGoldAcquisitionAllowed({ env: { [CGP_LEGACY_ISOLATION_ENV]: "true" } }),
    (error) => error?.errorCode === "CGP_LEGACY_ACQUISITION_ISOLATED",
  );
  assert.throws(
    () => assertCgpDispositionConversionAllowed({ disposition: "CONVERTED_TO_ASSET", env: { [CGP_LEGACY_ISOLATION_ENV]: "true" } }),
    (error) => error?.errorCode === "CGP_LEGACY_ACQUISITION_ISOLATED",
  );
  assert.doesNotThrow(() => assertSupplierReceiveDoesNotMasqueradeAsCgp({ body: {}, items: [{ profile: "GOLD_BY_WEIGHT_JEWELLERY" }] }));
  assert.throws(() => assertSupplierReceiveDoesNotMasqueradeAsCgp({ body: { items: [{ perPiece: [{ profile: "CGP_CUSTOMER_GOLD_PURCHASE" }] }] } }), /Supplier Receive cannot be used/);
  const receipts = await assertStageAwareReceipts();
  const final = await one(`SELECT count(*)::int AS count FROM outbox_events WHERE event_type=:eventType AND status <> 'PENDING'`, { eventType: EVENT_TYPE });
  assert.equal(Number(final.count), 0, "CGP posted events must remain pending while the dispatcher is unregistered");
  const appSource = fs.readFileSync(path.resolve(__dirname, "../src/app.js"), "utf8");
  assert.equal(appSource.includes("outbox-dispatcher.service"), false, "Automatic Outbox dispatcher must remain unregistered");
  assert.deepEqual(await technicalSnapshot(), before, "IMP11 verifier must not mutate receipt, integration, or Outbox state");
  console.log("CGP_IMP_11_ACCEPTANCE_PERMISSION_ASSIGNMENTS: PASS");
  console.log("CGP_IMP_11_CUTOVER_AND_SUPPLIER_BOUNDARIES: PASS");
  console.log("CGP_IMP_11_POSTED_EVENTS_REMAIN_UNDISPATCHED: PASS");
  console.log(`CGP_IMP_11_STAGE_AWARE_RECEIPTS: ${JSON.stringify(receipts.classifications.map((row) => ({ consumer: row.consumer_name, eventId: row.event_id, classification: row.classification })))} `);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { await models.sequelize.close(); });
