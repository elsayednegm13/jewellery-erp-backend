"use strict";

const crypto = require("crypto");
const manifest = require("../src/services/inventory-master-data-manifest");

function stableId(category, canonicalValue) {
  const digest = crypto.createHash("sha256").update(`INVENTORY_REFERENCE_MASTER_DATA|3|${category}|${canonicalValue}`).digest("hex");
  return `PMD-R3-${digest.slice(0, 26)}`;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [companies] = await queryInterface.sequelize.query("SELECT id FROM companies ORDER BY id", { transaction });
      for (const company of companies) {
        await queryInterface.sequelize.query(`
          INSERT INTO profile_master_data
            (id, company_id, category_key, canonical_value, display_label, is_active, sort_order, created_at, updated_at)
          VALUES (:id, :companyId, 'DIAMOND_NAME', 'diamond', 'Diamond', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (company_id, category_key, canonical_value) DO NOTHING
        `, { replacements: { id: stableId("DIAMOND_NAME", "diamond"), companyId: company.id }, transaction });
      }

      await queryInterface.sequelize.query(
        "ALTER TABLE asset_profile_master_data_references DROP CONSTRAINT IF EXISTS asset_master_reference_uq, DROP CONSTRAINT IF EXISTS asset_profile_master_reference_uq",
        { transaction },
      );
      await queryInterface.addConstraint("asset_profile_master_data_references", {
        fields: ["asset_id", "category_key", "master_data_id"],
        type: "unique",
        name: "asset_master_reference_value_uq",
        transaction,
      });

      await queryInterface.sequelize.query(`
        UPDATE inventory_master_data_bootstrap_states
           SET current_version = 3,
               manifest_hash = :manifestHash
         WHERE dataset_id = 'INVENTORY_REFERENCE_MASTER_DATA'
           AND current_version = 2
           AND state = 'READY'
      `, { replacements: { manifestHash: manifest.manifestHash() }, transaction }).catch(() => undefined);
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: Loose Diamond master data must not be rolled back automatically");
  },
};
