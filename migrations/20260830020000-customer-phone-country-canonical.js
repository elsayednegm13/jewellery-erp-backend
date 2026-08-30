"use strict";

const INDEX_NAME = "customers_company_id_canonical_phone_uq";

// CRM-1B4 supersedes the unexecuted CRM-1B2 expression index. The old
// migration remains historical and is not edited; this migration removes its
// clone-only index before creating the canonical persisted-field authority.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn("companies", "default_phone_country", {
        type: Sequelize.STRING(2),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn("customers", "phone_country", {
        type: Sequelize.STRING(2),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn("customers", "canonical_phone", {
        type: Sequelize.STRING(32),
        allowNull: true,
      }, { transaction });

      // CRM-1B2 is intentionally not changed in place. When the complete
      // migration sequence has applied it first, this drops only that
      // unqualified functional index on the disposable target.
      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS "${INDEX_NAME}"`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX "${INDEX_NAME}" ON customers (company_id, canonical_phone)`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS "${INDEX_NAME}"`,
        { transaction },
      );
      await queryInterface.removeColumn("customers", "canonical_phone", { transaction });
      await queryInterface.removeColumn("customers", "phone_country", { transaction });
      await queryInterface.removeColumn("companies", "default_phone_country", { transaction });
    });
  },
};
