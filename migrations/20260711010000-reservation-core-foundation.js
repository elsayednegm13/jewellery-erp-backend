"use strict";

const { DataTypes } = require("sequelize");

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
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
    await queryInterface.sequelize.query("ALTER TYPE enum_reservations_status ADD VALUE IF NOT EXISTS 'partially_paid'");
    await queryInterface.sequelize.query("ALTER TYPE enum_reservations_status ADD VALUE IF NOT EXISTS 'fully_paid'");

    await addColumnIfMissing(queryInterface, "reservations", "branch_id", {
      type: DataTypes.STRING,
      allowNull: true,
      references: { model: "branches", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL"
    });
    await addColumnIfMissing(queryInterface, "reservations", "currency", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "AED"
    });
    await addColumnIfMissing(queryInterface, "reservations", "agreed_total", {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      defaultValue: 0
    });
    await addColumnIfMissing(queryInterface, "reservations", "paid_total", {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      defaultValue: 0
    });
    await addColumnIfMissing(queryInterface, "reservations", "remaining_total", {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      defaultValue: 0
    });
    await addColumnIfMissing(queryInterface, "reservations", "excess_total", {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      defaultValue: 0
    });
    await addColumnIfMissing(queryInterface, "reservations", "fully_paid_at", {
      type: DataTypes.DATE,
      allowNull: true
    });
    await addColumnIfMissing(queryInterface, "reservations", "final_invoice_id", {
      type: DataTypes.STRING,
      allowNull: true
    });
    await addColumnIfMissing(queryInterface, "reservations", "workflow_version", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    });
    await addColumnIfMissing(queryInterface, "reservations", "is_legacy", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
    await addColumnIfMissing(queryInterface, "reservations", "version", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    });
    await addColumnIfMissing(queryInterface, "reservations", "created_by", {
      type: DataTypes.STRING,
      allowNull: true
    });
    await addColumnIfMissing(queryInterface, "reservations", "updated_by", {
      type: DataTypes.STRING,
      allowNull: true
    });

    await queryInterface.createTable("reservation_items", {
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
        onDelete: "CASCADE"
      },
      asset_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "assets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      asset_name: { type: DataTypes.STRING, allowNull: false },
      item_type: { type: DataTypes.STRING, allowNull: false, defaultValue: "asset" },
      agreed_price: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      original_price: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      status: { type: DataTypes.ENUM("active", "released"), allowNull: false, defaultValue: "active" },
      reserved_at: { type: DataTypes.DATE, allowNull: false },
      released_at: { type: DataTypes.DATE, allowNull: true },
      added_by: { type: DataTypes.STRING, allowNull: true },
      release_reason: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.createTable("reservation_payments", {
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
      payment_method: { type: DataTypes.STRING, allowNull: false, defaultValue: "cash" },
      treasury_account_code: { type: DataTypes.STRING, allowNull: false },
      advances_account_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "accounts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      advances_account_code: { type: DataTypes.STRING, allowNull: false },
      receipt_number: { type: DataTypes.STRING, allowNull: false },
      journal_entry_id: {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "journal_entries", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      status: { type: DataTypes.ENUM("posted", "reversed", "refunded"), allowNull: false, defaultValue: "posted" },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      received_by: { type: DataTypes.STRING, allowNull: true },
      received_employee_id: { type: DataTypes.STRING, allowNull: true },
      received_at: { type: DataTypes.DATE, allowNull: false },
      source_reference: { type: DataTypes.STRING, allowNull: true },
      reversal_of: { type: DataTypes.STRING, allowNull: true },
      refund_of: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    await addIndexSafe(queryInterface, "reservation_items", ["company_id", "reservation_id"], {
      name: "reservation_items_company_reservation_idx"
    });
    await addIndexSafe(queryInterface, "reservation_items", ["company_id", "reservation_id", "asset_id"], {
      name: "reservation_items_reservation_asset_unique",
      unique: true
    });
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservation_items_active_asset_unique ON reservation_items(company_id, asset_id) WHERE status = 'active'"
    );

    await addIndexSafe(queryInterface, "reservation_payments", ["company_id", "reservation_id"], {
      name: "reservation_payments_company_reservation_idx"
    });
    await addIndexSafe(queryInterface, "reservation_payments", ["company_id", "receipt_number"], {
      name: "reservation_payments_receipt_unique",
      unique: true
    });
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservation_payments_idempotency_unique ON reservation_payments(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''"
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("reservation_payments");
    await queryInterface.dropTable("reservation_items");
    for (const column of [
      "updated_by",
      "created_by",
      "version",
      "is_legacy",
      "workflow_version",
      "final_invoice_id",
      "fully_paid_at",
      "excess_total",
      "remaining_total",
      "paid_total",
      "agreed_total",
      "currency",
      "branch_id"
    ]) {
      try {
        await queryInterface.removeColumn("reservations", column);
      } catch (_) {
        // rollback is structural best-effort; enum values remain in PostgreSQL
      }
    }
  }
};
