"use strict";

/**
 * Additive, non-destructive: extend the asset status enum with the four
 * states required by the DARFUS inventory rules. Uses
 * `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, which only appends labels — it
 * never drops, recreates or rewrites the enum, the table, or any existing row.
 *
 * Existing legacy values (repair, transferred, archived) are intentionally
 * left in place for backward compatibility; remapping them is a separate,
 * gated step.
 *
 * Note: there is no safe `down` for enum values in PostgreSQL (you cannot
 * remove an enum label without recreating the type), so down() is a no-op.
 */
const NEW_VALUES = ["pending_transfer", "returned", "in_workshop", "pending_tag"];
const ENUM_TYPE = "enum_assets_status";

module.exports = {
  up: async (queryInterface) => {
    for (const value of NEW_VALUES) {
      await queryInterface.sequelize.query(
        `ALTER TYPE "${ENUM_TYPE}" ADD VALUE IF NOT EXISTS '${value}';`
      );
    }
  },

  // Removing enum labels safely requires recreating the type and is therefore
  // intentionally not automated (and not needed — the change is additive).
  down: async () => {},
};
