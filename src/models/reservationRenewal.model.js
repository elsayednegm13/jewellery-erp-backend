const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Phase 32.6-Fix C — durable renewal record linking an automatically expired
// source reservation to a new successor reservation. Records the server-derived
// transferable balance, successor total, transfer amount, and any excess refund.
const ReservationRenewal = sequelize.define("ReservationRenewal", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  sourceReservationId: { type: DataTypes.STRING, allowNull: false, field: "source_reservation_id" },
  successorReservationId: { type: DataTypes.STRING, allowNull: true, field: "successor_reservation_id" },
  customerId: { type: DataTypes.STRING, allowNull: false, field: "customer_id" },
  branchId: { type: DataTypes.STRING, allowNull: true, field: "branch_id" },
  currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "AED" },
  sourceTransferableBalance: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "source_transferable_balance" },
  successorTotal: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "successor_total" },
  transferAmount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0, field: "transfer_amount" },
  excessRefundAmount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0, field: "excess_refund_amount" },
  excessRefundId: { type: DataTypes.STRING, allowNull: true, field: "excess_refund_id" },
  status: {
    type: DataTypes.ENUM("requested", "pending_excess_refund", "ready_to_activate", "activated", "rejected", "cancelled"),
    allowNull: false,
    defaultValue: "requested"
  },
  currentPriceEvidence: { type: DataTypes.JSONB, allowNull: true, field: "current_price_evidence" },
  reason: { type: DataTypes.TEXT, allowNull: true },
  requestedBy: { type: DataTypes.STRING, allowNull: true, field: "requested_by" },
  requestedAt: { type: DataTypes.DATE, allowNull: false, field: "requested_at" },
  activatedBy: { type: DataTypes.STRING, allowNull: true, field: "activated_by" },
  activatedAt: { type: DataTypes.DATE, allowNull: true, field: "activated_at" },
  idempotencyKey: { type: DataTypes.STRING, allowNull: true, field: "idempotency_key" },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, {
  tableName: "reservation_renewals",
  timestamps: true,
  underscored: true
});

module.exports = ReservationRenewal;
