const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const PasswordResetToken = sequelize.define("PasswordResetToken", {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false, field: "user_id" },
  tokenHash: { type: DataTypes.STRING, allowNull: false, field: "token_hash" },
  expiresAt: { type: DataTypes.DATE, allowNull: false, field: "expires_at" },
  usedAt: { type: DataTypes.DATE, allowNull: true, field: "used_at" },
  requestedIp: { type: DataTypes.STRING, allowNull: true, field: "requested_ip" },
  requestedUserAgent: { type: DataTypes.STRING, allowNull: true, field: "requested_user_agent" }
}, {
  tableName: "password_reset_tokens",
  timestamps: true,
  underscored: true
});

module.exports = PasswordResetToken;
