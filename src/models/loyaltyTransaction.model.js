const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * LoyaltyTransaction — append-only ledger of loyalty point movements
 * (earned on purchases, redeemed for value, or manually adjusted).
 */
const LoyaltyTransaction = sequelize.define("LoyaltyTransaction", {
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
    allowNull: false,
    field: "customer_id"
  },
  customerName: {
    type: DataTypes.STRING,
    field: "customer_name"
  },
  type: {
    type: DataTypes.ENUM("earn", "redeem", "adjust"),
    allowNull: false
  },
  points: {
    // positive for earn, negative for redeem
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  value: {
    // monetary value of redeemed points (for redeem rows)
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0
  },
  balanceAfter: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: "balance_after"
  },
  invoiceId: {
    type: DataTypes.STRING,
    field: "invoice_id"
  },
  date: {
    type: DataTypes.STRING
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  tableName: "loyalty_transactions",
  timestamps: true,
  underscored: true
});

module.exports = LoyaltyTransaction;
