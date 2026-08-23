"use strict";

/**
 * G3 financial reconciliation closure.
 *
 * The canonical GBP tax snapshot and purchase-cost authority use 8 decimal
 * places. The original PO tax columns were numeric(15,4), which caused lossy
 * persistence even though purchase_orders.total already uses numeric(20,8).
 * This migration widens only the two proven lossy columns.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn("purchase_orders", "tax_base", {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.changeColumn("purchase_orders", "input_vat_amount", {
      type: Sequelize.DECIMAL(20, 8),
      allowNull: false,
      defaultValue: 0,
    });
  },

  // Do not run down: returning these columns to 4 decimals can be lossy after
  // new 8-decimal business data has been persisted.
  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn("purchase_orders", "tax_base", {
      type: Sequelize.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.changeColumn("purchase_orders", "input_vat_amount", {
      type: Sequelize.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 0,
    });
  },
};
