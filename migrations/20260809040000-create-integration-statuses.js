"use strict";

const { DataTypes } = require("sequelize");

const TABLE = "integration_statuses";
const STATUS_CONSTRAINT = "integration_statuses_status_ck";

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable(TABLE, {
      id: { type: DataTypes.STRING, primaryKey: true },
      source_event_id: { type: DataTypes.STRING(128), allowNull: false },
      aggregate_type: { type: DataTypes.STRING(128), allowNull: false },
      aggregate_id: { type: DataTypes.STRING(128), allowNull: false },
      consumer_name: { type: DataTypes.STRING(64), allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "PENDING" },
      attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      first_attempt_at: { type: DataTypes.DATE, allowNull: true },
      last_attempt_at: { type: DataTypes.DATE, allowNull: true },
      succeeded_at: { type: DataTypes.DATE, allowNull: true },
      next_retry_at: { type: DataTypes.DATE, allowNull: true },
      correlation_id: { type: DataTypes.STRING(128), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${STATUS_CONSTRAINT} CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRYABLE_FAILED'))`);
    await queryInterface.addIndex(TABLE, ["source_event_id", "consumer_name"], { unique: true, name: "integration_statuses_event_consumer_uq" });
    await queryInterface.addIndex(TABLE, ["aggregate_type", "aggregate_id"], { name: "integration_statuses_aggregate_idx" });
    await queryInterface.addIndex(TABLE, ["status", "next_retry_at"], { name: "integration_statuses_retry_idx" });
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(`SELECT count(*)::int AS count FROM ${TABLE}`);
    if (Number(rows?.[0]?.count || 0) > 0) {
      throw new Error("CGP-M4 rollback is unsafe after integration status records exist");
    }
    await queryInterface.dropTable(TABLE);
  },
};
