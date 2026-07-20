"use strict";

// RESET-1: one additive, company-scoped role mapping.  Existing journal rows
// and account balances are intentionally untouched.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("system_account_roles", {
      id: { type: Sequelize.STRING, primaryKey: true },
      company_id: {
        type: Sequelize.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      role_code: { type: Sequelize.STRING, allowNull: false },
      account_id: {
        type: Sequelize.STRING,
        allowNull: false,
        references: { model: "accounts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      created_by: { type: Sequelize.STRING, allowNull: true },
      updated_by: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("system_account_roles", ["company_id", "role_code"], {
      name: "system_account_roles_company_role_uq",
      unique: true,
    });
    await queryInterface.addIndex("system_account_roles", ["company_id", "account_id"], {
      name: "system_account_roles_company_account_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("system_account_roles");
  },
};
