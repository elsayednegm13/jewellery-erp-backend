const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AssetRevision = sequelize.define("AssetRevision", {
  id: { type: DataTypes.STRING, primaryKey: true },
  assetId: { type: DataTypes.STRING, allowNull: false, field: "asset_id" },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: true, field: "branch_id" },
  revisionNo: { type: DataTypes.INTEGER, allowNull: false, field: "revision_no" },
  reason: { type: DataTypes.TEXT, allowNull: false },
  sourceOperation: { type: DataTypes.STRING(120), allowNull: false, field: "source_operation" },
  sourceReference: { type: DataTypes.STRING(255), allowNull: true, field: "source_reference" },
  technicalUserId: { type: DataTypes.STRING, allowNull: true, field: "technical_user_id" },
  employeeId: { type: DataTypes.STRING, allowNull: true, field: "employee_id" },
  operatorSessionId: { type: DataTypes.STRING, allowNull: true, field: "operator_session_id" },
  occurredAt: { type: DataTypes.DATE, allowNull: false, field: "occurred_at" },
  idempotencyScope: { type: DataTypes.STRING(100), allowNull: false, field: "idempotency_scope" },
  idempotencyKey: { type: DataTypes.STRING(191), allowNull: false, field: "idempotency_key" },
  requestHash: { type: DataTypes.STRING(128), allowNull: false, field: "request_hash" },
}, {
  tableName: "asset_revisions",
  timestamps: true,
  underscored: true,
});

module.exports = AssetRevision;
