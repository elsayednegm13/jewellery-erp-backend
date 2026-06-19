const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const UserRole = sequelize.define("UserRole", {
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
    field: "user_id"
  },
  roleId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
    field: "role_id"
  }
}, {
  tableName: "user_roles",
  timestamps: true,
  underscored: true
});

module.exports = UserRole;
