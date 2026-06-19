"use strict";

const { DataTypes } = require("sequelize");

/**
 * Additive, non-destructive: add an invoice lifecycle column `posting_status`
 * (draft | posted | cancelled) DISTINCT from the existing `status` column
 * (which is the PAYMENT status). Default 'posted' so every existing row and
 * every current immediate-post path is treated as posted — zero behaviour
 * change. No table recreate, no data reset, no change to `status`.
 *
 * A brand-new Postgres ENUM type is created for this new column (safe; we are
 * not altering an existing enum).
 */
async function columnExists(queryInterface, tableName, columnName) {
  try {
    const table = await queryInterface.describeTable(tableName);
    return Boolean(table[columnName]);
  } catch {
    return false;
  }
}

module.exports = {
  up: async (queryInterface) => {
    if (!(await columnExists(queryInterface, "invoices", "posting_status"))) {
      await queryInterface.addColumn("invoices", "posting_status", {
        type: DataTypes.ENUM("draft", "posted", "cancelled"),
        allowNull: false,
        defaultValue: "posted",
      });
    }
    // Helpful lookup indexes (reports / lifecycle filtering). Safe to skip if present.
    for (const cols of [["company_id", "posting_status"], ["branch_id", "posting_status"]]) {
      try {
        await queryInterface.addIndex("invoices", cols, {
          name: `invoices_${cols[0]}_posting_status_idx`,
        });
      } catch {
        /* index already exists */
      }
    }
  },

  down: async (queryInterface) => {
    for (const cols of [["company_id", "posting_status"], ["branch_id", "posting_status"]]) {
      try {
        await queryInterface.removeIndex("invoices", `invoices_${cols[0]}_posting_status_idx`);
      } catch {
        /* ignore */
      }
    }
    if (await columnExists(queryInterface, "invoices", "posting_status")) {
      await queryInterface.removeColumn("invoices", "posting_status");
      // Drop the enum type created for the column (Postgres).
      try {
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_invoices_posting_status";');
      } catch {
        /* ignore */
      }
    }
  },
};
