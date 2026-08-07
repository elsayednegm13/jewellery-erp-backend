"use strict";

const PERMISSION = "inventory.returns.approve_restock";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("asset_return_reviews", {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT" },
      return_invoice_id: { type: Sequelize.STRING, allowNull: false, references: { model: "invoices", key: "id" }, onDelete: "RESTRICT" },
      company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT" },
      branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT" },
      condition_outcome: { type: Sequelize.STRING(32), allowNull: false },
      note: { type: Sequelize.TEXT, allowNull: true },
      reviewed_by: { type: Sequelize.STRING, allowNull: false },
      reviewed_at: { type: Sequelize.DATE, allowNull: false },
      approved_by: { type: Sequelize.STRING, allowNull: true },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addConstraint("asset_return_reviews", { fields: ["asset_id", "return_invoice_id"], type: "unique", name: "asset_return_reviews_asset_return_unique" });
    await queryInterface.addIndex("asset_return_reviews", ["company_id", "branch_id", "asset_id"], { name: "asset_return_reviews_scope_asset_idx" });
    await queryInterface.sequelize.query(`INSERT INTO permissions (id,name,module,action,description,created_at,updated_at)
      VALUES (:id,:name,'inventory.returns','approve_restock',:description,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT (name) DO NOTHING`, { replacements: { id: `PERM-${PERMISSION}`, name: PERMISSION, description: "Approve returned Asset restock after GOOD condition review" } });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("asset_return_reviews", "asset_return_reviews_scope_asset_idx");
    await queryInterface.removeConstraint("asset_return_reviews", "asset_return_reviews_asset_return_unique");
    await queryInterface.dropTable("asset_return_reviews");
  },
};
