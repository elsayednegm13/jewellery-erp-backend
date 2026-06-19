const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const PurchaseOrderItem = sequelize.define("PurchaseOrderItem", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  purchaseOrderId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "purchase_order_id"
  },
  assetId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "asset_id"
  },
  description: {
    type: DataTypes.STRING,
    allowNull: false
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "قطعة"
  },
  unitPrice: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    field: "unit_price"
  },
  total: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false
  },
  receivedQuantity: {
    type: DataTypes.INTEGER,
    field: "received_quantity",
    defaultValue: 0
  }
}, {
  tableName: "purchase_order_items",
  timestamps: true,
  underscored: true
});

module.exports = PurchaseOrderItem;
