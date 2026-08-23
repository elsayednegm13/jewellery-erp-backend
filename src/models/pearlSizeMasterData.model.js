"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Canonical server-owned selectable Pearl Size values.  `value` is the
// normalized numeric identity; `displayValue` preserves the approved master
// data representation without making free text an inventory authority.
const PearlSizeMasterData = sequelize.define("PearlSizeMasterData", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  value: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
  displayValue: { type: DataTypes.STRING(32), allowNull: false, field: "display_value" },
  unit: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "MM" },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
  isOwnerApprovedInitial: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_owner_approved_initial" },
  createdBy: { type: DataTypes.STRING, field: "created_by" },
  updatedBy: { type: DataTypes.STRING, field: "updated_by" },
}, {
  tableName: "pearl_size_master_data",
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ["company_id", "value", "unit"], name: "pearl_size_master_data_company_value_unit_uq" },
    { fields: ["company_id", "is_active", "sort_order"], name: "pearl_size_master_data_company_active_sort_idx" },
  ],
});

module.exports = PearlSizeMasterData;
