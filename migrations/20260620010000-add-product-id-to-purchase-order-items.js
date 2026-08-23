"use strict";

/**
 * Additive, non-destructive: add `product_id` to purchase_order_items so a
 * quantity-based receipt links the line to its PRODUCT, instead of forcing the
 * product id into `asset_id` (which is a FK to assets.id and therefore raised
 * "purchase_order_items_asset_id_fkey" for products).
 *
 * asset_id (FK → assets) stays for serialized items. product_id (FK → products)
 * is for quantity-based items. Both nullable; a line uses exactly one. No data
 * change, no FK dropped, no table recreate.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Historical installations obtained these tables through runtime
    // `Model.sync()`, which made a clean migration-only bootstrap impossible.
    // Create them only when absent so the migration remains additive for every
    // already-deployed database and fresh environments need no startup writes.
    try {
      await queryInterface.describeTable("products");
    } catch {
      await queryInterface.createTable("products", {
        id: { type: Sequelize.STRING, primaryKey: true },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
        product_code: { type: Sequelize.STRING, allowNull: false },
        product_name: { type: Sequelize.STRING, allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        karat: { type: Sequelize.INTEGER, allowNull: true },
        stock_type: { type: Sequelize.STRING, allowNull: true },
        branch_id: { type: Sequelize.STRING, allowNull: true },
        branch_name: { type: Sequelize.STRING, allowNull: true },
        warehouse_id: { type: Sequelize.STRING, allowNull: true },
        quantity_on_hand: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        quantity_available: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        quantity_sold: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        quantity_reserved: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        total_weight: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
        average_unit_weight: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
        unit_cost: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
        average_cost: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
        sale_price: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
        supplier_id: { type: Sequelize.STRING, allowNull: true },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
      await queryInterface.addIndex("products", ["company_id", "product_code"], { unique: true, name: "products_company_product_code_uq" });
    }
    try {
      await queryInterface.describeTable("stock_movements");
    } catch {
      await queryInterface.createTable("stock_movements", {
        id: { type: Sequelize.STRING, primaryKey: true },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
        product_id: { type: Sequelize.STRING, allowNull: true, references: { model: "products", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
        asset_id: { type: Sequelize.STRING, allowNull: true, references: { model: "assets", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
        product_code: { type: Sequelize.STRING, allowNull: false },
        type: { type: Sequelize.STRING, allowNull: false },
        quantity_in: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        quantity_out: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        weight_in: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
        weight_out: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
        unit_cost: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
        total_cost: { type: Sequelize.DECIMAL(15, 4), allowNull: false, defaultValue: 0 },
        reference_type: { type: Sequelize.STRING, allowNull: true },
        reference_id: { type: Sequelize.STRING, allowNull: true },
        supplier_id: { type: Sequelize.STRING, allowNull: true },
        customer_id: { type: Sequelize.STRING, allowNull: true },
        branch_id: { type: Sequelize.STRING, allowNull: true },
        warehouse_id: { type: Sequelize.STRING, allowNull: true },
        created_by: { type: Sequelize.STRING, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
    }
    const table = await queryInterface.describeTable("purchase_order_items");
    if (!table.product_id) {
      await queryInterface.addColumn("purchase_order_items", "product_id", {
        type: Sequelize.STRING,
        allowNull: true,
        references: { model: "products", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("purchase_order_items");
    if (table.product_id) {
      await queryInterface.removeColumn("purchase_order_items", "product_id");
    }
  },
};
