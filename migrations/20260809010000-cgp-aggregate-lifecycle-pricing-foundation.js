"use strict";

const { DataTypes } = require("sequelize");

const LEGACY_STATUS_MAPPINGS = Object.freeze({
  draft: { business: "DRAFT", governance: "NONE" },
  validated: { business: "VALIDATED", governance: "NONE" },
  submitted: { business: "VALIDATED", governance: "PENDING" },
  approved: { business: "VALIDATED", governance: "APPROVED" },
});

const TABLE = "customer_gold_purchase_documents";
const BUSINESS_CONSTRAINT = "cgp_documents_business_status_ck";
const GOVERNANCE_CONSTRAINT = "cgp_documents_governance_status_ck";
const STATUS_INDEX = "cgp_documents_business_governance_idx";

async function assertKnownLegacyStatuses(queryInterface) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT array_agg(DISTINCT status ORDER BY status) AS statuses
    FROM ${TABLE}
    WHERE status NOT IN ('draft', 'validated', 'submitted', 'approved')
  `);
  const statuses = rows?.[0]?.statuses || [];
  if (statuses.length) throw new Error(`CGP-M1 cannot map unknown legacy statuses: ${statuses.join(", ")}`);
}

module.exports = {
  async up(queryInterface) {
    await assertKnownLegacyStatuses(queryInterface);

    // Nullable first preserves every existing row while the deterministic
    // compatibility mapping is populated; NOT NULL follows only afterwards.
    await queryInterface.addColumn(TABLE, "business_status", { type: DataTypes.STRING(16), allowNull: true });
    await queryInterface.addColumn(TABLE, "governance_status", { type: DataTypes.STRING(16), allowNull: true });
    await queryInterface.sequelize.query(`
      UPDATE ${TABLE}
      SET business_status = CASE status
        WHEN 'draft' THEN 'DRAFT'
        WHEN 'validated' THEN 'VALIDATED'
        WHEN 'submitted' THEN 'VALIDATED'
        WHEN 'approved' THEN 'VALIDATED'
      END,
      governance_status = CASE status
        WHEN 'draft' THEN 'NONE'
        WHEN 'validated' THEN 'NONE'
        WHEN 'submitted' THEN 'PENDING'
        WHEN 'approved' THEN 'APPROVED'
      END
    `);
    await queryInterface.changeColumn(TABLE, "business_status", { type: DataTypes.STRING(16), allowNull: false, defaultValue: "DRAFT" });
    await queryInterface.changeColumn(TABLE, "governance_status", { type: DataTypes.STRING(16), allowNull: false, defaultValue: "NONE" });
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${BUSINESS_CONSTRAINT} CHECK (business_status IN ('DRAFT', 'VALIDATED', 'POSTED', 'REVERSED'))`);
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${GOVERNANCE_CONSTRAINT} CHECK (governance_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED'))`);
    await queryInterface.addIndex(TABLE, ["company_id", "branch_id", "business_status", "governance_status"], { name: STATUS_INDEX });
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(`SELECT count(*)::int AS count FROM ${TABLE} WHERE business_status IN ('POSTED', 'REVERSED')`);
    if (Number(rows?.[0]?.count || 0) > 0) throw new Error("CGP-M1 rollback is unsafe after Posted or Reversed CGP business state exists");
    await queryInterface.removeIndex(TABLE, STATUS_INDEX);
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${GOVERNANCE_CONSTRAINT}`);
    await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${BUSINESS_CONSTRAINT}`);
    await queryInterface.removeColumn(TABLE, "governance_status");
    await queryInterface.removeColumn(TABLE, "business_status");
  },

  LEGACY_STATUS_MAPPINGS,
};
