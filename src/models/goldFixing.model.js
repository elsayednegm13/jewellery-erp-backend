const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * GoldFixing — locks ("fixes") the gold rate for an open metal position
 * (a weight of gold owed to / by a customer or held unpriced in stock).
 * Fixing converts a floating weight position into a locked currency value;
 * unfixing releases it back to a floating position.
 */
const GoldFixing = sequelize.define("GoldFixing", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  customerId: {
    type: DataTypes.STRING,
    field: "customer_id"
  },
  customerName: {
    type: DataTypes.STRING,
    field: "customer_name"
  },
  direction: {
    // buy = we owe the counterparty gold/value; sell = they owe us
    type: DataTypes.ENUM("buy", "sell"),
    allowNull: false,
    defaultValue: "buy"
  },
  karat: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 21
  },
  grossWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    defaultValue: 0,
    field: "gross_weight"
  },
  fineWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    defaultValue: 0,
    field: "fine_weight"
  },
  ratePerGram: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
    defaultValue: 0,
    field: "rate_per_gram"
  },
  value: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  currency: {
    type: DataTypes.STRING,
    defaultValue: "AED"
  },
  status: {
    type: DataTypes.ENUM("fixed", "unfixed", "settled"),
    defaultValue: "fixed"
  },
  fixedAt: {
    type: DataTypes.STRING,
    field: "fixed_at"
  },
  unfixedAt: {
    type: DataTypes.STRING,
    field: "unfixed_at"
  },
  fixedBy: {
    type: DataTypes.STRING,
    field: "fixed_by"
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  tableName: "gold_fixings",
  timestamps: true,
  underscored: true
});

module.exports = GoldFixing;
