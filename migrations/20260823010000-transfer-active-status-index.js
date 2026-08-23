"use strict";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex("transfer_items", "transfer_items_one_active_uq", { transaction });
      await queryInterface.addIndex("transfer_items", ["asset_id"], {
        unique: true,
        where: { status: ["PENDING", "APPROVED", "IN_TRANSIT"] },
        name: "transfer_items_one_active_uq",
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex("transfer_items", "transfer_items_one_active_uq", { transaction });
      await queryInterface.addIndex("transfer_items", ["asset_id"], {
        unique: true,
        where: { status: ["REQUESTED", "APPROVED", "DISPATCHED"] },
        name: "transfer_items_one_active_uq",
        transaction,
      });
    });
  },
};
