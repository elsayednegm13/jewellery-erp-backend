const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const TechnicalAccountSession = sequelize.define("TechnicalAccountSession", {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false, field: "user_id" },
  companyId: { type: DataTypes.STRING, allowNull: false, field: "company_id" },
  branchId: { type: DataTypes.STRING, allowNull: true, field: "branch_id" },
  refreshTokenHash: { type: DataTypes.STRING, allowNull: false, field: "refresh_token_hash" },
  deviceSessionId: { type: DataTypes.STRING, allowNull: true, field: "device_session_id" },
  userAgent: { type: DataTypes.STRING, allowNull: true, field: "user_agent" },
  ipAddress: { type: DataTypes.STRING, allowNull: true, field: "ip_address" },
  passwordVersion: { type: DataTypes.INTEGER, allowNull: false, field: "password_version" },
  sessionVersion: { type: DataTypes.INTEGER, allowNull: false, field: "session_version" },
  expiresAt: { type: DataTypes.DATE, allowNull: false, field: "expires_at" },
  lastUsedAt: { type: DataTypes.DATE, allowNull: true, field: "last_used_at" },
  revokedAt: { type: DataTypes.DATE, allowNull: true, field: "revoked_at" },
  revokeReason: { type: DataTypes.STRING, allowNull: true, field: "revoke_reason" }
}, {
  tableName: "technical_account_sessions",
  timestamps: true,
  underscored: true
});

module.exports = TechnicalAccountSession;
