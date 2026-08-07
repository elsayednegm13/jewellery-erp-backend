const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const StockAuditItem = sequelize.define("StockAuditItem", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  stockAuditId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "stock_audit_id"
  },
  assetId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "asset_id"
  },
  expectedBranchId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "expected_branch_id"
  },
  scannedBranchId: {
    type: DataTypes.STRING,
    field: "scanned_branch_id"
  },
  status: {
    type: DataTypes.ENUM("matched", "missing", "unexpected"),
    allowNull: false
  },
  result: { type: DataTypes.STRING },
  observedAt: { type: DataTypes.DATE, field: "observed_at" },
  scanMethod: { type: DataTypes.STRING, field: "scan_method" }
}, {
  tableName: "stock_audit_items",
  timestamps: true,
  underscored: true
});

module.exports = StockAuditItem;
