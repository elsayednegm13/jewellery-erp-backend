const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ReservationItem = sequelize.define("ReservationItem", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  reservationId: { type: DataTypes.STRING, allowNull: false, field: "reservation_id" },
  assetId: { type: DataTypes.STRING, allowNull: false, field: "asset_id" },
  assetName: { type: DataTypes.STRING, allowNull: false, field: "asset_name" },
  itemType: { type: DataTypes.STRING, allowNull: false, defaultValue: "asset", field: "item_type" },
  agreedPrice: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: "agreed_price" },
  originalPrice: { type: DataTypes.DECIMAL(20, 8), allowNull: true, field: "original_price" },
  status: { type: DataTypes.ENUM("active", "released", "sold"), allowNull: false, defaultValue: "active" },
  reservedAt: { type: DataTypes.DATE, allowNull: false, field: "reserved_at" },
  releasedAt: { type: DataTypes.DATE, allowNull: true, field: "released_at" },
  addedBy: { type: DataTypes.STRING, allowNull: true, field: "added_by" },
  releaseReason: { type: DataTypes.TEXT, allowNull: true, field: "release_reason" }
}, {
  tableName: "reservation_items",
  timestamps: true,
  underscored: true
});

module.exports = ReservationItem;
