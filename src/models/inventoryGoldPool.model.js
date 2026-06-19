const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const InventoryGoldPool = sequelize.define("InventoryGoldPool", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  source: {
    type: DataTypes.STRING,
    allowNull: false
  },
  cgpId: {
    type: DataTypes.STRING,
    field: "cgp_id"
  },
  grossWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "gross_weight"
  },
  purity: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false
  },
  fineWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "fine_weight"
  },
  availableWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "available_weight"
  },
  allocatedWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "allocated_weight",
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM("available", "allocated", "consumed", "returned"),
    defaultValue: "available"
  },
  allocations: {
    type: DataTypes.JSONB,
    defaultValue: []
  }
}, {
  tableName: "inventory_gold_pools",
  timestamps: true,
  underscored: true
});

module.exports = InventoryGoldPool;
