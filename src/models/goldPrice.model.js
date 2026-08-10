const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { AppError } = require("../utils/errors");

const GoldPrice = sequelize.define("GoldPrice", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  karat: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  pricePerGram: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "price_per_gram"
  },
  currency: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "AED"
  },
  updatedBy: {
    type: DataTypes.STRING,
    field: "updated_by",
    defaultValue: "System"
  },
  // Tenant scope (P2.3). NULL = legacy/global fallback row.
  companyId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "company_id"
  },
  // manual | live | import (only "manual" is written today).
  source: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "manual"
  },
  // Raw/live/manual input is never executable economic truth by itself.
  approvalStatus: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: "PENDING",
    field: "approval_status"
  },
  approvedAt: { type: DataTypes.DATE, allowNull: true, field: "approved_at" },
  approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
  validFrom: { type: DataTypes.DATE, allowNull: true, field: "valid_from" },
  validUntil: { type: DataTypes.DATE, allowNull: true, field: "valid_until" },
  approvalVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "approval_version" },
}, {
  tableName: "gold_prices",
  timestamps: true,
  underscored: true,
  hooks: {
    beforeUpdate: (instance, options) => {
      const previousStatus = instance.previous("approvalStatus");
      const changed = instance.changed() || [];
      if (options.goldPriceTransition === "approve" && previousStatus === "PENDING" && instance.approvalStatus === "APPROVED") {
        const permitted = new Set(["approvalStatus", "approvedAt", "approvedBy", "approvalVersion", "updatedAt"]);
        if (changed.every((field) => permitted.has(field))) return;
      }
      if (options.goldPriceTransition === "supersede" && previousStatus === "APPROVED" && instance.approvalStatus === "SUPERSEDED") {
        const permitted = new Set(["approvalStatus", "updatedAt"]);
        if (changed.every((field) => permitted.has(field))) return;
      }
      throw new AppError("Gold Center price records are append-only; use the approved transition", 409, "GOLD_PRICE_IMMUTABLE");
    },
    beforeDestroy: () => { throw new AppError("Gold Center price records cannot be deleted", 409, "GOLD_PRICE_IMMUTABLE"); },
    beforeBulkUpdate: () => { throw new AppError("Gold Center price records cannot be bulk-updated", 409, "GOLD_PRICE_IMMUTABLE"); },
    beforeBulkDestroy: () => { throw new AppError("Gold Center price records cannot be deleted", 409, "GOLD_PRICE_IMMUTABLE"); },
  }
});

module.exports = GoldPrice;
