const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ReservationRefundAllocation = sequelize.define("ReservationRefundAllocation", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  reservationRefundId: { type: DataTypes.STRING, allowNull: false, field: "reservation_refund_id" },
  reservationPaymentId: { type: DataTypes.STRING, allowNull: false, field: "reservation_payment_id" },
  allocatedAmount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "allocated_amount" }
}, {
  tableName: "reservation_refund_allocations",
  timestamps: true,
  underscored: true
});

module.exports = ReservationRefundAllocation;
