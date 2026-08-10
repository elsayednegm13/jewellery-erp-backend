const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { AppError } = require("../utils/errors");

const MUTABLE_FIELDS = new Set(["status", "attemptCount", "lastError", "availableAt", "claimedAt", "claimedBy", "publishedAt", "updatedAt"]);

function immutableEventError() {
  throw new AppError("Durable event payload and identity are immutable", 409, "OUTBOX_EVENT_IMMUTABLE");
}

function assertOnlyTechnicalFields(instance) {
  const changed = instance.changed() || [];
  if (changed.some((field) => !MUTABLE_FIELDS.has(field))) immutableEventError();
}

function assertBulkOnlyTechnicalFields(options) {
  const fields = Object.keys(options.attributes || {});
  if (fields.some((field) => !MUTABLE_FIELDS.has(field))) immutableEventError();
}

const OutboxEvent = sequelize.define("OutboxEvent", {
  id: { type: DataTypes.STRING, primaryKey: true },
  eventId: { type: DataTypes.STRING(128), allowNull: false, field: "event_id" },
  eventType: { type: DataTypes.STRING(128), allowNull: false, field: "event_type" },
  eventVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "event_version" },
  aggregateType: { type: DataTypes.STRING(128), allowNull: false, field: "aggregate_type" },
  aggregateId: { type: DataTypes.STRING(128), allowNull: false, field: "aggregate_id" },
  payload: { type: DataTypes.JSONB, allowNull: false },
  occurredAt: { type: DataTypes.DATE, allowNull: false, field: "occurred_at" },
  availableAt: { type: DataTypes.DATE, allowNull: false, field: "available_at" },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "PENDING" },
  attemptCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "attempt_count" },
  lastError: { type: DataTypes.TEXT, allowNull: true, field: "last_error" },
  claimedAt: { type: DataTypes.DATE, allowNull: true, field: "claimed_at" },
  claimedBy: { type: DataTypes.STRING(128), allowNull: true, field: "claimed_by" },
  publishedAt: { type: DataTypes.DATE, allowNull: true, field: "published_at" },
  correlationId: { type: DataTypes.STRING(128), allowNull: false, field: "correlation_id" },
  causationId: { type: DataTypes.STRING(128), allowNull: true, field: "causation_id" },
}, {
  tableName: "outbox_events",
  timestamps: true,
  underscored: true,
  hooks: {
    beforeUpdate: assertOnlyTechnicalFields,
    beforeBulkUpdate: assertBulkOnlyTechnicalFields,
    beforeDestroy: immutableEventError,
    beforeBulkDestroy: immutableEventError,
  },
});

module.exports = OutboxEvent;
