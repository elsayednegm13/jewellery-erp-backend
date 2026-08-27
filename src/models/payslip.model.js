const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Payslip — a single employee's pay for a period (YYYY-MM).
 *   net = baseSalary + allowances + overtime - deductions
 */
const Payslip = sequelize.define("Payslip", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  employeeId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "employee_id"
  },
  employeeName: {
    type: DataTypes.STRING,
    field: "employee_name"
  },
  period: {
    type: DataTypes.STRING,
    allowNull: false
  },
  baseSalary: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0,
    field: "base_salary"
  },
  allowances: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0
  },
  overtime: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0
  },
  deductions: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0
  },
  net: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM("draft", "approved", "paid"),
    defaultValue: "draft"
  },
  paidDate: {
    type: DataTypes.STRING,
    field: "paid_date"
  },
  paymentMethod: {
    type: DataTypes.STRING,
    field: "payment_method"
  },
  journalEntryId: {
    type: DataTypes.STRING,
    field: "journal_entry_id"
  },
  branch: {
    type: DataTypes.STRING
  },
  notes: {
    type: DataTypes.TEXT
  },
  idempotencyKey: {
    type: DataTypes.STRING,
    field: "idempotency_key"
  }
}, {
  tableName: "payslips",
  timestamps: true,
  underscored: true
});

module.exports = Payslip;
