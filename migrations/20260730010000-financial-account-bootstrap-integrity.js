"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn("accounts", "is_posting", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      }, { transaction });
      await queryInterface.addColumn("accounts", "statement_classification", {
        type: Sequelize.STRING,
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn("accounts", "bootstrap_version", {
        type: Sequelize.INTEGER,
        allowNull: true,
      }, { transaction });
      await queryInterface.sequelize.query(`
        UPDATE accounts
        SET statement_classification = CASE
          WHEN code = '5000' OR code LIKE '50%' THEN 'cost_of_goods_sold'
          WHEN code IN ('4200', '4900') THEN 'other_income'
          WHEN type = 'asset' THEN 'asset'
          WHEN type = 'liability' THEN 'liability'
          WHEN type = 'equity' THEN 'equity'
          WHEN type = 'revenue' THEN 'revenue'
          WHEN type = 'expense' THEN 'operating_expense'
          ELSE NULL
        END,
        bootstrap_version = 1
      `, { transaction });
      await queryInterface.sequelize.query(`
        UPDATE accounts parent
        SET is_posting = FALSE
        WHERE EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = parent.id)
      `, { transaction });
      await queryInterface.addIndex("accounts", ["company_id", "code"], {
        name: "accounts_company_code_unique",
        unique: true,
        transaction,
      });
      await queryInterface.addConstraint("accounts", {
        fields: ["parent_id"],
        type: "foreign key",
        name: "accounts_parent_id_fk",
        references: { table: "accounts", field: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
        transaction,
      });
      await queryInterface.addIndex("journal_entries", ["company_id", "source_type", "source_id"], {
        name: "journal_entries_company_source_unique",
        unique: true,
        where: {
          source_type: { [Sequelize.Op.ne]: null },
          source_id: { [Sequelize.Op.ne]: null },
        },
        transaction,
      });
      await queryInterface.sequelize.query(`
        ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS journal_lines_account_id_fkey;
        ALTER TABLE journal_lines
          ADD CONSTRAINT journal_lines_account_id_fkey
          FOREIGN KEY (account_id) REFERENCES accounts(id)
          ON UPDATE CASCADE ON DELETE RESTRICT;
      `, { transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS journal_lines_account_id_fkey;
        ALTER TABLE journal_lines
          ADD CONSTRAINT journal_lines_account_id_fkey
          FOREIGN KEY (account_id) REFERENCES accounts(id)
          ON UPDATE CASCADE ON DELETE CASCADE;
      `, { transaction });
      await queryInterface.removeIndex("journal_entries", "journal_entries_company_source_unique", { transaction });
      await queryInterface.removeConstraint("accounts", "accounts_parent_id_fk", { transaction });
      await queryInterface.removeIndex("accounts", "accounts_company_code_unique", { transaction });
      await queryInterface.removeColumn("accounts", "bootstrap_version", { transaction });
      await queryInterface.removeColumn("accounts", "statement_classification", { transaction });
      await queryInterface.removeColumn("accounts", "is_posting", { transaction });
    });
  },
};
