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
  // Serialized items link to assets.id; quantity-based items link to products.id
  // via productId. A line uses exactly one (the other is null).
  assetId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "asset_id"
  },
  productId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "product_id"
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
  tableName: "purchase_order_items",
  timestamps: true,
  underscored: true
});

module.exports = PurchaseOrderItem;
