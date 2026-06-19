const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Payment = sequelize.define("Payment", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  branchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "branch_id"
  },
  invoiceId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "invoice_id"
  },
  paymentMethod: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "payment_method"
  },
  amount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  reference: {
    type: DataTypes.STRING
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  tableName: "payments",
  timestamps: true,
  underscored: true
});

module.exports = Payment;
