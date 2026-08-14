"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { Op } = require("sequelize");

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const MARKER = `ACCEPTANCE_TEST_CGP_IMP04:${Date.now()}`;
const VERIFY_EXISTING = process.argv.includes("--verify-existing");

// These are evidence-bound historical Acceptance fixtures, not a product
// compatibility alias.  New CGP-IMP-04 fixtures must use INVENTORY and the
// canonical CGP Asset profile; only these exact immutable records are exempt.
const KNOWN_FIXTURES = [
  {
    documentNumber: "CGPD-000041",
    eventId: "CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:689c0867-8e1d-4e63-ac56-f8f29eee26a6",
    consumer: "CGP_INVENTORY",
    profile: "GOLD_BY_WEIGHT_JEWELLERY",
    historical: true,
    assetIds: ["CGPA-5f4845564e9142ffa4be4766c9", "CGPA-22ffae462e46431398954bcbfb"],
    barcodes: ["GODGOF21000283", "GODGOF21000284"],
  },
  {
    documentNumber: "CGPD-000042",
    eventId: "CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:b7f40ada-9275-42d6-a90c-fbb2d35d8929",
    consumer: "CGP_INVENTORY",
    profile: "CGP_CUSTOMER_GOLD_PURCHASE",
    historical: true,
    assetIds: ["CGPA-1de20fd74732451da2b2688e3f", "CGPA-4fc18a1e5dab41dfb04ae833a7"],
    barcodes: ["GODGOF21000285", "GODGOF21000286"],
  },
  {
    documentNumber: "CGPD-000043",
    eventId: "CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:cd3e0c51-d1b3-4c00-93fb-13b8532b051e",
    consumer: "INVENTORY",
    profile: "CGP_CUSTOMER_GOLD_PURCHASE",
    historical: false,
    assetIds: ["CGPA-aae64ae0be7a40d29cf90ce40e", "CGPA-3fea143ac58c41a38d8b4b0fe3"],
    barcodes: ["GODGOF21000287", "GODGOF21000288"],
  },
  // These two exact stage fixtures were created by prior authorized IMP04
  // acceptance runs.  Their marker, posted-event lineage, approved-price
  // snapshot, two canonical assets, and INVENTORY receipts are asserted
  // below.  Do not replace this exact list with a range or a consumer-wide
  // exemption: an unlisted consumed IMP04 event remains a failure.
  {
    documentNumber: "CGPD-000065",
    eventId: "CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:19e5eba3-8417-4c97-b7f5-d5dccfbdca38",
    consumer: "INVENTORY",
    profile: "CGP_CUSTOMER_GOLD_PURCHASE",
    historical: false,
    assetIds: ["CGPA-58a365984371482eae42b57390", "CGPA-a67de422448d48398914471a1d"],
    barcodes: ["GODGOF21000291", "GODGOF21000292"],
  },
  {
    documentNumber: "CGPD-000072",
    eventId: "CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:05e98997-0bb1-4f99-a363-ca6f773cf3dd",
    consumer: "INVENTORY",
    profile: "CGP_CUSTOMER_GOLD_PURCHASE",
    historical: false,
    assetIds: ["CGPA-cb11fa0e84df4745b99f2a9b2b", "CGPA-d70a3618cd7f48cabb4ac27c55"],
    barcodes: ["GODGOF21000294", "GODGOF21000295"],
  },
];

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
delete process.env.DATABASE_URL;
process.env.DB_NAME = ACCEPTANCE_DATABASE;

const models = require("../src/models");
const draftService = require("../src/services/gold-purchase-draft.service");
const postingService = require("../src/services/cgp-posting.service");
const consumer = require("../src/services/cgp-inventory-consumer.service");
const priceService = require("../src/services/gold-price-approval.service");
const permissionService = require("../src/services/permission.service");
const idempotencyService = require("../src/services/idempotency.service");

async function requireAcceptanceTarget() {
  const [rows] = await models.sequelize.query("SELECT current_database() AS db");
  assert.equal(rows?.[0]?.db, ACCEPTANCE_DATABASE, "CGP-IMP-04 verifier refused a non-acceptance database");
}

async function countExisting(table) {
  const [exists] = await models.sequelize.query("SELECT to_regclass(:tableName) AS name", { replacements: { tableName: table } });
  if (!exists?.[0]?.name) return null;
  const [rows] = await models.sequelize.query(`SELECT count(*)::int AS count FROM ${table}`);
  return Number(rows?.[0]?.count || 0);
}

async function findContext() {
  const companies = await models.Company.findAll({ order: [["id", "ASC"]] });
  for (const company of companies) {
    const branch = await models.Branch.findOne({ where: { companyId: company.id, isActive: true }, order: [["id", "ASC"]] });
    const customer = await models.Customer.findOne({ where: { companyId: company.id, status: "active" }, order: [["id", "ASC"]] });
    if (!branch || !customer) continue;
    const users = await models.User.findAll({ where: { companyId: company.id }, order: [["id", "ASC"]] });
    for (const user of users) {
      const actor = user.toJSON();
      if (await permissionService.userHasPermission(actor, postingService.POST_PERMISSION)
        && await permissionService.userHasPermission(actor, priceService.GOLD_PRICE_APPROVAL_PERMISSION)) {
        return { company: company.toJSON(), branch: branch.toJSON(), customer: customer.toJSON(), user: actor };
      }
    }
  }
  throw new Error("CGP_IMP04_ACCEPTANCE_CONTEXT_NOT_FOUND");
}

async function requireApprovedPrice(context) {
  const now = new Date();
  const price = await models.GoldPrice.findOne({
    where: { companyId: context.company.id, currency: context.company.currency || "AED", karat: 21, approvalStatus: "APPROVED", validFrom: { [Op.lte]: now }, validUntil: { [Op.gt]: now } },
    order: [["approvedAt", "DESC"], ["id", "DESC"]],
  });
  assert.ok(price, "CGP-IMP-04 requires an existing approved active 21K acceptance price");
  return price;
}

async function createValidatedTwoPieceDocument(context) {
  await requireAcceptanceTarget();
  const transaction = await models.sequelize.transaction();
  try {
    const created = await draftService.create("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, {
      branchId: context.branch.id,
      customerId: context.customer.id,
      transactionDate: "2026-08-09",
      currency: context.company.currency || "AED",
      exchangeRate: "1",
      notes: MARKER,
      items: [
        { goldType: "acceptance-cgp-piece-one", karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "10.123456", stoneWeight: "0.123456", proposedRate: "999.0000", referenceMarketRate: "888.0000" },
        { goldType: "acceptance-cgp-piece-two", karat: "21", purityFactor: "0.875", fineness: "0.875", grossWeight: "6.500000", stoneWeight: "0.500000", proposedRate: "999.0000", referenceMarketRate: "888.0000" },
      ],
    }, transaction);
    const validated = await draftService.validate("cgp", { companyId: context.company.id, branchId: context.branch.id, user: context.user }, created.id, created.version, transaction);
    await transaction.commit();
    return validated;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function post(context, document) {
  await requireAcceptanceTarget();
  const transaction = await models.sequelize.transaction();
  try {
    const data = await postingService.post({
      context: { companyId: context.company.id, branchId: context.branch.id, user: context.user },
      id: document.id, expectedVersion: document.version, correlationId: `${MARKER}:POST`, transaction,
    });
    await transaction.commit();
    return data;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function originalLegacyEventIds() {
  const [rows] = await models.sequelize.query(`SELECT DISTINCT o.event_id
    FROM outbox_events o
    JOIN customer_gold_purchase_documents d ON d.id=o.aggregate_id
    JOIN cgp_pricing_snapshots s ON s.cgp_document_id=d.id
    WHERE o.event_type=:eventType AND o.event_version=1 AND s.approved_price_id IS NULL
    ORDER BY o.event_id`, { replacements: { eventType: postingService.POSTED_EVENT_TYPE } });
  return rows.map((row) => row.event_id);
}

async function assertLegacyEventsUntouched(eventIds) {
  if (!eventIds.length) return;
  const [status] = await models.sequelize.query(`SELECT count(*)::int AS count FROM outbox_events
    WHERE event_id IN(:eventIds) AND status='PENDING'`, { replacements: { eventIds } });
  assert.equal(Number(status[0]?.count || 0), eventIds.length, "historical CGP events must remain PENDING");
  const [processed] = await models.sequelize.query(`SELECT count(*)::int AS count FROM processed_events
    WHERE event_id IN(:eventIds) AND consumer_name=:consumer`, { replacements: { eventIds, consumer: consumer.CONSUMER_NAME } });
  const [integrations] = await models.sequelize.query(`SELECT count(*)::int AS count FROM integration_statuses
    WHERE source_event_id IN(:eventIds) AND consumer_name=:consumer`, { replacements: { eventIds, consumer: consumer.CONSUMER_NAME } });
  const [origins] = await models.sequelize.query(`SELECT count(*)::int AS count FROM asset_origins ao
    JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id
    JOIN outbox_events o ON o.aggregate_id=i.document_id
    WHERE o.event_id IN(:eventIds)`, { replacements: { eventIds } });
  assert.equal(Number(processed[0]?.count || 0), 0);
  assert.equal(Number(integrations[0]?.count || 0), 0);
  assert.equal(Number(origins[0]?.count || 0), 0);
}

function equalSet(actual, expected, message) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), message);
}

async function verifyExisting() {
  await requireAcceptanceTarget();
  const fixtureNumbers = KNOWN_FIXTURES.map((fixture) => fixture.documentNumber);
  const fixtureEventIds = KNOWN_FIXTURES.map((fixture) => fixture.eventId);
  const [rows] = await models.sequelize.query(`SELECT
      d.draft_number AS "documentNumber",
      d.id AS "documentId",
      d.company_id AS "companyId",
      o.event_id AS "eventId",
      o.status AS "eventStatus",
      o.event_type AS "eventType",
      o.event_version AS "eventVersion",
      o.correlation_id AS "correlationId",
      i.id AS "itemId",
      s.id AS "snapshotId",
      ao.cgp_item_id AS "originCgpItemId",
      ao.origin_type AS "originType",
      ao.mapping_classification AS "mappingClassification",
      a.id AS "assetId",
      a.inventory_profile AS "assetProfile",
      a.status AS "assetStatus",
      a.operational_status AS "operationalStatus",
      a.barcode AS "barcode"
    FROM customer_gold_purchase_documents d
    JOIN outbox_events o
      ON o.aggregate_id=d.id AND o.event_type=:eventType AND o.event_version=1
    JOIN customer_gold_purchase_items i ON i.document_id=d.id
    JOIN cgp_pricing_snapshots s ON s.cgp_item_id=i.id
    LEFT JOIN asset_origins ao ON ao.cgp_item_id=i.id
    LEFT JOIN assets a ON a.id=ao.asset_id
    WHERE d.draft_number IN(:fixtureNumbers)
    ORDER BY d.draft_number, i.line_number`, {
    replacements: { fixtureNumbers, eventType: consumer.EVENT_TYPE },
  });

  assert.equal(rows.length, 10, "the exact five known fixtures must contain ten item rows");
  for (const fixture of KNOWN_FIXTURES) {
    const fixtureRows = rows.filter((row) => row.documentNumber === fixture.documentNumber);
    assert.equal(fixtureRows.length, 2, `${fixture.documentNumber} must remain a two-piece fixture`);
    assert.ok(fixtureRows.every((row) => row.eventId === fixture.eventId), `${fixture.documentNumber} event identity drifted`);
    assert.ok(fixtureRows.every((row) => row.eventStatus === "PENDING" && row.eventType === consumer.EVENT_TYPE && Number(row.eventVersion) === 1), `${fixture.documentNumber} Outbox contract drifted`);
    assert.ok(fixtureRows.every((row) => row.snapshotId && row.itemId && row.originCgpItemId === row.itemId), `${fixture.documentNumber} item/snapshot/origin lineage is invalid`);
    assert.ok(fixtureRows.every((row) => row.originType === "CUSTOMER_GOLD_PURCHASE" && row.mappingClassification === "CGP_IMP_04_EVENT_V1"), `${fixture.documentNumber} origin classification drifted`);
    assert.ok(fixtureRows.every((row) => row.assetStatus === "pending_integration" && row.operationalStatus === consumer.PENDING_STATE), `${fixture.documentNumber} Assets must remain PENDING_INTEGRATION`);
    assert.ok(fixtureRows.every((row) => row.assetProfile === fixture.profile), `${fixture.documentNumber} Asset profile drifted`);
    equalSet(fixtureRows.map((row) => row.assetId), fixture.assetIds, `${fixture.documentNumber} Asset identity drifted`);
    equalSet(fixtureRows.map((row) => row.barcode), fixture.barcodes, `${fixture.documentNumber} barcode identity drifted`);
  }

  const [processedRows] = await models.sequelize.query(`SELECT event_id AS "eventId", consumer_name AS consumer, status
    FROM processed_events WHERE event_id IN(:fixtureEventIds) ORDER BY event_id, consumer_name`, { replacements: { fixtureEventIds } });
  const [integrationRows] = await models.sequelize.query(`SELECT source_event_id AS "eventId", consumer_name AS consumer, status
    FROM integration_statuses WHERE source_event_id IN(:fixtureEventIds) ORDER BY source_event_id, consumer_name`, { replacements: { fixtureEventIds } });
  for (const fixture of KNOWN_FIXTURES) {
    const processed = processedRows.filter((row) => row.eventId === fixture.eventId);
    const integrations = integrationRows.filter((row) => row.eventId === fixture.eventId);
    assert.equal(processed.length, 1, `${fixture.documentNumber} must have exactly one processed-event receipt`);
    assert.equal(integrations.length, 1, `${fixture.documentNumber} must have exactly one integration status`);
    assert.equal(processed[0].consumer, fixture.consumer, `${fixture.documentNumber} processed-event consumer drifted`);
    assert.equal(integrations[0].consumer, fixture.consumer, `${fixture.documentNumber} integration consumer drifted`);
    assert.equal(processed[0].status, "SUCCEEDED", `${fixture.documentNumber} processed-event status drifted`);
    assert.equal(integrations[0].status, "SUCCEEDED", `${fixture.documentNumber} integration status drifted`);
  }

  // The marker is deliberately exact: it detects a later CGP-IMP-04 test
  // fixture rather than accepting a date range, a consumer alias, or a
  // profile wildcard.
  const [unknownFixtureEvents] = await models.sequelize.query(`SELECT o.event_id AS "eventId"
    FROM outbox_events o
    WHERE o.event_type=:eventType
      AND o.correlation_id LIKE 'ACCEPTANCE_TEST_CGP_IMP04:%'
      AND o.event_id NOT IN(:fixtureEventIds)`, {
    replacements: { eventType: consumer.EVENT_TYPE, fixtureEventIds },
  });
  const [unknownConsumedEvents] = await models.sequelize.query(`SELECT o.event_id AS "eventId"
    FROM outbox_events o
    WHERE o.event_id IN(:unknownFixtureEventIds)
      AND (
        EXISTS (SELECT 1 FROM processed_events pe WHERE pe.event_id=o.event_id)
        OR EXISTS (SELECT 1 FROM integration_statuses ist WHERE ist.source_event_id=o.event_id)
        OR EXISTS (
          SELECT 1 FROM asset_origins ao
          JOIN customer_gold_purchase_items i ON i.id=ao.cgp_item_id
          WHERE i.document_id=o.aggregate_id
        )
      )`, { replacements: { unknownFixtureEventIds: unknownFixtureEvents.map((row) => row.eventId) } });
  assert.equal(unknownConsumedEvents.length, 0, "unknown consumed CGP-IMP-04 fixture event detected");

  const historicalEvents = await originalLegacyEventIds();
  assert.equal(historicalEvents.length, 19, "CGP-IMP-04 historical event isolation baseline changed unexpectedly");
  await assertLegacyEventsUntouched(historicalEvents);
  const [historicalReceipts] = await models.sequelize.query(`SELECT count(*)::int AS count FROM processed_events
    WHERE event_id IN(:historicalEvents) AND consumer_name IN('INVENTORY', 'CGP_INVENTORY')`, { replacements: { historicalEvents } });
  const [historicalIntegrations] = await models.sequelize.query(`SELECT count(*)::int AS count FROM integration_statuses
    WHERE source_event_id IN(:historicalEvents) AND consumer_name IN('INVENTORY', 'CGP_INVENTORY')`, { replacements: { historicalEvents } });
  assert.equal(Number(historicalReceipts[0]?.count || 0), 0, "original 19 events acquired an Inventory receipt");
  assert.equal(Number(historicalIntegrations[0]?.count || 0), 0, "original 19 events acquired an Integration status");

  const assetIds = rows.map((row) => row.assetId);
  const [integrityRows] = await models.sequelize.query(`SELECT
      (SELECT count(*)::int FROM assets WHERE barcode IS NULL OR btrim(barcode)='') AS "blankBarcodes",
      (SELECT count(*)::int FROM (SELECT barcode FROM assets WHERE barcode IS NOT NULL AND btrim(barcode)<>'' GROUP BY barcode HAVING count(*) > 1) duplicates) AS "duplicateBarcodes",
      (SELECT count(*)::int FROM asset_origins ao LEFT JOIN assets a ON a.id=ao.asset_id WHERE a.id IS NULL) AS "orphanOrigins",
      (SELECT count(*)::int FROM (SELECT cgp_item_id FROM asset_origins WHERE cgp_item_id IS NOT NULL GROUP BY cgp_item_id HAVING count(*) > 1) duplicates) AS "duplicateCgpItemOrigins",
      (SELECT count(*)::int FROM asset_events ae LEFT JOIN assets a ON a.id=ae.asset_id WHERE a.id IS NULL) AS "orphanAssetEvents",
      (SELECT count(*)::int FROM inventory_asset_movements iam LEFT JOIN assets a ON a.id=iam.asset_id WHERE a.id IS NULL) AS "orphanMovements",
      (SELECT count(*)::int FROM asset_rfid_assignments ara LEFT JOIN assets a ON a.id=ara.asset_id WHERE a.id IS NULL) AS "orphanRfidAssignments",
      (SELECT count(*)::int FROM journal_entries je WHERE je.status='posted' AND je.total_debit<>je.total_credit) AS "unbalancedJournals",
      (SELECT count(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS "orphanJournalLines",
      (SELECT count(*)::int FROM journal_entries je WHERE je.source_id::text IN(:fixtureEventIds) OR je.source_id::text IN(:fixtureDocumentIds)) AS "cgpJournalRows",
      (SELECT count(*)::int FROM customer_credit_transactions cct WHERE cct.source_id::text IN(:fixtureEventIds) OR cct.source_id::text IN(:fixtureDocumentIds)) AS "cgpCustomerCreditRows",
      (SELECT count(*)::int FROM inventory_gold_pools igp WHERE igp.cgp_id::text IN(:fixtureDocumentIds)) AS "cgpGoldPoolRows",
      (SELECT count(*)::int FROM assets WHERE id IN(:assetIds) AND status='available') AS "knownAssetsAvailable"`, {
    replacements: { fixtureEventIds, fixtureDocumentIds: rows.map((row) => row.documentId), assetIds },
  });
  const integrity = integrityRows[0];
  for (const [field, value] of Object.entries(integrity)) assert.equal(Number(value || 0), 0, `${field} must be zero`);

  const auditService = require("../src/services/audit.service");
  const audit = await auditService.verifyChain(rows[0].companyId);
  assert.equal(audit.valid, true, "Acceptance audit hash chain is invalid");
  const [auditRows] = await models.sequelize.query(`SELECT correlation_id AS "correlationId", count(*)::int AS count
    FROM audit_logs WHERE correlation_id IN(:correlationIds) AND action='cgp.posted'
    GROUP BY correlation_id`, { replacements: { correlationIds: rows.map((row) => row.correlationId) } });
  assert.equal(auditRows.length, 5, "each known fixture must retain its posted audit record");
  assert.ok(auditRows.every((row) => Number(row.count) === 1), "known fixture audit references must be unique");

  console.log("CGP_IMP04_VERIFY_EXISTING: PASS");
  console.log("KNOWN_HISTORICAL_IMP04_DEVIATIONS: 2");
  console.log("UNKNOWN_IMP04_DEVIATIONS: 0");
  console.log("CURRENT_CANONICAL_IMP04_EVIDENCE_COUNT: 1");
  console.log("CGP_IMP04_GLOBAL_DISPATCHER: BLOCKED_PENDING_SEPARATE_BACKLOG_STRATEGY");
}

async function main() {
  await requireAcceptanceTarget();
  const context = await findContext();
  await requireApprovedPrice(context);
  const historicalEvents = await originalLegacyEventIds();
  assert.equal(historicalEvents.length, 19, "CGP-IMP-04 historical event isolation baseline changed unexpectedly");
  await assertLegacyEventsUntouched(historicalEvents);
  const financialBaseline = {};
  for (const table of ["journal_entries", "journal_lines", "cash_transactions", "treasury_transactions", "customer_gold_pools", "inventory_gold_pools"]) financialBaseline[table] = await countExisting(table);

  const validated = await createValidatedTwoPieceDocument(context);
  const posted = await post(context, validated);
  const eventId = posted.outboxEvent.eventId;
  assert.equal(posted.outboxEvent.eventType, consumer.EVENT_TYPE);
  assert.equal(posted.outboxEvent.eventVersion, consumer.EVENT_VERSION);
  assert.equal(posted.outboxEvent.status, "PENDING");
  assert.equal(posted.pricingSnapshots.length, 2);
  assert.ok(posted.pricingSnapshots.every((snapshot) => snapshot.approvedPriceId && snapshot.approvedPriceStatus === "APPROVED"));

  // An injected failure after the first projected Asset must roll every CGP
  // Inventory fact back, including the barcode allocation and receipt.
  await requireAcceptanceTarget();
  await assert.rejects(
    () => consumer.consumePostedEvent({ eventId, failureInjector: ({ itemIndex }) => { if (itemIndex === 0) throw new Error("CGP_IMP04_FORCED_ROLLBACK"); } }),
    /CGP_IMP04_FORCED_ROLLBACK/,
  );
  const itemIds = posted.pricingSnapshots.map((snapshot) => snapshot.cgpItemId);
  const [rollbackOrigins] = await models.sequelize.query("SELECT count(*)::int AS count FROM asset_origins WHERE cgp_item_id IN(:ids)", { replacements: { ids: itemIds } });
  assert.equal(Number(rollbackOrigins[0]?.count || 0), 0);
  assert.equal(await models.ProcessedEvent.count({ where: { consumerName: consumer.CONSUMER_NAME, eventId } }), 0);
  assert.equal(await models.IntegrationStatus.count({ where: { consumerName: consumer.CONSUMER_NAME, sourceEventId: eventId } }), 0);

  // The two simultaneous exact calls are the concurrency proof: the Outbox
  // row lock permits one projection and the other observes its immutable
  // receipt as a replay.
  await requireAcceptanceTarget();
  const race = await Promise.allSettled([consumer.consumePostedEvent({ eventId }), consumer.consumePostedEvent({ eventId })]);
  assert.equal(race.filter((entry) => entry.status === "fulfilled").length, 2);
  const raceValues = race.map((entry) => entry.value);
  assert.equal(raceValues.filter((entry) => entry.replayed === false).length, 1);
  assert.equal(raceValues.filter((entry) => entry.replayed === true).length, 1);
  const created = raceValues.find((entry) => !entry.replayed).assets;
  assert.equal(created.length, 2);
  const replay = await consumer.consumePostedEvent({ eventId });
  assert.equal(replay.replayed, true);

  const assets = await models.Asset.findAll({ where: { id: created.map((asset) => asset.id) }, order: [["id", "ASC"]] });
  assert.equal(assets.length, 2);
  assert.equal(new Set(assets.map((asset) => asset.barcode)).size, 2);
  assert.ok(assets.every((asset) => asset.barcode && asset.status === "pending_integration" && asset.operationalStatus === consumer.PENDING_STATE && asset.inventoryProfile === "CGP_CUSTOMER_GOLD_PURCHASE"));
  const [origins] = await models.sequelize.query("SELECT * FROM asset_origins WHERE asset_id IN(:assetIds) ORDER BY cgp_item_id", { replacements: { assetIds: assets.map((asset) => asset.id) } });
  assert.equal(origins.length, 2);
  assert.equal(new Set(origins.map((origin) => origin.cgp_item_id)).size, 2);
  assert.ok(origins.every((origin) => origin.origin_type === "CUSTOMER_GOLD_PURCHASE" && origin.mapping_classification === "CGP_IMP_04_EVENT_V1"));
  const [goldDetails] = await models.sequelize.query("SELECT * FROM asset_gold_details WHERE asset_id IN(:assetIds)", { replacements: { assetIds: assets.map((asset) => asset.id) } });
  const [costs] = await models.sequelize.query("SELECT * FROM asset_purchase_cost_revisions WHERE asset_id IN(:assetIds) AND is_current=true", { replacements: { assetIds: assets.map((asset) => asset.id) } });
  const [assetEvents] = await models.sequelize.query("SELECT * FROM asset_events WHERE asset_id IN(:assetIds) AND event_type='CGP_ACQUIRED_PENDING_INTEGRATION'", { replacements: { assetIds: assets.map((asset) => asset.id) } });
  const [movements] = await models.sequelize.query("SELECT * FROM inventory_asset_movements WHERE asset_id IN(:assetIds) AND movement_type='CGP_ACQUIRED_PENDING'", { replacements: { assetIds: assets.map((asset) => asset.id) } });
  assert.equal(goldDetails.length, 2);
  assert.equal(costs.length, 2);
  assert.equal(assetEvents.length, 2);
  assert.equal(movements.length, 2);
  assert.ok(costs.every((row) => itemIds.includes(row.cgp_item_id) && row.mapping_classification === "CGP_IMP_04_EVENT_V1"));
  assert.equal(await models.ProcessedEvent.count({ where: { consumerName: consumer.CONSUMER_NAME, eventId } }), 1);
  assert.equal(await models.IntegrationStatus.count({ where: { consumerName: consumer.CONSUMER_NAME, sourceEventId: eventId, status: "SUCCEEDED" } }), 1);
  const outbox = await models.OutboxEvent.findOne({ where: { eventId } });
  assert.equal(outbox.status, "PENDING", "consumer must not claim, publish, or dispatch the Outbox event");
  await assertLegacyEventsUntouched(historicalEvents);
  for (const [table, before] of Object.entries(financialBaseline)) assert.equal(await countExisting(table), before, `${table} must not be written by the Inventory consumer`);

  console.log("CGP_INVENTORY_CONSUMER_TEST: PASS");
  console.log("CGP_INVENTORY_EVENT_SCOPE: EXACT_CustomerGoldPurchasePostedEvent_v1");
  console.log("CGP_INVENTORY_ONE_ITEM_ONE_ASSET: PASS");
  console.log("CGP_INVENTORY_PENDING_INTEGRATION: PASS");
  console.log("CGP_INVENTORY_IDEMPOTENCY: PASS");
  console.log("CGP_INVENTORY_CONCURRENCY: PASS");
  console.log("CGP_INVENTORY_FAILURE_ROLLBACK: PASS");
  console.log("CGP_INVENTORY_NO_DOWNSTREAM_WRITES: PASS");
  console.log("CGP_INVENTORY_LEGACY_EVENTS_UNTOUCHED: PASS");
}

(VERIFY_EXISTING ? verifyExisting : main)()
  .catch((error) => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(async () => { await models.sequelize.close(); });
