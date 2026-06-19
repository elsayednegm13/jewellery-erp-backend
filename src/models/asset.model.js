const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Asset = sequelize.define("Asset", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM("gold-piece", "gold-weight", "diamond", "gemstone", "pearl", "watch"),
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false
  },
  karat: {
    type: DataTypes.INTEGER
  },
  purity: {
    type: DataTypes.DECIMAL(5, 4)
  },
  grossWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "gross_weight"
  },
  netWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "net_weight"
  },
  goldWeight: {
    type: DataTypes.DECIMAL(10, 4),
    field: "gold_weight"
  },
  price: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false
  },
  cost: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  branchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "branch_id"
  },
  location: {
    type: DataTypes.STRING,
    allowNull: false
  },
  status: {
    // Legacy values (repair, transferred, archived) kept for backward
    // compatibility; pending_transfer/returned/in_workshop/pending_tag added
    // per DARFUS inventory rules (migration 20260619050000).
    type: DataTypes.ENUM(
      "available", "reserved", "sold", "repair", "transferred", "melted", "archived",
      "pending_transfer", "returned", "in_workshop", "pending_tag"
    ),
    defaultValue: "available"
  },
  barcode: {
    type: DataTypes.STRING,
    allowNull: false
  },
  rfid: {
    type: DataTypes.STRING
  },
  source: {
    type: DataTypes.STRING
  },
  parentAssetId: {
    type: DataTypes.STRING,
    field: "parent_asset_id"
  },
  childAssetIds: {
    type: DataTypes.JSONB,
    field: "child_asset_ids",
    defaultValue: []
  },
  stones: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  stoneDetails: {
    type: DataTypes.JSONB,
    field: "stone_details",
    defaultValue: []
  },
  pearls: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  pearlDetails: {
    type: DataTypes.JSONB,
    field: "pearl_details",
    defaultValue: []
  },
  notes: {
    type: DataTypes.TEXT
  },
  manufacturingOrderId: {
    type: DataTypes.STRING,
    field: "manufacturing_order_id"
  },
  contributionWeight: {
    type: DataTypes.DECIMAL(10, 4),
    field: "contribution_weight"
  },
  processLoss: {
    type: DataTypes.DECIMAL(10, 4),
    field: "process_loss"
  }
}, {
  tableName: "assets",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = Asset;
