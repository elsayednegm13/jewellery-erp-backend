const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// Singleton setup marker. Values are deliberately secret-free: authorization
// is supplied by deployment configuration and only request/payload hashes are
// retained for safe replay/conflict handling.
const FirstRunSetupState = sequelize.define("FirstRunSetupState", {
  id: { type: DataTypes.STRING(32), primaryKey: true },
  state: { type: DataTypes.STRING(48), allowNull: false },
  idempotencyKeyHash: { type: DataTypes.STRING(128), allowNull: true, field: "idempotency_key_hash" },
  payloadHash: { type: DataTypes.STRING(128), allowNull: true, field: "payload_hash" },
  result: { type: DataTypes.JSONB, allowNull: true },
  completedAt: { type: DataTypes.DATE, allowNull: true, field: "completed_at" },
  lastErrorCode: { type: DataTypes.STRING(96), allowNull: true, field: "last_error_code" }
}, { tableName: "first_run_setup_states", timestamps: true, underscored: true });

module.exports = FirstRunSetupState;
