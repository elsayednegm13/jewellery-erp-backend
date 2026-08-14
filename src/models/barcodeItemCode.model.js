const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const BarcodeItemCode = sequelize.define("BarcodeItemCode", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  code: { type: DataTypes.STRING(6), allowNull: false },
  displayName: { type: DataTypes.STRING, allowNull: false, field: "display_name" },
  description: { type: DataTypes.TEXT },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
  isClientApproved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_client_approved" },
  isProvisional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_provisional" },
  allowedInventoryCodes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "allowed_inventory_codes" },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
  createdBy: { type: DataTypes.STRING, field: "created_by" },
  updatedBy: { type: DataTypes.STRING, field: "updated_by" },
}, {
  tableName: "barcode_item_codes",
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ["company_id", "code"] }],
});

module.exports = BarcodeItemCode;
