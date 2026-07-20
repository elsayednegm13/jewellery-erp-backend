const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Account = sequelize.define("Account", {
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
    allowNull: true,
    field: "branch_id"
  },
  code: {
    type: DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  nameAr: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "name_ar"
  },
  type: {
    type: DataTypes.ENUM("asset", "liability", "equity", "revenue", "expense"),
    allowNull: false
  },
  nature: {
    type: DataTypes.ENUM("debit", "credit"),
    allowNull: false
  },
  parentId: {
    type: DataTypes.STRING,
    field: "parent_id"
  },
  balance: {
    type: DataTypes.DECIMAL(15, 4),
    defaultValue: 0,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    field: "is_active",
    defaultValue: true
  },
  level: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  }
}, {
  tableName: "accounts",
  timestamps: true,
  underscored: true
});

module.exports = Account;
