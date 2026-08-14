"use strict";

/**
 * GOLD-LIVE-FEED-03: versioned, company-scoped CGP pricing policy foundation.
 * Additive only. No business rows, CGP rows, assets, journals, treasury or
 * market settings are changed by this migration.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("gold_pricing_policies", {
        id: { type: Sequelize.STRING(128), primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        business_context: { type: Sequelize.STRING(64), allowNull: false, defaultValue: "CGP" },
        pricing_mode: { type: Sequelize.STRING(24), allowNull: false },
        scope_type: { type: Sequelize.STRING(16), allowNull: false },
        karat: { type: Sequelize.DECIMAL(8, 3), allowNull: true },
        base_quote_type: { type: Sequelize.STRING(8), allowNull: false },
        adjustment_type: { type: Sequelize.STRING(24), allowNull: false },
        adjustment_value: { type: Sequelize.DECIMAL(20, 8), allowNull: false, defaultValue: "0" },
        version: { type: Sequelize.INTEGER, allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "INACTIVE" },
        effective_from: { type: Sequelize.DATE, allowNull: false },
        effective_until: { type: Sequelize.DATE, allowNull: true },
        created_by: { type: Sequelize.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
        supersedes_policy_id: { type: Sequelize.STRING(128), allowNull: true, references: { model: "gold_pricing_policies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });

      await queryInterface.sequelize.query(`
        ALTER TABLE gold_pricing_policies
        ADD CONSTRAINT gold_pricing_policies_context_ck CHECK (business_context = 'CGP'),
        ADD CONSTRAINT gold_pricing_policies_mode_ck CHECK (pricing_mode IN ('MANUAL_APPROVED','LIVE_PROVIDER')),
        ADD CONSTRAINT gold_pricing_policies_scope_ck CHECK (
          (scope_type = 'DEFAULT' AND karat IS NULL)
          OR (scope_type = 'KARAT' AND karat IN (18,21,22,24))
        ),
        ADD CONSTRAINT gold_pricing_policies_quote_ck CHECK (base_quote_type IN ('BID','SPOT','ASK')),
        ADD CONSTRAINT gold_pricing_policies_adjustment_ck CHECK (adjustment_type IN ('NONE','FIXED_PER_GRAM','PERCENTAGE')),
        ADD CONSTRAINT gold_pricing_policies_none_zero_ck CHECK (adjustment_type <> 'NONE' OR adjustment_value = 0),
        ADD CONSTRAINT gold_pricing_policies_status_ck CHECK (status IN ('ACTIVE','INACTIVE','SUPERSEDED','EXPIRED')),
        ADD CONSTRAINT gold_pricing_policies_window_ck CHECK (effective_until IS NULL OR effective_until > effective_from)
      `, { transaction });

      await queryInterface.addIndex("gold_pricing_policies", ["company_id", "business_context", "scope_type", "karat", "version"], {
        unique: true,
        name: "gold_pricing_policies_scope_version_uq",
        transaction,
      });
      await queryInterface.addIndex("gold_pricing_policies", ["company_id", "business_context", "scope_type", "karat", "status", "effective_from"], {
        name: "gold_pricing_policies_resolution_idx",
        transaction,
      });
      await queryInterface.addIndex("gold_pricing_policies", ["supersedes_policy_id"], {
        name: "gold_pricing_policies_supersedes_idx",
        transaction,
      });

      await queryInterface.sequelize.query(`
        INSERT INTO permissions (id, name, module, action, description, created_at, updated_at)
        VALUES (:id, :name, :module, :action, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (name) DO NOTHING
      `, {
        replacements: {
          id: "PERM-gold.manage_pricing_policy",
          name: "gold.manage_pricing_policy",
          module: "gold",
          action: "manage_pricing_policy",
          description: "Create and activate versioned CGP pricing policies",
        },
        transaction,
      });
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: CGP pricing policy history must not be rolled back automatically");
  },
};
