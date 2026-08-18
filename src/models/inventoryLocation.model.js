const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const InventoryLocation = sequelize.define("InventoryLocation", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  code: { type: DataTypes.STRING(32), allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  locationType: { type: DataTypes.STRING(24), allowNull: false, field: "location_type", defaultValue: "GENERAL" },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, field: "is_active", defaultValue: true },
}, {
  tableName: "inventory_locations",
  timestamps: true,
  underscored: true,
});

module.exports = InventoryLocation;
