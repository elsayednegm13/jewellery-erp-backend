"use strict";

/**
 * Phase 12F — additive, non-destructive: add header-level purchase VAT / RCM
 * fields to `purchase_orders`. Forward-only foundation; NO posting consumes them
 * yet (purchase-VAT posting lands in 12G) and there is NO backfill — existing
 * rows take the safe defaults (no VAT, recoverable, not RCM), which reproduce
 * today's behaviour exactly.
 *
 *  - tax_base / vat_rate / input_vat_amount  → recoverable input VAT (12G)
 *  - tax_included                            → supplier invoice inclusive flag
 *  - is_recoverable                          → input VAT recoverable vs cost
 *  - is_rcm / rcm_vat_amount / rcm_rate      → reverse-charge (DRC), net-zero
 *
 * No id change, no data rewrite, no FK touched, no index, no DB reset.
 */

async function columnExists(qi, table, col) {
  try { return Boolean((await qi.describeTable(table))[col]); } catch { return false; }
}

const COLUMNS = (Sequelize) => ({
  tax_base: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
  vat_rate: { type: Sequelize.DECIMAL(6, 3), allowNull: false, defaultValue: 0 },
  input_vat_amount: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
  tax_included: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
  is_recoverable: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
  is_rcm: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
  rcm_vat_amount: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
  rcm_rate: { type: Sequelize.DECIMAL(6, 3), allowNull: false, defaultValue: 0 },
});

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = COLUMNS(Sequelize);
    for (const [name, spec] of Object.entries(cols)) {
      if (!(await columnExists(queryInterface, "purchase_orders", name))) {
        await queryInterface.addColumn("purchase_orders", name, spec);
      }
    }
  },

  down: async (queryInterface) => {
    for (const name of Object.keys(COLUMNS(require("sequelize")))) {
      if (await columnExists(queryInterface, "purchase_orders", name)) {
        await queryInterface.removeColumn("purchase_orders", name);
      }
    }
  },
};
