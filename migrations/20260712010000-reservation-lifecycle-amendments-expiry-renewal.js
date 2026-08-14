"use strict";

// Phase 32.6-Fix C — additive, forward-only foundation for reservation item
// amendments, expiry extensions, automatic expiry metadata, renewals, and the
// immutable advance payment transfer subledger. No existing column is dropped,
// no data is mutated, and no business record is created by this migration.

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
    // 1) Additive enum values (new values are not referenced within this migration).
    await queryInterface.sequelize.query("ALTER TYPE enum_reservations_status ADD VALUE IF NOT EXISTS 'pending_renewal_settlement'");
    await queryInterface.sequelize.query("ALTER TYPE enum_reservations_status ADD VALUE IF NOT EXISTS 'renewed'");
    await queryInterface.sequelize.query("ALTER TYPE enum_reservation_payments_status ADD VALUE IF NOT EXISTS 'transferred'");

    // 2) Reservation expiry / extension / renewal metadata columns.
    await addColumnIfMissing(queryInterface, "reservations", "expiry_processed_at", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "expired_at", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "expired_by_system", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await addColumnIfMissing(queryInterface, "reservations", "expiry_cancellation_reason", { type: DataTypes.TEXT, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "last_extended_at", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "last_extended_by", { type: DataTypes.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "extension_count", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
    await addColumnIfMissing(queryInterface, "reservations", "predecessor_reservation_id", { type: DataTypes.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "successor_reservation_id", { type: DataTypes.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "renewed_at", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "renewed_by", { type: DataTypes.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservations", "renewal_status", { type: DataTypes.STRING, allowNull: true });

    // A successor references at most one predecessor, and each predecessor may have
    // at most one successfully linked successor.
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservations_successor_unique ON reservations(company_id, successor_reservation_id) WHERE successor_reservation_id IS NOT NULL"
    );

    // 3) Reservation payment transfer-origin markers.
    await addColumnIfMissing(queryInterface, "reservation_payments", "source_transfer_id", { type: DataTypes.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, "reservation_payments", "origin", { type: DataTypes.STRING, allowNull: true });

    // 4) Reservation refund typing for the distinct renewal-excess refund.
    await addColumnIfMissing(queryInterface, "reservation_refunds", "refund_type", {
      type: DataTypes.ENUM("reservation_full", "renewal_excess"),
      allowNull: false,
      defaultValue: "reservation_full"
    });
    await addColumnIfMissing(queryInterface, "reservation_refunds", "renewal_id", { type: DataTypes.STRING, allowNull: true });

    // 5) Reservation amendment master.
    await createTableIfMissing(queryInterface, "reservation_amendments", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      reservation_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservations", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      amendment_type: { type: DataTypes.ENUM("add_items", "remove_items", "replace_items", "reprice_items", "mixed"), allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      before_total: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      after_total: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      before_paid: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      after_paid: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      before_remaining: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      after_remaining: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      before_status: { type: DataTypes.STRING, allowNull: false },
      after_status: { type: DataTypes.STRING, allowNull: false },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      created_by: { type: DataTypes.STRING, allowNull: true },
      employee_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await addIndexSafe(queryInterface, "reservation_amendments", ["reservation_id"], { name: "reservation_amendments_reservation_idx" });
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservation_amendments_idem_unique ON reservation_amendments(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL"
    );

    // 6) Reservation amendment item details.
    await createTableIfMissing(queryInterface, "reservation_amendment_items", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      amendment_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservation_amendments", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      reservation_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservations", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      action: { type: DataTypes.ENUM("added", "removed", "replaced_out", "replaced_in", "repriced"), allowNull: false },
      reservation_item_id: { type: DataTypes.STRING, allowNull: true },
      asset_id: { type: DataTypes.STRING, allowNull: true },
      previous_asset_id: { type: DataTypes.STRING, allowNull: true },
      old_price: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      new_price: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      previous_active_state: { type: DataTypes.STRING, allowNull: true },
      new_active_state: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await addIndexSafe(queryInterface, "reservation_amendment_items", ["amendment_id"], { name: "reservation_amendment_items_amendment_idx" });

    // 7) Reservation expiry extensions.
    await createTableIfMissing(queryInterface, "reservation_expiry_extensions", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      reservation_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservations", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      old_expiry: { type: DataTypes.STRING, allowNull: false },
      new_expiry: { type: DataTypes.STRING, allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      extended_by: { type: DataTypes.STRING, allowNull: true },
      extended_at: { type: DataTypes.DATE, allowNull: false },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await addIndexSafe(queryInterface, "reservation_expiry_extensions", ["reservation_id"], { name: "reservation_expiry_extensions_reservation_idx" });
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservation_expiry_extensions_idem_unique ON reservation_expiry_extensions(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL"
    );

    // 8) Reservation renewals.
    await createTableIfMissing(queryInterface, "reservation_renewals", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      source_reservation_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservations", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      successor_reservation_id: { type: DataTypes.STRING, allowNull: true, references: { model: "reservations", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      customer_id: { type: DataTypes.STRING, allowNull: false },
      branch_id: { type: DataTypes.STRING, allowNull: true },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "AED" },
      source_transferable_balance: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      successor_total: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      transfer_amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      excess_refund_amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, defaultValue: 0 },
      excess_refund_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.ENUM("requested", "pending_excess_refund", "ready_to_activate", "activated", "rejected", "cancelled"), allowNull: false, defaultValue: "requested" },
      current_price_evidence: { type: DataTypes.JSONB, allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: true },
      requested_by: { type: DataTypes.STRING, allowNull: true },
      requested_at: { type: DataTypes.DATE, allowNull: false },
      activated_by: { type: DataTypes.STRING, allowNull: true },
      activated_at: { type: DataTypes.DATE, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await addIndexSafe(queryInterface, "reservation_renewals", ["source_reservation_id"], { name: "reservation_renewals_source_idx" });
    // At most one active (non-terminal) renewal per source reservation.
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservation_renewals_one_active_unique ON reservation_renewals(company_id, source_reservation_id) WHERE status IN ('requested', 'pending_excess_refund', 'ready_to_activate', 'activated')"
    );
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS reservation_renewals_idem_unique ON reservation_renewals(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL"
    );

    // 9) Reservation payment transfer subledger.
    await createTableIfMissing(queryInterface, "reservation_payment_transfers", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      renewal_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservation_renewals", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      source_reservation_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservations", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      target_reservation_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservations", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      source_payment_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservation_payments", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      target_payment_id: { type: DataTypes.STRING, allowNull: true, references: { model: "reservation_payments", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      customer_id: { type: DataTypes.STRING, allowNull: false },
      branch_id: { type: DataTypes.STRING, allowNull: true },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "AED" },
      amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false },
      advances_account_code: { type: DataTypes.STRING, allowNull: true },
      journal_entry_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.ENUM("posted", "reversed"), allowNull: false, defaultValue: "posted" },
      transferred_by: { type: DataTypes.STRING, allowNull: true },
      transferred_at: { type: DataTypes.DATE, allowNull: false },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await addIndexSafe(queryInterface, "reservation_payment_transfers", ["renewal_id"], { name: "reservation_payment_transfers_renewal_idx" });
    await addIndexSafe(queryInterface, "reservation_payment_transfers", ["source_payment_id"], { name: "reservation_payment_transfers_source_payment_idx" });
  },

  async down() {
    throw new Error("Rollback disabled for forward-only reservation amendment/expiry/renewal foundation");
  }
};
