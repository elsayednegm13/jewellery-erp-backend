"use strict";

/**
 * Additive, non-destructive: add `installment` to the invoice type enum.
 *
 * /pos/checkout sets `type: "installment"` when paymentMethod === "installment",
 * but the enum was ("sale","return","exchange","deposit","repair") — so an
 * installment POS sale would fail with "invalid input value for enum" and roll
 * back. This aligns the enum with the checkout flow (TD-003).
 *
 * Uses ALTER TYPE ... ADD VALUE IF NOT EXISTS (append only). No drop, no table
 * recreate, no data change. No safe `down` for enum values in PostgreSQL.
 */
const ENUM_TYPE = "enum_invoices_type";

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TYPE "${ENUM_TYPE}" ADD VALUE IF NOT EXISTS 'installment';`
    );
  },

  // Enum labels cannot be safely removed in PostgreSQL without recreating the
  // type; intentionally a no-op (the change is additive).
  down: async () => {},
};
