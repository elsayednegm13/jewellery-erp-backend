"use strict";

// CGP-IMP-04 is deliberately an explicit, event-id addressed consumer.  It
// never scans the Outbox and it does not advance event delivery state: later
// orchestration owns that concern.  Its only durable projection is the
// inventory representation of an already-posted CGP document.
const Decimal = require("decimal.js");
const crypto = require("crypto");
const models = require("../models");
const barcodeIdentity = require("./barcode-identity.service");
const inventoryRuntime = require("./inventory-v2-runtime.service");
const posting = require("./cgp-posting.service");
const { consumeExactlyOnce } = require("./processed-event.service");
const { ensureIntegrationStatus, transitionIntegrationStatus, INTEGRATION_STATUS } = require("./integration-status.service");
const { AppError, ConflictError, NotFoundError, ValidationError } = require("../utils/errors");

const CONSUMER_NAME = "INVENTORY";
const EVENT_TYPE = posting.POSTED_EVENT_TYPE;
const EVENT_VERSION = posting.POSTED_EVENT_VERSION;
const PENDING_STATE = "PENDING_INTEGRATION";

function auditIdempotencyKey(eventId, itemId) {
  return `CGP_INV:${crypto.createHash("sha256").update(`${eventId}:${itemId}`).digest("hex")}`;
}

function decimalEqual(left, right) {
  try {
    return new Decimal(left).eq(new Decimal(right));
  } catch {
    return false;
  }
}

function requireMatch(actual, expected, code) {
  if (String(actual ?? "") !== String(expected ?? "")) {
    throw new AppError("CGP posted event does not match immutable purchase evidence", 409, code);
  }
}

function requireDecimalMatch(actual, expected, code) {
  if (!decimalEqual(actual, expected)) {
    throw new AppError("CGP posted event numeric facts do not match immutable purchase evidence", 409, code);
  }
}

function assertExactEvent(event) {
  if (!event) throw new NotFoundError("CGP posted event not found");
  if (event.eventType !== EVENT_TYPE || Number(event.eventVersion) !== EVENT_VERSION) {
    throw new ValidationError("Only CustomerGoldPurchasePostedEvent v1 can be consumed by Inventory", {
      eventType: [EVENT_TYPE], eventVersion: [String(EVENT_VERSION)],
    });
  }
  const payload = event.payload || {};
  const aggregate = payload.aggregate || {};
  requireMatch(payload.eventId, event.eventId, "CGP_EVENT_ID_MISMATCH");
  requireMatch(payload.eventType, EVENT_TYPE, "CGP_EVENT_TYPE_MISMATCH");
  requireMatch(payload.eventVersion, EVENT_VERSION, "CGP_EVENT_VERSION_MISMATCH");
  requireMatch(aggregate.type, "CustomerGoldPurchaseDocument", "CGP_EVENT_AGGREGATE_TYPE_MISMATCH");
  requireMatch(aggregate.id, event.aggregateId, "CGP_EVENT_AGGREGATE_ID_MISMATCH");
  if (!Array.isArray(payload.pricing?.lines) || !payload.pricing.lines.length) {
    throw new ValidationError("CGP posted event has no pricing lines");
  }
  return { payload, aggregate };
}

function assertSnapshotMatchesLine(snapshot, line) {
  const textFields = ["priceSource", "priceVersion", "currency", "rateBasis"];
  const numericFields = ["karat", "purityFactor", "grossWeight", "stoneWeight", "netWeight", "pureGoldWeight", "approvedKaratRate", "lineGoldValue", "calculationVersion"];
  for (const field of textFields) requireMatch(line[field], snapshot[field], `CGP_EVENT_SNAPSHOT_${field.toUpperCase()}_MISMATCH`);
  for (const field of numericFields) requireDecimalMatch(line[field], snapshot[field], `CGP_EVENT_SNAPSHOT_${field.toUpperCase()}_MISMATCH`);
}

async function createAssetProjection({ transaction, event, document, item, snapshot, line, failureInjector, itemIndex }) {
  const existingOrigins = await models.sequelize.query(
    "SELECT id FROM asset_origins WHERE cgp_item_id=:cgpItemId FOR UPDATE",
    { replacements: { cgpItemId: item.id }, transaction, type: models.sequelize.QueryTypes.SELECT }
  );
  if (existingOrigins.length) throw new ConflictError("A CGP inventory Asset already exists for this invoice item");

  const branch = await models.Branch.findOne({
    where: { id: document.branchId, companyId: document.companyId, isActive: true },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!branch) throw new AppError("CGP document branch is not an active branch in the document Company", 422, "CGP_INVENTORY_BRANCH_INVALID");

  const barcode = await barcodeIdentity.generateBarcodeForAsset({
    companyId: document.companyId,
    assetType: "gold-weight",
    karat: snapshot.karat,
    transaction,
  });
  const now = new Date();
  const asset = await models.Asset.create({
    id: inventoryRuntime.newId("CGPA"),
    companyId: document.companyId,
    name: `CGP ${document.draftNumber} #${item.lineNumber}`,
    description: `Customer Gold Purchase ${document.draftNumber}, line ${item.lineNumber}`,
    type: "gold-weight",
    category: "customer-gold-purchase",
    karat: Number(snapshot.karat),
    purity: snapshot.purityFactor,
    grossWeight: snapshot.grossWeight,
    netWeight: snapshot.netWeight,
    goldWeight: snapshot.pureGoldWeight,
    price: "0.0000",
    cost: snapshot.lineGoldValue,
    branch: branch.name,
    branchId: branch.id,
    location: "",
    locationId: null,
    status: "pending_integration",
    operationalStatus: PENDING_STATE,
    inventoryProfile: "CGP_CUSTOMER_GOLD_PURCHASE",
    condition: null,
    // The legacy compatibility trigger recognizes this exact canonical source
    // token and consequently preserves the CGP profile; display text belongs
    // in description/audit, never in the source discriminator.
    source: "customer_gold_purchase",
    barcode: barcode.barcode,
    inventoryCode: barcode.inventoryCode,
    itemCode: barcode.itemCode,
    karatCode: barcode.karatCode,
    barcodeSerial: barcode.barcodeSerial,
    barcodeGeneratedAt: barcode.barcodeGeneratedAt,
    barcodeRevision: barcode.barcodeRevision,
    purchaseDate: document.transactionDate,
    createdBy: document.postedBy,
    updatedBy: document.postedBy,
    metadataSchemaVersion: 1,
    metadata: {
      contract: "CGP_IMP_04_EVENT_V1",
      cgpDocumentId: document.id,
      cgpItemId: item.id,
      customerId: document.customerId,
      pricingSnapshotId: snapshot.id,
      postingEventId: event.eventId,
      correlationId: event.correlationId,
    },
  }, { transaction });

  await models.sequelize.query(`INSERT INTO asset_origins
    (id,asset_id,company_id,branch_id,origin_type,cgp_item_id,received_at,received_by,mapping_classification)
    VALUES (:id,:assetId,:companyId,:branchId,'CUSTOMER_GOLD_PURCHASE',:cgpItemId,:receivedAt,:receivedBy,'CGP_IMP_04_EVENT_V1')`, {
    replacements: {
      id: inventoryRuntime.newId("CGPOR"), assetId: asset.id, companyId: document.companyId,
      branchId: branch.id, cgpItemId: item.id, receivedAt: document.postedAt || now, receivedBy: document.postedBy,
    }, transaction,
  });
  await models.sequelize.query(`INSERT INTO asset_gold_details
    (asset_id,company_id,weight_unit,gross_weight,stone_weight,net_gold_weight,karat,purity_ratio,pure_gold_9999,mapping_classification)
    VALUES (:assetId,:companyId,'GRAM',:grossWeight,:stoneWeight,:netWeight,:karat,:purityFactor,:pureGoldWeight,'CGP_IMP_04_EVENT_V1')`, {
    replacements: { assetId: asset.id, companyId: document.companyId, grossWeight: snapshot.grossWeight, stoneWeight: snapshot.stoneWeight, netWeight: snapshot.netWeight, karat: snapshot.karat, purityFactor: snapshot.purityFactor, pureGoldWeight: snapshot.pureGoldWeight },
    transaction,
  });
  await models.sequelize.query(`INSERT INTO asset_purchase_cost_revisions
    (id,asset_id,company_id,branch_id,revision_no,currency,purchase_gold_rate,gold_rate_source,gold_value,total_purchase_cost,cgp_item_id,purchase_date,is_current,created_by,provenance,mapping_classification)
    VALUES (:id,:assetId,:companyId,:branchId,1,:currency,:purchaseGoldRate,:goldRateSource,:goldValue,:totalPurchaseCost,:cgpItemId,:purchaseDate,true,:createdBy,:provenance,'CGP_IMP_04_EVENT_V1')`, {
    replacements: {
      id: inventoryRuntime.newId("CGPCR"), assetId: asset.id, companyId: document.companyId, branchId: branch.id,
      currency: snapshot.currency, purchaseGoldRate: snapshot.approvedKaratRate, goldRateSource: snapshot.priceSource,
      goldValue: snapshot.lineGoldValue, totalPurchaseCost: snapshot.lineGoldValue, cgpItemId: item.id,
      purchaseDate: document.transactionDate, createdBy: document.postedBy,
      provenance: JSON.stringify({ contract: "CGP_IMP_04_EVENT_V1", eventId: event.eventId, correlationId: event.correlationId, snapshotId: snapshot.id, approvedPriceId: snapshot.approvedPriceId, approvedPriceVersion: snapshot.priceVersion, line: line.lineNumber }),
    }, transaction,
  });
  const assetEvent = await inventoryRuntime.recordAssetEvent({
    models, transaction, asset: asset.toJSON(),
    context: { companyId: document.companyId, branchId: branch.id, branchName: branch.name, actorId: document.postedBy, actorName: "CGP Inventory Consumer", occurredAt: now },
    eventType: "CGP_ACQUIRED_PENDING_INTEGRATION", oldStatus: null, newStatus: PENDING_STATE,
    sourceType: "CUSTOMER_GOLD_PURCHASE", sourceId: event.eventId,
    note: `CGP posted event ${event.eventId} projected as pending integration Asset`,
    idempotencyKey: auditIdempotencyKey(event.eventId, item.id),
  });
  await inventoryRuntime.recordMovement({
    models, transaction, asset: asset.toJSON(),
    context: { companyId: document.companyId, branchId: branch.id, actorId: document.postedBy, occurredAt: now },
    movementType: "CGP_ACQUIRED_PENDING", sourceType: "CUSTOMER_GOLD_PURCHASE", sourceId: event.eventId,
    eventId: assetEvent.id, toBranchId: branch.id, toLocationId: null,
  });
  if (typeof failureInjector === "function") await failureInjector({ stage: "after_asset", itemIndex, asset: asset.toJSON(), event, document, snapshot });
  return asset.toJSON();
}

async function consumePostedEvent({ eventId, failureInjector = null } = {}) {
  if (!eventId || !String(eventId).trim()) throw new ValidationError("CGP Inventory consumer requires an explicit eventId", { eventId: ["required"] });
  return models.sequelize.transaction(async (transaction) => {
    const event = await models.OutboxEvent.findOne({ where: { eventId: String(eventId) }, transaction, lock: transaction.LOCK.UPDATE });
    const { payload, aggregate } = assertExactEvent(event);
    const document = await models.CustomerGoldPurchaseDocument.findOne({
      where: { id: aggregate.id, companyId: aggregate.companyId }, transaction, lock: transaction.LOCK.UPDATE,
    });
    if (!document) throw new NotFoundError("CGP posted document not found for Inventory projection");
    if (document.businessStatus !== "POSTED") throw new ConflictError("CGP Inventory projection requires a posted document");
    requireMatch(document.branchId, aggregate.branchId, "CGP_DOCUMENT_BRANCH_MISMATCH");
    requireMatch(document.customerId, aggregate.customerId, "CGP_DOCUMENT_CUSTOMER_MISMATCH");
    requireMatch(document.currency, aggregate.currency, "CGP_DOCUMENT_CURRENCY_MISMATCH");
    const items = await models.CustomerGoldPurchaseItem.findAll({ where: { documentId: document.id, companyId: document.companyId }, order: [["lineNumber", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    if (items.length !== payload.pricing.lines.length) throw new AppError("CGP posted event line count does not match document items", 409, "CGP_EVENT_ITEM_COUNT_MISMATCH");
    const linesByItemId = new Map(payload.pricing.lines.map((line) => [String(line.cgpItemId), line]));
    if (linesByItemId.size !== items.length) throw new AppError("CGP posted event contains duplicate or missing item identifiers", 409, "CGP_EVENT_ITEM_IDENTIFIERS_INVALID");
    const assets = [];
    const exactEvent = event.toJSON();
    const result = await consumeExactlyOnce({
      transaction,
      consumerName: CONSUMER_NAME,
      event: exactEvent,
      effect: async () => {
        const integrationResult = await ensureIntegrationStatus({
          transaction, sourceEventId: event.eventId, aggregateType: event.aggregateType,
          aggregateId: event.aggregateId, consumerName: CONSUMER_NAME, correlationId: event.correlationId,
        });
        const integration = integrationResult.status;
        await transitionIntegrationStatus({ transaction, status: integration, nextStatus: INTEGRATION_STATUS.PROCESSING });
        for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
          const item = items[itemIndex];
          const line = linesByItemId.get(String(item.id));
          if (!line) throw new AppError("CGP posted event is missing a document item", 409, "CGP_EVENT_ITEM_MISSING");
          requireDecimalMatch(line.lineNumber, item.lineNumber, "CGP_EVENT_LINE_NUMBER_MISMATCH");
          const snapshot = await models.CgpPricingSnapshot.findOne({
            where: { cgpDocumentId: document.id, cgpItemId: item.id, companyId: document.companyId, branchId: document.branchId },
            transaction, lock: transaction.LOCK.UPDATE,
          });
          if (!snapshot) throw new AppError("CGP immutable pricing snapshot is missing", 409, "CGP_PRICING_SNAPSHOT_MISSING");
          if (!snapshot.approvedPriceId || snapshot.approvedPriceStatus !== "APPROVED") {
            throw new AppError("CGP Inventory projection requires approved pricing provenance", 409, "CGP_APPROVED_PRICE_PROVENANCE_REQUIRED");
          }
          assertSnapshotMatchesLine(snapshot.toJSON(), line);
          assets.push(await createAssetProjection({ transaction, event: exactEvent, document: document.toJSON(), item: item.toJSON(), snapshot: snapshot.toJSON(), line, failureInjector, itemIndex }));
        }
        await transitionIntegrationStatus({ transaction, status: integration, nextStatus: INTEGRATION_STATUS.SUCCEEDED });
      },
    });
    const integration = await models.IntegrationStatus.findOne({ where: { sourceEventId: event.eventId, consumerName: CONSUMER_NAME }, transaction });
    return { replayed: !result.processed, eventId: event.eventId, assets, receipt: result.receipt?.toJSON?.() || result.receipt || null, integration: integration?.toJSON() || null };
  });
}

module.exports = { CONSUMER_NAME, EVENT_TYPE, EVENT_VERSION, PENDING_STATE, consumePostedEvent };
