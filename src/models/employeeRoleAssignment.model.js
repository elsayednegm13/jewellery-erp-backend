const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const EmployeeRoleAssignment = sequelize.define("EmployeeRoleAssignment", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  employeeId: { type: DataTypes.STRING, allowNull: false, field: "employee_id" },
  roleId: { type: DataTypes.STRING, allowNull: false, field: "role_id" },
  assignedByUserId: { type: DataTypes.STRING, allowNull: true, field: "assigned_by_user_id" },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
  tableName: "employee_role_assignments",
  timestamps: true,
  underscored: true
});

module.exports = EmployeeRoleAssignment;
