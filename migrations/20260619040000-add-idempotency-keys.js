"use strict";

const { DataTypes } = require("sequelize");

/**
 * Additive, non-destructive: add a nullable `idempotency_key` column to the
 * tables behind the critical posting endpoints so a retried/double-clicked
 * request can be de-duplicated (same pattern as invoices.idempotency_key used
 * by POS checkout / returns / exchanges). No data is altered or dropped.
 */
const TABLES = ["purchase_orders", "installments", "cash_transactions", "payslips"];

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
    for (const table of TABLES) {
      if (!(await columnExists(queryInterface, table, "idempotency_key"))) {
        await queryInterface.addColumn(table, "idempotency_key", {
          type: DataTypes.STRING,
          allowNull: true,
        });
      }
      // Lookup index scoped per tenant; safe to skip if it already exists.
      try {
        await queryInterface.addIndex(table, ["company_id", "idempotency_key"], {
          name: `${table}_company_idempotency_idx`,
        });
      } catch {
        /* index already present */
      }
    }
  },

  down: async (queryInterface) => {
    for (const table of TABLES) {
      try {
        await queryInterface.removeIndex(table, `${table}_company_idempotency_idx`);
      } catch {
        /* ignore */
      }
      if (await columnExists(queryInterface, table, "idempotency_key")) {
        await queryInterface.removeColumn(table, "idempotency_key");
      }
    }
  },
};
