const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Role = sequelize.define("Role", {
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
  slug: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT
  },
  isSystem: {
    type: DataTypes.BOOLEAN,
    field: "is_system",
    defaultValue: false
  },
  isAdmin: {
    type: DataTypes.BOOLEAN,
    field: "is_admin",
    defaultValue: false
  }
}, {
  tableName: "roles",
  timestamps: true,
  underscored: true
});

module.exports = Role;
