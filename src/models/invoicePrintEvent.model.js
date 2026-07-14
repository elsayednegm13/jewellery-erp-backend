const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const InvoicePrintEvent = sequelize.define("InvoicePrintEvent", {
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
  invoiceId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "invoice_id"
  },
  technicalUserId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "technical_user_id"
  },
  employeeId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "employee_id"
  },
  operatorSessionId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "operator_session_id"
  },
  eventType: {
    type: DataTypes.ENUM("official_print_authorized", "reprint_authorized"),
    allowNull: false,
    field: "event_type"
  },
  copyNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: "copy_number"
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: "invoice_print_events",
  timestamps: true,
  underscored: true
});

module.exports = InvoicePrintEvent;
