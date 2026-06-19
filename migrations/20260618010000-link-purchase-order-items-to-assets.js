"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("purchase_order_items");
    if (!table.asset_id) {
      await queryInterface.addColumn("purchase_order_items", "asset_id", {
        type: Sequelize.STRING,
        allowNull: true,
        references: { model: "assets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("purchase_order_items");
    if (table.asset_id) {
      await queryInterface.removeColumn("purchase_order_items", "asset_id");
    }
  },
};
