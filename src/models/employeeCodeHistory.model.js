const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const EmployeeCodeHistory = sequelize.define("EmployeeCodeHistory", {
  id: { type: DataTypes.STRING, primaryKey: true },
  employeeId: { type: DataTypes.STRING, allowNull: false, field: "employee_id" },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  oldCode: { type: DataTypes.STRING, allowNull: true, field: "old_code" },
  newCode: { type: DataTypes.STRING, allowNull: false, field: "new_code" },
  changedByUserId: { type: DataTypes.STRING, allowNull: true, field: "changed_by_user_id" },
  changedByEmployeeId: { type: DataTypes.STRING, allowNull: true, field: "changed_by_employee_id" },
  reason: { type: DataTypes.TEXT, allowNull: false }
}, {
  tableName: "employee_code_history",
  timestamps: true,
  underscored: true
});

module.exports = EmployeeCodeHistory;
