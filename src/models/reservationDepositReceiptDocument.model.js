const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Immutable historical evidence for one committed reservation deposit payment.
// The JSON snapshot intentionally prevents later master-data edits from changing
// an issued customer document.
const ReservationDepositReceiptDocument = sequelize.define("ReservationDepositReceiptDocument", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  reservationId: { type: DataTypes.STRING, allowNull: false, field: "reservation_id" },
  reservationPaymentId: { type: DataTypes.STRING, allowNull: false, field: "reservation_payment_id" },
  customerId: { type: DataTypes.STRING, allowNull: true, field: "customer_id" },
  employeeId: { type: DataTypes.STRING, allowNull: true, field: "employee_id" },
  receiptNumber: { type: DataTypes.STRING, allowNull: false, field: "receipt_number" },
  sequenceYear: { type: DataTypes.INTEGER, allowNull: false, field: "sequence_year" },
  sequenceValue: { type: DataTypes.BIGINT, allowNull: false, field: "sequence_value" },
  postedAt: { type: DataTypes.DATE, allowNull: false, field: "posted_at" },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: "issued" },
  snapshotVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "snapshot_version" },
  snapshot: { type: DataTypes.JSONB, allowNull: false },
  createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" }
}, { tableName: "reservation_deposit_receipt_documents", timestamps: true, underscored: true, updatedAt: false });

module.exports = ReservationDepositReceiptDocument;
