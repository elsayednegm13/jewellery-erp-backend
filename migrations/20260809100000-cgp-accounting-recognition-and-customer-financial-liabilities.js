"use strict";

const { DataTypes } = require("sequelize");

const LIABILITY_TABLE = "customer_financial_liabilities";
const JOURNAL_SOURCE_TYPE = "CUSTOMER_GOLD_PURCHASE_ACCOUNTING_RECOGNITION";
const LIABILITY_EVENT_INDEX = "customer_financial_liabilities_source_event_uq";
const JOURNAL_SOURCE_INDEX = "journal_entries_cgp_accounting_event_uq";

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable(LIABILITY_TABLE, {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      branch_id: { type: DataTypes.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      customer_id: { type: DataTypes.STRING, allowNull: false, references: { model: "customers", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      source_type: { type: DataTypes.STRING(96), allowNull: false },
      source_document_id: { type: DataTypes.STRING, allowNull: false, references: { model: "customer_gold_purchase_documents", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      source_event_id: { type: DataTypes.STRING(128), allowNull: false, references: { model: "outbox_events", key: "event_id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      journal_entry_id: { type: DataTypes.STRING, allowNull: false, references: { model: "journal_entries", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      currency: { type: DataTypes.STRING(3), allowNull: false },
      original_amount: { type: DataTypes.DECIMAL(20, 4), allowNull: false },
      outstanding_amount: { type: DataTypes.DECIMAL(20, 4), allowNull: false },
      settled_amount: { type: DataTypes.DECIMAL(20, 4), allowNull: false, defaultValue: "0.0000" },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "OPEN" },
      recognized_at: { type: DataTypes.DATE, allowNull: false },
      correlation_id: { type: DataTypes.STRING(128), allowNull: false },
      causation_id: { type: DataTypes.STRING(128), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.sequelize.query(`ALTER TABLE ${LIABILITY_TABLE} ADD CONSTRAINT customer_financial_liabilities_amounts_ck CHECK (original_amount > 0 AND outstanding_amount >= 0 AND settled_amount >= 0 AND outstanding_amount + settled_amount = original_amount)`);
    await queryInterface.sequelize.query(`ALTER TABLE ${LIABILITY_TABLE} ADD CONSTRAINT customer_financial_liabilities_status_ck CHECK (status IN ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'REVERSED'))`);
    await queryInterface.addIndex(LIABILITY_TABLE, ["source_event_id"], { unique: true, name: LIABILITY_EVENT_INDEX });
    await queryInterface.addIndex(LIABILITY_TABLE, ["company_id", "customer_id", "status"], { name: "customer_financial_liabilities_customer_status_idx" });
    await queryInterface.addIndex("journal_entries", ["company_id", "source_type", "source_id"], {
      unique: true,
      where: { source_type: JOURNAL_SOURCE_TYPE },
      name: JOURNAL_SOURCE_INDEX,
    });
  },

  async down(queryInterface, Sequelize) {
    const [liabilityRows] = await queryInterface.sequelize.query(`SELECT count(*)::int AS count FROM ${LIABILITY_TABLE}`);
    const [journalRows] = await queryInterface.sequelize.query(
      "SELECT count(*)::int AS count FROM journal_entries WHERE source_type=:sourceType",
      { replacements: { sourceType: JOURNAL_SOURCE_TYPE }, type: Sequelize.QueryTypes.SELECT },
    );
    if (Number(liabilityRows?.count || liabilityRows?.[0]?.count || 0) || Number(journalRows?.count || journalRows?.[0]?.count || 0)) {
      throw new Error("CGP-IMP-05 rollback is unsafe after accounting recognition facts exist");
    }
    await queryInterface.removeIndex("journal_entries", JOURNAL_SOURCE_INDEX);
    await queryInterface.dropTable(LIABILITY_TABLE);
  },
};
