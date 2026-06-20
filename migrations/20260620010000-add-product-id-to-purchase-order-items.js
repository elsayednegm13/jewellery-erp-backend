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
