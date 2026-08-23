"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("inventory_master_data_bootstrap_states", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        dataset_id: { type: Sequelize.STRING(96), allowNull: false },
        current_version: { type: Sequelize.INTEGER, allowNull: false },
        manifest_hash: { type: Sequelize.STRING(128), allowNull: false },
        state: { type: Sequelize.STRING(24), allowNull: false },
        last_report: { type: Sequelize.JSONB, allowNull: true },
        last_error_code: { type: Sequelize.STRING(120), allowNull: true },
        started_at: { type: Sequelize.DATE, allowNull: true },
        completed_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addConstraint("inventory_master_data_bootstrap_states", {
        fields: ["company_id", "dataset_id"],
        type: "unique",
        name: "inventory_master_data_bootstrap_scope_uq",
        transaction,
      });
      await queryInterface.addIndex("inventory_master_data_bootstrap_states", ["company_id", "state"], { name: "inventory_master_data_bootstrap_company_state_idx", transaction });
    });
  },
  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: inventory bootstrap state is permanent reconciliation evidence");
  },
};
