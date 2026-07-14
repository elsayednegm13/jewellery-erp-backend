const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const EmployeeCredential = sequelize.define("EmployeeCredential", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  employeeId: { type: DataTypes.STRING, allowNull: false, field: "employee_id" },
  pinHash: { type: DataTypes.STRING, allowNull: false, field: "pin_hash" },
  credentialVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "credential_version" },
  failedAttemptCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "failed_attempt_count" },
  lockedUntil: { type: DataTypes.DATE, allowNull: true, field: "locked_until" },
  lastFailedAt: { type: DataTypes.DATE, allowNull: true, field: "last_failed_at" },
  lastVerifiedAt: { type: DataTypes.DATE, allowNull: true, field: "last_verified_at" },
  pinChangedAt: { type: DataTypes.DATE, allowNull: true, field: "pin_changed_at" },
  resetRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "reset_required" },
  resetAt: { type: DataTypes.DATE, allowNull: true, field: "reset_at" },
  resetByUserId: { type: DataTypes.STRING, allowNull: true, field: "reset_by_user_id" },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
  tableName: "employee_credentials",
  timestamps: true,
  underscored: true
});

module.exports = EmployeeCredential;
