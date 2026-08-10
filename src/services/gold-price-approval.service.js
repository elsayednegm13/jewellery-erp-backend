"use strict";

const { Op } = require("sequelize");
const models = require("../models");
const permissionService = require("./permission.service");
const auditService = require("./audit.service");
const { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } = require("../utils/errors");
const { GOLD_PRICE_APPROVAL_PERMISSION } = require("../bootstrap/gold-price-approval-permission-catalog");

const APPROVAL_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  VOIDED: "VOIDED",
  SUPERSEDED: "SUPERSEDED",
});
const PRICE_SOURCES = new Set(["manual", "live", "import", "emergency"]);

function requiredText(value, field, maxLength = 128) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) throw new ValidationError(`${field} is required`, { [field]: ["required"] });
  return text;
}

function validCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError("currency is invalid", { currency: ["invalid"] });
  return currency;
}

function positiveDecimal(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new ValidationError(`${field} is invalid`, { [field]: ["invalid"] });
  return number;
}

function validKarat(value) {
  const karat = Number(value);
  if (!Number.isInteger(karat) || karat <= 0 || karat > 24) throw new ValidationError("karat is invalid", { karat: ["invalid"] });
  return karat;
}

function optionalDate(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${field} is invalid`, { [field]: ["invalid"] });
  return date;
}

function validateWindow(validFrom, validUntil, { required = false } = {}) {
  if (required && (!validFrom || !validUntil)) {
    throw new ValidationError("Approved Gold Center price requires a validity period", { validFrom: ["required"], validUntil: ["required"] });
  }
  if (validFrom && validUntil && validUntil <= validFrom) {
    throw new ValidationError("validUntil must be later than validFrom", { validUntil: ["invalid_window"] });
  }
}

function requireContext(context = {}) {
  if (!context.companyId) throw new AppError("Gold price company context is required", 422, "GOLD_PRICE_COMPANY_CONTEXT_REQUIRED");
  if (!context.user?.id) throw new ForbiddenError("Gold price command requires an authenticated user");
}

async function assertApprovePermission(context) {
  if (!(await permissionService.userHasPermission(context.user, GOLD_PRICE_APPROVAL_PERMISSION.name))) {
    throw new ForbiddenError(`${GOLD_PRICE_APPROVAL_PERMISSION.name} is required`);
  }
}

async function createPendingPrice({ context, input, transaction }) {
  if (!transaction) throw new ValidationError("Gold price creation requires a transaction", { transaction: ["required"] });
  requireContext(context);
  const validFrom = optionalDate(input?.validFrom, "validFrom");
  const validUntil = optionalDate(input?.validUntil, "validUntil");
  validateWindow(validFrom, validUntil);
  const source = String(input?.source || "manual").trim().toLowerCase();
  if (!PRICE_SOURCES.has(source)) throw new ValidationError("Gold price source is invalid", { source: ["invalid"] });
  return models.GoldPrice.create({
    companyId: context.companyId,
    karat: validKarat(input?.karat),
    pricePerGram: positiveDecimal(input?.pricePerGram, "pricePerGram"),
    currency: validCurrency(input?.currency),
    source,
    updatedBy: context.user.id,
    approvalStatus: APPROVAL_STATUS.PENDING,
    validFrom,
    validUntil,
    approvalVersion: 0,
  }, { transaction });
}

async function approvePrice({ context, priceId, transaction, now = new Date() }) {
  if (!transaction) throw new ValidationError("Gold price approval requires a transaction", { transaction: ["required"] });
  requireContext(context);
  await assertApprovePermission(context);
  const price = await models.GoldPrice.findOne({
    where: { id: priceId, companyId: context.companyId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!price) throw new NotFoundError("Gold Center price not found");
  if (price.approvalStatus === APPROVAL_STATUS.APPROVED) return { price, replayed: true };
  if (price.approvalStatus !== APPROVAL_STATUS.PENDING) {
    throw new ConflictError("Only a pending Gold Center price can be approved");
  }
  const validFrom = price.validFrom && new Date(price.validFrom);
  const validUntil = price.validUntil && new Date(price.validUntil);
  validateWindow(validFrom, validUntil, { required: true });
  if (validFrom > now || validUntil <= now) {
    throw new AppError("Gold Center price is not currently executable", 422, "GOLD_PRICE_NOT_EFFECTIVE");
  }

  const currentApproved = await models.GoldPrice.findAll({
    where: {
      companyId: context.companyId,
      karat: price.karat,
      currency: price.currency,
      approvalStatus: APPROVAL_STATUS.APPROVED,
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  for (const previous of currentApproved) {
    await previous.update({ approvalStatus: APPROVAL_STATUS.SUPERSEDED }, { transaction, goldPriceTransition: "supersede" });
  }
  try {
    await price.update({
      approvalStatus: APPROVAL_STATUS.APPROVED,
      approvedAt: now,
      approvedBy: context.user.id,
      approvalVersion: Number(price.approvalVersion || 0) + 1,
    }, { transaction, goldPriceTransition: "approve" });
  } catch (error) {
    if (error?.name === "SequelizeUniqueConstraintError") throw new ConflictError("A current approved Gold Center price already exists");
    throw error;
  }
  await auditService.record(context.companyId, {
    action: "gold_price.approved",
    description: `Gold Center price ${price.id} approved for ${price.karat}K ${price.currency}`,
    user: context.user.email || context.user.username || context.user.id,
    userId: context.user.id,
    place: context.branchId || "GoldCenter",
    sourceDocument: String(price.id),
    severity: "info",
    before: JSON.stringify({ approvalStatus: APPROVAL_STATUS.PENDING, approvalVersion: Number(price.approvalVersion || 0) - 1 }),
    after: JSON.stringify({ approvalStatus: APPROVAL_STATUS.APPROVED, approvalVersion: price.approvalVersion, approvedAt: price.approvedAt, validFrom: price.validFrom, validUntil: price.validUntil, source: price.source }),
  }, { transaction });
  return { price, replayed: false };
}

async function resolveExecutableApprovedKaratPrice({ companyId, currency, karat, transaction, now = new Date() }) {
  if (!transaction) throw new ValidationError("Gold price resolution requires a transaction", { transaction: ["required"] });
  if (!companyId) throw new AppError("Gold price company context is required", 422, "GOLD_PRICE_COMPANY_CONTEXT_REQUIRED");
  const price = await models.GoldPrice.findOne({
    where: {
      companyId,
      currency: validCurrency(currency),
      karat: validKarat(karat),
      approvalStatus: APPROVAL_STATUS.APPROVED,
      validFrom: { [Op.lte]: now },
      validUntil: { [Op.gt]: now },
    },
    order: [["approvedAt", "DESC"], ["id", "DESC"]],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!price) throw new AppError("Approved executable Gold Center karat price is required before CGP Posting", 422, "CGP_APPROVED_GOLD_PRICE_REQUIRED");
  return price;
}

module.exports = {
  APPROVAL_STATUS,
  GOLD_PRICE_APPROVAL_PERMISSION: GOLD_PRICE_APPROVAL_PERMISSION.name,
  createPendingPrice,
  approvePrice,
  resolveExecutableApprovedKaratPrice,
};
