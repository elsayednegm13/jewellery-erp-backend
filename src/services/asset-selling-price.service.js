"use strict";

const Decimal = require("decimal.js");
const { QueryTypes } = require("sequelize");
const auditService = require("./audit.service");
const commandActorContext = require("./command-actor-context.service");
const { ValidationError, ConflictError } = require("../utils/errors");

const SELLING_PRICE_SCALE = 4;
const PRICE_EDIT_OPERATION = "inventory_v2.asset_selling_price_update";
const PRICE_CHANGE_ACTION = "inventory_v2.asset_selling_price_changed";
const IMMUTABLE_PRICE_STATUSES = new Set(["SOLD", "MELTED", "MISSING", "REVERSED", "REVERSAL_PENDING"]);

function normalizeSellingPrice(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new ValidationError("New selling price is required.", { newSellingPrice: ["required"] });
  }
  let price;
  try { price = new Decimal(String(value).trim()); } catch (_) { price = null; }
  if (!price || !price.isFinite() || !price.gt(0)) {
    throw new ValidationError("New selling price must be a positive decimal.", { newSellingPrice: ["positive_decimal_required"] });
  }
  if (price.decimalPlaces() > SELLING_PRICE_SCALE) {
    throw new ValidationError("New selling price has unsupported precision.", { newSellingPrice: ["precision_exceeded"] });
  }
  return price;
}

function normalizeReason(value) {
  const reason = value === undefined || value === null ? "" : String(value).trim();
  if (!reason) throw new ValidationError("A business reason is required for a selling-price change.", { reason: ["required"] });
  if (reason.length > 500) throw new ValidationError("The selling-price reason is too long.", { reason: ["too_long"] });
  return reason;
}

function assertExpectedVersion(asset, expectedUpdatedAt) {
  if (expectedUpdatedAt === undefined || expectedUpdatedAt === null || expectedUpdatedAt === "") return;
  if (new Date(expectedUpdatedAt).getTime() !== new Date(asset.updatedAt).getTime()) {
    throw new ConflictError("Asset price changed; refresh before retrying.");
  }
}

async function minimumSellingPrice({ models, assetId, companyId, transaction }) {
  const rows = await models.sequelize.query(
    "SELECT minimum_selling_price FROM asset_pricing_policies WHERE asset_id=:assetId AND company_id=:companyId FOR UPDATE",
    { replacements: { assetId, companyId }, transaction, type: QueryTypes.SELECT },
  );
  return rows[0]?.minimum_selling_price === null || rows[0]?.minimum_selling_price === undefined
    ? null
    : new Decimal(String(rows[0].minimum_selling_price));
}

async function updateSellingPrice({ models, asset, body = {}, req, transaction }) {
  if (!transaction) throw new Error("ASSET_SELLING_PRICE_TRANSACTION_REQUIRED");
  const newPrice = normalizeSellingPrice(body.newSellingPrice);
  const reason = normalizeReason(body.reason);
  assertExpectedVersion(asset, body.expectedUpdatedAt);

  const status = String(asset.operationalStatus || "").trim().toUpperCase();
  if (!status || IMMUTABLE_PRICE_STATUSES.has(status)) {
    throw new ValidationError("Selling price cannot be edited for the current Asset state.", { status: ["not_editable"] });
  }

  const minimum = await minimumSellingPrice({ models, assetId: asset.id, companyId: req.companyId, transaction });
  if (minimum && newPrice.lt(minimum)) {
    throw new ValidationError("Selling price cannot be below the approved minimum.", { newSellingPrice: ["below_minimum_selling_price"] });
  }

  const oldPrice = new Decimal(String(asset.price));
  const changed = !oldPrice.eq(newPrice);
  const before = { entityType: "ASSET", entityId: asset.id, oldPrice: oldPrice.toFixed(SELLING_PRICE_SCALE) };
  const after = { entityType: "ASSET", entityId: asset.id, newPrice: newPrice.toFixed(SELLING_PRICE_SCALE), reason, companyId: req.companyId, branchId: asset.branchId, changed };

  if (changed) {
    await asset.update({ price: newPrice.toFixed(SELLING_PRICE_SCALE), updatedBy: req.user?.id || null }, { transaction });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: PRICE_CHANGE_ACTION,
      description: `Selling price changed for Asset ${asset.id}`,
      sourceDocument: asset.id,
      branch: asset.branch,
      before: JSON.stringify(before),
      after: JSON.stringify(after),
    }, { requiredPermission: "inventory.adjust", requestedOperation: PRICE_EDIT_OPERATION, authorizationResult: "allowed", reason }), { transaction });
  }

  return {
    changed,
    asset: asset.toJSON(),
    oldPrice: oldPrice.toFixed(SELLING_PRICE_SCALE),
    newPrice: newPrice.toFixed(SELLING_PRICE_SCALE),
    minimumSellingPrice: minimum ? minimum.toFixed(SELLING_PRICE_SCALE) : null,
    reason,
    auditAction: changed ? PRICE_CHANGE_ACTION : null,
  };
}

module.exports = {
  SELLING_PRICE_SCALE,
  PRICE_EDIT_OPERATION,
  PRICE_CHANGE_ACTION,
  IMMUTABLE_PRICE_STATUSES,
  normalizeSellingPrice,
  normalizeReason,
  minimumSellingPrice,
  updateSellingPrice,
};
