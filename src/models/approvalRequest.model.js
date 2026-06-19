const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ApprovalRequest = sequelize.define("ApprovalRequest", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  type: {
    type: DataTypes.ENUM("discount", "price-override", "transfer", "adjustment", "cgp", "period-close", "reverse-charge"),
    allowNull: false
  },
  requestedBy: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "requested_by"
  },
  requestedAt: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "requested_at"
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(15, 4)
  },
  status: {
    type: DataTypes.ENUM("pending", "approved", "rejected", "expired"),
    defaultValue: "pending"
  },
  reviewedBy: {
    type: DataTypes.STRING,
    field: "reviewed_by"
  },
  reviewedAt: {
    type: DataTypes.STRING,
    field: "reviewed_at"
  },
  reason: {
    type: DataTypes.STRING
  },
  relatedId: {
    type: DataTypes.STRING,
    field: "related_id"
  }
}, {
  tableName: "approval_requests",
  timestamps: true,
  underscored: true
});

module.exports = ApprovalRequest;
