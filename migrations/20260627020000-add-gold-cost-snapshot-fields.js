"use strict";

/**
 * Phase 15D — additive, non-destructive: add gold-cost snapshot / cost-metadata
 * fields to `purchase_order_items` and `assets`. Forward-only foundation; NO
 * calculation, override, posting, COGS or valuation consumes them yet
 * (15E/15F/15G). NO backfill — existing rows take the safe metadata defaults
 * (cost_source="manual", cost_overridden=false) and NULL for every computed
 * field, so an old row never looks like it carries a real snapshot.
 *
 * Computed fields are intentionally NULLABLE with NO default 0. Existing
 * Asset.cost / Product.averageCost / StockMovement cost are untouched. No id
 * change, no data rewrite, no FK touched, no index, no DB reset.
 */

async function columnExists(qi, table, col) {
  try { return Boolean((await qi.describeTable(table))[col]); } catch { return false; }
}

const COLUMNS = (Sequelize) => ({
  gold_price_snapshot: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
  gold_price_source: { type: Sequelize.STRING, allowNull: true },
  gold_price_karat: { type: Sequelize.STRING, allowNull: true },
  gold_price_at: { type: Sequelize.DATE, allowNull: true },
  computed_gold_cost: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
  final_purchase_cost: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
  cost_source: { type: Sequelize.STRING, allowNull: false, defaultValue: "manual" },
  cost_overridden: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
  override_reason: { type: Sequelize.TEXT, allowNull: true },
  override_by: { type: Sequelize.STRING, allowNull: true },
  override_at: { type: Sequelize.DATE, allowNull: true },
  net_gold_weight: { type: Sequelize.DECIMAL(15, 4), allowNull: true },
});

const TABLES = ["purchase_order_items", "assets"];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = COLUMNS(Sequelize);
    for (const table of TABLES) {
      for (const [name, spec] of Object.entries(cols)) {
        if (!(await columnExists(queryInterface, table, name))) {
          await queryInterface.addColumn(table, name, spec);
        }
      }
    }
  },

  down: async (queryInterface) => {
    for (const table of TABLES) {
      for (const name of Object.keys(COLUMNS(require("sequelize")))) {
        if (await columnExists(queryInterface, table, name)) {
          await queryInterface.removeColumn(table, name);
        }
      }
    }
  },
};
