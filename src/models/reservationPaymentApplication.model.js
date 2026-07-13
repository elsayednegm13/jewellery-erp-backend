const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ReservationPaymentApplication = sequelize.define("ReservationPaymentApplication", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  reservationId: { type: DataTypes.STRING, allowNull: false, field: "reservation_id" },
  reservationPaymentId: { type: DataTypes.STRING, allowNull: false, field: "reservation_payment_id" },
  finalInvoiceId: { type: DataTypes.STRING, allowNull: false, field: "final_invoice_id" },
  appliedAmount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "applied_amount" },
  appliedAt: { type: DataTypes.DATE, allowNull: false, field: "applied_at" },
  appliedBy: { type: DataTypes.STRING, allowNull: true, field: "applied_by" },
  sourceReference: { type: DataTypes.STRING, allowNull: true, field: "source_reference" }
}, {
  tableName: "reservation_payment_applications",
  timestamps: true,
  underscored: true
});

module.exports = ReservationPaymentApplication;
