"use strict";

const { DataTypes } = require("sequelize");

/**
 * CUSTOMER-INVOICE-SNAPSHOT-IMPLEMENTATION-01
 * Additive, nullable historical contact evidence for posted invoices.
 * Intentionally contains no backfill, index, FK, or business-row update.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn("invoices", "customer_phone_snapshot", {
        type: DataTypes.STRING(255),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn("invoices", "customer_address_snapshot", {
        type: DataTypes.JSONB,
        allowNull: true,
      }, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("invoices", "customer_address_snapshot", { transaction });
      await queryInterface.removeColumn("invoices", "customer_phone_snapshot", { transaction });
    });
  },
};
