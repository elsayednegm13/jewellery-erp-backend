"use strict";

const { DataTypes } = require("sequelize");

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("reservation_deposit_receipt_sequences", {
        company_id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
        branch_id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
        sequence_year: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
        next_value: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: queryInterface.sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: queryInterface.sequelize.literal("CURRENT_TIMESTAMP") }
      }, { transaction });
      await queryInterface.createTable("reservation_deposit_receipt_documents", {
        id: { type: DataTypes.STRING, primaryKey: true },
        company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        branch_id: { type: DataTypes.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        reservation_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservations", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        reservation_payment_id: { type: DataTypes.STRING, allowNull: false, references: { model: "reservation_payments", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        customer_id: { type: DataTypes.STRING, allowNull: true, references: { model: "customers", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
        employee_id: { type: DataTypes.STRING, allowNull: true, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
        receipt_number: { type: DataTypes.STRING, allowNull: false },
        sequence_year: { type: DataTypes.INTEGER, allowNull: false },
        sequence_value: { type: DataTypes.BIGINT, allowNull: false },
        posted_at: { type: DataTypes.DATE, allowNull: false },
        status: { type: DataTypes.STRING, allowNull: false, defaultValue: "issued" },
        snapshot_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        snapshot: { type: DataTypes.JSONB, allowNull: false },
        created_by: { type: DataTypes.STRING, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: queryInterface.sequelize.literal("CURRENT_TIMESTAMP") }
      }, { transaction });
      await queryInterface.addIndex("reservation_deposit_receipt_documents", ["reservation_payment_id"], { unique: true, name: "reservation_deposit_receipt_payment_uq", transaction });
      await queryInterface.addIndex("reservation_deposit_receipt_documents", ["receipt_number"], { unique: true, name: "reservation_deposit_receipt_number_uq", transaction });
      await queryInterface.addIndex("reservation_deposit_receipt_documents", ["company_id", "branch_id", "sequence_year", "sequence_value"], { unique: true, name: "reservation_deposit_receipt_sequence_uq", transaction });
      await queryInterface.addIndex("reservation_deposit_receipt_documents", ["company_id", "reservation_id", "posted_at", "id"], { name: "reservation_deposit_receipt_history_idx", transaction });
    });
  },
  async down() {
    throw new Error("Irreversible financial-document migration: use a reviewed forward corrective migration instead of deleting issued receipt evidence.");
  }
};
