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

async function addColumnIfNotExists(queryInterface, tableName, columnName, definition) {
  const exists = await columnExists(queryInterface, tableName, columnName);
  if (!exists) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

module.exports = {
  up: async (queryInterface) => {
    await addColumnIfNotExists(queryInterface, "supplier_documents", "file_name", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, "supplier_documents", "original_file_name", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, "supplier_documents", "mime_type", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, "supplier_documents", "file_size", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, "supplier_documents", "uploaded_by", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, "supplier_documents", "uploaded_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    const columns = ["file_name", "original_file_name", "mime_type", "file_size", "uploaded_by", "uploaded_at"];
    for (const col of columns) {
      const exists = await columnExists(queryInterface, "supplier_documents", col);
      if (exists) {
        await queryInterface.removeColumn("supplier_documents", col);
      }
    }
  }
};
