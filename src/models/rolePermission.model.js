const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const RolePermission = sequelize.define("RolePermission", {
  roleId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
    field: "role_id"
  },
  permissionId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
    field: "permission_id"
  }
}, {
  tableName: "role_permissions",
  timestamps: true,
  underscored: true
});

module.exports = RolePermission;
