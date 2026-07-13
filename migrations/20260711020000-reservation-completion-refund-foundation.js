"use strict";

const { DataTypes } = require("sequelize");

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function createTableIfMissing(queryInterface, tableName, definition) {
  const tables = await queryInterface.showAllTables();
  const exists = tables.map((t) => (typeof t === "string" ? t : t.tableName)).includes(tableName);
  if (!exists) await queryInterface.createTable(tableName, definition);
}

async function addIndexSafe(queryInterface, tableName, fields, options) {
  try {
    await queryInterface.addIndex(tableName, fields, options);
  } catch (error) {
    if (!/already exists|duplicate/i.test(String(error.message || ""))) throw error;
  }
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query("ALTER TYPE enum_reservations_status ADD VALUE IF NOT EXISTS 'cancelled_refund_pending'");
    await queryInterface.sequelize.query("ALTER TYPE enum_reservations_status ADD VALUE IF NOT EXISTS 'refunded'");
    await queryInterface.sequelize.query("ALTER TYPE enum_reservation_items_status ADD VALUE IF NOT EXISTS 'sold'");

    await addColumnIfMissing(queryInterface, "reservations", "completed_at", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "completed_by", { type: DataTypes.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "cancelled_at", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "cancelled_by", { type: DataTypes.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "cancellation_reason", { type: DataTypes.TEXT, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "refunded_at", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "refund_status", { type: DataTypes.STRING, allowNull: true });

    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservations_final_invoice_unique ON reservations(company_id, final_invoice_id) WHERE final_invoice_id IS NOT NULL"
    );

    await createTableIfMissing(queryInterface, "reservation_payment_applications", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      reservation_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "reservations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      reservation_payment_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "reservation_payments", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      final_invoice_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "invoices", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      applied_amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      applied_at: { type: DataTypes.DATE, allowNull: false },
      applied_by: { type: DataTypes.STRING, allowNull: true },
      source_reference: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    await createTableIfMissing(queryInterface, "reservation_refunds", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      reservation_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "reservations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      customer_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "customers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      branch_id: {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "branches", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "AED" },
      status: { type: DataTypes.ENUM("requested", "approved", "rejected", "executed"), allowNull: false, defaultValue: "requested" },
      requested_refund_method: { type: DataTypes.STRING, allowNull: false },
      treasury_account_code: { type: DataTypes.STRING, allowNull: true },
      original_payment_methods_summary: { type: DataTypes.JSONB, allowNull: true },
      method_differs_from_original: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      method_override_approved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      requested_by: { type: DataTypes.STRING, allowNull: true },
      requested_at: { type: DataTypes.DATE, allowNull: false },
      approved_by: { type: DataTypes.STRING, allowNull: true },
      approved_at: { type: DataTypes.DATE, allowNull: true },
      rejected_by: { type: DataTypes.STRING, allowNull: true },
      rejected_at: { type: DataTypes.DATE, allowNull: true },
      rejection_reason: { type: DataTypes.TEXT, allowNull: true },
      executed_by: { type: DataTypes.STRING, allowNull: true },
      executed_at: { type: DataTypes.DATE, allowNull: true },
      journal_entry_id: {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "journal_entries", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      cash_transaction_id: {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "cash_transactions", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    await createTableIfMissing(queryInterface, "reservation_refund_allocations", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      reservation_refund_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "reservation_refunds", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      reservation_payment_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "reservation_payments", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      allocated_amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    await addIndexSafe(queryInterface, "reservation_payment_applications", ["company_id", "reservation_id"], {
      name: "reservation_payment_applications_reservation_idx"
    });
    await addIndexSafe(queryInterface, "reservation_payment_applications", ["company_id", "reservation_payment_id"], {
      name: "reservation_payment_applications_payment_unique",
      unique: true
    });
    await addIndexSafe(queryInterface, "reservation_payment_applications", ["company_id", "final_invoice_id"], {
      name: "reservation_payment_applications_invoice_idx"
    });
    await addIndexSafe(queryInterface, "reservation_refunds", ["company_id", "reservation_id"], {
      name: "reservation_refunds_reservation_idx"
    });
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservation_refunds_one_open_unique ON reservation_refunds(company_id, reservation_id) WHERE status IN ('requested', 'approved')"
    );
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservation_refunds_one_executed_unique ON reservation_refunds(company_id, reservation_id) WHERE status = 'executed'"
    );
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservation_refunds_idempotency_unique ON reservation_refunds(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''"
    );
    await addIndexSafe(queryInterface, "reservation_refund_allocations", ["company_id", "reservation_refund_id"], {
      name: "reservation_refund_allocations_refund_idx"
    });
    await addIndexSafe(queryInterface, "reservation_refund_allocations", ["company_id", "reservation_refund_id", "reservation_payment_id"], {
      name: "reservation_refund_allocations_payment_unique",
      unique: true
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("reservation_refund_allocations");
    await queryInterface.dropTable("reservation_refunds");
    await queryInterface.dropTable("reservation_payment_applications");
    for (const column of [
      "refund_status",
      "refunded_at",
      "cancellation_reason",
      "cancelled_by",
      "cancelled_at",
      "completed_by",
      "completed_at"
    ]) {
      try {
        await queryInterface.removeColumn("reservations", column);
      } catch (_) {
        // enum values and indexes remain best-effort on rollback
      }
    }
  }
};
