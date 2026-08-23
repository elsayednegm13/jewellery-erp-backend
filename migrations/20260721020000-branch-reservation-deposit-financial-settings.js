"use strict";

const { DataTypes } = require("sequelize");

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("branch_financial_mappings", {
        id: { type: DataTypes.STRING, primaryKey: true },
        company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
        branch_id: { type: DataTypes.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        mapping_type: { type: DataTypes.STRING, allowNull: false },
        channel: { type: DataTypes.STRING, allowNull: true },
        account_id: { type: DataTypes.STRING, allowNull: false, references: { model: "accounts", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        created_by: { type: DataTypes.STRING, allowNull: true },
        updated_by: { type: DataTypes.STRING, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: queryInterface.sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: queryInterface.sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.sequelize.query(`CREATE UNIQUE INDEX branch_financial_mapping_active_uq ON branch_financial_mappings(company_id, branch_id, mapping_type, COALESCE(channel, '')) WHERE is_active = true`, { transaction });
      await queryInterface.addIndex("branch_financial_mappings", ["company_id", "branch_id", "mapping_type"], { name: "branch_financial_mapping_scope_idx", transaction });
      await queryInterface.addColumn("reservation_payments", "cash_transaction_id", { type: DataTypes.STRING, allowNull: true, references: { model: "cash_transactions", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" }, { transaction });
      await queryInterface.addColumn("reservation_payments", "cash_register_session_id", { type: DataTypes.STRING, allowNull: true, references: { model: "cash_register_sessions", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" }, { transaction });
      await queryInterface.addColumn("reservation_payment_applications", "idempotency_key", { type: DataTypes.STRING, allowNull: true }, { transaction });
      await queryInterface.sequelize.query("DROP INDEX IF EXISTS reservation_payment_applications_payment_unique", { transaction });
      await queryInterface.sequelize.query("CREATE UNIQUE INDEX reservation_payment_applications_idem_uq ON reservation_payment_applications(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''", { transaction });
      await queryInterface.sequelize.query("DROP INDEX IF EXISTS reservation_refunds_one_executed_unique", { transaction });
      await queryInterface.addIndex("reservation_refunds", ["company_id", "reservation_id", "status"], { name: "reservation_refunds_scope_status_idx", transaction });
    });
  },
  async down(queryInterface) {
    // This forward-only financial migration can contain live configuration and
    // subledger links.  Refusing a destructive down migration is safer than
    // silently deleting accounting evidence or reimposing one-application and
    // one-executed-refund constraints on valid partial history.
    throw new Error("Irreversible financial migration: use a reviewed forward corrective migration instead of destructive rollback.");
  }
};
