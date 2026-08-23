"use strict";

// CGP-IMP-09A: generic configuration/evidence only.  This migration creates
// no policy, approval request, payment, journal, treasury, liability, Asset,
// Gold Center, CRM, or CGP business row.
const APPROVAL_REQUEST_FINANCIAL_TYPE = "financial-operation";

async function tableExists(queryInterface, table) {
  try { await queryInterface.describeTable(table); return true; } catch { return false; }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, "financial_approval_policies"))) {
      await queryInterface.createTable("financial_approval_policies", {
        id: { type: Sequelize.STRING, primaryKey: true },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        operation_type: { type: Sequelize.STRING(64), allowNull: false },
        branch_id: { type: Sequelize.STRING, allowNull: true, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        currency: { type: Sequelize.STRING(3), allowNull: true },
        payment_method: { type: Sequelize.STRING(32), allowNull: true },
        min_amount: { type: Sequelize.DECIMAL(20, 4), allowNull: true },
        max_amount: { type: Sequelize.DECIMAL(20, 4), allowNull: true },
        approval_required: { type: Sequelize.BOOLEAN, allowNull: false },
        priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        effective_from: { type: Sequelize.DATE, allowNull: true },
        effective_to: { type: Sequelize.DATE, allowNull: true },
        version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        deactivated_at: { type: Sequelize.DATE, allowNull: true },
        deactivated_by: { type: Sequelize.STRING, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
      await queryInterface.sequelize.query("ALTER TABLE financial_approval_policies ADD CONSTRAINT financial_approval_policy_amount_range_ck CHECK ((min_amount IS NULL OR min_amount >= 0) AND (max_amount IS NULL OR max_amount >= 0) AND (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount))");
      await queryInterface.sequelize.query("ALTER TABLE financial_approval_policies ADD CONSTRAINT financial_approval_policy_priority_ck CHECK (priority >= 0)");
      await queryInterface.sequelize.query("ALTER TABLE financial_approval_policies ADD CONSTRAINT financial_approval_policy_effective_window_ck CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from < effective_to)");
      await queryInterface.addIndex("financial_approval_policies", ["company_id", "operation_type", "is_active"], { name: "financial_approval_policy_scope_active_idx" });
      await queryInterface.addIndex("financial_approval_policies", ["company_id", "branch_id", "currency", "payment_method"], { name: "financial_approval_policy_context_idx" });
    }

    await queryInterface.sequelize.query("ALTER TYPE enum_approval_requests_type ADD VALUE IF NOT EXISTS 'financial-operation'");
    const requestColumns = await queryInterface.describeTable("approval_requests");
    const additions = {
      policy_id: { type: Sequelize.STRING, allowNull: true, references: { model: "financial_approval_policies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      operation_type: { type: Sequelize.STRING(64), allowNull: true },
      subject_type: { type: Sequelize.STRING(64), allowNull: true },
      subject_id: { type: Sequelize.STRING, allowNull: true },
      branch_id: { type: Sequelize.STRING, allowNull: true, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      currency: { type: Sequelize.STRING(3), allowNull: true },
      payment_method: { type: Sequelize.STRING(32), allowNull: true },
      idempotency_key: { type: Sequelize.STRING(191), allowNull: true },
      request_context_snapshot: { type: Sequelize.JSONB, allowNull: true },
      policy_decision_snapshot: { type: Sequelize.JSONB, allowNull: true },
    };
    for (const [column, definition] of Object.entries(additions)) if (!requestColumns[column]) await queryInterface.addColumn("approval_requests", column, definition);
    await queryInterface.addIndex("approval_requests", ["company_id", "operation_type", "status", "requested_at"], { name: "approval_requests_financial_queue_idx" });
    await queryInterface.addIndex("approval_requests", ["company_id", "operation_type", "subject_type", "subject_id", "idempotency_key"], { unique: true, where: { type: APPROVAL_REQUEST_FINANCIAL_TYPE, idempotency_key: { [Sequelize.Op.ne]: null } }, name: "approval_requests_financial_idempotency_uq" });
  },

  async down(queryInterface) {
    // PostgreSQL enum labels are append-only.  Refuse reversal if the generic
    // financial evidence has been used rather than erasing audited history.
    const [[used]] = await queryInterface.sequelize.query("SELECT count(*)::int AS count FROM approval_requests WHERE type = 'financial-operation'");
    const [[policies]] = await queryInterface.sequelize.query("SELECT count(*)::int AS count FROM financial_approval_policies");
    if (Number(used.count) || Number(policies.count)) throw new Error("Cannot remove financial approval policy foundation after policy or request evidence exists");
    await queryInterface.removeIndex("approval_requests", "approval_requests_financial_idempotency_uq");
    await queryInterface.removeIndex("approval_requests", "approval_requests_financial_queue_idx");
    for (const column of ["policy_decision_snapshot", "request_context_snapshot", "idempotency_key", "payment_method", "currency", "branch_id", "subject_id", "subject_type", "operation_type", "policy_id"]) await queryInterface.removeColumn("approval_requests", column);
    await queryInterface.dropTable("financial_approval_policies");
  },
};
