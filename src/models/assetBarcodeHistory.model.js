"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AssetBarcodeHistory = sequelize.define("AssetBarcodeHistory", {
  id: { type: DataTypes.STRING, primaryKey: true },
  assetId: { type: DataTypes.STRING, allowNull: false, field: "asset_id" },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  barcode: { type: DataTypes.STRING, allowNull: false },
  barcodeRevision: { type: DataTypes.INTEGER, allowNull: false, field: "barcode_revision" },
  state: { type: DataTypes.STRING(16), allowNull: false },
  action: { type: DataTypes.STRING(16), allowNull: false },
  issuedAt: { type: DataTypes.DATE, allowNull: false, field: "issued_at" },
  issuedBy: { type: DataTypes.STRING, allowNull: true, field: "issued_by" },
  retiredAt: { type: DataTypes.DATE, allowNull: true, field: "retired_at" },
  retiredBy: { type: DataTypes.STRING, allowNull: true, field: "retired_by" },
  retirementReason: { type: DataTypes.TEXT, allowNull: true, field: "retirement_reason" },
  sourceType: { type: DataTypes.STRING(48), allowNull: true, field: "source_type" },
  sourceId: { type: DataTypes.STRING, allowNull: true, field: "source_id" },
}, {
  tableName: "asset_barcode_history",
  timestamps: true,
  underscored: true,
});

module.exports = AssetBarcodeHistory;
