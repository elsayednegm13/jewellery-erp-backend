"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const MUTABLE_DEACTIVATION_FIELDS = new Set(["isActive", "deactivatedAt", "deactivatedBy", "updatedAt"]);

function immutablePolicyError() {
  throw new Error("Financial approval policies are versioned configuration and cannot be edited or deleted in place.");
}

module.exports = sequelize.define("FinancialApprovalPolicy", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  operationType: { type: DataTypes.STRING(64), allowNull: false, field: "operation_type" },
  branchId: { type: DataTypes.STRING, allowNull: true, field: "branch_id" },
  currency: { type: DataTypes.STRING(3), allowNull: true },
  paymentMethod: { type: DataTypes.STRING(32), allowNull: true, field: "payment_method" },
  minAmount: { type: DataTypes.DECIMAL(20, 4), allowNull: true, field: "min_amount" },
  maxAmount: { type: DataTypes.DECIMAL(20, 4), allowNull: true, field: "max_amount" },
  approvalRequired: { type: DataTypes.BOOLEAN, allowNull: false, field: "approval_required" },
  priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
  effectiveFrom: { type: DataTypes.DATE, allowNull: true, field: "effective_from" },
  effectiveTo: { type: DataTypes.DATE, allowNull: true, field: "effective_to" },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  deactivatedAt: { type: DataTypes.DATE, allowNull: true, field: "deactivated_at" },
  deactivatedBy: { type: DataTypes.STRING, allowNull: true, field: "deactivated_by" },
  description: { type: DataTypes.TEXT, allowNull: true },
  metadata: { type: DataTypes.JSONB, allowNull: true },
}, {
  tableName: "financial_approval_policies",
  timestamps: true,
  underscored: true,
  hooks: {
    beforeUpdate: (instance, options) => {
      const changed = instance.changed() || [];
      if (options?.financialApprovalPolicyDeactivation !== true || changed.some((field) => !MUTABLE_DEACTIVATION_FIELDS.has(field))) immutablePolicyError();
      if (instance.previous("isActive") !== true || instance.isActive !== false) immutablePolicyError();
    },
    beforeDestroy: immutablePolicyError,
    beforeBulkUpdate: immutablePolicyError,
    beforeBulkDestroy: immutablePolicyError,
  },
});
