"use strict";

const { DataTypes } = require("sequelize");

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [duplicates] = await queryInterface.sequelize.query(`
        SELECT branch_id, COUNT(*)::int AS count
        FROM users
        WHERE account_type = 'branch_shell'
          AND deleted_at IS NULL
          AND branch_id IS NOT NULL
        GROUP BY branch_id
        HAVING COUNT(*) > 1
      `, { transaction });

      if (duplicates.length) {
        throw new Error(`BRANCH_ACCOUNT_DUPLICATES_EXIST: ${JSON.stringify(duplicates)}`);
      }

      await queryInterface.addColumn("users", "is_active", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      }, { transaction });

      await queryInterface.addIndex("users", ["is_active"], {
        name: "users_is_active_idx",
        transaction
      });

      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX users_branch_shell_one_per_branch_uq
        ON users(branch_id)
        WHERE account_type = 'branch_shell'
          AND deleted_at IS NULL
          AND branch_id IS NOT NULL
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query("DROP INDEX IF EXISTS users_branch_shell_one_per_branch_uq", { transaction });
      await queryInterface.removeIndex("users", "users_is_active_idx", { transaction });
      await queryInterface.removeColumn("users", "is_active", { transaction });
    });
  }
};
