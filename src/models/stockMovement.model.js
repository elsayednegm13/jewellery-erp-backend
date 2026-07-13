const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const StockMovement = sequelize.define("StockMovement", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  productId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "product_id"
  },
  assetId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "asset_id"
  },
  productCode: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "product_code"
  },
  type: {
    type: DataTypes.ENUM(
      "purchase_receive",
      "sale",
      "return",
      "exchange_in",
      "exchange_out",
      "adjustment_in",
      "adjustment_out",
      "transfer_in",
      "transfer_out",
      "opening_balance"
    ),
    allowNull: false
  },
  quantityIn: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    field: "quantity_in"
  },
  quantityOut: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    field: "quantity_out"
  },
  weightIn: {
    type: DataTypes.DECIMAL(12, 4),
    defaultValue: 0,
    field: "weight_in"
  },
  weightOut: {
    type: DataTypes.DECIMAL(12, 4),
    defaultValue: 0,
    field: "weight_out"
  },
  unitCost: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "unit_cost"
  },
  totalCost: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    field: "total_cost"
  },
  referenceType: {
    type: DataTypes.STRING,
    field: "reference_type"
  },
  referenceId: {
    type: DataTypes.STRING,
    field: "reference_id"
  },
  supplierId: {
    type: DataTypes.STRING,
    field: "supplier_id"
  },
  customerId: {
    type: DataTypes.STRING,
    field: "customer_id"
  },
  branchId: {
    type: DataTypes.STRING,
    field: "branch_id"
  },
  warehouseId: {
    type: DataTypes.STRING,
    field: "warehouse_id"
  },
  createdBy: {
    type: DataTypes.STRING,
    field: "created_by"
  }
}, {
  tableName: "stock_movements",
  timestamps: true,
  underscored: true
});

module.exports = StockMovement;
