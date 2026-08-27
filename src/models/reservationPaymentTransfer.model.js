const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Phase 32.6-Fix C — immutable subledger of reservation advance payment value
// transferred from an expired source reservation to its renewal successor.
// The customer's Reservation Advances liability, customer, branch, company, and
// currency are unchanged by a transfer, so no cash/bank/revenue/VAT/AR/COGS/
// inventory movement occurs. This ledger is the reconciliation source of truth.
const ReservationPaymentTransfer = sequelize.define("ReservationPaymentTransfer", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  renewalId: { type: DataTypes.STRING, allowNull: false, field: "renewal_id" },
  sourceReservationId: { type: DataTypes.STRING, allowNull: false, field: "source_reservation_id" },
  targetReservationId: { type: DataTypes.STRING, allowNull: false, field: "target_reservation_id" },
  sourcePaymentId: { type: DataTypes.STRING, allowNull: false, field: "source_payment_id" },
  targetPaymentId: { type: DataTypes.STRING, allowNull: true, field: "target_payment_id" },
  customerId: { type: DataTypes.STRING, allowNull: false, field: "customer_id" },
  branchId: { type: DataTypes.STRING, allowNull: true, field: "branch_id" },
  currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "AED" },
  amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
  advancesAccountCode: { type: DataTypes.STRING, allowNull: true, field: "advances_account_code" },
  journalEntryId: { type: DataTypes.STRING, allowNull: true, field: "journal_entry_id" },
  status: { type: DataTypes.ENUM("posted", "reversed"), allowNull: false, defaultValue: "posted" },
  transferredBy: { type: DataTypes.STRING, allowNull: true, field: "transferred_by" },
  transferredAt: { type: DataTypes.DATE, allowNull: false, field: "transferred_at" },
  idempotencyKey: { type: DataTypes.STRING, allowNull: true, field: "idempotency_key" }
}, {
  tableName: "reservation_payment_transfers",
  timestamps: true,
  underscored: true
});

module.exports = ReservationPaymentTransfer;
