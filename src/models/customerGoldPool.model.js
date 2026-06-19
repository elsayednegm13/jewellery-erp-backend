const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const CustomerGoldPool = sequelize.define("CustomerGoldPool", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  customerId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_id"
  },
  customerName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "customer_name"
  },
  status: {
    type: DataTypes.ENUM("pending-assay", "assayed", "approved", "transferred", "rejected"),
    defaultValue: "pending-assay"
  },
  grossWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "gross_weight"
  },
  purity: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false
  },
  fineWeight: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: false,
    field: "fine_weight"
  },
  assayResult: {
    type: DataTypes.DECIMAL(5, 4),
    field: "assay_result"
  },
  assayDate: {
    type: DataTypes.STRING,
    field: "assay_date"
  },
  assayedBy: {
    type: DataTypes.STRING,
    field: "assayed_by"
  },
  receivedAt: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "received_at"
  },
  approvedAt: {
    type: DataTypes.STRING,
    field: "approved_at"
  },
  approvedBy: {
    type: DataTypes.STRING,
    field: "approved_by"
  },
  notes: {
    type: DataTypes.TEXT
  },
  transferredToIGP: {
    type: DataTypes.BOOLEAN,
    field: "transferred_to_igp",
    defaultValue: false
  },
  igpId: {
    type: DataTypes.STRING,
    field: "igp_id"
  }
}, {
  tableName: "customer_gold_pools",
  timestamps: true,
  underscored: true
});

module.exports = CustomerGoldPool;
