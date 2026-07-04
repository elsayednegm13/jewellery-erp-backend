"use strict";

/**
 * Phase 19X.2-B — additive, non-destructive: add DB-backed company contact
 * columns to `companies` (phone / email / website). Forward-only foundation for
 * making Company Profile the master source of company contact data.
 *
 * All nullable, no defaults, no backfill — existing rows take NULL, which the
 * auth serializer renders as "" (reproducing today's behaviour exactly). No id
 * change, no data rewrite, no FK touched, no index, no DB reset.
 */

async function columnExists(qi, table, col) {
  try { return Boolean((await qi.describeTable(table))[col]); } catch { return false; }
}

const COLUMNS = (Sequelize) => ({
  phone: { type: Sequelize.STRING(40), allowNull: true },
  email: { type: Sequelize.STRING(160), allowNull: true },
  website: { type: Sequelize.STRING(200), allowNull: true },
});

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = COLUMNS(Sequelize);
    for (const [name, spec] of Object.entries(cols)) {
      if (!(await columnExists(queryInterface, "companies", name))) {
        await queryInterface.addColumn("companies", name, spec);
      }
    }
  },

  down: async (queryInterface) => {
    for (const name of Object.keys(COLUMNS(require("sequelize")))) {
      if (await columnExists(queryInterface, "companies", name)) {
        await queryInterface.removeColumn("companies", name);
      }
    }
  },
};
