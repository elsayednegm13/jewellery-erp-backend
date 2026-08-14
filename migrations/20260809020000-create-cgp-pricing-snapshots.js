"use strict";

const { DataTypes } = require("sequelize");

const TABLE = "cgp_pricing_snapshots";
const RATE_BASIS_CONSTRAINT = "cgp_pricing_snapshots_rate_basis_ck";

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable(TABLE, {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      branch_id: { type: DataTypes.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      cgp_document_id: { type: DataTypes.STRING, allowNull: false, references: { model: "customer_gold_purchase_documents", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      cgp_item_id: { type: DataTypes.STRING, allowNull: false, references: { model: "customer_gold_purchase_items", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      price_source: { type: DataTypes.STRING(128), allowNull: false },
      price_version: { type: DataTypes.STRING(64), allowNull: false },
      price_timestamp: { type: DataTypes.DATE, allowNull: false },
      currency: { type: DataTypes.STRING(3), allowNull: false },
      karat: { type: DataTypes.DECIMAL(8, 6), allowNull: false },
      purity_factor: { type: DataTypes.DECIMAL(10, 6), allowNull: false },
      gross_weight: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
      stone_weight: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
      net_weight: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
      pure_gold_weight: { type: DataTypes.DECIMAL(20, 6), allowNull: false },
      approved_karat_rate: { type: DataTypes.DECIMAL(20, 4), allowNull: false },
      rate_basis: { type: DataTypes.STRING(32), allowNull: false },
      line_gold_value: { type: DataTypes.DECIMAL(20, 4), allowNull: false },
      calculation_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      created_by: { type: DataTypes.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${RATE_BASIS_CONSTRAINT} CHECK (rate_basis = 'KARAT_SPECIFIC')`);
    // A canonical item belongs to one immutable posting lifecycle. Revisions
    // allocate new item IDs, so this prevents duplicate price truth without
    // erasing historical revision snapshots.
    await queryInterface.addIndex(TABLE, ["cgp_item_id"], { unique: true, name: "cgp_pricing_snapshots_item_uq" });
    await queryInterface.addIndex(TABLE, ["company_id", "branch_id", "cgp_document_id"], { name: "cgp_pricing_snapshots_scope_document_idx" });
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(`SELECT count(*)::int AS count FROM ${TABLE}`);
    if (Number(rows?.[0]?.count || 0) > 0) throw new Error("CGP-M2 rollback is unsafe after immutable pricing snapshots exist");
    await queryInterface.dropTable(TABLE);
  },
};
