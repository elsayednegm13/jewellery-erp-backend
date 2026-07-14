const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const EmployeeBranchAccess = sequelize.define("EmployeeBranchAccess", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  employeeId: { type: DataTypes.STRING, allowNull: false, field: "employee_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  validFrom: { type: DataTypes.DATE, allowNull: true, field: "valid_from" },
  validTo: { type: DataTypes.DATE, allowNull: true, field: "valid_to" },
  createdByUserId: { type: DataTypes.STRING, allowNull: true, field: "created_by_user_id" }
}, {
  tableName: "employee_branch_access",
  timestamps: true,
  underscored: true
});

module.exports = EmployeeBranchAccess;
