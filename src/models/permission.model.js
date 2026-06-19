const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Permission = sequelize.define("Permission", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  module: {
    type: DataTypes.STRING,
    allowNull: false
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT
  }
}, {
  tableName: "permissions",
  timestamps: true,
  underscored: true
});

module.exports = Permission;
