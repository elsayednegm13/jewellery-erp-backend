"use strict";

const {
  DEFAULT_BARCODE_INVENTORY_CODES,
  DEFAULT_BARCODE_ITEM_CODES,
} = require("../src/config/barcode-defaults");

async function tableExists(queryInterface, tableName) {
  try { await queryInterface.describeTable(tableName); return true; } catch { return false; }
}

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  const columns = await queryInterface.describeTable(tableName);
  if (!columns[columnName]) await queryInterface.addColumn(tableName, columnName, definition);
}

async function addIndexIfMissing(queryInterface, tableName, fields, options) {
  const indexes = await queryInterface.showIndex(tableName);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(tableName, fields, options);
  }
}

async function hasDuplicate(queryInterface, expression, whereSql) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 FROM assets WHERE ${whereSql} GROUP BY ${expression} HAVING COUNT(*) > 1 LIMIT 1`
  );
  return rows.length > 0;
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Additive nullable fields only. Existing barcodes are deliberately not
    // parsed, rewritten, or backfilled in this phase.
    await addColumnIfMissing(queryInterface, "assets", "inventory_code", { type: Sequelize.STRING(6), allowNull: true });
    await addColumnIfMissing(queryInterface, "assets", "item_code", { type: Sequelize.STRING(6), allowNull: true });
    await addColumnIfMissing(queryInterface, "assets", "karat_code", { type: Sequelize.STRING(2), allowNull: true });
    await addColumnIfMissing(queryInterface, "assets", "barcode_serial", { type: Sequelize.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, "assets", "barcode_generated_at", { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "assets", "barcode_revision", { type: Sequelize.INTEGER, allowNull: true, defaultValue: 1 });
    await addColumnIfMissing(queryInterface, "assets", "inventory_subtype", { type: Sequelize.STRING(60), allowNull: true });
    await addColumnIfMissing(queryInterface, "assets", "metadata_schema_version", { type: Sequelize.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, "assets", "metadata", { type: Sequelize.JSONB, allowNull: true });

    if (!(await tableExists(queryInterface, "barcode_inventory_codes"))) {
      await queryInterface.createTable("barcode_inventory_codes", {
        id: { type: Sequelize.STRING, primaryKey: true },
        company_id: { type: Sequelize.STRING, allowNull: false },
        code: { type: Sequelize.STRING(6), allowNull: false },
        display_name: { type: Sequelize.STRING, allowNull: false },
        asset_type: { type: Sequelize.STRING(40), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        is_client_approved: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        is_provisional: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        requires_karat: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        default_karat_code: { type: Sequelize.STRING(2), allowNull: true },
        default_item_code: { type: Sequelize.STRING(6), allowNull: true },
        sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_by: { type: Sequelize.STRING, allowNull: true },
        updated_by: { type: Sequelize.STRING, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!(await tableExists(queryInterface, "barcode_item_codes"))) {
      await queryInterface.createTable("barcode_item_codes", {
        id: { type: Sequelize.STRING, primaryKey: true },
        company_id: { type: Sequelize.STRING, allowNull: false },
        code: { type: Sequelize.STRING(6), allowNull: false },
        display_name: { type: Sequelize.STRING, allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        is_client_approved: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        is_provisional: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        allowed_inventory_codes: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_by: { type: Sequelize.STRING, allowNull: true },
        updated_by: { type: Sequelize.STRING, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!(await tableExists(queryInterface, "barcode_sequences"))) {
      await queryInterface.createTable("barcode_sequences", {
        id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
        company_id: { type: Sequelize.STRING, allowNull: false },
        inventory_code: { type: Sequelize.STRING(6), allowNull: false },
        item_code: { type: Sequelize.STRING(6), allowNull: false },
        karat_code: { type: Sequelize.STRING(2), allowNull: false },
        last_serial: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
    }

    await addIndexIfMissing(queryInterface, "barcode_inventory_codes", ["company_id", "code"], { name: "barcode_inventory_codes_company_code_uq", unique: true });
    await addIndexIfMissing(queryInterface, "barcode_item_codes", ["company_id", "code"], { name: "barcode_item_codes_company_code_uq", unique: true });
    await addIndexIfMissing(queryInterface, "barcode_sequences", ["company_id", "inventory_code", "item_code", "karat_code"], { name: "barcode_sequences_scope_uq", unique: true });

    // New component columns are NULL on historical rows, so this partial index
    // adds no backfill requirement and protects only newly generated identities.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS assets_barcode_components_uq
      ON assets (company_id, inventory_code, item_code, karat_code, barcode_serial)
      WHERE inventory_code IS NOT NULL AND item_code IS NOT NULL
        AND karat_code IS NOT NULL AND barcode_serial IS NOT NULL
    `);

    // Historical demo/legacy data may contain duplicate barcodes or RFID values.
    // Add uniqueness only when the live preflight proves it is safe; never mutate
    // or backfill those rows inside this migration.
    const barcodeDuplicates = await hasDuplicate(
      queryInterface,
      "company_id, btrim(barcode)",
      "barcode IS NOT NULL AND btrim(barcode) <> ''"
    );
    if (!barcodeDuplicates) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS assets_company_barcode_uq
        ON assets (company_id, barcode)
        WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
      `);
    } else {
      console.warn("[Phase 32.1] Existing duplicate asset barcodes detected; assets_company_barcode_uq was not created. Run the read-only barcode preflight before a later remediation phase.");
    }

    const rfidDuplicates = await hasDuplicate(
      queryInterface,
      "company_id, btrim(rfid)",
      "rfid IS NOT NULL AND btrim(rfid) <> ''"
    );
    if (!rfidDuplicates) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS assets_company_rfid_uq
        ON assets (company_id, rfid)
        WHERE rfid IS NOT NULL AND btrim(rfid) <> ''
      `);
    } else {
      console.warn("[Phase 32.1] Existing duplicate RFID values detected; assets_company_rfid_uq was not created. No existing RFID was changed.");
    }

    // Bootstrap company-scoped editable taxonomy rows. This is operational
    // configuration, not demo data, and does not touch Asset.barcode.
    const [companies] = await queryInterface.sequelize.query("SELECT id FROM companies");
    const now = new Date();
    for (const company of companies) {
      const [existingInventory] = await queryInterface.sequelize.query(
        "SELECT code FROM barcode_inventory_codes WHERE company_id = :companyId",
        { replacements: { companyId: company.id } }
      );
      const inventoryCodes = new Set(existingInventory.map((row) => row.code));
      const inventoryRows = DEFAULT_BARCODE_INVENTORY_CODES.filter((row) => !inventoryCodes.has(row.code)).map((row) => ({
        id: `${company.id}:INV:${row.code}`,
        company_id: company.id,
        code: row.code,
        display_name: row.displayName,
        asset_type: row.assetType,
        description: row.description,
        is_active: row.isActive,
        is_client_approved: row.isClientApproved,
        is_provisional: row.isProvisional,
        requires_karat: row.requiresKarat,
        default_karat_code: row.defaultKaratCode,
        default_item_code: row.defaultItemCode,
        sort_order: row.sortOrder,
        created_by: "migration:phase-32.1",
        updated_by: "migration:phase-32.1",
        created_at: now,
        updated_at: now,
      }));
      if (inventoryRows.length) await queryInterface.bulkInsert("barcode_inventory_codes", inventoryRows);

      const [existingItems] = await queryInterface.sequelize.query(
        "SELECT code FROM barcode_item_codes WHERE company_id = :companyId",
        { replacements: { companyId: company.id } }
      );
      const itemCodes = new Set(existingItems.map((row) => row.code));
      const itemRows = DEFAULT_BARCODE_ITEM_CODES.filter((row) => !itemCodes.has(row.code)).map((row) => ({
        id: `${company.id}:ITEM:${row.code}`,
        company_id: company.id,
        code: row.code,
        display_name: row.displayName,
        description: row.description,
        is_active: row.isActive,
        is_client_approved: row.isClientApproved,
        is_provisional: row.isProvisional,
        allowed_inventory_codes: JSON.stringify(row.allowedInventoryCodes),
        sort_order: row.sortOrder,
        created_by: "migration:phase-32.1",
        updated_by: "migration:phase-32.1",
        created_at: now,
        updated_at: now,
      }));
      if (itemRows.length) await queryInterface.bulkInsert("barcode_item_codes", itemRows);
    }
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query("DROP INDEX IF EXISTS assets_company_rfid_uq");
    await queryInterface.sequelize.query("DROP INDEX IF EXISTS assets_company_barcode_uq");
    await queryInterface.sequelize.query("DROP INDEX IF EXISTS assets_barcode_components_uq");
    for (const tableName of ["barcode_sequences", "barcode_item_codes", "barcode_inventory_codes"]) {
      if (await tableExists(queryInterface, tableName)) await queryInterface.dropTable(tableName);
    }
    const columns = await queryInterface.describeTable("assets");
    for (const columnName of ["metadata", "metadata_schema_version", "inventory_subtype", "barcode_revision", "barcode_generated_at", "barcode_serial", "karat_code", "item_code", "inventory_code"]) {
      if (columns[columnName]) await queryInterface.removeColumn("assets", columnName);
    }
  },
};
