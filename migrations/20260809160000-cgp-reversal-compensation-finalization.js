"use strict";

// Forward-only CGP-IMP-10 evidence.  This does not alter original posting,
// settlement, Gold, or Asset history; it records additive compensation facts.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn("cgp_reversal_requests", "compensation_event_id", { type: Sequelize.STRING(128), allowNull: true, references: { model: "outbox_events", key: "event_id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" }, { transaction });
      await queryInterface.addColumn("cgp_reversal_requests", "completed_at", { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("cgp_reversal_requests", "completed_by", { type: Sequelize.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" }, { transaction });
      await queryInterface.createTable("cgp_reversal_compensations", {
        id: { type: Sequelize.STRING, primaryKey: true },
        reversal_request_id: { type: Sequelize.STRING, allowNull: false, references: { model: "cgp_reversal_requests", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        domain: { type: Sequelize.STRING(32), allowNull: false },
        compensation_event_id: { type: Sequelize.STRING(128), allowNull: false, references: { model: "outbox_events", key: "event_id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        journal_entry_id: { type: Sequelize.STRING, allowNull: true, references: { model: "journal_entries", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        gold_core_event_id: { type: Sequelize.STRING, allowNull: true, references: { model: "gold_core_events", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        amount: { type: Sequelize.DECIMAL(20, 4), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "SUCCEEDED" },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.sequelize.query("ALTER TABLE cgp_reversal_compensations ADD CONSTRAINT cgp_reversal_compensations_domain_ck CHECK (domain IN ('ACCOUNTING','GOLD_CENTER'))", { transaction });
      await queryInterface.sequelize.query("ALTER TABLE cgp_reversal_compensations ADD CONSTRAINT cgp_reversal_compensations_status_ck CHECK (status='SUCCEEDED')", { transaction });
      await queryInterface.addIndex("cgp_reversal_compensations", ["reversal_request_id", "domain"], { unique: true, name: "cgp_reversal_compensations_request_domain_uq", transaction });
      await queryInterface.addIndex("cgp_reversal_compensations", ["compensation_event_id", "domain"], { unique: true, name: "cgp_reversal_compensations_event_domain_uq", transaction });
      await queryInterface.removeConstraint("gold_core_events", "gold_core_events_type_ck", { transaction });
      await queryInterface.removeConstraint("gold_core_events", "gold_core_events_source_type_ck", { transaction });
      await queryInterface.sequelize.query("ALTER TABLE gold_core_events ADD CONSTRAINT gold_core_events_type_ck CHECK ((event_type='CUSTOMER_GOLD_ACQUISITION_RECORDED' AND event_version=1) OR (event_type='CUSTOMER_GOLD_ACQUISITION_REVERSED' AND event_version=1))", { transaction });
      await queryInterface.sequelize.query("ALTER TABLE gold_core_events ADD CONSTRAINT gold_core_events_source_type_ck CHECK ((source_event_type='CustomerGoldPurchasePostedEvent' AND source_event_version=1) OR (source_event_type='CustomerGoldPurchaseReversalRequestedEvent' AND source_event_version=1))", { transaction });
      // This constraint originates in CGP-IMP-01.  Keep the exact original
      // name so this forward-only migration cannot silently target another
      // constraint in a future environment.
      await queryInterface.removeConstraint("customer_gold_purchase_documents", "cgp_documents_business_status_ck", { transaction });
      await queryInterface.sequelize.query("ALTER TABLE customer_gold_purchase_documents ADD CONSTRAINT cgp_documents_business_status_ck CHECK (business_status IN ('DRAFT','VALIDATED','POSTED','REVERSED'))", { transaction });
    });
  },
  async down() { throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: CGP reversal compensation evidence must not be removed"); },
};
