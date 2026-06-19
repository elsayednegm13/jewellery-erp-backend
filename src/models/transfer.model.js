const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Transfer = sequelize.define("Transfer", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  assetIds: {
    type: DataTypes.JSONB,
    allowNull: false,
    field: "asset_ids"
  },
  fromBranch: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "from_branch"
  },
  fromBranchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "from_branch_id"
  },
  toBranch: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "to_branch"
  },
  toBranchId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "to_branch_id"
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
  approvedBy: {
    type: DataTypes.STRING,
    field: "approved_by"
  },
  approvedAt: {
    type: DataTypes.STRING,
    field: "approved_at"
  },
  receivedBy: {
    type: DataTypes.STRING,
    field: "received_by"
  },
  receivedAt: {
    type: DataTypes.STRING,
    field: "received_at"
  },
  status: {
    type: DataTypes.ENUM("pending", "approved", "in-transit", "received", "cancelled"),
    defaultValue: "pending"
  },
  notes: {
    type: DataTypes.TEXT
  },
  cancelReason: {
    type: DataTypes.STRING,
    field: "cancel_reason"
  }
}, {
  tableName: "transfers",
  timestamps: true,
  underscored: true
});

module.exports = Transfer;
