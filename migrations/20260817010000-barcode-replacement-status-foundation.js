"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [duplicates] = await queryInterface.sequelize.query(`
        SELECT btrim(barcode) AS barcode
        FROM assets
        WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
        GROUP BY btrim(barcode)
        HAVING COUNT(*) > 1
        LIMIT 1
      `, { transaction });
      if (duplicates.length) throw new Error("BARCODE_HISTORY_BACKFILL_DUPLICATES_EXIST");

      await queryInterface.createTable("asset_barcode_history", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        barcode: { type: Sequelize.STRING, allowNull: false },
        barcode_revision: { type: Sequelize.INTEGER, allowNull: false },
        state: { type: Sequelize.STRING(16), allowNull: false },
        action: { type: Sequelize.STRING(16), allowNull: false },
        issued_at: { type: Sequelize.DATE, allowNull: false },
        issued_by: { type: Sequelize.STRING, allowNull: true },
        retired_at: { type: Sequelize.DATE, allowNull: true },
        retired_by: { type: Sequelize.STRING, allowNull: true },
        retirement_reason: { type: Sequelize.TEXT, allowNull: true },
        source_type: { type: Sequelize.STRING(48), allowNull: true },
        source_id: { type: Sequelize.STRING, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });

      await queryInterface.sequelize.query(`
        ALTER TABLE asset_barcode_history
        ADD CONSTRAINT asset_barcode_history_state_ck CHECK (state IN ('ACTIVE','RETIRED')),
        ADD CONSTRAINT asset_barcode_history_action_ck CHECK (action IN ('INITIAL','REPLACEMENT')),
        ADD CONSTRAINT asset_barcode_history_revision_ck CHECK (barcode_revision >= 1)
      `, { transaction });
      await queryInterface.addIndex("asset_barcode_history", ["barcode"], { unique: true, name: "asset_barcode_history_barcode_uq", transaction });
      await queryInterface.addIndex("asset_barcode_history", ["asset_id", "barcode_revision"], { unique: true, name: "asset_barcode_history_asset_revision_uq", transaction });
      await queryInterface.addIndex("asset_barcode_history", ["asset_id"], { unique: true, where: { state: "ACTIVE" }, name: "asset_barcode_history_one_active_uq", transaction });
      await queryInterface.addIndex("asset_barcode_history", ["company_id", "asset_id", "issued_at"], { name: "asset_barcode_history_asset_time_idx", transaction });

      await queryInterface.sequelize.query(`
        INSERT INTO asset_barcode_history
          (id,asset_id,company_id,barcode,barcode_revision,state,action,issued_at,issued_by,source_type,source_id,created_at,updated_at)
        SELECT
          'ABH-LEGACY-' || a.id,
          a.id,
          a.company_id,
          btrim(a.barcode),
          GREATEST(COALESCE(a.barcode_revision,1),1),
          'ACTIVE',
          'INITIAL',
          COALESCE(a.barcode_generated_at,a.created_at,CURRENT_TIMESTAMP),
          a.created_by,
          'LEGACY_BACKFILL',
          a.id,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM assets a
        WHERE a.barcode IS NOT NULL AND btrim(a.barcode) <> ''
      `, { transaction });

      // The existing identity trigger remains the database guard. A barcode
      // replacement is the only narrowly scoped exception, and the service
      // sets this transaction-local marker immediately before its locked update.
      await queryInterface.sequelize.query(`
        CREATE OR REPLACE FUNCTION inventory_asset_identity_guard() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'INVENTORY_ASSET_HARD_DELETE_FORBIDDEN';
          END IF;
          IF NEW.barcode IS DISTINCT FROM OLD.barcode
             AND current_setting('darfus.inventory_barcode_replacement', true) <> 'approved' THEN
            RAISE EXCEPTION 'INVENTORY_ASSET_BARCODE_IMMUTABLE';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `, { transaction });

      await queryInterface.sequelize.query(`
        CREATE OR REPLACE FUNCTION inventory_asset_barcode_history_insert_guard() RETURNS trigger AS $$
        BEGIN
          INSERT INTO asset_barcode_history
            (id,asset_id,company_id,barcode,barcode_revision,state,action,issued_at,issued_by,source_type,source_id,created_at,updated_at)
          VALUES
            ('ABH-INITIAL-' || NEW.id,NEW.id,NEW.company_id,btrim(NEW.barcode),GREATEST(COALESCE(NEW.barcode_revision,1),1),'ACTIVE','INITIAL',COALESCE(NEW.barcode_generated_at,NEW.created_at,CURRENT_TIMESTAMP),NEW.created_by,'ASSET_CREATE',NEW.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS assets_barcode_history_insert_trg ON assets;
        CREATE TRIGGER assets_barcode_history_insert_trg AFTER INSERT ON assets
          FOR EACH ROW EXECUTE FUNCTION inventory_asset_barcode_history_insert_guard();
      `, { transaction });
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: barcode history is permanent identity evidence");
  },
};
