"use strict";

// BRANCH-1: preserve legacy company-level mappings for explicit review while
// enabling exactly one protected mapping per company/branch/role. No account,
// journal, balance, or business data is created by this migration.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("accounts", "branch_id", {
      type: Sequelize.STRING,
      allowNull: true,
      references: { model: "branches", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.addIndex("accounts", ["company_id", "branch_id"], {
      name: "accounts_company_branch_idx",
    });

    await queryInterface.addColumn("system_account_roles", "branch_id", {
      type: Sequelize.STRING,
      allowNull: true,
      references: { model: "branches", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.removeIndex("system_account_roles", "system_account_roles_company_role_uq");
    await queryInterface.addIndex("system_account_roles", ["company_id", "branch_id", "role_code"], {
      name: "system_account_roles_company_branch_role_uq",
      unique: true,
      where: { branch_id: { [Sequelize.Op.ne]: null } },
    });
    await queryInterface.addIndex("system_account_roles", ["company_id", "role_code"], {
      name: "system_account_roles_company_legacy_role_uq",
      unique: true,
      where: { branch_id: null },
    });
    await queryInterface.addIndex("system_account_roles", ["company_id", "branch_id", "account_id"], {
      name: "system_account_roles_company_branch_account_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("system_account_roles", "system_account_roles_company_branch_account_idx");
    await queryInterface.removeIndex("system_account_roles", "system_account_roles_company_legacy_role_uq");
    await queryInterface.removeIndex("system_account_roles", "system_account_roles_company_branch_role_uq");
    await queryInterface.addIndex("system_account_roles", ["company_id", "role_code"], {
      name: "system_account_roles_company_role_uq",
      unique: true,
    });
    await queryInterface.removeColumn("system_account_roles", "branch_id");
    await queryInterface.removeIndex("accounts", "accounts_company_branch_idx");
    await queryInterface.removeColumn("accounts", "branch_id");
  },
};
