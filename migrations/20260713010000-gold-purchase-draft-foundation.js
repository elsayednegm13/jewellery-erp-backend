"use strict";

const { DataTypes } = require("sequelize");

const actorReference = {
  type: DataTypes.STRING,
  allowNull: true,
  references: { model: "users", key: "id" },
  onUpdate: "CASCADE",
  onDelete: "SET NULL"
};

function commonHeader(referenceField, referenceTable) {
  return {
    id: { type: DataTypes.STRING, primaryKey: true },
    company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
    branch_id: { type: DataTypes.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
    draft_number: { type: DataTypes.STRING, allowNull: false },
    [referenceField]: { type: DataTypes.STRING, allowNull: false, references: { model: referenceTable, key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    exchange_rate: { type: DataTypes.DECIMAL(24, 8), allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.ENUM("draft", "validated"), allowNull: false, defaultValue: "draft" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_by: actorReference,
    updated_by: actorReference,
    validated_at: { type: DataTypes.DATE, allowNull: true },
    validated_by: actorReference,
    voided_at: { type: DataTypes.DATE, allowNull: true },
    voided_by: actorReference,
    void_reason: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false }
  };
}

const commonItem = {
  id: { type: DataTypes.STRING, primaryKey: true },
  company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
  line_number: { type: DataTypes.INTEGER, allowNull: false },
  gold_type: { type: DataTypes.STRING, allowNull: false },
  karat: { type: DataTypes.DECIMAL(8, 6), allowNull: false },
  fineness: { type: DataTypes.DECIMAL(10, 6), allowNull: false },
  purity_factor: { type: DataTypes.DECIMAL(10, 6), allowNull: false },
  gross_weight: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
  stone_weight: { type: DataTypes.DECIMAL(20, 6), allowNull: false, defaultValue: 0 },
  net_weight: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
  pure_gold_weight: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
  reference_market_rate: { type: DataTypes.DECIMAL(20, 4), allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  created_at: { type: DataTypes.DATE, allowNull: false },
  updated_at: { type: DataTypes.DATE, allowNull: false },
  deleted_at: { type: DataTypes.DATE, allowNull: true }
};

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable("customer_gold_purchase_documents", {
      ...commonHeader("customer_id", "customers"),
      transaction_date: { type: DataTypes.DATEONLY, allowNull: false }
    });
    await queryInterface.createTable("customer_gold_purchase_items", {
      ...commonItem,
      document_id: { type: DataTypes.STRING, allowNull: false, references: { model: "customer_gold_purchase_documents", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      proposed_rate: { type: DataTypes.DECIMAL(20, 4), allowNull: true },
      deduction_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
    });

    await queryInterface.createTable("investment_gold_purchase_documents", {
      ...commonHeader("supplier_id", "suppliers"),
      supplier_reference: { type: DataTypes.STRING, allowNull: true },
      purchase_date: { type: DataTypes.DATEONLY, allowNull: false }
    });
    await queryInterface.createTable("investment_gold_purchase_items", {
      ...commonItem,
      document_id: { type: DataTypes.STRING, allowNull: false, references: { model: "investment_gold_purchase_documents", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      investment_type: { type: DataTypes.ENUM("physical", "bullion"), allowNull: false },
      bullion_identity_type: { type: DataTypes.ENUM("serialized_unit", "bullion_lot"), allowNull: true },
      serial_number: { type: DataTypes.STRING, allowNull: true },
      lot_number: { type: DataTypes.STRING, allowNull: true },
      quantity: { type: DataTypes.DECIMAL(20, 6), allowNull: false, defaultValue: 1 },
      proposed_purchase_rate: { type: DataTypes.DECIMAL(20, 4), allowNull: true },
      proposed_charges: { type: DataTypes.DECIMAL(20, 4), allowNull: true },
      proposed_discount: { type: DataTypes.DECIMAL(20, 4), allowNull: true },
      tax_mode_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
    });

    const indexes = [
      ["customer_gold_purchase_documents", ["company_id", "draft_number"], { unique: true, name: "cgp_documents_company_draft_uq" }],
      ["customer_gold_purchase_documents", ["company_id", "branch_id", "status"], { name: "cgp_documents_scope_status_idx" }],
      ["customer_gold_purchase_documents", ["company_id", "customer_id", "transaction_date"], { name: "cgp_documents_customer_date_idx" }],
      ["customer_gold_purchase_items", ["document_id", "line_number"], { unique: true, name: "cgp_items_document_line_uq" }],
      ["customer_gold_purchase_items", ["karat"], { name: "cgp_items_karat_idx" }],
      ["investment_gold_purchase_documents", ["company_id", "draft_number"], { unique: true, name: "igp_documents_company_draft_uq" }],
      ["investment_gold_purchase_documents", ["company_id", "branch_id", "status"], { name: "igp_documents_scope_status_idx" }],
      ["investment_gold_purchase_documents", ["company_id", "supplier_id", "purchase_date"], { name: "igp_documents_supplier_date_idx" }],
      ["investment_gold_purchase_items", ["document_id", "line_number"], { unique: true, name: "igp_items_document_line_uq" }],
      ["investment_gold_purchase_items", ["karat"], { name: "igp_items_karat_idx" }],
      ["investment_gold_purchase_items", ["investment_type", "bullion_identity_type"], { name: "igp_items_type_idx" }]
    ];
    for (const [table, fields, options] of indexes) await queryInterface.addIndex(table, fields, options);
    await queryInterface.sequelize.query("CREATE UNIQUE INDEX igp_items_company_serial_uq ON investment_gold_purchase_items (company_id, serial_number) WHERE serial_number IS NOT NULL AND deleted_at IS NULL");
    await queryInterface.sequelize.query("CREATE UNIQUE INDEX igp_items_company_lot_uq ON investment_gold_purchase_items (company_id, lot_number) WHERE lot_number IS NOT NULL AND deleted_at IS NULL");
  },

  async down(queryInterface) {
    await queryInterface.dropTable("investment_gold_purchase_items");
    await queryInterface.dropTable("investment_gold_purchase_documents");
    await queryInterface.dropTable("customer_gold_purchase_items");
    await queryInterface.dropTable("customer_gold_purchase_documents");
  }
};
