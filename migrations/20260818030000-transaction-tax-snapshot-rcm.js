"use strict";

/**
 * G2A2 additive transaction-tax contract.
 *
 * Both columns are nullable by design: historical purchase orders remain
 * untouched and are not assigned a guessed treatment or RCM evidence.
 * Treatment values are validated by the backend tax service, not by a
 * destructive enum migration, so the five canonical values remain portable.
 */
async function columnExists(queryInterface, table, column) {
  try { return Boolean((await queryInterface.describeTable(table))[column]); } catch { return false; }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    if (!(await columnExists(queryInterface, "purchase_orders", "tax_treatment"))) {
      await queryInterface.addColumn("purchase_orders", "tax_treatment", { type: Sequelize.STRING(32), allowNull: true });
    }
    if (!(await columnExists(queryInterface, "purchase_orders", "tax_snapshot"))) {
      await queryInterface.addColumn("purchase_orders", "tax_snapshot", { type: Sequelize.JSONB, allowNull: true });
    }
  },
  down: async (queryInterface) => {
    if (await columnExists(queryInterface, "purchase_orders", "tax_snapshot")) await queryInterface.removeColumn("purchase_orders", "tax_snapshot");
    if (await columnExists(queryInterface, "purchase_orders", "tax_treatment")) await queryInterface.removeColumn("purchase_orders", "tax_treatment");
  },
};
