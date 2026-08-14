const { DataTypes } = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    // 1. Employee salary fields.
    await queryInterface.addColumn("employees", "base_salary", {
      type: DataTypes.DECIMAL(15, 4), defaultValue: 0
    });
    await queryInterface.addColumn("employees", "allowances", {
      type: DataTypes.DECIMAL(15, 4), defaultValue: 0
    });

    // 2. Loyalty transactions ledger.
    await queryInterface.createTable("loyalty_transactions", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING, allowNull: false,
        references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      customer_id: { type: DataTypes.STRING, allowNull: false },
      customer_name: { type: DataTypes.STRING },
      type: { type: DataTypes.ENUM("earn", "redeem", "adjust"), allowNull: false },
      points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      value: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
      balance_after: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      invoice_id: { type: DataTypes.STRING },
      date: { type: DataTypes.STRING },
      notes: { type: DataTypes.TEXT },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("loyalty_transactions", ["company_id"]);
    await queryInterface.addIndex("loyalty_transactions", ["customer_id"]);

    // 3. Attendance.
    await queryInterface.createTable("attendance", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING, allowNull: false,
        references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      employee_id: { type: DataTypes.STRING, allowNull: false },
      employee_name: { type: DataTypes.STRING },
      date: { type: DataTypes.STRING, allowNull: false },
      check_in: { type: DataTypes.STRING },
      check_out: { type: DataTypes.STRING },
      hours: { type: DataTypes.DECIMAL(6, 2), defaultValue: 0 },
      status: { type: DataTypes.ENUM("present", "absent", "leave", "late", "holiday"), defaultValue: "present" },
      branch: { type: DataTypes.STRING },
      notes: { type: DataTypes.TEXT },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("attendance", ["company_id"]);
    await queryInterface.addIndex("attendance", ["employee_id", "date"]);

    // 4. Payslips.
    await queryInterface.createTable("payslips", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING, allowNull: false,
        references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      employee_id: { type: DataTypes.STRING, allowNull: false },
      employee_name: { type: DataTypes.STRING },
      period: { type: DataTypes.STRING, allowNull: false },
      base_salary: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      allowances: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
      overtime: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
      deductions: { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
      net: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.ENUM("draft", "approved", "paid"), defaultValue: "draft" },
      paid_date: { type: DataTypes.STRING },
      payment_method: { type: DataTypes.STRING },
      journal_entry_id: { type: DataTypes.STRING },
      branch: { type: DataTypes.STRING },
      notes: { type: DataTypes.TEXT },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("payslips", ["company_id"]);
    await queryInterface.addIndex("payslips", ["period"]);

    // Payroll posting auto-creates account 6100 for the active company through
    // posting.service. Do not insert a CMP-DEMO account here: fresh production
    // databases have no demo company, and this migration must stay tenant-safe.
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("loyalty_transactions");
    await queryInterface.dropTable("attendance");
    await queryInterface.dropTable("payslips");
    await queryInterface.removeColumn("employees", "base_salary");
    await queryInterface.removeColumn("employees", "allowances");
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_loyalty_transactions_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_attendance_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_payslips_status";');
  }
};
