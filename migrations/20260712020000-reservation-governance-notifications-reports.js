"use strict";

// Phase 32.6-Fix D — additive governance foundation for reservation-specific
// permissions and notification traceability. This migration is forward-only:
// it inserts permission metadata and adds nullable notification metadata fields.
// It does not backfill, reset, or mutate business records.

const { DataTypes } = require("sequelize");

const RESERVATION_PERMISSIONS = [
  "reservations.view",
  "reservations.view_all",
  "reservations.view_branch",
  "reservations.view_own",
  "reservations.create",
  "reservations.record_payment",
  "reservations.view_payments",
  "reservations.view_receipts",
  "reservations.complete_sale",
  "reservations.cancel",
  "reservations.amend_items",
  "reservations.reprice_items",
  "reservations.extend_expiry",
  "reservations.renew",
  "reservations.view_renewal_transfers",
  "reservations.refund_request",
  "reservations.refund_approve",
  "reservations.refund_reject",
  "reservations.refund_execute",
  "reservations.refund_method_override",
  "reservations.audit_view",
  "reservations.reports_view",
  "reservations.reports_export",
  "reservations.statement_view",
  "reservations.configure_account",
];

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.bulkInsert(
      "permissions",
      RESERVATION_PERMISSIONS.map((name) => {
        const [module, action] = name.split(".");
        return {
          id: `PERM-${name}`,
          name,
          module,
          action,
          description: name,
          created_at: now,
          updated_at: now,
        };
      }),
      { ignoreDuplicates: true }
    );

    await addColumnIfMissing(queryInterface, "notifications", "source_type", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await addColumnIfMissing(queryInterface, "notifications", "source_id", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await addColumnIfMissing(queryInterface, "notifications", "event_key", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_key_unique ON notifications(company_id, event_key) WHERE event_key IS NOT NULL"
    );
  },

  async down() {
    throw new Error("Rollback disabled for forward-only reservation governance foundation");
  },
};
