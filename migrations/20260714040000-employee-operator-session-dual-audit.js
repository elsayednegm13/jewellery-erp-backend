"use strict";

const { DataTypes } = require("sequelize");

const AUDIT_COLUMNS = [
  "technical_user_id",
  "employee_id",
  "employee_code_snapshot",
  "employee_name_snapshot",
  "operator_session_id",
  "device_session_id",
  "verification_level",
  "level_2_verified_at",
  "required_permission",
  "requested_operation",
  "authorization_result",
  "authorization_failure_code",
  "operator_reason",
  "hash_version"
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn("employees", "authorization_version", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
      }, { transaction });

      await queryInterface.createTable("employee_operational_sessions", {
        id: { type: DataTypes.STRING, primaryKey: true },
        company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        branch_id: { type: DataTypes.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        session_user_id: { type: DataTypes.STRING, allowNull: false, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
        employee_id: { type: DataTypes.STRING, allowNull: false, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
        verification_level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        verified_at: { type: DataTypes.DATE, allowNull: false },
        level_2_verified_at: { type: DataTypes.DATE, allowNull: true },
        last_activity_at: { type: DataTypes.DATE, allowNull: false },
        idle_expires_at: { type: DataTypes.DATE, allowNull: false },
        absolute_expires_at: { type: DataTypes.DATE, allowNull: false },
        locked_at: { type: DataTypes.DATE, allowNull: true },
        revoked_at: { type: DataTypes.DATE, allowNull: true },
        revoked_reason: { type: DataTypes.STRING(80), allowNull: true },
        credential_version: { type: DataTypes.INTEGER, allowNull: false },
        authorization_version: { type: DataTypes.INTEGER, allowNull: false },
        device_session_id: { type: DataTypes.STRING(128), allowNull: false },
        auth_session_fingerprint: { type: DataTypes.STRING(160), allowNull: true },
        ip_address: { type: DataTypes.STRING(80), allowNull: true },
        user_agent: { type: DataTypes.STRING(255), allowNull: true },
        employee_code_snapshot: { type: DataTypes.STRING(64), allowNull: true },
        employee_name_snapshot: { type: DataTypes.STRING(160), allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false }
      }, { transaction });

      await queryInterface.sequelize.query(`
        ALTER TABLE employee_operational_sessions
        ADD CONSTRAINT employee_operational_sessions_level_chk
        CHECK (verification_level IN (1, 2))
      `, { transaction });
      await queryInterface.addIndex("employee_operational_sessions", ["company_id", "session_user_id"], { name: "employee_operator_sessions_company_user_idx", transaction });
      await queryInterface.addIndex("employee_operational_sessions", ["company_id", "employee_id"], { name: "employee_operator_sessions_company_employee_idx", transaction });
      await queryInterface.addIndex("employee_operational_sessions", ["company_id", "branch_id"], { name: "employee_operator_sessions_company_branch_idx", transaction });
      await queryInterface.addIndex("employee_operational_sessions", ["session_user_id", "device_session_id"], { name: "employee_operator_sessions_user_device_idx", transaction });
      await queryInterface.addIndex("employee_operational_sessions", ["company_id", "revoked_at", "locked_at", "idle_expires_at"], { name: "employee_operator_sessions_expiry_idx", transaction });
      await queryInterface.addIndex("employee_operational_sessions", ["employee_id", "revoked_at"], { name: "employee_operator_sessions_employee_revoked_idx", transaction });
      await queryInterface.addIndex("employee_operational_sessions", ["company_id", "created_at"], { name: "employee_operator_sessions_company_created_idx", transaction });
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX employee_operator_sessions_active_user_device_uq
        ON employee_operational_sessions (company_id, session_user_id, device_session_id)
        WHERE revoked_at IS NULL AND locked_at IS NULL
      `, { transaction });

      await queryInterface.addColumn("audit_logs", "technical_user_id", { type: DataTypes.STRING, allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "employee_id", { type: DataTypes.STRING, allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "employee_code_snapshot", { type: DataTypes.STRING(64), allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "employee_name_snapshot", { type: DataTypes.STRING(160), allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "operator_session_id", { type: DataTypes.STRING, allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "device_session_id", { type: DataTypes.STRING(128), allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "verification_level", { type: DataTypes.INTEGER, allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "level_2_verified_at", { type: DataTypes.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "required_permission", { type: DataTypes.STRING(160), allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "requested_operation", { type: DataTypes.STRING(160), allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "authorization_result", { type: DataTypes.STRING(40), allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "authorization_failure_code", { type: DataTypes.STRING(80), allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "operator_reason", { type: DataTypes.STRING(255), allowNull: true }, { transaction });
      await queryInterface.addColumn("audit_logs", "hash_version", { type: DataTypes.STRING(8), allowNull: true }, { transaction });
      await queryInterface.sequelize.query("UPDATE audit_logs SET hash_version = 'v1' WHERE hash_version IS NULL", { transaction });
      await queryInterface.changeColumn("audit_logs", "hash_version", {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: "v2"
      }, { transaction });
      await queryInterface.addIndex("audit_logs", ["technical_user_id"], { name: "audit_logs_technical_user_idx", transaction });
      await queryInterface.addIndex("audit_logs", ["employee_id"], { name: "audit_logs_employee_idx", transaction });
      await queryInterface.addIndex("audit_logs", ["operator_session_id"], { name: "audit_logs_operator_session_idx", transaction });
      await queryInterface.addIndex("audit_logs", ["device_session_id"], { name: "audit_logs_device_session_idx", transaction });
      await queryInterface.addIndex("audit_logs", ["hash_version"], { name: "audit_logs_hash_version_idx", transaction });
      await queryInterface.addIndex("audit_logs", ["company_id", "employee_id", "date"], { name: "audit_logs_company_employee_date_idx", transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("employee_operational_sessions", { transaction });
      await queryInterface.removeColumn("employees", "authorization_version", { transaction });
      for (const column of AUDIT_COLUMNS.reverse()) {
        await queryInterface.removeColumn("audit_logs", column, { transaction });
      }
    });
  }
};
