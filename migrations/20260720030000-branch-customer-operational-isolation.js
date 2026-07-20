"use strict";

// BRANCH-1: Customer remains a company identity. BranchCustomer owns the
// operational relationship and its branch-local balance/loyalty aggregates.
// Historical customers are deliberately not guessed or copied to branches.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("branch_customers", {
      id: { type: Sequelize.STRING, primaryKey: true },
      company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      customer_id: { type: Sequelize.STRING, allowNull: false, references: { model: "customers", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      balance: { type: Sequelize.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      purchases: { type: Sequelize.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      loyalty_points: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("branch_customers", ["company_id", "branch_id", "customer_id"], {
      name: "branch_customers_company_branch_customer_uq",
      unique: true,
    });
    await queryInterface.addIndex("branch_customers", ["company_id", "customer_id"], {
      name: "branch_customers_company_customer_idx",
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("branch_customers");
  },
};
