const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const SupplierConsignment = sequelize.define("SupplierConsignment", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  supplierId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "supplier_id"
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
  weight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false
  },
  agreedPrice: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    field: "agreed_price"
  },
  receivedDate: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "received_date"
  },
  status: {
    type: DataTypes.ENUM("available", "sold", "returned"),
    defaultValue: "available"
  }
}, {
  tableName: "supplier_consignments",
  timestamps: true,
  underscored: true
});

module.exports = SupplierConsignment;
