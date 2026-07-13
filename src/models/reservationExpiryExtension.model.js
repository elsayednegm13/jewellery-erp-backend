const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Phase 32.6-Fix C — immutable history of reservation expiry extensions.
// An extension may only move expiry later, only before the current expiry
// time. No financial or inventory posting is produced by an extension.
const ReservationExpiryExtension = sequelize.define("ReservationExpiryExtension", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  reservationId: { type: DataTypes.STRING, allowNull: false, field: "reservation_id" },
  oldExpiry: { type: DataTypes.STRING, allowNull: false, field: "old_expiry" },
  newExpiry: { type: DataTypes.STRING, allowNull: false, field: "new_expiry" },
  reason: { type: DataTypes.TEXT, allowNull: false },
  extendedBy: { type: DataTypes.STRING, allowNull: true, field: "extended_by" },
  extendedAt: { type: DataTypes.DATE, allowNull: false, field: "extended_at" },
  idempotencyKey: { type: DataTypes.STRING, allowNull: true, field: "idempotency_key" }
}, {
  tableName: "reservation_expiry_extensions",
  timestamps: true,
  underscored: true
});

module.exports = ReservationExpiryExtension;
