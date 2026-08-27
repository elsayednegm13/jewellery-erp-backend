"use strict";

// CGP-IMP-10A is a non-financial operational hold foundation.  It never
// creates a reversal journal, Treasury record, Gold event, CRM entry, or
// business REVERSED outcome.
const TABLE = "cgp_reversal_requests";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query("ALTER TYPE enum_assets_status ADD VALUE IF NOT EXISTS 'reversal_pending'", { transaction });
      await queryInterface.sequelize.query("ALTER TYPE enum_assets_status ADD VALUE IF NOT EXISTS 'reversed'", { transaction });
      await queryInterface.removeConstraint("assets", "assets_operational_status_ck", { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE assets ADD CONSTRAINT assets_operational_status_ck CHECK (
        operational_status IN ('AVAILABLE','PENDING_INTEGRATION','RESERVED','PENDING_TRANSFER','WORKSHOP','RETURNED','MISSING','MELTED','SOLD','REVERSAL_PENDING','REVERSED')
      )`, { transaction });
      await queryInterface.createTable(TABLE, {
        id: { type: Sequelize.STRING, primaryKey: true },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        cgp_document_id: { type: Sequelize.STRING, allowNull: false, references: { model: "customer_gold_purchase_documents", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        posted_event_id: { type: Sequelize.STRING(128), allowNull: false, references: { model: "outbox_events", key: "event_id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "REQUESTED" },
        reason: { type: Sequelize.TEXT, allowNull: false },
        idempotency_key: { type: Sequelize.STRING(191), allowNull: false },
        request_hash: { type: Sequelize.STRING(64), allowNull: false },
        correlation_id: { type: Sequelize.STRING(128), allowNull: false },
        causation_id: { type: Sequelize.STRING(128), allowNull: true },
        requested_by: { type: Sequelize.STRING, allowNull: false, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        requested_at: { type: Sequelize.DATE, allowNull: false },
        held_at: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT cgp_reversal_requests_status_ck CHECK (status IN ('REQUESTED','HOLD_PENDING','HELD','COMPENSATING','COMPLETED'))`, { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT cgp_reversal_requests_reason_ck CHECK (length(trim(reason)) > 0)`, { transaction });
      await queryInterface.addIndex(TABLE, ["company_id", "idempotency_key"], { unique: true, name: "cgp_reversal_requests_idempotency_uq", transaction });
      await queryInterface.sequelize.query(`CREATE UNIQUE INDEX cgp_reversal_requests_active_document_uq ON ${TABLE} (cgp_document_id) WHERE status IN ('REQUESTED','HOLD_PENDING','HELD','COMPENSATING')`, { transaction });
    });
  },
  async down() { throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: CGP reversal hold evidence must not be deleted"); },
};
