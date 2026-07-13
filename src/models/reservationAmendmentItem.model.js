const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Phase 32.6-Fix C — immutable per-item detail of a reservation amendment.
// One row per affected reservation item, recording the action taken, the
// asset(s) involved, old/new price, and the active-state transition.
const ReservationAmendmentItem = sequelize.define("ReservationAmendmentItem", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  amendmentId: { type: DataTypes.STRING, allowNull: false, field: "amendment_id" },
  reservationId: { type: DataTypes.STRING, allowNull: false, field: "reservation_id" },
  action: { type: DataTypes.ENUM("added", "removed", "replaced_out", "replaced_in", "repriced"), allowNull: false },
  reservationItemId: { type: DataTypes.STRING, allowNull: true, field: "reservation_item_id" },
  assetId: { type: DataTypes.STRING, allowNull: true, field: "asset_id" },
  previousAssetId: { type: DataTypes.STRING, allowNull: true, field: "previous_asset_id" },
  oldPrice: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "old_price" },
  newPrice: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "new_price" },
  previousActiveState: { type: DataTypes.STRING, allowNull: true, field: "previous_active_state" },
  newActiveState: { type: DataTypes.STRING, allowNull: true, field: "new_active_state" }
}, {
  tableName: "reservation_amendment_items",
  timestamps: true,
  underscored: true
});

module.exports = ReservationAmendmentItem;
