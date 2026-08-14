"use strict";

// CGP-M5 is intentionally structural only.  It never projects historical
// posted events into Assets; controlled event consumption is the sole runtime
// path that may create a CGP Asset.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [duplicates] = await queryInterface.sequelize.query(`
        SELECT cgp_item_id
        FROM asset_origins
        WHERE cgp_item_id IS NOT NULL
        GROUP BY cgp_item_id
        HAVING COUNT(*) > 1
        LIMIT 1
      `, { transaction });
      if (duplicates.length) throw new Error("CGP_M5_EXISTING_CGP_ITEM_ORIGIN_DUPLICATE");

      await queryInterface.sequelize.query("ALTER TYPE enum_assets_status ADD VALUE IF NOT EXISTS 'pending_integration'", { transaction });
      await queryInterface.removeConstraint("assets", "assets_operational_status_ck", { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE assets ADD CONSTRAINT assets_operational_status_ck CHECK (
        operational_status IN ('AVAILABLE','PENDING_INTEGRATION','RESERVED','PENDING_TRANSFER','WORKSHOP','RETURNED','MISSING','MELTED','SOLD')
      )`, { transaction });
      await queryInterface.removeConstraint("asset_origins", "asset_origins_type_ck", { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE asset_origins ADD CONSTRAINT asset_origins_type_ck CHECK (
        origin_type IN ('PURCHASE_ORDER','CGP','CUSTOMER_GOLD_PURCHASE','LEGACY_PRODUCT','MANUFACTURING_OUTPUT','LEGACY_UNKNOWN')
      )`, { transaction });
      await queryInterface.sequelize.query(`CREATE UNIQUE INDEX asset_origins_cgp_item_id_uq
        ON asset_origins (cgp_item_id) WHERE cgp_item_id IS NOT NULL`, { transaction });
    });
  },
  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: CGP Asset lineage and pending integration evidence cannot be removed safely");
  },
};
