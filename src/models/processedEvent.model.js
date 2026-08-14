const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const { AppError } = require("../utils/errors");

function immutableReceiptError() {
  throw new AppError("Processed event receipts are immutable", 409, "PROCESSED_EVENT_IMMUTABLE");
}

const ProcessedEvent = sequelize.define("ProcessedEvent", {
  id: { type: DataTypes.STRING, primaryKey: true },
  consumerName: { type: DataTypes.STRING(64), allowNull: false, field: "consumer_name" },
  eventId: { type: DataTypes.STRING(128), allowNull: false, field: "event_id" },
  eventType: { type: DataTypes.STRING(128), allowNull: false, field: "event_type" },
  eventVersion: { type: DataTypes.INTEGER, allowNull: false, field: "event_version" },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "SUCCEEDED" },
  correlationId: { type: DataTypes.STRING(128), allowNull: false, field: "correlation_id" },
  processedAt: { type: DataTypes.DATE, allowNull: false, field: "processed_at" },
}, {
  tableName: "processed_events",
  timestamps: true,
  underscored: true,
  hooks: {
    beforeUpdate: immutableReceiptError,
    beforeDestroy: immutableReceiptError,
    beforeBulkUpdate: immutableReceiptError,
    beforeBulkDestroy: immutableReceiptError,
  },
});

module.exports = ProcessedEvent;
