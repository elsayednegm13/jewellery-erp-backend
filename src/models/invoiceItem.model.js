const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const InvoiceItem = sequelize.define("InvoiceItem", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  invoiceId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "invoice_id"
  },
  assetId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "asset_id"
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  price: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false
  },
  cost: {
    type: DataTypes.DECIMAL(15, 4)
  },
  weight: {
    type: DataTypes.DECIMAL(10, 4)
  },
  karat: {
    type: DataTypes.INTEGER
  },
  discount: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0
  },
  makingCharge: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "making_charge"
  },
  stoneValue: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "stone_value"
  }
}, {
  tableName: "invoice_items",
  timestamps: true,
  underscored: true
});

module.exports = InvoiceItem;
