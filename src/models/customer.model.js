const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Customer = sequelize.define("Customer", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING
  },
  tier: {
    type: DataTypes.ENUM("VIP", "Gold", "Standard"),
    defaultValue: "Standard"
  },
  balance: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    allowNull: false
  },
  purchases: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    allowNull: false
  },
  lastVisit: {
    type: DataTypes.STRING,
    field: "last_visit"
  },
  status: {
    type: DataTypes.ENUM("active", "inactive"),
    defaultValue: "active"
  },
  nationality: {
    type: DataTypes.STRING
  },
  idType: {
    type: DataTypes.STRING,
    field: "id_type"
  },
  idNumber: {
    type: DataTypes.STRING,
    field: "id_number"
  },
  idExpiry: {
    type: DataTypes.STRING,
    field: "id_expiry"
  },
  kycStatus: {
    type: DataTypes.ENUM("verified", "pending", "flagged", "not-started"),
    field: "kyc_status",
    defaultValue: "not-started"
  },
  amlStatus: {
    type: DataTypes.ENUM("clear", "review", "flagged"),
    field: "aml_status",
    defaultValue: "clear"
  },
  creditLimit: {
    type: DataTypes.DECIMAL(15, 4),
    field: "credit_limit",
    defaultValue: 0
  },
  loyaltyPoints: {
    type: DataTypes.INTEGER,
    field: "loyalty_points",
    defaultValue: 0
  },
  addresses: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  notes: {
    type: DataTypes.TEXT
  },
  kycDetails: {
    type: DataTypes.JSONB,
    field: "kyc_details"
  }
}, {
  tableName: "customers",
  timestamps: true,
  underscored: true,
  paranoid: true
});

module.exports = Customer;
