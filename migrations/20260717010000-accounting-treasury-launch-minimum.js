"use strict";

const { DataTypes } = require("sequelize");

const PHASE35D_PERMISSIONS = [
  "treasury.register.view",
  "treasury.register.open",
  "treasury.register.close",
  "accounting.lock.manage",
  "accounting.reconciliation.view",
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("accounting_locks", {
        id: { type: DataTypes.STRING, primaryKey: true },
        company_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "companies", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        locked_through_date: { type: DataTypes.DATEONLY, allowNull: true },
        reason: { type: DataTypes.TEXT, allowNull: true },
        updated_by_user_id: { type: DataTypes.STRING, allowNull: true },
        updated_by_name: { type: DataTypes.STRING, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: queryInterface.sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: queryInterface.sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("accounting_locks", ["company_id"], {
        name: "accounting_locks_company_uq",
        unique: true,
        transaction
      });

      await queryInterface.createTable("cash_register_sessions", {
        id: { type: DataTypes.STRING, primaryKey: true },
        company_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "companies", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        branch_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "branches", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        cash_account_code: { type: DataTypes.STRING, allowNull: false, defaultValue: "1110" },
        status: { type: DataTypes.STRING, allowNull: false, defaultValue: "OPEN" },
        opened_at: { type: DataTypes.DATE, allowNull: false },
        opened_by_user_id: { type: DataTypes.STRING, allowNull: true },
        opened_by_employee_id: { type: DataTypes.STRING, allowNull: true },
        opened_by_name: { type: DataTypes.STRING, allowNull: true },
        opening_counted_amount: { type: DataTypes.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
        closed_at: { type: DataTypes.DATE, allowNull: true },
        closed_by_user_id: { type: DataTypes.STRING, allowNull: true },
        closed_by_employee_id: { type: DataTypes.STRING, allowNull: true },
        closed_by_name: { type: DataTypes.STRING, allowNull: true },
        closing_counted_amount: { type: DataTypes.DECIMAL(15, 4), allowNull: true },
        system_expected_amount: { type: DataTypes.DECIMAL(15, 4), allowNull: true },
        variance: { type: DataTypes.DECIMAL(15, 4), allowNull: true },
        variance_reason: { type: DataTypes.TEXT, allowNull: true },
        open_idempotency_key: { type: DataTypes.STRING, allowNull: true },
        close_idempotency_key: { type: DataTypes.STRING, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: queryInterface.sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: queryInterface.sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("cash_register_sessions", ["company_id", "branch_id", "cash_account_code", "status"], {
        name: "cash_register_sessions_scope_status_idx",
        transaction
      });
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX cash_register_sessions_one_open_uq
        ON cash_register_sessions(company_id, branch_id, cash_account_code)
        WHERE status = 'OPEN'
      `, { transaction });
      await queryInterface.addIndex("cash_register_sessions", ["open_idempotency_key"], {
        name: "cash_register_sessions_open_idem_idx",
        transaction
      });
      await queryInterface.addIndex("cash_register_sessions", ["close_idempotency_key"], {
        name: "cash_register_sessions_close_idem_idx",
        transaction
      });

      const permissionRows = PHASE35D_PERMISSIONS.map((name) => {
        const parts = name.split(".");
        const action = parts.pop();
        return {
          id: `PERM-${name}`,
          name,
          module: parts.join("."),
          action,
          description: name,
          created_at: new Date(),
          updated_at: new Date()
        };
      });
      await queryInterface.bulkInsert("permissions", permissionRows, {
        ignoreDuplicates: true,
        transaction
      });

      await queryInterface.sequelize.query(`
        INSERT INTO role_permissions(role_id, permission_id, created_at, updated_at)
        SELECT r.id, p.id, NOW(), NOW()
        FROM roles r
        JOIN permissions p ON p.name IN (:permissionNames)
        WHERE r.slug IN ('admin', 'owner', 'accountant')
        ON CONFLICT DO NOTHING
      `, { replacements: { permissionNames: PHASE35D_PERMISSIONS }, transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO role_permissions(role_id, permission_id, created_at, updated_at)
        SELECT r.id, p.id, NOW(), NOW()
        FROM roles r
        JOIN permissions p ON p.name IN (:permissionNames)
        WHERE r.slug = 'manager'
        ON CONFLICT DO NOTHING
      `, {
        replacements: {
          permissionNames: [
            "treasury.register.view",
            "treasury.register.open",
            "treasury.register.close",
            "accounting.reconciliation.view",
          ]
        },
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query("DELETE FROM role_permissions WHERE permission_id IN (:permissionIds)", {
        replacements: { permissionIds: PHASE35D_PERMISSIONS.map((name) => `PERM-${name}`) },
        transaction
      });
      await queryInterface.sequelize.query("DELETE FROM permissions WHERE name IN (:permissionNames)", {
        replacements: { permissionNames: PHASE35D_PERMISSIONS },
        transaction
      });
      await queryInterface.sequelize.query("DROP INDEX IF EXISTS cash_register_sessions_close_idem_idx", { transaction });
      await queryInterface.sequelize.query("DROP INDEX IF EXISTS cash_register_sessions_open_idem_idx", { transaction });
      await queryInterface.sequelize.query("DROP INDEX IF EXISTS cash_register_sessions_one_open_uq", { transaction });
      await queryInterface.removeIndex("cash_register_sessions", "cash_register_sessions_scope_status_idx", { transaction });
      await queryInterface.dropTable("cash_register_sessions", { transaction });
      await queryInterface.removeIndex("accounting_locks", "accounting_locks_company_uq", { transaction });
      await queryInterface.dropTable("accounting_locks", { transaction });
    });
  }
};
