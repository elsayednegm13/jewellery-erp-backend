"use strict";

const { DataTypes } = require("sequelize");

const TABLE = "gold_core_events";
const SOURCE_EVENT_INDEX = "gold_core_events_source_event_uq";

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable(TABLE, {
      id: { type: DataTypes.STRING, primaryKey: true },
      event_type: { type: DataTypes.STRING(128), allowNull: false },
      event_version: { type: DataTypes.INTEGER, allowNull: false },
      source_event_id: { type: DataTypes.STRING(128), allowNull: false, references: { model: "outbox_events", key: "event_id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      source_event_type: { type: DataTypes.STRING(128), allowNull: false },
      source_event_version: { type: DataTypes.INTEGER, allowNull: false },
      source_document_id: { type: DataTypes.STRING, allowNull: false, references: { model: "customer_gold_purchase_documents", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      source_document_number: { type: DataTypes.STRING(128), allowNull: false },
      posting_reference: { type: DataTypes.STRING(128), allowNull: false },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      branch_id: { type: DataTypes.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      source_party_type: { type: DataTypes.STRING(32), allowNull: false },
      source_party_id: { type: DataTypes.STRING, allowNull: false, references: { model: "customers", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      currency: { type: DataTypes.STRING(3), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
      occurred_at: { type: DataTypes.DATE, allowNull: false },
      correlation_id: { type: DataTypes.STRING(128), allowNull: false },
      causation_id: { type: DataTypes.STRING(128), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT gold_core_events_type_ck CHECK (event_type = 'CUSTOMER_GOLD_ACQUISITION_RECORDED' AND event_version = 1)`);
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT gold_core_events_source_type_ck CHECK (source_event_type = 'CustomerGoldPurchasePostedEvent' AND source_event_version = 1)`);
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT gold_core_events_source_party_ck CHECK (source_party_type = 'CUSTOMER')`);
    await queryInterface.addIndex(TABLE, ["source_event_id"], { unique: true, name: SOURCE_EVENT_INDEX });
    await queryInterface.addIndex(TABLE, ["company_id", "branch_id", "occurred_at"], { name: "gold_core_events_scope_occurred_idx" });
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(`SELECT count(*)::int AS count FROM ${TABLE}`);
    if (Number(rows?.[0]?.count || 0) > 0) throw new Error("CGP-IMP-06 rollback is unsafe after Gold Center core facts exist");
    await queryInterface.dropTable(TABLE);
  },
};
