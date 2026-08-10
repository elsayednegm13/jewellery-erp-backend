const crypto = require("crypto");
const Decimal = require("decimal.js");
const models = require("../models");
const { ConflictError, ValidationError } = require("../utils/errors");

const RATE_BASIS = "KARAT_SPECIFIC";
const CALCULATION_VERSION = 1;

function decimal(value, field) {
  try {
    const result = new Decimal(value);
    if (!result.isFinite()) throw new Error("not finite");
    return result;
  } catch {
    throw new ValidationError(`${field} must be a valid decimal`, { [field]: ["invalid_decimal"] });
  }
}

function fixed(value, places) {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

function plain(value) {
  return value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

function requiredText(value, field, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) throw new ValidationError(`${field} is required`, { [field]: ["required"] });
  return text;
}

function buildSnapshot({ document, item, pricing = {}, createdBy = null } = {}) {
  const header = plain(document);
  const line = plain(item);
  if (!header?.id || !line?.id || line.documentId !== header.id) {
    throw new ValidationError("CGP pricing snapshot requires a matching server document and item", { cgpItemId: ["document_mismatch"] });
  }
  if (!header.companyId || !header.branchId || line.companyId !== header.companyId) {
    throw new ValidationError("CGP pricing snapshot requires a valid company and branch scope", { companyId: ["scope_mismatch"] });
  }
  if (String(pricing.rateBasis || RATE_BASIS) !== RATE_BASIS) {
    throw new ValidationError("CGP pricing snapshot rate basis must be KARAT_SPECIFIC", { rateBasis: ["unsupported_rate_basis"] });
  }

  const grossWeight = decimal(line.grossWeight, "grossWeight");
  const stoneWeight = decimal(line.stoneWeight, "stoneWeight");
  const netWeight = decimal(line.netWeight, "netWeight");
  const purityFactor = decimal(line.purityFactor, "purityFactor");
  const karat = decimal(line.karat, "karat");
  const approvedKaratRate = decimal(pricing.approvedKaratRate, "approvedKaratRate");
  if (grossWeight.lt(0) || stoneWeight.lt(0) || stoneWeight.gt(grossWeight) || netWeight.lt(0)) {
    throw new ValidationError("CGP pricing snapshot contains invalid weight evidence", { netWeight: ["invalid_weight_evidence"] });
  }
  if (!grossWeight.minus(stoneWeight).eq(netWeight)) {
    throw new ValidationError("CGP pricing snapshot net weight must match gross minus stone", { netWeight: ["formula_mismatch"] });
  }
  if (purityFactor.lte(0) || purityFactor.gt(1) || approvedKaratRate.lt(0)) {
    throw new ValidationError("CGP pricing snapshot contains invalid purity or rate evidence", { approvedKaratRate: ["out_of_range"] });
  }

  const priceTimestamp = new Date(pricing.priceTimestamp);
  if (Number.isNaN(priceTimestamp.getTime())) throw new ValidationError("priceTimestamp is required", { priceTimestamp: ["invalid_timestamp"] });
  if (!Number.isInteger(Number(pricing.approvedPriceId)) || Number(pricing.approvedPriceId) < 1 || pricing.approvedPriceStatus !== "APPROVED" || !pricing.approvedPriceAt || !pricing.approvedPriceBy || !pricing.approvedPriceSource) {
    throw new ValidationError("CGP pricing snapshot requires approved Gold Center price provenance", { approvedPriceId: ["approved_price_required"] });
  }
  const currency = String(header.currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError("CGP pricing snapshot currency is invalid", { currency: ["invalid_currency"] });

  // A karat-specific rate already contains the purity adjustment.  Pure gold
  // remains immutable gold evidence and is deliberately not multiplied again.
  const normalizedNetWeight = new Decimal(fixed(netWeight, 6));
  const normalizedPurityFactor = new Decimal(fixed(purityFactor, 6));
  const normalizedApprovedKaratRate = new Decimal(fixed(approvedKaratRate, 4));
  const pureGoldWeight = normalizedNetWeight.mul(normalizedPurityFactor);
  const lineGoldValue = normalizedNetWeight.mul(normalizedApprovedKaratRate);

  return {
    id: `CGPS:${header.companyId}:${crypto.randomUUID()}`,
    companyId: header.companyId,
    branchId: header.branchId,
    cgpDocumentId: header.id,
    cgpItemId: line.id,
    priceSource: requiredText(pricing.priceSource, "priceSource", 128),
    priceVersion: requiredText(pricing.priceVersion, "priceVersion", 64),
    priceTimestamp,
    approvedPriceId: Number.isInteger(Number(pricing.approvedPriceId)) ? Number(pricing.approvedPriceId) : null,
    approvedPriceStatus: requiredText(pricing.approvedPriceStatus, "approvedPriceStatus", 24),
    approvedPriceAt: new Date(pricing.approvedPriceAt),
    approvedPriceBy: requiredText(pricing.approvedPriceBy, "approvedPriceBy", 128),
    approvedPriceSource: requiredText(pricing.approvedPriceSource, "approvedPriceSource", 64),
    currency,
    karat: fixed(karat, 6),
    purityFactor: fixed(purityFactor, 6),
    grossWeight: fixed(grossWeight, 6),
    stoneWeight: fixed(stoneWeight, 6),
    netWeight: fixed(netWeight, 6),
    pureGoldWeight: fixed(pureGoldWeight, 6),
    approvedKaratRate: fixed(normalizedApprovedKaratRate, 4),
    rateBasis: RATE_BASIS,
    lineGoldValue: fixed(lineGoldValue, 4),
    calculationVersion: Number.isInteger(pricing.calculationVersion) && pricing.calculationVersion > 0 ? pricing.calculationVersion : CALCULATION_VERSION,
    createdBy: createdBy || null,
  };
}

async function createSnapshot({ transaction, document, item, pricing, createdBy } = {}) {
  if (!transaction) throw new ValidationError("CGP pricing snapshot requires a caller transaction", { transaction: ["required"] });
  const values = buildSnapshot({ document, item, pricing, createdBy });
  const existing = await models.CgpPricingSnapshot.findOne({ where: { cgpItemId: values.cgpItemId }, transaction, lock: transaction.LOCK.UPDATE });
  if (existing) throw new ConflictError("CGP item already has an immutable pricing snapshot");
  return models.CgpPricingSnapshot.create(values, { transaction });
}

module.exports = { RATE_BASIS, CALCULATION_VERSION, buildSnapshot, createSnapshot };
