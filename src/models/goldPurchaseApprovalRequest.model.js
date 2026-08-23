const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

module.exports = sequelize.define("GoldPurchaseApprovalRequest", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  aggregateType: { type: DataTypes.ENUM("cgp", "igp"), allowNull: false, field: "aggregate_type" },
  documentId: { type: DataTypes.STRING, allowNull: false, field: "document_id" },
  documentVersion: { type: DataTypes.INTEGER, allowNull: false, field: "document_version" },
  approvalStatus: { type: DataTypes.ENUM("pending", "approved", "rejected", "superseded"), allowNull: false, defaultValue: "pending", field: "approval_status" },
  submittedSnapshot: { type: DataTypes.JSONB, allowNull: false, field: "submitted_snapshot" },
  submittedSnapshotHash: { type: DataTypes.STRING(64), allowNull: false, field: "submitted_snapshot_hash" },
  requestedBy: { type: DataTypes.STRING, allowNull: false, field: "requested_by" },
  requestedAt: { type: DataTypes.DATE, allowNull: false, field: "requested_at" },
  reviewedBy: { type: DataTypes.STRING, field: "reviewed_by" },
  reviewedAt: { type: DataTypes.DATE, field: "reviewed_at" },
  reviewReason: { type: DataTypes.TEXT, field: "review_reason" },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }
}, { tableName: "gold_purchase_approval_requests", timestamps: true, underscored: true });
