const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ReservationPayment = sequelize.define("ReservationPayment", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  reservationId: { type: DataTypes.STRING, allowNull: false, field: "reservation_id" },
  customerId: { type: DataTypes.STRING, allowNull: false, field: "customer_id" },
  branchId: { type: DataTypes.STRING, allowNull: true, field: "branch_id" },
  amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
  currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "AED" },
  paymentMethod: { type: DataTypes.STRING, allowNull: false, defaultValue: "cash", field: "payment_method" },
  treasuryAccountCode: { type: DataTypes.STRING, allowNull: false, field: "treasury_account_code" },
  advancesAccountId: { type: DataTypes.STRING, allowNull: false, field: "advances_account_id" },
  advancesAccountCode: { type: DataTypes.STRING, allowNull: false, field: "advances_account_code" },
  receiptNumber: { type: DataTypes.STRING, allowNull: false, field: "receipt_number" },
  journalEntryId: { type: DataTypes.STRING, allowNull: true, field: "journal_entry_id" },
  status: { type: DataTypes.ENUM("posted", "reversed", "refunded", "transferred"), allowNull: false, defaultValue: "posted" },
  idempotencyKey: { type: DataTypes.STRING, allowNull: true, field: "idempotency_key" },
  receivedBy: { type: DataTypes.STRING, allowNull: true, field: "received_by" },
  receivedEmployeeId: { type: DataTypes.STRING, allowNull: true, field: "received_employee_id" },
  receivedAt: { type: DataTypes.DATE, allowNull: false, field: "received_at" },
  sourceReference: { type: DataTypes.STRING, allowNull: true, field: "source_reference" },
  reversalOf: { type: DataTypes.STRING, allowNull: true, field: "reversal_of" },
  refundOf: { type: DataTypes.STRING, allowNull: true, field: "refund_of" },
  // Fix C: for successor payments created from a renewal advance transfer, the
  // source transfer ledger id. No new cash/advance journal is posted for these.
  sourceTransferId: { type: DataTypes.STRING, allowNull: true, field: "source_transfer_id" },
  origin: { type: DataTypes.STRING, allowNull: true }
}, {
  tableName: "reservation_payments",
  timestamps: true,
  underscored: true
});

module.exports = ReservationPayment;
