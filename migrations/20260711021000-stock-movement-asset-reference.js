"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("stock_movements");

    if (table.product_id && table.product_id.allowNull === false) {
      await queryInterface.changeColumn("stock_movements", "product_id", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!table.asset_id) {
      await queryInterface.addColumn("stock_movements", "asset_id", {
        type: Sequelize.STRING,
        allowNull: true,
        references: {
          model: "assets",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }

    await queryInterface.addIndex("stock_movements", ["asset_id"], {
      name: "stock_movements_asset_id_idx",
    }).catch(() => {});
  },

  async down() {
    throw new Error("Rollback disabled for forward-only reservation asset stock movement foundation");
  },
};
