const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const EmployeePermissionGrant = sequelize.define("EmployeePermissionGrant", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  employeeId: { type: DataTypes.STRING, allowNull: false, field: "employee_id" },
  permissionId: { type: DataTypes.STRING, allowNull: false, field: "permission_id" },
  grantedByUserId: { type: DataTypes.STRING, allowNull: true, field: "granted_by_user_id" },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
  tableName: "employee_permission_grants",
  timestamps: true,
  underscored: true
});

module.exports = EmployeePermissionGrant;
