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
    type: DataTypes.ENUM("draft", "in-progress", "completed", "closed", "cancelled"),
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
  },
  auditNumber: { type: DataTypes.STRING, field: "audit_number" },
  auditDate: { type: DataTypes.DATEONLY, field: "audit_date" },
  locationId: { type: DataTypes.STRING, field: "location_id" },
  auditMethod: { type: DataTypes.STRING, field: "audit_method" },
  closedAt: { type: DataTypes.DATE, field: "closed_at" },
  closedBy: { type: DataTypes.STRING, field: "closed_by" }
}, {
  tableName: "stock_audits",
  timestamps: true,
  underscored: true
});

module.exports = StockAudit;
