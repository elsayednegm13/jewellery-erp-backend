const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Phase 32.6-Fix C — immutable master record of a reservation item amendment
// (add / remove / replace / reprice / mixed). Captures before/after totals,
// paid, remaining, and status so grouped amendment history provides durable
// before/after evidence. No financial journal is produced by an amendment.
const ReservationAmendment = sequelize.define("ReservationAmendment", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  reservationId: { type: DataTypes.STRING, allowNull: false, field: "reservation_id" },
  amendmentType: { type: DataTypes.ENUM("add_items", "remove_items", "replace_items", "reprice_items", "mixed"), allowNull: false, field: "amendment_type" },
  reason: { type: DataTypes.TEXT, allowNull: false },
  beforeTotal: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "before_total" },
  afterTotal: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "after_total" },
  beforePaid: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "before_paid" },
  afterPaid: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "after_paid" },
  beforeRemaining: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "before_remaining" },
  afterRemaining: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "after_remaining" },
  beforeStatus: { type: DataTypes.STRING, allowNull: false, field: "before_status" },
  afterStatus: { type: DataTypes.STRING, allowNull: false, field: "after_status" },
  idempotencyKey: { type: DataTypes.STRING, allowNull: true, field: "idempotency_key" },
  createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
  employeeId: { type: DataTypes.STRING, allowNull: true, field: "employee_id" }
}, {
  tableName: "reservation_amendments",
  timestamps: true,
  underscored: true
});

module.exports = ReservationAmendment;
