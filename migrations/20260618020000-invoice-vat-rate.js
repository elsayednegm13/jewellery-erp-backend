"use strict";

const { DataTypes } = require("sequelize");

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
    const exists = await columnExists(queryInterface, "invoices", "vat_rate");
    if (!exists) {
      await queryInterface.addColumn("invoices", "vat_rate", {
        type: DataTypes.DECIMAL(6, 3),
        allowNull: true,
      });
    }
  },

  down: async (queryInterface) => {
    const exists = await columnExists(queryInterface, "invoices", "vat_rate");
    if (exists) {
      await queryInterface.removeColumn("invoices", "vat_rate");
    }
  },
};
