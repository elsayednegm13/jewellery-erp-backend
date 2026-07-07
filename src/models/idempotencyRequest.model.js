const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Central idempotency store (Phase 21.3-Fix). One row per (companyId, scope, key)
 * enforced by a UNIQUE index, so an insert-first claim is race-safe: a concurrent
 * duplicate cannot create a second row. `responseBody`/`statusCode` hold the saved
 * success response for replay; `requestHash` distinguishes a genuine replay from a
 * key reused for a different payload.
 */
const IdempotencyRequest = sequelize.define("IdempotencyRequest", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  companyId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: "company_id"
  },
  scope: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  key: {
    type: DataTypes.STRING(191),
    allowNull: false
  },
  requestHash: {
    type: DataTypes.STRING(128),
    allowNull: false,
    field: "request_hash"
  },
  // processing | succeeded | failed
  status: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: "processing"
  },
  statusCode: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: "status_code"
  },
  responseBody: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: "response_body"
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: "expires_at"
  }
}, {
  tableName: "idempotency_requests",
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ["company_id", "scope", "key"], name: "idempotency_requests_company_scope_key_uq" }
  ]
});

module.exports = IdempotencyRequest;
