const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const StockAudit = sequelize.define("StockAudit", {
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
  status: {
    type: DataTypes.ENUM("in-progress", "completed", "cancelled"),
    defaultValue: "in-progress"
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "created_by"
  },
  completedAt: {
    type: DataTypes.STRING,
    field: "completed_at"
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  tableName: "stock_audits",
  timestamps: true,
  underscored: true
});

module.exports = StockAudit;
