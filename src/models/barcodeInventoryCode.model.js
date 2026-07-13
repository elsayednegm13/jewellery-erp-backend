const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const BarcodeInventoryCode = sequelize.define("BarcodeInventoryCode", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  code: { type: DataTypes.STRING(6), allowNull: false },
  displayName: { type: DataTypes.STRING, allowNull: false, field: "display_name" },
  assetType: { type: DataTypes.STRING(40), allowNull: false, field: "asset_type" },
  description: { type: DataTypes.TEXT },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
  isClientApproved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_client_approved" },
  isProvisional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_provisional" },
  requiresKarat: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "requires_karat" },
  defaultKaratCode: { type: DataTypes.STRING(2), field: "default_karat_code" },
  defaultItemCode: { type: DataTypes.STRING(6), field: "default_item_code" },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
  createdBy: { type: DataTypes.STRING, field: "created_by" },
  updatedBy: { type: DataTypes.STRING, field: "updated_by" },
}, {
  tableName: "barcode_inventory_codes",
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ["company_id", "code"] }],
});

module.exports = BarcodeInventoryCode;
