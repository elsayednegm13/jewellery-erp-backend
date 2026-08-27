const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Branch = sequelize.define("Branch", {
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
  code: {
    type: DataTypes.STRING,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM("store", "warehouse", "factory"),
    allowNull: false,
    defaultValue: "store"
  },
  address: {
    type: DataTypes.STRING
  },
  phone: {
    type: DataTypes.STRING
  },
  managerId: {
    type: DataTypes.STRING,
    allowNull: true,
    field: "manager_id"
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: "is_active"
  }
}, {
  tableName: "branches",
  timestamps: true,
  underscored: true
});

module.exports = Branch;
