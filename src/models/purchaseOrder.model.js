const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const PurchaseOrder = sequelize.define("PurchaseOrder", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  supplierId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "supplier_id"
  },
  supplierName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "supplier_name"
  },
  status: {
    type: DataTypes.ENUM("draft", "sent", "partial", "received", "cancelled"),
    defaultValue: "draft"
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  expectedDate: {
    type: DataTypes.STRING,
    field: "expected_date"
  },
  receivedDate: {
    type: DataTypes.STRING,
    field: "received_date"
  },
  total: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  notes: {
    type: DataTypes.TEXT
  },
  isConsignment: {
    type: DataTypes.BOOLEAN,
    field: "is_consignment",
    defaultValue: false
  },
  idempotencyKey: {
    type: DataTypes.STRING,
    field: "idempotency_key"
  }
}, {
  tableName: "purchase_orders",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = PurchaseOrder;
