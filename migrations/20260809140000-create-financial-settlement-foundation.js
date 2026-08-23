"use strict";

// CGP-IMP-09: generic Accounting/Treasury settlement foundation.  No policy,
// payment, journal, Treasury, liability, Asset, Gold Center, CRM, or CGP row
// is seeded or transformed by this migration.
const SETTLEMENTS = "financial_settlements";
const LEGS = "financial_settlement_legs";
const ALLOCATIONS = "financial_settlement_allocations";

module.exports = {
  async up(queryInterface, Sequelize) {
    const exists = async (table) => { try { await queryInterface.describeTable(table); return true; } catch { return false; } };
    if (!(await exists(SETTLEMENTS))) {
      await queryInterface.createTable(SETTLEMENTS, {
        id: { type: Sequelize.STRING, primaryKey: true },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        customer_id: { type: Sequelize.STRING, allowNull: false, references: { model: "customers", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        operation_type: { type: Sequelize.STRING(64), allowNull: false },
        source_type: { type: Sequelize.STRING(96), allowNull: false },
        source_document_id: { type: Sequelize.STRING, allowNull: false },
        currency: { type: Sequelize.STRING(3), allowNull: false },
        total_amount: { type: Sequelize.DECIMAL(20, 4), allowNull: false },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "EXECUTED" },
        approval_policy_id: { type: Sequelize.STRING, allowNull: true, references: { model: "financial_approval_policies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        approval_policy_version: { type: Sequelize.INTEGER, allowNull: true },
        approval_decision_snapshot: { type: Sequelize.JSONB, allowNull: false },
        approval_request_id: { type: Sequelize.STRING, allowNull: true, references: { model: "approval_requests", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        journal_entry_id: { type: Sequelize.STRING, allowNull: false, references: { model: "journal_entries", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        idempotency_key: { type: Sequelize.STRING(191), allowNull: false },
        request_hash: { type: Sequelize.STRING(64), allowNull: false },
        correlation_id: { type: Sequelize.STRING(128), allowNull: false },
        causation_id: { type: Sequelize.STRING(128), allowNull: true },
        executed_at: { type: Sequelize.DATE, allowNull: false },
        executed_by: { type: Sequelize.STRING, allowNull: false },
        metadata: { type: Sequelize.JSONB, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
      await queryInterface.sequelize.query(`ALTER TABLE ${SETTLEMENTS} ADD CONSTRAINT financial_settlements_amount_ck CHECK (total_amount > 0)`);
      await queryInterface.sequelize.query(`ALTER TABLE ${SETTLEMENTS} ADD CONSTRAINT financial_settlements_status_ck CHECK (status = 'EXECUTED')`);
      await queryInterface.addIndex(SETTLEMENTS, ["company_id", "operation_type", "idempotency_key"], { unique: true, name: "financial_settlements_idempotency_uq" });
      await queryInterface.addIndex(SETTLEMENTS, ["company_id", "customer_id", "executed_at"], { name: "financial_settlements_customer_idx" });
    }
    if (!(await exists(LEGS))) {
      await queryInterface.createTable(LEGS, {
        id: { type: Sequelize.STRING, primaryKey: true },
        settlement_id: { type: Sequelize.STRING, allowNull: false, references: { model: SETTLEMENTS, key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        method: { type: Sequelize.STRING(32), allowNull: false },
        amount: { type: Sequelize.DECIMAL(20, 4), allowNull: false },
        account_id: { type: Sequelize.STRING, allowNull: false, references: { model: "accounts", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        cash_register_session_id: { type: Sequelize.STRING, allowNull: true, references: { model: "cash_register_sessions", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        bank_reference: { type: Sequelize.STRING(191), allowNull: true },
        cash_transaction_id: { type: Sequelize.STRING, allowNull: true, references: { model: "cash_transactions", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        metadata: { type: Sequelize.JSONB, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
      await queryInterface.sequelize.query(`ALTER TABLE ${LEGS} ADD CONSTRAINT financial_settlement_legs_amount_ck CHECK (amount > 0)`);
      await queryInterface.sequelize.query(`ALTER TABLE ${LEGS} ADD CONSTRAINT financial_settlement_legs_method_ck CHECK (method IN ('CASH', 'BANK_TRANSFER'))`);
      await queryInterface.sequelize.query(`ALTER TABLE ${LEGS} ADD CONSTRAINT financial_settlement_legs_bank_reference_ck CHECK ((method <> 'BANK_TRANSFER') OR (bank_reference IS NOT NULL AND length(trim(bank_reference)) > 0))`);
      await queryInterface.addIndex(LEGS, ["settlement_id"], { name: "financial_settlement_legs_settlement_idx" });
    }
    if (!(await exists(ALLOCATIONS))) {
      await queryInterface.createTable(ALLOCATIONS, {
        id: { type: Sequelize.STRING, primaryKey: true },
        settlement_id: { type: Sequelize.STRING, allowNull: false, references: { model: SETTLEMENTS, key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        customer_financial_liability_id: { type: Sequelize.STRING, allowNull: false, references: { model: "customer_financial_liabilities", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        amount: { type: Sequelize.DECIMAL(20, 4), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
      await queryInterface.sequelize.query(`ALTER TABLE ${ALLOCATIONS} ADD CONSTRAINT financial_settlement_allocations_amount_ck CHECK (amount > 0)`);
      await queryInterface.addIndex(ALLOCATIONS, ["settlement_id", "customer_financial_liability_id"], { unique: true, name: "financial_settlement_allocations_uq" });
      await queryInterface.addIndex(ALLOCATIONS, ["customer_financial_liability_id"], { name: "financial_settlement_allocations_liability_idx" });
    }

    const policyColumns = await queryInterface.describeTable("financial_approval_policies");
    if (!policyColumns.description) await queryInterface.addColumn("financial_approval_policies", "description", { type: Sequelize.TEXT, allowNull: true });
    if (!policyColumns.metadata) await queryInterface.addColumn("financial_approval_policies", "metadata", { type: Sequelize.JSONB, allowNull: true });
  },

  async down(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;
    for (const table of [ALLOCATIONS, LEGS, SETTLEMENTS]) {
      const [[row]] = await q.query(`SELECT count(*)::int AS count FROM ${table}`);
      if (Number(row.count)) throw new Error("Cannot remove financial settlement foundation after durable settlement evidence exists");
    }
    await queryInterface.removeColumn("financial_approval_policies", "metadata");
    await queryInterface.removeColumn("financial_approval_policies", "description");
    await queryInterface.dropTable(ALLOCATIONS);
    await queryInterface.dropTable(LEGS);
    await queryInterface.dropTable(SETTLEMENTS);
  },
};
