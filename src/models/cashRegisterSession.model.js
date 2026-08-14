const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const CashRegisterSession = sequelize.define("CashRegisterSession", {
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
    allowNull: false,
    field: "branch_id"
  },
  cashAccountCode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "1110",
    field: "cash_account_code"
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "OPEN"
  },
  openedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: "opened_at"
  },
  openedByUserId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "opened_by_user_id"
  },
  openedByEmployeeId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "opened_by_employee_id"
  },
  openedByName: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "opened_by_name"
  },
  openingCountedAmount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: false,
    defaultValue: 0,
    field: "opening_counted_amount"
  },
  closedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "closed_at"
  },
  closedByUserId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "closed_by_user_id"
  },
  closedByEmployeeId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "closed_by_employee_id"
  },
  closedByName: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "closed_by_name"
  },
  closingCountedAmount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: true,
    field: "closing_counted_amount"
  },
  systemExpectedAmount: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: true,
    field: "system_expected_amount"
  },
  variance: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: true
  },
  varianceReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: "variance_reason"
  },
  openIdempotencyKey: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "open_idempotency_key"
  },
  closeIdempotencyKey: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "close_idempotency_key"
  }
}, {
  tableName: "cash_register_sessions",
  timestamps: true,
  underscored: true
});

module.exports = CashRegisterSession;
