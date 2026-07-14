"use strict";

const { DataTypes } = require("sequelize");

const SYSTEM_ACCOUNT_PERMISSIONS = [
  "system_accounts.view",
  "system_accounts.manage",
  "system_accounts.credentials.reset",
  "system_accounts.sessions.revoke",
  "security.recovery.manage",
  "super_admin.manage"
];

function permissionRow(name) {
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
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn("users", "account_type", {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "legacy"
      }, { transaction });
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        ADD CONSTRAINT users_account_type_chk
        CHECK (account_type IN ('legacy', 'super_admin', 'branch_shell'))
      `, { transaction });

      await queryInterface.addColumn("users", "branch_id", {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "branches", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      }, { transaction });
      await queryInterface.addColumn("users", "recovery_email", { type: DataTypes.STRING, allowNull: true }, { transaction });
      await queryInterface.addColumn("users", "recovery_phone", { type: DataTypes.STRING, allowNull: true }, { transaction });
      await queryInterface.addColumn("users", "recovery_email_verified_at", { type: DataTypes.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("users", "recovery_phone_verified_at", { type: DataTypes.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("users", "force_password_change", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction });
      await queryInterface.addColumn("users", "failed_login_count", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn("users", "locked_until", { type: DataTypes.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("users", "password_version", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }, { transaction });
      await queryInterface.addColumn("users", "session_version", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }, { transaction });
      await queryInterface.addColumn("users", "credentials_changed_at", { type: DataTypes.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("users", "last_login_at", { type: DataTypes.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("users", "last_password_change_at", { type: DataTypes.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("users", "default_employee_id", {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      }, { transaction });
      await queryInterface.addIndex("users", ["account_type"], { name: "users_account_type_idx", transaction });
      await queryInterface.addIndex("users", ["company_id", "branch_id"], { name: "users_company_branch_idx", transaction });
      await queryInterface.addIndex("users", ["default_employee_id"], { name: "users_default_employee_idx", transaction });
      await queryInterface.addIndex("users", ["locked_until"], { name: "users_locked_until_idx", transaction });

      await queryInterface.createTable("technical_account_sessions", {
        id: { type: DataTypes.STRING, primaryKey: true },
        user_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        company_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "companies", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        branch_id: {
          type: DataTypes.STRING,
          allowNull: true,
          references: { model: "branches", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        refresh_token_hash: { type: DataTypes.STRING(128), allowNull: false, unique: true },
        device_session_id: { type: DataTypes.STRING(128), allowNull: true },
        user_agent: { type: DataTypes.STRING(255), allowNull: true },
        ip_address: { type: DataTypes.STRING(80), allowNull: true },
        password_version: { type: DataTypes.INTEGER, allowNull: false },
        session_version: { type: DataTypes.INTEGER, allowNull: false },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        last_used_at: { type: DataTypes.DATE, allowNull: true },
        revoked_at: { type: DataTypes.DATE, allowNull: true },
        revoke_reason: { type: DataTypes.STRING(120), allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false }
      }, { transaction });
      await queryInterface.addIndex("technical_account_sessions", ["user_id", "revoked_at"], { name: "technical_sessions_user_revoked_idx", transaction });
      await queryInterface.addIndex("technical_account_sessions", ["company_id", "branch_id"], { name: "technical_sessions_company_branch_idx", transaction });
      await queryInterface.addIndex("technical_account_sessions", ["expires_at"], { name: "technical_sessions_expires_idx", transaction });
      await queryInterface.addIndex("technical_account_sessions", ["revoked_at"], { name: "technical_sessions_revoked_idx", transaction });

      await queryInterface.createTable("password_reset_tokens", {
        id: { type: DataTypes.STRING, primaryKey: true },
        user_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        token_hash: { type: DataTypes.STRING(128), allowNull: false, unique: true },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        used_at: { type: DataTypes.DATE, allowNull: true },
        requested_ip: { type: DataTypes.STRING(80), allowNull: true },
        requested_user_agent: { type: DataTypes.STRING(255), allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false }
      }, { transaction });
      await queryInterface.addIndex("password_reset_tokens", ["user_id", "used_at"], { name: "password_reset_tokens_user_used_idx", transaction });
      await queryInterface.addIndex("password_reset_tokens", ["expires_at"], { name: "password_reset_tokens_expires_idx", transaction });

      await queryInterface.createTable("email_change_tokens", {
        id: { type: DataTypes.STRING, primaryKey: true },
        user_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        new_email: { type: DataTypes.STRING, allowNull: false },
        token_hash: { type: DataTypes.STRING(128), allowNull: false, unique: true },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        used_at: { type: DataTypes.DATE, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false }
      }, { transaction });
      await queryInterface.addIndex("email_change_tokens", ["user_id", "used_at"], { name: "email_change_tokens_user_used_idx", transaction });
      await queryInterface.addIndex("email_change_tokens", ["expires_at"], { name: "email_change_tokens_expires_idx", transaction });

      await queryInterface.createTable("employee_code_history", {
        id: { type: DataTypes.STRING, primaryKey: true },
        employee_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "employees", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        company_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "companies", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        old_code: { type: DataTypes.STRING(64), allowNull: true },
        new_code: { type: DataTypes.STRING(64), allowNull: false },
        changed_by_user_id: {
          type: DataTypes.STRING,
          allowNull: true,
          references: { model: "users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL"
        },
        changed_by_employee_id: {
          type: DataTypes.STRING,
          allowNull: true,
          references: { model: "employees", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL"
        },
        reason: { type: DataTypes.TEXT, allowNull: false },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false }
      }, { transaction });
      await queryInterface.addIndex("employee_code_history", ["company_id", "employee_id", "created_at"], { name: "employee_code_history_company_employee_idx", transaction });
      await queryInterface.addIndex("employee_code_history", ["new_code"], { name: "employee_code_history_new_code_idx", transaction });

      await queryInterface.bulkInsert("permissions", SYSTEM_ACCOUNT_PERMISSIONS.map(permissionRow), {
        ignoreDuplicates: true,
        transaction
      });
      const [adminRoles] = await queryInterface.sequelize.query("SELECT id FROM roles WHERE is_admin = true", { transaction });
      if (adminRoles.length) {
        const now = new Date();
        const rows = [];
        for (const role of adminRoles) {
          for (const name of SYSTEM_ACCOUNT_PERMISSIONS) {
            rows.push({ role_id: role.id, permission_id: `PERM-${name}`, created_at: now, updated_at: now });
          }
        }
        await queryInterface.bulkInsert("role_permissions", rows, { ignoreDuplicates: true, transaction });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("employee_code_history", { transaction });
      await queryInterface.dropTable("email_change_tokens", { transaction });
      await queryInterface.dropTable("password_reset_tokens", { transaction });
      await queryInterface.dropTable("technical_account_sessions", { transaction });
      await queryInterface.bulkDelete("role_permissions", { permission_id: SYSTEM_ACCOUNT_PERMISSIONS.map((name) => `PERM-${name}`) }, { transaction });
      await queryInterface.bulkDelete("permissions", { id: SYSTEM_ACCOUNT_PERMISSIONS.map((name) => `PERM-${name}`) }, { transaction });
      await queryInterface.removeIndex("users", "users_locked_until_idx", { transaction });
      await queryInterface.removeIndex("users", "users_default_employee_idx", { transaction });
      await queryInterface.removeIndex("users", "users_company_branch_idx", { transaction });
      await queryInterface.removeIndex("users", "users_account_type_idx", { transaction });
      await queryInterface.removeColumn("users", "default_employee_id", { transaction });
      await queryInterface.removeColumn("users", "last_password_change_at", { transaction });
      await queryInterface.removeColumn("users", "last_login_at", { transaction });
      await queryInterface.removeColumn("users", "credentials_changed_at", { transaction });
      await queryInterface.removeColumn("users", "session_version", { transaction });
      await queryInterface.removeColumn("users", "password_version", { transaction });
      await queryInterface.removeColumn("users", "locked_until", { transaction });
      await queryInterface.removeColumn("users", "failed_login_count", { transaction });
      await queryInterface.removeColumn("users", "force_password_change", { transaction });
      await queryInterface.removeColumn("users", "recovery_phone_verified_at", { transaction });
      await queryInterface.removeColumn("users", "recovery_email_verified_at", { transaction });
      await queryInterface.removeColumn("users", "recovery_phone", { transaction });
      await queryInterface.removeColumn("users", "recovery_email", { transaction });
      await queryInterface.removeColumn("users", "branch_id", { transaction });
      await queryInterface.removeColumn("users", "account_type", { transaction });
    });
  }
};
