"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

function immutablePolicyError(_instance, options = {}) {
  if (options.pricingPolicyTransition) return;
  const error = new Error("Gold pricing policies are versioned; use the pricing policy service");
  error.code = "GOLD_PRICING_POLICY_IMMUTABLE";
  error.statusCode = 409;
  throw error;
}

const GoldPricingPolicy = sequelize.define("GoldPricingPolicy", {
  id: { type: DataTypes.STRING(128), primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  businessContext: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "CGP", field: "business_context" },
  pricingMode: { type: DataTypes.STRING(24), allowNull: false, field: "pricing_mode" },
  scopeType: { type: DataTypes.STRING(16), allowNull: false, field: "scope_type" },
  karat: { type: DataTypes.DECIMAL(8, 3), allowNull: true },
  baseQuoteType: { type: DataTypes.STRING(8), allowNull: false, field: "base_quote_type" },
  adjustmentType: { type: DataTypes.STRING(24), allowNull: false, field: "adjustment_type" },
  adjustmentValue: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: "0", field: "adjustment_value" },
  version: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "INACTIVE" },
  effectiveFrom: { type: DataTypes.DATE, allowNull: false, field: "effective_from" },
  effectiveUntil: { type: DataTypes.DATE, allowNull: true, field: "effective_until" },
  createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
  supersedesPolicyId: { type: DataTypes.STRING(128), allowNull: true, field: "supersedes_policy_id" },
}, {
  tableName: "gold_pricing_policies",
  timestamps: true,
  underscored: true,
  hooks: {
    beforeUpdate: immutablePolicyError,
    beforeDestroy: immutablePolicyError,
    beforeBulkUpdate: immutablePolicyError,
    beforeBulkDestroy: immutablePolicyError,
  },
});

module.exports = GoldPricingPolicy;
