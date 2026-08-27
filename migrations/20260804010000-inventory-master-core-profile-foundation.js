"use strict";

const PROFILES = [
  "GOLD_BY_WEIGHT_JEWELLERY",
  "GOLD_BAR_24K",
  "GOLD_BY_PIECE",
  "DIAMOND_JEWELLERY",
  "LOOSE_DIAMOND",
  "GEMSTONE_JEWELLERY",
  "LOOSE_GEMSTONE",
  "PEARL_JEWELLERY",
  "LOOSE_PEARL",
  "CGP_CUSTOMER_GOLD_PURCHASE",
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [duplicateRows] = await queryInterface.sequelize.query(`
        SELECT barcode
        FROM assets
        GROUP BY barcode
        HAVING COUNT(*) > 1
        LIMIT 1
      `, { transaction });
      if (duplicateRows.length) throw new Error("INVENTORY_GLOBAL_BARCODE_DUPLICATES_EXIST");

      await queryInterface.createTable("inventory_locations", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        code: { type: Sequelize.STRING(32), allowNull: false },
        name: { type: Sequelize.STRING(120), allowNull: false },
        location_type: { type: Sequelize.STRING(24), allowNull: false, defaultValue: "GENERAL" },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("inventory_locations", ["company_id", "branch_id", "code"], { unique: true, name: "inventory_locations_company_branch_code_uq", transaction });

      const assetColumns = {
        location_id: { type: Sequelize.STRING, allowNull: true, references: { model: "inventory_locations", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        inventory_profile: { type: Sequelize.STRING(40), allowNull: true },
        operational_status: { type: Sequelize.STRING(24), allowNull: true },
        condition: { type: Sequelize.STRING(8), allowNull: true },
        condition_classification: { type: Sequelize.STRING(48), allowNull: true },
        tag_state: { type: Sequelize.STRING(8), allowNull: true },
        tag_state_classification: { type: Sequelize.STRING(48), allowNull: true },
        description: { type: Sequelize.TEXT, allowNull: true },
        brand: { type: Sequelize.STRING(160), allowNull: true },
        model: { type: Sequelize.STRING(160), allowNull: true },
        model_number: { type: Sequelize.STRING(160), allowNull: true },
        supplier_id: { type: Sequelize.STRING, allowNull: true, references: { model: "suppliers", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        purchase_date: { type: Sequelize.DATEONLY, allowNull: true },
        created_by: { type: Sequelize.STRING, allowNull: true },
        updated_by: { type: Sequelize.STRING, allowNull: true },
        retired_at: { type: Sequelize.DATE, allowNull: true },
        retired_by: { type: Sequelize.STRING, allowNull: true },
        retirement_reason: { type: Sequelize.TEXT, allowNull: true },
      };
      for (const [name, definition] of Object.entries(assetColumns)) {
        await queryInterface.addColumn("assets", name, definition, { transaction });
      }

      await queryInterface.addIndex("assets", ["barcode"], { unique: true, name: "assets_barcode_global_uq", transaction });
      await queryInterface.addIndex("assets", ["company_id", "branch_id", "inventory_profile", "operational_status", "id"], { name: "assets_inventory_master_list_idx", transaction });
      await queryInterface.addIndex("assets", ["location_id", "operational_status"], { name: "assets_location_status_idx", transaction });
      await queryInterface.addIndex("assets", ["supplier_id", "purchase_date"], { name: "assets_supplier_purchase_date_idx", transaction });

      await queryInterface.createTable("asset_origins", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: false, unique: true, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        origin_type: { type: Sequelize.STRING(40), allowNull: false },
        purchase_order_item_id: { type: Sequelize.STRING, allowNull: true, references: { model: "purchase_order_items", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        cgp_item_id: { type: Sequelize.STRING, allowNull: true, references: { model: "customer_gold_purchase_items", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        legacy_product_id: { type: Sequelize.STRING, allowNull: true, references: { model: "products", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        manufacturing_order_id: { type: Sequelize.STRING, allowNull: true, references: { model: "manufacturing_orders", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        received_at: { type: Sequelize.DATE, allowNull: true },
        received_by: { type: Sequelize.STRING, allowNull: true },
        mapping_classification: { type: Sequelize.STRING(64), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addConstraint("asset_origins", { fields: ["origin_type"], type: "check", name: "asset_origins_type_ck", where: { origin_type: ["PURCHASE_ORDER", "CGP", "LEGACY_PRODUCT", "MANUFACTURING_OUTPUT", "LEGACY_UNKNOWN"] }, transaction });

      await queryInterface.createTable("asset_gold_details", {
        asset_id: { type: Sequelize.STRING, primaryKey: true, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        weight_unit: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "GRAM" },
        gross_weight: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        stone_weight: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        net_gold_weight: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        karat: { type: Sequelize.DECIMAL(9, 6), allowNull: true },
        purity_ratio: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        pure_gold_9999: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        pure_gold_995: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        mapping_classification: { type: Sequelize.STRING(64), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE asset_gold_details ADD CONSTRAINT asset_gold_details_values_ck CHECK (
        weight_unit = 'GRAM' AND
        (gross_weight IS NULL OR gross_weight >= 0) AND
        (stone_weight IS NULL OR stone_weight >= 0) AND
        (net_gold_weight IS NULL OR net_gold_weight >= 0) AND
        (karat IS NULL OR karat > 0 AND karat <= 24) AND
        (pure_gold_9999 IS NULL OR pure_gold_9999 >= 0) AND
        (pure_gold_995 IS NULL OR pure_gold_995 >= 0)
      )`, { transaction });

      await queryInterface.createTable("asset_purchase_cost_revisions", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        revision_no: { type: Sequelize.INTEGER, allowNull: false },
        currency: { type: Sequelize.STRING(8), allowNull: true },
        purchase_gold_rate: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        gold_rate_source: { type: Sequelize.STRING(40), allowNull: true },
        gold_value: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        making_per_gram: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        making_total: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        certificate_cost: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        component_cost: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        vat_enabled: { type: Sequelize.BOOLEAN, allowNull: true },
        vat_rate: { type: Sequelize.DECIMAL(9, 6), allowNull: true },
        vat_rate_source: { type: Sequelize.STRING(40), allowNull: true },
        vat_base: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        vat_amount: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        total_purchase_cost: { type: Sequelize.DECIMAL(20, 8), allowNull: false },
        supplier_id: { type: Sequelize.STRING, allowNull: true, references: { model: "suppliers", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        purchase_date: { type: Sequelize.DATEONLY, allowNull: true },
        purchase_order_item_id: { type: Sequelize.STRING, allowNull: true, references: { model: "purchase_order_items", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        cgp_item_id: { type: Sequelize.STRING, allowNull: true, references: { model: "customer_gold_purchase_items", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        supersedes_id: { type: Sequelize.STRING, allowNull: true, references: { model: "asset_purchase_cost_revisions", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        is_current: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        override_reason: { type: Sequelize.TEXT, allowNull: true },
        created_by: { type: Sequelize.STRING, allowNull: true },
        provenance: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        mapping_classification: { type: Sequelize.STRING(64), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("asset_purchase_cost_revisions", ["asset_id", "revision_no"], { unique: true, name: "asset_purchase_cost_revision_uq", transaction });
      await queryInterface.addIndex("asset_purchase_cost_revisions", ["asset_id"], { unique: true, where: { is_current: true }, name: "asset_purchase_cost_current_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE asset_purchase_cost_revisions ADD CONSTRAINT asset_purchase_cost_values_ck CHECK (revision_no >= 1 AND total_purchase_cost >= 0 AND (vat_rate IS NULL OR vat_rate BETWEEN 0 AND 100))", { transaction });

      await queryInterface.createTable("asset_current_valuations", {
        asset_id: { type: Sequelize.STRING, primaryKey: true, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        rate_source: { type: Sequelize.STRING(32), allowNull: false },
        gold_rate: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        gold_value: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        making_value: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        certificate_value: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        component_value: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        vat_rate: { type: Sequelize.DECIMAL(9, 6), allowNull: true },
        vat_rate_source: { type: Sequelize.STRING(32), allowNull: true },
        vat_base: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        vat_amount: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        total_value: { type: Sequelize.DECIMAL(20, 8), allowNull: false },
        as_of: { type: Sequelize.DATE, allowNull: false },
        input_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        override_reason: { type: Sequelize.TEXT, allowNull: true },
        override_by: { type: Sequelize.STRING, allowNull: true },
        version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("asset_current_valuations", ["company_id", "branch_id", "as_of"], { name: "asset_current_valuations_scope_asof_idx", transaction });

      await queryInterface.createTable("asset_pricing_policies", {
        asset_id: { type: Sequelize.STRING, primaryKey: true, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        strategy_code: { type: Sequelize.STRING(48), allowNull: false },
        strategy_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        selling_making_per_gram: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        minimum_making_per_gram: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        certificate_charge: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        minimum_certificate_charge: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        markup_percent: { type: Sequelize.DECIMAL(9, 6), allowNull: true },
        maximum_discount_percent: { type: Sequelize.DECIMAL(9, 6), allowNull: true },
        minimum_selling_price: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        manual_price_allowed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE asset_pricing_policies ADD CONSTRAINT asset_pricing_strategy_ck CHECK (strategy_code IN ('WEIGHT_BASED_MAKING_STRATEGY','BAR_CERTIFICATE_STRATEGY','PIECE_MARKUP_STRATEGY','DIAMOND_PROFILE_STRATEGY','GEMSTONE_PROFILE_STRATEGY','PEARL_PROFILE_STRATEGY','LOOSE_ASSET_STRATEGY'))`, { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE assets ADD CONSTRAINT assets_inventory_profile_ck CHECK (inventory_profile IS NULL OR inventory_profile IN (${PROFILES.map((p) => `'${p}'`).join(",")})) NOT VALID`, { transaction });
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: inventory master evidence and identity structures require backup-based recovery");
  },
};
