const { DataTypes } = require("sequelize");

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("cash_transactions", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      type: {
        type: DataTypes.ENUM("cash_in", "cash_out", "transfer", "closing"),
        allowNull: false,
        defaultValue: "cash_in"
      },
      account: { type: DataTypes.STRING, allowNull: false, defaultValue: "cash" },
      to_account: { type: DataTypes.STRING },
      amount: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      category: { type: DataTypes.STRING },
      counter_account_code: { type: DataTypes.STRING },
      description: { type: DataTypes.STRING },
      reference: { type: DataTypes.STRING },
      branch: { type: DataTypes.STRING, allowNull: false, defaultValue: "Main Branch" },
      date: { type: DataTypes.STRING, allowNull: false },
      created_by: { type: DataTypes.STRING },
      status: {
        type: DataTypes.ENUM("posted", "draft", "approved"),
        defaultValue: "posted"
      },
      opening_balance: { type: DataTypes.DECIMAL(15, 4) },
      expected_balance: { type: DataTypes.DECIMAL(15, 4) },
      actual_balance: { type: DataTypes.DECIMAL(15, 4) },
      variance: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
      journal_entry_id: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.addIndex("cash_transactions", ["company_id"]);
    await queryInterface.addIndex("cash_transactions", ["type"]);
    await queryInterface.addIndex("cash_transactions", ["date"]);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("cash_transactions");
    // Clean up the ENUM types created by Postgres for this table.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_cash_transactions_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_cash_transactions_status";');
  }
};
