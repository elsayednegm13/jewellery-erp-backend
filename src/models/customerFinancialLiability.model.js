"use strict";

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { AppError } = require("../utils/errors");

// Recognition facts are immutable.  A later settlement capability may adjust
// only the sub-ledger balance and lifecycle state; it must never rewrite the
// CGP posting source, original amount, or journal provenance.
const MUTABLE_FIELDS = new Set(["outstandingAmount", "settledAmount", "status", "updatedAt"]);

function immutableLiabilityError() {
  throw new AppError("Customer financial liability recognition facts are immutable", 409, "CUSTOMER_FINANCIAL_LIABILITY_IMMUTABLE");
}

function assertOnlySettlementFields(instance) {
  const changed = instance.changed() || [];
  if (changed.some((field) => !MUTABLE_FIELDS.has(field))) immutableLiabilityError();
}

module.exports = sequelize.define("CustomerFinancialLiability", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  customerId: { type: DataTypes.STRING, allowNull: false, field: "customer_id" },
  sourceType: { type: DataTypes.STRING(96), allowNull: false, field: "source_type" },
  sourceDocumentId: { type: DataTypes.STRING, allowNull: false, field: "source_document_id" },
  sourceEventId: { type: DataTypes.STRING(128), allowNull: false, field: "source_event_id" },
  journalEntryId: { type: DataTypes.STRING, allowNull: false, field: "journal_entry_id" },
  currency: { type: DataTypes.STRING(3), allowNull: false },
  originalAmount: { type: DataTypes.DECIMAL(20, 4), allowNull: false, field: "original_amount" },
  outstandingAmount: { type: DataTypes.DECIMAL(20, 4), allowNull: false, field: "outstanding_amount" },
  settledAmount: { type: DataTypes.DECIMAL(20, 4), allowNull: false, defaultValue: "0.0000", field: "settled_amount" },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "OPEN" },
  recognizedAt: { type: DataTypes.DATE, allowNull: false, field: "recognized_at" },
  correlationId: { type: DataTypes.STRING(128), allowNull: false, field: "correlation_id" },
  causationId: { type: DataTypes.STRING(128), allowNull: true, field: "causation_id" },
}, {
  tableName: "customer_financial_liabilities",
  timestamps: true,
  underscored: true,
  hooks: {
    beforeUpdate: assertOnlySettlementFields,
    beforeBulkUpdate: immutableLiabilityError,
    beforeDestroy: immutableLiabilityError,
    beforeBulkDestroy: immutableLiabilityError,
  },
});
