"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const IMMUTABLE = new Set(["updatedAt"]);

function assertImmutable(instance) {
  if ((instance.changed() || []).some((field) => !IMMUTABLE.has(field))) {
    throw new Error("Executed financial settlements are immutable.");
  }
}

module.exports = sequelize.define("FinancialSettlement", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  customerId: { type: DataTypes.STRING, allowNull: false, field: "customer_id" },
  operationType: { type: DataTypes.STRING(64), allowNull: false, field: "operation_type" },
  sourceType: { type: DataTypes.STRING(96), allowNull: false, field: "source_type" },
  sourceDocumentId: { type: DataTypes.STRING, allowNull: false, field: "source_document_id" },
  currency: { type: DataTypes.STRING(3), allowNull: false },
  totalAmount: { type: DataTypes.DECIMAL(20, 4), allowNull: false, field: "total_amount" },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "EXECUTED" },
  approvalPolicyId: { type: DataTypes.STRING, allowNull: true, field: "approval_policy_id" },
  approvalPolicyVersion: { type: DataTypes.INTEGER, allowNull: true, field: "approval_policy_version" },
  approvalDecisionSnapshot: { type: DataTypes.JSONB, allowNull: false, field: "approval_decision_snapshot" },
  approvalRequestId: { type: DataTypes.STRING, allowNull: true, field: "approval_request_id" },
  journalEntryId: { type: DataTypes.STRING, allowNull: false, field: "journal_entry_id" },
  idempotencyKey: { type: DataTypes.STRING(191), allowNull: false, field: "idempotency_key" },
  requestHash: { type: DataTypes.STRING(64), allowNull: false, field: "request_hash" },
  correlationId: { type: DataTypes.STRING(128), allowNull: false, field: "correlation_id" },
  causationId: { type: DataTypes.STRING(128), allowNull: true, field: "causation_id" },
  executedAt: { type: DataTypes.DATE, allowNull: false, field: "executed_at" },
  executedBy: { type: DataTypes.STRING, allowNull: false, field: "executed_by" },
  metadata: { type: DataTypes.JSONB, allowNull: true },
}, {
  tableName: "financial_settlements",
  timestamps: true,
  underscored: true,
  hooks: { beforeUpdate: assertImmutable, beforeDestroy: assertImmutable, beforeBulkUpdate: assertImmutable, beforeBulkDestroy: assertImmutable },
});
