const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const EmailChangeToken = sequelize.define("EmailChangeToken", {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false, field: "user_id" },
  newEmail: { type: DataTypes.STRING, allowNull: false, field: "new_email" },
  tokenHash: { type: DataTypes.STRING, allowNull: false, field: "token_hash" },
  expiresAt: { type: DataTypes.DATE, allowNull: false, field: "expires_at" },
  usedAt: { type: DataTypes.DATE, allowNull: true, field: "used_at" }
}, {
  tableName: "email_change_tokens",
  timestamps: true,
  underscored: true
});

module.exports = EmailChangeToken;
