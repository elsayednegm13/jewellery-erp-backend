"use strict";

// CGP-IMP-07 is an Inventory-owned readiness evaluator, not a fourth event
// consumer. It reads committed evidence for one exact source event and only
// delegates the final operational transition to the canonical Inventory runtime.
const Decimal = require("decimal.js");
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const models = require("../models");
const inventory = require("./inventory-v2-runtime.service");
const accounting = require("./cgp-accounting-consumer.service");
const gold = require("./cgp-gold-center-consumer.service");
const { AppError, ConflictError, NotFoundError, ValidationError } = require("../utils/errors");

const EVENT_TYPE = "CustomerGoldPurchasePostedEvent";
const EVENT_VERSION = 1;
const CONSUMERS = Object.freeze(["INVENTORY", "ACCOUNTING", "GOLD_CENTER"]);

function fail(code, message = "CGP availability hard gate is incomplete") { throw new AppError(message, 409, code); }
function same(a, b, code) { if (String(a ?? "") !== String(b ?? "")) fail(code, "CGP availability evidence does not match its source event"); }
function decimal(a, b, code) { try { if (new Decimal(a).eq(new Decimal(b))) return; } catch {} fail(code, "CGP availability numeric evidence does not match its source event"); }
function availabilityIdempotencyKey(eventId, assetId) {
  return `CGP_AVAILABLE:${crypto.createHash("sha256").update(`${eventId}:${assetId}`).digest("hex")}`;
}

async function oneCount(sql, replacements, transaction) {
  const rows = await models.sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  return Number(rows[0]?.count || 0);
}
async function requireReceiptAndIntegration({ event, consumerName, transaction }) {
  const receipt = await models.ProcessedEvent.count({ where: { consumerName, eventId: event.eventId }, transaction });
  const integration = await models.IntegrationStatus.findOne({ where: { consumerName, sourceEventId: event.eventId }, transaction, lock: transaction.LOCK.UPDATE });
  if (receipt !== 1 || !integration || integration.status !== "SUCCEEDED") fail(`CGP_AVAILABILITY_${consumerName}_STATUS_REQUIRED`);
}
async function loadPosted({ event, transaction }) {
  if (!event) throw new NotFoundError("CGP posted event not found");
  if (event.eventType !== EVENT_TYPE || Number(event.eventVersion) !== EVENT_VERSION) throw new ValidationError("CGP availability supports CustomerGoldPurchasePostedEvent v1 only");
  const { payload, aggregate } = accounting.assertExactEvent(event);
  const facts = await accounting.assertPostedFacts({ event, payload, aggregate, transaction });
  const audit = await models.AuditLog.findOne({ where: { companyId: facts.document.companyId, action: "cgp.posted", sourceDocument: facts.document.draftNumber, correlationId: event.correlationId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!audit) fail("CGP_AVAILABILITY_AUDIT_REQUIRED");
  return { payload, aggregate, document: facts.document };
}
async function requireInventory({ event, document, transaction }) {
  await requireReceiptAndIntegration({ event, consumerName: "INVENTORY", transaction });
  const items = await models.CustomerGoldPurchaseItem.findAll({ where: { documentId: document.id, companyId: document.companyId }, order: [["lineNumber", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
  if (!items.length) fail("CGP_AVAILABILITY_ITEMS_REQUIRED");
  const origins = await models.sequelize.query(`SELECT cgp_item_id AS "cgpItemId",asset_id AS "assetId" FROM asset_origins WHERE cgp_item_id IN(:itemIds) FOR UPDATE`, { replacements: { itemIds: items.map((x) => x.id) }, transaction, type: QueryTypes.SELECT });
  if (origins.length !== items.length || new Set(origins.map((x) => x.cgpItemId)).size !== items.length) fail("CGP_AVAILABILITY_INVENTORY_LINEAGE_REQUIRED");
  const assets = await models.Asset.findAll({ where: { id: origins.map((x) => x.assetId), companyId: document.companyId }, transaction, lock: transaction.LOCK.UPDATE });
  if (assets.length !== items.length) fail("CGP_AVAILABILITY_ASSET_COUNT_REQUIRED");
  for (const asset of assets) {
    if (asset.branchId !== document.branchId || asset.source !== "customer_gold_purchase" || asset.inventoryProfile !== "CGP_CUSTOMER_GOLD_PURCHASE" || !String(asset.barcode || "").trim()) fail("CGP_AVAILABILITY_ASSET_EVIDENCE_INVALID");
    if (inventory.operationalStatusOf(asset) !== "PENDING_INTEGRATION" && inventory.operationalStatusOf(asset) !== "AVAILABLE") fail("CGP_AVAILABILITY_ASSET_STATUS_INVALID");
  }
  const duplicateBarcode = await oneCount("SELECT count(*)::int AS count FROM (SELECT barcode FROM assets WHERE id IN(:assetIds) GROUP BY barcode HAVING count(*)>1) q", { assetIds: assets.map((x) => x.id) }, transaction);
  if (duplicateBarcode) fail("CGP_AVAILABILITY_BARCODE_DUPLICATE");
  return { items: items.map((x) => x.toJSON()), assets };
}
async function requireAccounting({ event, document, transaction }) {
  await requireReceiptAndIntegration({ event, consumerName: "ACCOUNTING", transaction });
  const journal = await models.JournalEntry.findOne({ where: { companyId: document.companyId, sourceType: accounting.JOURNAL_SOURCE_TYPE, sourceId: event.eventId }, transaction, lock: transaction.LOCK.UPDATE });
  const liability = await models.CustomerFinancialLiability.findOne({ where: { sourceEventId: event.eventId, sourceDocumentId: document.id, companyId: document.companyId, customerId: document.customerId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!journal || !liability || journal.status !== "posted" || liability.status !== "OPEN") fail("CGP_AVAILABILITY_ACCOUNTING_EVIDENCE_REQUIRED");
  decimal(journal.totalDebit, journal.totalCredit, "CGP_AVAILABILITY_JOURNAL_UNBALANCED");
  decimal(liability.originalAmount, document.totalPayableToCustomer, "CGP_AVAILABILITY_LIABILITY_VALUE_INVALID");
  same(liability.currency, document.currency, "CGP_AVAILABILITY_LIABILITY_CURRENCY_INVALID");
}
async function requireGold({ event, document, transaction }) {
  await requireReceiptAndIntegration({ event, consumerName: "GOLD_CENTER", transaction });
  const core = await models.GoldCoreEvent.findOne({ where: { sourceEventId: event.eventId, companyId: document.companyId, branchId: document.branchId, sourcePartyId: document.customerId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!core || core.eventType !== "CUSTOMER_GOLD_ACQUISITION_RECORDED" || Number(core.eventVersion) !== 1) fail("CGP_AVAILABILITY_GOLD_EVIDENCE_REQUIRED");
  same(core.sourceDocumentId, document.id, "CGP_AVAILABILITY_GOLD_DOCUMENT_INVALID");
  same(core.currency, document.currency, "CGP_AVAILABILITY_GOLD_CURRENCY_INVALID");
  await gold.assertPostedFacts({ event, payload: event.payload, aggregate: event.payload.aggregate, transaction });
}
async function evaluateAvailability({ eventId, failureInjector = null } = {}) {
  if (!String(eventId || "").trim()) throw new ValidationError("CGP availability evaluator requires an explicit eventId", { eventId: ["required"] });
  return models.sequelize.transaction(async (transaction) => {
    const event = await models.OutboxEvent.findOne({ where: { eventId: String(eventId) }, transaction, lock: transaction.LOCK.UPDATE });
    const { document } = await loadPosted({ event, transaction });
    const inventoryFacts = await requireInventory({ event, document, transaction });
    // Replays are not a shortcut around the economic gates.  Availability
    // remains justified only while the same exact source event still has all
    // three committed, successful projections.
    await requireAccounting({ event, document, transaction });
    await requireGold({ event, document, transaction });
    const allAvailable = inventoryFacts.assets.every((asset) => inventory.operationalStatusOf(asset) === "AVAILABLE");
    if (allAvailable) return { replayed: true, eventId: event.eventId, assets: inventoryFacts.assets.map((x) => x.toJSON()) };
    if (inventoryFacts.assets.some((asset) => inventory.operationalStatusOf(asset) !== "PENDING_INTEGRATION")) fail("CGP_AVAILABILITY_PARTIAL_ASSET_STATE");
    const context = inventory.createCgpAvailabilityTransitionContext({ companyId: document.companyId, branchId: document.branchId, branchName: inventoryFacts.assets[0].branch, actorId: document.postedBy, actorName: "CGP Availability Evaluator", occurredAt: new Date() });
    const transitioned = [];
    for (const asset of inventoryFacts.assets) {
      await inventory.transitionAsset({ models, transaction, asset, context, toStatus: "AVAILABLE", eventType: "CGP_INTEGRATION_AVAILABLE", movementType: "CGP_INTEGRATION_AVAILABLE", sourceType: "CUSTOMER_GOLD_PURCHASE", sourceId: event.eventId, note: `CGP hard gates complete for ${event.eventId}`, idempotencyKey: availabilityIdempotencyKey(event.eventId, asset.id) });
      transitioned.push(asset.id);
      if (typeof failureInjector === "function") await failureInjector({ stage: "after_asset_transition", assetId: asset.id, transitioned, event, document });
    }
    return { replayed: false, eventId: event.eventId, assets: await models.Asset.findAll({ where: { id: transitioned }, transaction }) };
  });
}
module.exports = { EVENT_TYPE, EVENT_VERSION, availabilityIdempotencyKey, evaluateAvailability, loadPosted, requireInventory, requireAccounting, requireGold };
