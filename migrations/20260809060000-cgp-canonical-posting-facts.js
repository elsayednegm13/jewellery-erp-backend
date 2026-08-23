"use strict";

const { DataTypes } = require("sequelize");

const TABLE = "customer_gold_purchase_documents";
const POSTING_REFERENCE_INDEX = "cgp_documents_company_posting_reference_uq";
const POSTED_FACTS_CONSTRAINT = "cgp_documents_posted_facts_ck";

module.exports = {
  async up(queryInterface) {
    // Additive durable facts distinguish a POSTED aggregate from VALIDATED
    // drafts while retaining all legacy documents unchanged.
    await queryInterface.addColumn(TABLE, "posted_at", { type: DataTypes.DATE, allowNull: true });
    await queryInterface.addColumn(TABLE, "posted_by", { type: DataTypes.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" });
    await queryInterface.addColumn(TABLE, "posting_reference", { type: DataTypes.STRING(128), allowNull: true });
    await queryInterface.addColumn(TABLE, "posting_metadata", { type: DataTypes.JSONB, allowNull: true });
    await queryInterface.addColumn(TABLE, "total_gold_value", { type: DataTypes.DECIMAL(20, 4), allowNull: true });
    await queryInterface.addColumn(TABLE, "total_payable_to_customer", { type: DataTypes.DECIMAL(20, 4), allowNull: true });
    await queryInterface.addIndex(TABLE, ["company_id", "posting_reference"], { unique: true, name: POSTING_REFERENCE_INDEX });
    await queryInterface.sequelize.query(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${POSTED_FACTS_CONSTRAINT}
      CHECK (
        business_status <> 'POSTED'
        OR (
          posted_at IS NOT NULL
          AND posted_by IS NOT NULL
          AND posting_reference IS NOT NULL
          AND total_gold_value IS NOT NULL
          AND total_payable_to_customer IS NOT NULL
        )
      )
    `);
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(`SELECT count(*)::int AS count FROM ${TABLE} WHERE business_status = 'POSTED'`);
    if (Number(rows?.[0]?.count || 0) > 0) throw new Error("CGP-M9 rollback is unsafe after canonical CGP Posting exists");
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${POSTED_FACTS_CONSTRAINT}`);
    await queryInterface.removeIndex(TABLE, POSTING_REFERENCE_INDEX);
    await queryInterface.removeColumn(TABLE, "total_payable_to_customer");
    await queryInterface.removeColumn(TABLE, "total_gold_value");
    await queryInterface.removeColumn(TABLE, "posting_metadata");
    await queryInterface.removeColumn(TABLE, "posting_reference");
    await queryInterface.removeColumn(TABLE, "posted_by");
    await queryInterface.removeColumn(TABLE, "posted_at");
  },
};
