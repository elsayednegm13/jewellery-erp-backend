const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ReservationRefund = sequelize.define("ReservationRefund", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  reservationId: { type: DataTypes.STRING, allowNull: false, field: "reservation_id" },
  customerId: { type: DataTypes.STRING, allowNull: false, field: "customer_id" },
  branchId: { type: DataTypes.STRING, allowNull: true, field: "branch_id" },
  amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
  currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "AED" },
  status: { type: DataTypes.ENUM("requested", "approved", "rejected", "executed"), allowNull: false, defaultValue: "requested" },
  refundType: { type: DataTypes.ENUM("reservation_full", "renewal_excess"), allowNull: false, defaultValue: "reservation_full", field: "refund_type" },
  renewalId: { type: DataTypes.STRING, allowNull: true, field: "renewal_id" },
  requestedRefundMethod: { type: DataTypes.STRING, allowNull: false, field: "requested_refund_method" },
  treasuryAccountCode: { type: DataTypes.STRING, allowNull: true, field: "treasury_account_code" },
  originalPaymentMethodsSummary: { type: DataTypes.JSONB, allowNull: true, field: "original_payment_methods_summary" },
  methodDiffersFromOriginal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "method_differs_from_original" },
  methodOverrideApproved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "method_override_approved" },
  reason: { type: DataTypes.TEXT, allowNull: false },
  requestedBy: { type: DataTypes.STRING, allowNull: true, field: "requested_by" },
  requestedAt: { type: DataTypes.DATE, allowNull: false, field: "requested_at" },
  approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
  approvedAt: { type: DataTypes.DATE, allowNull: true, field: "approved_at" },
  rejectedBy: { type: DataTypes.STRING, allowNull: true, field: "rejected_by" },
  rejectedAt: { type: DataTypes.DATE, allowNull: true, field: "rejected_at" },
  rejectionReason: { type: DataTypes.TEXT, allowNull: true, field: "rejection_reason" },
  executedBy: { type: DataTypes.STRING, allowNull: true, field: "executed_by" },
  executedAt: { type: DataTypes.DATE, allowNull: true, field: "executed_at" },
  journalEntryId: { type: DataTypes.STRING, allowNull: true, field: "journal_entry_id" },
  cashTransactionId: { type: DataTypes.STRING, allowNull: true, field: "cash_transaction_id" },
  idempotencyKey: { type: DataTypes.STRING, allowNull: true, field: "idempotency_key" },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, {
  tableName: "reservation_refunds",
  timestamps: true,
  underscored: true
});

module.exports = ReservationRefund;
