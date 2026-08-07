const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

module.exports = sequelize.define("AssetReturnReview", {
  id: { type: DataTypes.STRING, primaryKey: true },
  assetId: { type: DataTypes.STRING, allowNull: false, field: "asset_id" },
  returnInvoiceId: { type: DataTypes.STRING, allowNull: false, field: "return_invoice_id" },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  conditionOutcome: { type: DataTypes.STRING(32), allowNull: false, field: "condition_outcome" },
  note: { type: DataTypes.TEXT, allowNull: true },
  reviewedBy: { type: DataTypes.STRING, allowNull: false, field: "reviewed_by" },
  reviewedAt: { type: DataTypes.DATE, allowNull: false, field: "reviewed_at" },
  approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
  approvedAt: { type: DataTypes.DATE, allowNull: true, field: "approved_at" },
}, { tableName: "asset_return_reviews", timestamps: true, underscored: true });
