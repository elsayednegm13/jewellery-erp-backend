const { DataTypes } = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    // 1. Create stock_audits table
    await queryInterface.createTable("stock_audits", {
      id: {
        type: DataTypes.STRING,
        primaryKey: true
      },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      branch_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "branches", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      status: {
        type: DataTypes.ENUM("in-progress", "completed", "cancelled"),
        allowNull: false,
        defaultValue: "in-progress"
      },
      created_by: {
        type: DataTypes.STRING,
        allowNull: false
      },
      completed_at: {
        type: DataTypes.STRING,
        allowNull: true
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });

    // 2. Create stock_audit_items table
    await queryInterface.createTable("stock_audit_items", {
      id: {
        type: DataTypes.STRING,
        primaryKey: true
      },
      stock_audit_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "stock_audits", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      asset_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "assets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      expected_branch_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "branches", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      scanned_branch_id: {
        type: DataTypes.STRING,
        allowNull: true,
        references: { model: "branches", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      status: {
        type: DataTypes.ENUM("matched", "missing", "unexpected"),
        allowNull: false
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("stock_audit_items");
    await queryInterface.dropTable("stock_audits");
  }
};
