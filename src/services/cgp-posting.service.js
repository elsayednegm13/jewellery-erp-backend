"use strict";

const Decimal = require("decimal.js");
const models = require("../models");
const permissionService = require("./permission.service");
const pricingSnapshots = require("./cgp-pricing-snapshot.service");
const outboxService = require("./outbox.service");
const auditService = require("./audit.service");
const draftService = require("./gold-purchase-draft.service");
const goldPriceApprovalService = require("./gold-price-approval.service");
const { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } = require("../utils/errors");

const POST_PERMISSION = "gold_purchase.cgp.post";
const POSTED_EVENT_TYPE = "CustomerGoldPurchasePostedEvent";
const POSTED_EVENT_VERSION = 1;

function fixed(value, places) {
  return new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

function postingReference(documentId) {
  return `CGP-POSTED:${documentId}`;
}

function requireContext(context = {}) {
  if (!context.companyId) throw new AppError("CGP Company context is required", 422, "CGP_COMPANY_CONTEXT_REQUIRED");
  if (!context.branchId) throw new AppError("CGP Branch context is required", 422, "CGP_BRANCH_CONTEXT_REQUIRED");
  if (!context.user?.id) throw new ForbiddenError("CGP posting requires an authenticated user");
}

async function assertPostingPermission(context) {
  if (!(await permissionService.userHasPermission(context.user, POST_PERMISSION))) {
    throw new ForbiddenError(`${POST_PERMISSION} is required`);
  }
}

async function resolveApprovedKaratPrice({ document, item, transaction }) {
  const price = await goldPriceApprovalService.resolveExecutableApprovedKaratPrice({
    companyId: document.companyId,
    currency: document.currency,
    karat: Number(item.karat),
    transaction,
  });
  const rate = new Decimal(price.pricePerGram);
  if (!rate.isFinite() || rate.lt(0)) throw new AppError("Approved Gold Center price is invalid", 422, "CGP_APPROVED_GOLD_PRICE_INVALID");
  return {
    priceSource: "GOLD_CENTER_APPROVED_PRICE",
    priceVersion: `GOLD_PRICE:${price.id}:APPROVAL:${price.approvalVersion}`,
    priceTimestamp: price.approvedAt,
    approvedPriceId: price.id,
    approvedPriceStatus: price.approvalStatus,
    approvedPriceAt: price.approvedAt,
    approvedPriceBy: price.approvedBy,
    approvedPriceSource: price.source,
    approvedKaratRate: fixed(rate, 4),
    rateBasis: pricingSnapshots.RATE_BASIS,
  };
}

function buildPostedEvent({ document, snapshots, postedAt, eventId, correlationId }) {
  const lines = snapshots.map((snapshot) => ({
    cgpItemId: snapshot.cgpItemId,
    lineNumber: Number(snapshot.lineNumber),
    priceSource: snapshot.priceSource,
    priceVersion: snapshot.priceVersion,
    priceTimestamp: new Date(snapshot.priceTimestamp).toISOString(),
    currency: snapshot.currency,
    karat: snapshot.karat,
    purityFactor: snapshot.purityFactor,
    grossWeight: snapshot.grossWeight,
    stoneWeight: snapshot.stoneWeight,
    netWeight: snapshot.netWeight,
    pureGoldWeight: snapshot.pureGoldWeight,
    approvedKaratRate: snapshot.approvedKaratRate,
    rateBasis: snapshot.rateBasis,
    lineGoldValue: snapshot.lineGoldValue,
    calculationVersion: snapshot.calculationVersion,
  }));
  const totalGoldValue = fixed(lines.reduce((total, line) => total.plus(line.lineGoldValue), new Decimal(0)), 4);
  return {
    eventId,
    eventType: POSTED_EVENT_TYPE,
    eventVersion: POSTED_EVENT_VERSION,
    occurredAt: postedAt.toISOString(),
    correlationId,
    aggregate: {
      type: "CustomerGoldPurchaseDocument",
      id: document.id,
      documentNumber: document.draftNumber,
      companyId: document.companyId,
      branchId: document.branchId,
      customerId: document.customerId,
      currency: document.currency,
      transactionDate: document.transactionDate,
    },
    pricing: {
      rateBasis: pricingSnapshots.RATE_BASIS,
      formula: "NET_WEIGHT_X_APPROVED_KARAT_RATE",
      purityApplication: "EXACTLY_ONCE_AS_PURE_GOLD_EVIDENCE",
      totalGoldValue,
      totalPayableToCustomer: totalGoldValue,
      lines,
    },
  };
}

async function post({ context, id, expectedVersion, correlationId, transaction, failureInjector = null }) {
  if (!transaction) throw new ValidationError("CGP Posting requires a caller transaction", { transaction: ["required"] });
  requireContext(context);
  await assertPostingPermission(context);
  const version = draftService.parseVersion(expectedVersion);
  const document = await models.CustomerGoldPurchaseDocument.findOne({
    where: { id, companyId: context.companyId, voidedAt: null },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!document) throw new NotFoundError("Customer Gold Purchase document not found");
  if (document.branchId !== context.branchId) throw new ForbiddenError("CGP Posting branch is outside the authenticated scope");
  if (document.businessStatus === "POSTED") throw new ConflictError("Customer Gold Purchase document is already posted");
  if (document.businessStatus !== "VALIDATED") {
    throw new AppError("Only a validated Customer Gold Purchase document can be posted", 409, "CGP_DOCUMENT_NOT_VALIDATED");
  }
  if (document.version !== version) throw new ConflictError("Customer Gold Purchase document version conflict");

  const items = await models.CustomerGoldPurchaseItem.findAll({
    where: { documentId: document.id, companyId: context.companyId },
    order: [["lineNumber", "ASC"]],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!items.length) throw new AppError("Customer Gold Purchase document has no items", 422, "CGP_ITEMS_REQUIRED");

  const snapshots = [];
  for (const item of items) {
    const pricing = await resolveApprovedKaratPrice({ document, item, transaction });
    const snapshot = await pricingSnapshots.createSnapshot({ transaction, document, item, pricing, createdBy: context.user.id });
    snapshots.push({ ...snapshot.toJSON(), lineNumber: item.lineNumber });
  }

  const postedAt = new Date();
  const reference = postingReference(document.id);
  const eventId = reference;
  const event = buildPostedEvent({
    document: document.toJSON(),
    snapshots,
    postedAt,
    eventId,
    correlationId: correlationId || eventId,
  });
  const totals = event.pricing;
  await document.update({
    businessStatus: "POSTED",
    postedAt,
    postedBy: context.user.id,
    postingReference: reference,
    postingMetadata: { eventId, eventType: POSTED_EVENT_TYPE, eventVersion: POSTED_EVENT_VERSION, correlationId: event.correlationId },
    totalGoldValue: totals.totalGoldValue,
    totalPayableToCustomer: totals.totalPayableToCustomer,
    updatedBy: context.user.id,
    version: version + 1,
  }, { transaction });

  await auditService.record(context.companyId, {
    action: "cgp.posted",
    description: `CGP ${document.draftNumber} posted`,
    user: draftService.actorName(context.user),
    userId: context.user.id,
    branch: document.branchId,
    sourceDocument: document.draftNumber,
    correlationId: event.correlationId,
    before: JSON.stringify({ businessStatus: "VALIDATED", version }),
    after: JSON.stringify({ businessStatus: "POSTED", version: version + 1, postingReference: reference, eventId, totalGoldValue: totals.totalGoldValue }),
  }, { transaction });
  // This is an internal test seam, intentionally unreachable from the route.
  // It verifies that a failure after durable draft facts and audit work still
  // rolls the entire Posting transaction back.
  if (typeof failureInjector === "function") await failureInjector({ stage: "after_audit_before_outbox", document, event });
  const outbox = await outboxService.enqueueEvent({
    transaction,
    event: {
      eventId,
      eventType: POSTED_EVENT_TYPE,
      eventVersion: POSTED_EVENT_VERSION,
      aggregateType: "CustomerGoldPurchaseDocument",
      aggregateId: document.id,
      payload: event,
      occurredAt: postedAt,
      correlationId: event.correlationId,
      causationId: context.causationId || null,
    },
  });

  return {
    document: document.toJSON(),
    pricingSnapshots: snapshots,
    postedEvent: event,
    outboxEvent: outbox.toJSON(),
  };
}

module.exports = {
  POST_PERMISSION,
  POSTED_EVENT_TYPE,
  POSTED_EVENT_VERSION,
  resolveApprovedKaratPrice,
  buildPostedEvent,
  post,
};
