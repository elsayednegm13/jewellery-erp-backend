"use strict";

// Forward-only canonical Master Data storage.  Initial owner-approved values
// are seeded explicitly into the acceptance DB by the controlled service, not
// into the persistent DB by this migration.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("pearl_size_master_data", {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      value: { type: Sequelize.DECIMAL(20, 8), allowNull: false },
      display_value: { type: Sequelize.STRING(32), allowNull: false },
      unit: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "MM" },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      is_owner_approved_initial: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_by: { type: Sequelize.STRING, allowNull: true },
      updated_by: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });
    await queryInterface.addConstraint("pearl_size_master_data", { fields: ["company_id", "value", "unit"], type: "unique", name: "pearl_size_master_data_company_value_unit_uq" });
    await queryInterface.addIndex("pearl_size_master_data", ["company_id", "is_active", "sort_order"], { name: "pearl_size_master_data_company_active_sort_idx" });
  },
  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: Pearl Size Master Data must not be dropped automatically");
  },
};
