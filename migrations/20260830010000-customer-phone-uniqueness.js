"use strict";

const INDEX_NAME = "customers_company_id_canonical_phone_uq";
const CANONICAL_PHONE_SQL = "ltrim(regexp_replace(phone, '[^0-9]', '', 'g'), '0')";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [invalidRows] = await queryInterface.sequelize.query(
        `
          SELECT COUNT(*)::int AS count
          FROM customers
          WHERE phone IS NULL OR ${CANONICAL_PHONE_SQL} = ''
        `,
        { transaction },
      );
      if (Number(invalidRows[0]?.count || 0) > 0) {
        throw new Error("CUSTOMER_PHONE_CANONICALIZATION_INVALID_DATA");
      }

      const [duplicateRows] = await queryInterface.sequelize.query(
        `
          SELECT company_id, ${CANONICAL_PHONE_SQL} AS canonical_phone, COUNT(*)::int AS count
          FROM customers
          GROUP BY company_id, ${CANONICAL_PHONE_SQL}
          HAVING COUNT(*) > 1
          LIMIT 1
        `,
        { transaction },
      );
      if (duplicateRows.length > 0) {
        throw new Error("CUSTOMER_PHONE_CANONICALIZATION_DUPLICATES_EXIST");
      }

      await queryInterface.sequelize.query(
        `
          CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX_NAME}"
          ON customers (company_id, (${CANONICAL_PHONE_SQL}))
        `,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${INDEX_NAME}"`);
  },
};

