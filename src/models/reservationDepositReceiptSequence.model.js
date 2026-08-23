const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// One locked counter per company, operational branch and calendar year.  It is
// deliberately not exposed to clients and has no reset operation.
const ReservationDepositReceiptSequence = sequelize.define("ReservationDepositReceiptSequence", {
  companyId: { type: DataTypes.STRING, primaryKey: true, field: "company_id" },
  branchId: { type: DataTypes.STRING, primaryKey: true, field: "branch_id" },
  sequenceYear: { type: DataTypes.INTEGER, primaryKey: true, field: "sequence_year" },
  nextValue: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1, field: "next_value" }
}, {
  tableName: "reservation_deposit_receipt_sequences",
  timestamps: true,
  underscored: true,
  updatedAt: "updatedAt",
  createdAt: "createdAt"
});

module.exports = ReservationDepositReceiptSequence;
