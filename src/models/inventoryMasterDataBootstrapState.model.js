"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const InventoryMasterDataBootstrapState = sequelize.define("InventoryMasterDataBootstrapState", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  datasetId: { type: DataTypes.STRING(96), allowNull: false, field: "dataset_id" },
  currentVersion: { type: DataTypes.INTEGER, allowNull: false, field: "current_version" },
  manifestHash: { type: DataTypes.STRING(128), allowNull: false, field: "manifest_hash" },
  state: { type: DataTypes.STRING(24), allowNull: false },
  lastReport: { type: DataTypes.JSONB, allowNull: true, field: "last_report" },
  lastErrorCode: { type: DataTypes.STRING(120), allowNull: true, field: "last_error_code" },
  startedAt: { type: DataTypes.DATE, allowNull: true, field: "started_at" },
  completedAt: { type: DataTypes.DATE, allowNull: true, field: "completed_at" },
}, {
  tableName: "inventory_master_data_bootstrap_states",
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ["company_id", "dataset_id"], name: "inventory_master_data_bootstrap_scope_uq" }],
});

module.exports = InventoryMasterDataBootstrapState;
