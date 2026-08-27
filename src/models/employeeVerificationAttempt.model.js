const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const EmployeeVerificationAttempt = sequelize.define("EmployeeVerificationAttempt", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: true, field: "branch_id" },
  technicalUserId: { type: DataTypes.STRING, allowNull: true, field: "technical_user_id" },
  employeeId: { type: DataTypes.STRING, allowNull: true, field: "employee_id" },
  employeeCodeNormalized: { type: DataTypes.STRING, allowNull: true, field: "employee_code_normalized" },
  requestedPermission: { type: DataTypes.STRING, allowNull: true, field: "requested_permission" },
  requestedOperation: { type: DataTypes.STRING, allowNull: true, field: "requested_operation" },
  requestedLevel: { type: DataTypes.INTEGER, allowNull: false, field: "requested_level" },
  result: { type: DataTypes.ENUM("success", "failure"), allowNull: false },
  failureCode: { type: DataTypes.STRING, allowNull: true, field: "failure_code" },
  ipAddress: { type: DataTypes.STRING, allowNull: true, field: "ip_address" },
  userAgent: { type: DataTypes.STRING, allowNull: true, field: "user_agent" }
}, {
  tableName: "employee_verification_attempts",
  timestamps: true,
  underscored: true
});

module.exports = EmployeeVerificationAttempt;
