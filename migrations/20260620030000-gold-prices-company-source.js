"use strict";

/**
 * Additive, non-destructive: make gold_prices tenant-safe.
 *  - company_id (nullable) — scopes a price to a company. Legacy rows stay NULL
 *    and act as a global fallback (a company with no own price uses the NULL one;
 *    no company ever reads another company's price).
 *  - source (default "manual") — manual | live | import (foundation; only manual
 *    is written today).
 *  - lookup indexes for the company-scoped reads.
 *
 * company_id is left NULLABLE (no backfill) — old rows remain the legacy/global
 * fallback. No FK constraint (legacy NULLs + simplicity); scoping is in queries.
 * No data change, no DB reset.
 */
async function columnExists(qi, table, col) {
  try { return Boolean((await qi.describeTable(table))[col]); } catch { return false; }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    if (!(await columnExists(queryInterface, "gold_prices", "company_id"))) {
      await queryInterface.addColumn("gold_prices", "company_id", { type: Sequelize.STRING, allowNull: true });
    }
    if (!(await columnExists(queryInterface, "gold_prices", "source"))) {
      await queryInterface.addColumn("gold_prices", "source", { type: Sequelize.STRING, allowNull: false, defaultValue: "manual" });
    }
    for (const cols of [["company_id"], ["company_id", "karat"], ["company_id", "currency"], ["company_id", "karat", "currency"]]) {
      try {
        await queryInterface.addIndex("gold_prices", cols, { name: `gold_prices_${cols.join("_")}_idx` });
      } catch { /* exists */ }
    }
  },

  down: async (queryInterface) => {
    for (const cols of [["company_id"], ["company_id", "karat"], ["company_id", "currency"], ["company_id", "karat", "currency"]]) {
      try { await queryInterface.removeIndex("gold_prices", `gold_prices_${cols.join("_")}_idx`); } catch { /* ignore */ }
    }
    for (const col of ["company_id", "source"]) {
      if (await columnExists(queryInterface, "gold_prices", col)) await queryInterface.removeColumn("gold_prices", col);
    }
  },
};
