"use strict";

const { DataTypes } = require("sequelize");

const POS_PERMISSIONS = [
  "pos.view",
  "pos.sell",
  "pos.discount.approve"
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
      await queryInterface.addColumn("invoices", "created_by_employee_id", {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      }, { transaction });
      await queryInterface.addColumn("invoices", "finalized_by_employee_id", {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      }, { transaction });
      await queryInterface.addIndex("invoices", ["company_id", "created_by_employee_id"], {
        name: "invoices_company_created_employee_idx",
        transaction
      });
      await queryInterface.addIndex("invoices", ["company_id", "finalized_by_employee_id"], {
        name: "invoices_company_finalized_employee_idx",
        transaction
      });

      await queryInterface.addColumn("payments", "received_by_employee_id", {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      }, { transaction });
      await queryInterface.addIndex("payments", ["company_id", "received_by_employee_id"], {
        name: "payments_company_received_employee_idx",
        transaction
      });

      await queryInterface.createTable("invoice_print_events", {
        id: { type: DataTypes.STRING, primaryKey: true },
        company_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "companies", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        branch_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "branches", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        invoice_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "invoices", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        technical_user_id: {
          type: DataTypes.STRING,
          allowNull: false,
          references: { model: "users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        employee_id: {
          type: DataTypes.STRING,
          allowNull: true,
          references: { model: "employees", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL"
        },
        operator_session_id: {
          type: DataTypes.STRING,
          allowNull: true,
          references: { model: "employee_operational_sessions", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL"
        },
        event_type: { type: DataTypes.STRING(64), allowNull: false },
        copy_number: { type: DataTypes.INTEGER, allowNull: false },
        reason: { type: DataTypes.TEXT, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false }
      }, { transaction });

      await queryInterface.sequelize.query(`
        ALTER TABLE invoice_print_events
        ADD CONSTRAINT invoice_print_events_event_type_chk
        CHECK (event_type IN ('official_print_authorized', 'reprint_authorized'))
      `, { transaction });
      await queryInterface.sequelize.query(`
        ALTER TABLE invoice_print_events
        ADD CONSTRAINT invoice_print_events_copy_number_chk
        CHECK (copy_number >= 1)
      `, { transaction });
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX invoice_print_events_one_official_uq
        ON invoice_print_events (invoice_id)
        WHERE event_type = 'official_print_authorized'
      `, { transaction });
      await queryInterface.addIndex("invoice_print_events", ["invoice_id", "copy_number"], {
        name: "invoice_print_events_invoice_copy_uq",
        unique: true,
        transaction
      });
      await queryInterface.addIndex("invoice_print_events", ["company_id", "invoice_id", "created_at"], {
        name: "invoice_print_events_company_invoice_date_idx",
        transaction
      });
      await queryInterface.addIndex("invoice_print_events", ["employee_id", "created_at"], {
        name: "invoice_print_events_employee_date_idx",
        transaction
      });
      await queryInterface.addIndex("invoice_print_events", ["technical_user_id", "created_at"], {
        name: "invoice_print_events_user_date_idx",
        transaction
      });

      await queryInterface.bulkInsert("permissions", POS_PERMISSIONS.map(permissionRow), {
        ignoreDuplicates: true,
        transaction
      });
      const [adminRoles] = await queryInterface.sequelize.query(
        "SELECT id FROM roles WHERE is_admin = true",
        { transaction }
      );
      if (adminRoles.length) {
        const now = new Date();
        const rolePermissionRows = [];
        for (const role of adminRoles) {
          for (const name of POS_PERMISSIONS) {
            rolePermissionRows.push({
              role_id: role.id,
              permission_id: `PERM-${name}`,
              created_at: now,
              updated_at: now
            });
          }
        }
        await queryInterface.bulkInsert("role_permissions", rolePermissionRows, {
          ignoreDuplicates: true,
          transaction
        });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("invoice_print_events", { transaction });
      await queryInterface.removeIndex("payments", "payments_company_received_employee_idx", { transaction });
      await queryInterface.removeColumn("payments", "received_by_employee_id", { transaction });
      await queryInterface.removeIndex("invoices", "invoices_company_finalized_employee_idx", { transaction });
      await queryInterface.removeIndex("invoices", "invoices_company_created_employee_idx", { transaction });
      await queryInterface.removeColumn("invoices", "finalized_by_employee_id", { transaction });
      await queryInterface.removeColumn("invoices", "created_by_employee_id", { transaction });
      await queryInterface.bulkDelete("role_permissions", {
        permission_id: POS_PERMISSIONS.map((name) => `PERM-${name}`)
      }, { transaction });
      await queryInterface.bulkDelete("permissions", {
        id: POS_PERMISSIONS.map((name) => `PERM-${name}`)
      }, { transaction });
    });
  }
};
