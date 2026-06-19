const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Reservation = sequelize.define("Reservation", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  assetId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "asset_id"
  },
  assetName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "asset_name"
  },
  customerId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_id"
  },
  customerName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_name"
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  deposit: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  expiresAt: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "expires_at"
  },
  status: {
    type: DataTypes.ENUM("active", "expired", "completed", "cancelled"),
    defaultValue: "active"
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  tableName: "reservations",
  timestamps: true,
  underscored: true
});

module.exports = Reservation;
