const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const EmployeeOperationalSession = sequelize.define("EmployeeOperationalSession", {
  id: { type: DataTypes.STRING, primaryKey: true },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: false, field: "branch_id" },
  sessionUserId: { type: DataTypes.STRING, allowNull: false, field: "session_user_id" },
  employeeId: { type: DataTypes.STRING, allowNull: false, field: "employee_id" },
  verificationLevel: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "verification_level" },
  verifiedAt: { type: DataTypes.DATE, allowNull: false, field: "verified_at" },
  level2VerifiedAt: { type: DataTypes.DATE, allowNull: true, field: "level_2_verified_at" },
  lastActivityAt: { type: DataTypes.DATE, allowNull: false, field: "last_activity_at" },
  idleExpiresAt: { type: DataTypes.DATE, allowNull: false, field: "idle_expires_at" },
  absoluteExpiresAt: { type: DataTypes.DATE, allowNull: false, field: "absolute_expires_at" },
  lockedAt: { type: DataTypes.DATE, allowNull: true, field: "locked_at" },
  revokedAt: { type: DataTypes.DATE, allowNull: true, field: "revoked_at" },
  revokedReason: { type: DataTypes.STRING, allowNull: true, field: "revoked_reason" },
  credentialVersion: { type: DataTypes.INTEGER, allowNull: false, field: "credential_version" },
  authorizationVersion: { type: DataTypes.INTEGER, allowNull: false, field: "authorization_version" },
  deviceSessionId: { type: DataTypes.STRING, allowNull: false, field: "device_session_id" },
  authSessionFingerprint: { type: DataTypes.STRING, allowNull: true, field: "auth_session_fingerprint" },
  ipAddress: { type: DataTypes.STRING, allowNull: true, field: "ip_address" },
  userAgent: { type: DataTypes.STRING, allowNull: true, field: "user_agent" },
  employeeCodeSnapshot: { type: DataTypes.STRING, allowNull: true, field: "employee_code_snapshot" },
  employeeNameSnapshot: { type: DataTypes.STRING, allowNull: true, field: "employee_name_snapshot" }
}, {
  tableName: "employee_operational_sessions",
  timestamps: true,
  underscored: true
});

module.exports = EmployeeOperationalSession;
