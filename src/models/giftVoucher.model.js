const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * GiftVoucher — a prepaid voucher: customer pays its value up-front
 * (deferred revenue / liability) and redeems it later against purchases.
 */
const GiftVoucher = sequelize.define("GiftVoucher", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  code: {
    type: DataTypes.STRING,
    allowNull: false
  },
  value: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  balance: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  customerId: {
    type: DataTypes.STRING,
    field: "customer_id"
  },
  customerName: {
    type: DataTypes.STRING,
    field: "customer_name"
  },
  status: {
    type: DataTypes.ENUM("active", "redeemed", "expired"),
    defaultValue: "active"
  },
  issueDate: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "issue_date"
  },
  expiryDate: {
    type: DataTypes.STRING,
    field: "expiry_date"
  },
  paymentMethod: {
    type: DataTypes.STRING,
    field: "payment_method"
  },
  branch: {
    type: DataTypes.STRING
  }
}, {
  tableName: "gift_vouchers",
  timestamps: true,
  underscored: true
});

module.exports = GiftVoucher;
