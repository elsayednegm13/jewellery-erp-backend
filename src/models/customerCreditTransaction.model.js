const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Customer Credit Ledger (Phase 23-Fix) — infrastructure only.
 *
 * One row per customer credit movement. `direction` is credit_in (raises the
 * customer's available credit) or credit_out (consumes it). Available credit is
 * SUM(active credit_in) − SUM(active credit_out), computed by
 * customer-credit.service — this table NEVER mutates Customer.balance (AR-only)
 * or Invoice.remainingAmount. `journalEntryId` bridges to GL 2300 "Customer
 * Deposits" but the posting integration is DEFERRED, so it stays nullable. No
 * current flow writes to this table yet.
 */
const CustomerCreditTransaction = sequelize.define("CustomerCreditTransaction", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  branchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "branch_id"
  },
  customerId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_id"
  },
  // opening_balance | return_credit | exchange_credit | overpayment |
  // credit_application | credit_refund | manual_deposit |
  // manual_adjustment | migration_seed
  sourceType: {
    type: DataTypes.STRING(40),
    allowNull: false,
    field: "source_type",
    validate: {
      isIn: [[
        "opening_balance", "return_credit", "exchange_credit", "overpayment",
        "credit_application", "credit_refund", "manual_deposit", "manual_adjustment", "migration_seed"
      ]]
    }
  },
  sourceId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "source_id"
  },
  direction: {
    type: DataTypes.STRING(16),
    allowNull: false,
    validate: { isIn: [["credit_in", "credit_out"]] }
  },
  amount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    validate: { min: 0.0001 }
  },
  currency: {
    type: DataTypes.STRING(8),
    allowNull: false,
    defaultValue: "AED"
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // active | reversed | void
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: "active",
    validate: { isIn: [["active", "reversed", "void"]] }
  },
  journalEntryId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "journal_entry_id"
  },
  cashTransactionId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "cash_transaction_id"
  },
  invoiceId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "invoice_id"
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "created_by"
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
  }
}, {
  tableName: "customer_credit_transactions",
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ["company_id", "customer_id", "created_at"], name: "cct_company_customer_created_idx" },
    { fields: ["company_id", "source_type", "source_id"], name: "cct_company_source_idx" },
    { fields: ["journal_entry_id"], name: "cct_journal_entry_idx" },
    { fields: ["cash_transaction_id"], name: "cct_cash_transaction_idx" },
    { fields: ["invoice_id"], name: "cct_invoice_idx" }
  ]
});

module.exports = CustomerCreditTransaction;
