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
  },
  // Phase 15D — gold cost snapshot / cost metadata. Forward-only foundation:
  // no calculation/override/COGS reads these yet (15E/15F/15G). Computed fields
  // are nullable (no default 0) so legacy rows never look like real snapshots.
  goldPriceSnapshot: { type: DataTypes.DECIMAL(15, 4), allowNull: true, field: "gold_price_snapshot" },
  goldPriceSource: { type: DataTypes.STRING, allowNull: true, field: "gold_price_source" },
  goldPriceKarat: { type: DataTypes.STRING, allowNull: true, field: "gold_price_karat" },
  goldPriceAt: { type: DataTypes.DATE, allowNull: true, field: "gold_price_at" },
  computedGoldCost: { type: DataTypes.DECIMAL(15, 4), allowNull: true, field: "computed_gold_cost" },
  finalPurchaseCost: { type: DataTypes.DECIMAL(15, 4), allowNull: true, field: "final_purchase_cost" },
  costSource: { type: DataTypes.STRING, allowNull: false, defaultValue: "manual", field: "cost_source" },
  costOverridden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "cost_overridden" },
  overrideReason: { type: DataTypes.TEXT, allowNull: true, field: "override_reason" },
  overrideBy: { type: DataTypes.STRING, allowNull: true, field: "override_by" },
  overrideAt: { type: DataTypes.DATE, allowNull: true, field: "override_at" },
  netGoldWeight: { type: DataTypes.DECIMAL(15, 4), allowNull: true, field: "net_gold_weight" }
}, {
  tableName: "assets",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = Asset;
