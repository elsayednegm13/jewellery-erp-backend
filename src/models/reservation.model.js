const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Reservation = sequelize.define("Reservation", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  assetId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "asset_id"
  },
  assetName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "asset_name"
  },
  customerId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_id"
  },
  customerName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_name"
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  branchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "branch_id"
  },
  currency: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "AED"
  },
  deposit: {
    type: DataTypes.DECIMAL(20, 8),
    allowNull: false,
    defaultValue: 0
  },
  agreedTotal: {
    type: DataTypes.DECIMAL(20, 8),
    allowNull: false,
    defaultValue: 0,
    field: "agreed_total"
  },
  paidTotal: {
    type: DataTypes.DECIMAL(20, 8),
    allowNull: false,
    defaultValue: 0,
    field: "paid_total"
  },
  remainingTotal: {
    type: DataTypes.DECIMAL(20, 8),
    allowNull: false,
    defaultValue: 0,
    field: "remaining_total"
  },
  excessTotal: {
    type: DataTypes.DECIMAL(20, 8),
    allowNull: false,
    defaultValue: 0,
    field: "excess_total"
  },
  expiresAt: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "expires_at"
  },
  fullyPaidAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "fully_paid_at"
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "completed_at"
  },
  completedBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "completed_by"
  },
  cancelledAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "cancelled_at"
  },
  cancelledBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "cancelled_by"
  },
  cancellationReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: "cancellation_reason"
  },
  refundedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "refunded_at"
  },
  refundStatus: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "refund_status"
  },
  expiryProcessedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "expiry_processed_at"
  },
  expiredAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "expired_at"
  },
  expiredBySystem: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: "expired_by_system"
  },
  expiryCancellationReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: "expiry_cancellation_reason"
  },
  lastExtendedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "last_extended_at"
  },
  lastExtendedBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "last_extended_by"
  },
  extensionCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: "extension_count"
  },
  predecessorReservationId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "predecessor_reservation_id"
  },
  successorReservationId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "successor_reservation_id"
  },
  renewedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "renewed_at"
  },
  renewedBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "renewed_by"
  },
  renewalStatus: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "renewal_status"
  },
  finalInvoiceId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "final_invoice_id"
  },
  workflowVersion: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    field: "workflow_version"
  },
  isLegacy: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: "is_legacy"
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "created_by"
  },
  updatedBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "updated_by"
  },
  status: {
    type: DataTypes.ENUM("active", "partially_paid", "fully_paid", "expired", "completed", "cancelled", "cancelled_refund_pending", "refunded", "pending_renewal_settlement", "renewed"),
    defaultValue: "active"
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  tableName: "reservations",
  timestamps: true,
  underscored: true
});

module.exports = Reservation;
