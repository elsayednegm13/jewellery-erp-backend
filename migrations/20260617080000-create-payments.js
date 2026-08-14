const { DataTypes } = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    const now = new Date();

    // 1. Add columns to invoices
    await queryInterface.addColumn("invoices", "paid_amount", {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0
    });
    await queryInterface.addColumn("invoices", "remaining_amount", {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0
    });

    // 2. Add columns to cash_transactions and journal_entries
    await queryInterface.addColumn("cash_transactions", "branch_id", {
      type: DataTypes.STRING,
      allowNull: true
    });
    await queryInterface.addColumn("journal_entries", "branch_id", {
      type: DataTypes.STRING,
      allowNull: true
    });

    // 3. Create payments table
    await queryInterface.createTable("payments", {
      id: {
        type: DataTypes.STRING,
        primaryKey: true
      },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      branch_id: {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "branches", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      invoice_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "invoices", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      payment_method: {
        type: DataTypes.STRING,
        allowNull: false
      },
      amount: {
        type: DataTypes.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0
      },
      reference: {
        type: DataTypes.STRING
      },
      date: {
        type: DataTypes.STRING,
        allowNull: false
      },
      notes: {
        type: DataTypes.TEXT
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });

    // 4. Backfill existing records
    await queryInterface.sequelize.query(`
      UPDATE invoices
      SET paid_amount = CASE WHEN status = 'paid' THEN total ELSE 0 END,
          remaining_amount = CASE WHEN status = 'paid' THEN 0 ELSE total END
    `);

    await queryInterface.sequelize.query(`
      UPDATE cash_transactions
      SET branch_id = 'BR-WH'
      WHERE branch_id IS NULL
    `);

    await queryInterface.sequelize.query(`
      UPDATE journal_entries
      SET branch_id = 'BR-WH'
      WHERE branch_id IS NULL
    `);
  },

  down: async (queryInterface) => {
    // Drop table
    await queryInterface.dropTable("payments");

    // Remove columns
    await queryInterface.removeColumn("journal_entries", "branch_id");
    await queryInterface.removeColumn("cash_transactions", "branch_id");
    await queryInterface.removeColumn("invoices", "remaining_amount");
    await queryInterface.removeColumn("invoices", "paid_amount");
  }
};
