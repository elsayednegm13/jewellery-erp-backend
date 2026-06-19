const { DataTypes } = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    // 1. Extend the invoices.type enum with the new invoice types.
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_invoices_type" ADD VALUE IF NOT EXISTS 'installment';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_invoices_type" ADD VALUE IF NOT EXISTS 'giftVoucher';`
    );

    // 2. Installments schedule table.
    await queryInterface.createTable("installments", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      invoice_id: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING },
      customer_name: { type: DataTypes.STRING },
      sequence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      due_date: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      paid_amount: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      status: {
        type: DataTypes.ENUM("pending", "paid", "overdue", "partial"),
        defaultValue: "pending"
      },
      paid_date: { type: DataTypes.STRING },
      branch: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("installments", ["company_id"]);
    await queryInterface.addIndex("installments", ["invoice_id"]);

    // 3. Gift vouchers table.
    await queryInterface.createTable("gift_vouchers", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      code: { type: DataTypes.STRING, allowNull: false },
      value: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      balance: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      customer_id: { type: DataTypes.STRING },
      customer_name: { type: DataTypes.STRING },
      status: {
        type: DataTypes.ENUM("active", "redeemed", "expired"),
        defaultValue: "active"
      },
      issue_date: { type: DataTypes.STRING, allowNull: false },
      expiry_date: { type: DataTypes.STRING },
      payment_method: { type: DataTypes.STRING },
      branch: { type: DataTypes.STRING },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("gift_vouchers", ["company_id"]);
    await queryInterface.addIndex("gift_vouchers", ["code"]);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("installments");
    await queryInterface.dropTable("gift_vouchers");
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_installments_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_gift_vouchers_status";');
    // Note: enum values added to enum_invoices_type are intentionally left in place
    // (Postgres cannot easily remove enum values).
  }
};
