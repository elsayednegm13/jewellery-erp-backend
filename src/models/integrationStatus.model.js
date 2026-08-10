const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const IntegrationStatus = sequelize.define("IntegrationStatus", {
  id: { type: DataTypes.STRING, primaryKey: true },
  sourceEventId: { type: DataTypes.STRING(128), allowNull: false, field: "source_event_id" },
  aggregateType: { type: DataTypes.STRING(128), allowNull: false, field: "aggregate_type" },
  aggregateId: { type: DataTypes.STRING(128), allowNull: false, field: "aggregate_id" },
  consumerName: { type: DataTypes.STRING(64), allowNull: false, field: "consumer_name" },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "PENDING" },
  attemptCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "attempt_count" },
  lastError: { type: DataTypes.TEXT, allowNull: true, field: "last_error" },
  firstAttemptAt: { type: DataTypes.DATE, allowNull: true, field: "first_attempt_at" },
  lastAttemptAt: { type: DataTypes.DATE, allowNull: true, field: "last_attempt_at" },
  succeededAt: { type: DataTypes.DATE, allowNull: true, field: "succeeded_at" },
  nextRetryAt: { type: DataTypes.DATE, allowNull: true, field: "next_retry_at" },
  correlationId: { type: DataTypes.STRING(128), allowNull: false, field: "correlation_id" },
}, {
  tableName: "integration_statuses",
  timestamps: true,
  underscored: true,
});

module.exports = IntegrationStatus;
