"use strict";

const { DataTypes } = require("sequelize");

const OUTBOX_TABLE = "outbox_events";
const PROCESSED_TABLE = "processed_events";
const OUTBOX_STATUS_CONSTRAINT = "outbox_events_status_ck";
const PROCESSED_STATUS_CONSTRAINT = "processed_events_status_ck";

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable(OUTBOX_TABLE, {
      id: { type: DataTypes.STRING, primaryKey: true },
      event_id: { type: DataTypes.STRING(128), allowNull: false },
      event_type: { type: DataTypes.STRING(128), allowNull: false },
      event_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      aggregate_type: { type: DataTypes.STRING(128), allowNull: false },
      aggregate_id: { type: DataTypes.STRING(128), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
      occurred_at: { type: DataTypes.DATE, allowNull: false },
      available_at: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "PENDING" },
      attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      claimed_at: { type: DataTypes.DATE, allowNull: true },
      claimed_by: { type: DataTypes.STRING(128), allowNull: true },
      published_at: { type: DataTypes.DATE, allowNull: true },
      correlation_id: { type: DataTypes.STRING(128), allowNull: false },
      causation_id: { type: DataTypes.STRING(128), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.sequelize.query(`ALTER TABLE ${OUTBOX_TABLE} ADD CONSTRAINT ${OUTBOX_STATUS_CONSTRAINT} CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'RETRYABLE_FAILED'))`);
    await queryInterface.addIndex(OUTBOX_TABLE, ["event_id"], { unique: true, name: "outbox_events_event_id_uq" });
    await queryInterface.addIndex(OUTBOX_TABLE, ["status", "available_at"], { name: "outbox_events_dispatch_idx" });
    await queryInterface.addIndex(OUTBOX_TABLE, ["aggregate_type", "aggregate_id"], { name: "outbox_events_aggregate_idx" });

    await queryInterface.createTable(PROCESSED_TABLE, {
      id: { type: DataTypes.STRING, primaryKey: true },
      consumer_name: { type: DataTypes.STRING(64), allowNull: false },
      event_id: { type: DataTypes.STRING(128), allowNull: false },
      event_type: { type: DataTypes.STRING(128), allowNull: false },
      event_version: { type: DataTypes.INTEGER, allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "SUCCEEDED" },
      correlation_id: { type: DataTypes.STRING(128), allowNull: false },
      processed_at: { type: DataTypes.DATE, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.sequelize.query(`ALTER TABLE ${PROCESSED_TABLE} ADD CONSTRAINT ${PROCESSED_STATUS_CONSTRAINT} CHECK (status = 'SUCCEEDED')`);
    await queryInterface.addIndex(PROCESSED_TABLE, ["consumer_name", "event_id"], { unique: true, name: "processed_events_consumer_event_uq" });
  },

  async down(queryInterface) {
    const [outboxRows] = await queryInterface.sequelize.query(`SELECT count(*)::int AS count FROM ${OUTBOX_TABLE}`);
    const [processedRows] = await queryInterface.sequelize.query(`SELECT count(*)::int AS count FROM ${PROCESSED_TABLE}`);
    if (Number(outboxRows?.[0]?.count || 0) || Number(processedRows?.[0]?.count || 0)) {
      throw new Error("CGP-M3 rollback is unsafe after durable event records exist");
    }
    await queryInterface.dropTable(PROCESSED_TABLE);
    await queryInterface.dropTable(OUTBOX_TABLE);
  },
};
