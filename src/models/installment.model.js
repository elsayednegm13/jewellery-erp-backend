const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Installment — a single scheduled payment for an installment-sale invoice.
 */
const Installment = sequelize.define("Installment", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  invoiceId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "invoice_id"
  },
  customerId: {
    type: DataTypes.STRING,
    field: "customer_id"
  },
  customerName: {
    type: DataTypes.STRING,
    field: "customer_name"
  },
  sequence: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  dueDate: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "due_date"
  },
  amount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  paidAmount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0,
    field: "paid_amount"
  },
  status: {
    type: DataTypes.ENUM("pending", "paid", "overdue", "partial"),
    defaultValue: "pending"
  },
  paidDate: {
    type: DataTypes.STRING,
    field: "paid_date"
  },
  branch: {
    type: DataTypes.STRING
  },
  idempotencyKey: {
    type: DataTypes.STRING,
    field: "idempotency_key"
  }
}, {
  tableName: "installments",
  timestamps: true,
  underscored: true
});

module.exports = Installment;
