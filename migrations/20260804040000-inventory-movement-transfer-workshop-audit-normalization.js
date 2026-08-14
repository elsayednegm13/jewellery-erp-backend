"use strict";

const createdAt = (Sequelize) => ({ type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") });
const updatedAt = (Sequelize) => ({ type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") });

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("transfer_items", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        transfer_id: { type: Sequelize.STRING, allowNull: false, references: { model: "transfers", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        from_branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        to_branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        from_location_id: { type: Sequelize.STRING, allowNull: true, references: { model: "inventory_locations", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        to_location_id: { type: Sequelize.STRING, allowNull: true, references: { model: "inventory_locations", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        status: { type: Sequelize.STRING(24), allowNull: false },
        dispatched_at: { type: Sequelize.DATE, allowNull: true },
        dispatched_by: { type: Sequelize.STRING, allowNull: true },
        received_at: { type: Sequelize.DATE, allowNull: true },
        received_by: { type: Sequelize.STRING, allowNull: true },
        created_at: createdAt(Sequelize),
        updated_at: updatedAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("transfer_items", ["transfer_id", "asset_id"], { unique: true, name: "transfer_items_pair_uq", transaction });
      await queryInterface.addIndex("transfer_items", ["asset_id"], { unique: true, where: { status: ["REQUESTED", "APPROVED", "DISPATCHED"] }, name: "transfer_items_one_active_uq", transaction });

      await queryInterface.createTable("inventory_workshop_orders", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        order_number: { type: Sequelize.STRING(64), allowNull: false },
        provider_name: { type: Sequelize.STRING(160), allowNull: true },
        status: { type: Sequelize.STRING(24), allowNull: false },
        expected_return_at: { type: Sequelize.DATE, allowNull: true },
        created_by: { type: Sequelize.STRING, allowNull: true },
        created_at: createdAt(Sequelize),
        updated_at: updatedAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("inventory_workshop_orders", ["company_id", "order_number"], { unique: true, name: "inventory_workshop_order_number_uq", transaction });
      await queryInterface.createTable("inventory_workshop_items", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        workshop_order_id: { type: Sequelize.STRING, allowNull: false, references: { model: "inventory_workshop_orders", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        from_location_id: { type: Sequelize.STRING, allowNull: true, references: { model: "inventory_locations", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        prior_operational_status: { type: Sequelize.STRING(24), allowNull: false },
        status: { type: Sequelize.STRING(24), allowNull: false },
        sent_at: { type: Sequelize.DATE, allowNull: true },
        sent_by: { type: Sequelize.STRING, allowNull: true },
        returned_at: { type: Sequelize.DATE, allowNull: true },
        returned_by: { type: Sequelize.STRING, allowNull: true },
        created_at: createdAt(Sequelize),
        updated_at: updatedAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("inventory_workshop_items", ["asset_id"], { unique: true, where: { status: ["OPEN", "SENT"] }, name: "inventory_workshop_item_active_uq", transaction });

      await queryInterface.createTable("manufacturing_order_inputs", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        manufacturing_order_id: { type: Sequelize.STRING, allowNull: false, references: { model: "manufacturing_orders", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        ordinal: { type: Sequelize.INTEGER, allowNull: false },
        pre_weight: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        disposition: { type: Sequelize.STRING(32), allowNull: false },
        created_at: createdAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("manufacturing_order_inputs", ["manufacturing_order_id", "asset_id"], { unique: true, name: "manufacturing_order_inputs_pair_uq", transaction });
      await queryInterface.createTable("manufacturing_order_outputs", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        manufacturing_order_id: { type: Sequelize.STRING, allowNull: false, references: { model: "manufacturing_orders", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        ordinal: { type: Sequelize.INTEGER, allowNull: false },
        post_weight: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        process_loss: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        created_at: createdAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("manufacturing_order_outputs", ["asset_id"], { unique: true, name: "manufacturing_order_outputs_asset_uq", transaction });

      await queryInterface.createTable("asset_lineage_links", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        parent_asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        child_asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        relation_type: { type: Sequelize.STRING(32), allowNull: false },
        source_type: { type: Sequelize.STRING(48), allowNull: false },
        source_id: { type: Sequelize.STRING, allowNull: false },
        occurred_at: { type: Sequelize.DATE, allowNull: false },
        created_at: createdAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("asset_lineage_links", ["parent_asset_id", "child_asset_id", "relation_type"], { unique: true, name: "asset_lineage_pair_type_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE asset_lineage_links ADD CONSTRAINT asset_lineage_not_self_ck CHECK (parent_asset_id <> child_asset_id)", { transaction });

      await queryInterface.createTable("asset_missing_cases", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        status: { type: Sequelize.STRING(16), allowNull: false },
        prior_operational_status: { type: Sequelize.STRING(24), allowNull: false },
        prior_location_id: { type: Sequelize.STRING, allowNull: true, references: { model: "inventory_locations", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        discovered_at: { type: Sequelize.DATE, allowNull: false },
        discovered_by: { type: Sequelize.STRING, allowNull: true },
        reason: { type: Sequelize.TEXT, allowNull: false },
        resolved_at: { type: Sequelize.DATE, allowNull: true },
        resolved_by: { type: Sequelize.STRING, allowNull: true },
        resolution_code: { type: Sequelize.STRING(32), allowNull: true },
        resolution_notes: { type: Sequelize.TEXT, allowNull: true },
        created_at: createdAt(Sequelize),
        updated_at: updatedAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("asset_missing_cases", ["asset_id"], { unique: true, where: { status: "OPEN" }, name: "asset_missing_case_open_uq", transaction });

      await queryInterface.createTable("inventory_adjustments", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        status: { type: Sequelize.STRING(16), allowNull: false },
        reason: { type: Sequelize.TEXT, allowNull: false },
        requested_by: { type: Sequelize.STRING, allowNull: false },
        requested_at: { type: Sequelize.DATE, allowNull: false },
        approved_by: { type: Sequelize.STRING, allowNull: true },
        approved_at: { type: Sequelize.DATE, allowNull: true },
        applied_by: { type: Sequelize.STRING, allowNull: true },
        applied_at: { type: Sequelize.DATE, allowNull: true },
        idempotency_key: { type: Sequelize.STRING(128), allowNull: false },
        created_at: createdAt(Sequelize),
        updated_at: updatedAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("inventory_adjustments", ["company_id", "idempotency_key"], { unique: true, name: "inventory_adjustment_idempotency_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustment_separation_ck CHECK (approved_by IS NULL OR approved_by <> requested_by)", { transaction });
      await queryInterface.createTable("inventory_adjustment_items", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        adjustment_id: { type: Sequelize.STRING, allowNull: false, references: { model: "inventory_adjustments", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        old_context: { type: Sequelize.JSONB, allowNull: false },
        new_context: { type: Sequelize.JSONB, allowNull: false },
        created_at: createdAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("inventory_adjustment_items", ["adjustment_id", "asset_id"], { unique: true, name: "inventory_adjustment_item_pair_uq", transaction });

      await queryInterface.createTable("inventory_asset_movements", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        movement_type: { type: Sequelize.STRING(32), allowNull: false },
        from_branch_id: { type: Sequelize.STRING, allowNull: true, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        to_branch_id: { type: Sequelize.STRING, allowNull: true, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        from_location_id: { type: Sequelize.STRING, allowNull: true, references: { model: "inventory_locations", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        to_location_id: { type: Sequelize.STRING, allowNull: true, references: { model: "inventory_locations", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        source_type: { type: Sequelize.STRING(48), allowNull: false },
        source_id: { type: Sequelize.STRING, allowNull: false },
        asset_event_id: { type: Sequelize.STRING, allowNull: true, references: { model: "asset_events", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        occurred_at: { type: Sequelize.DATE, allowNull: false },
        operator_id: { type: Sequelize.STRING, allowNull: true },
        created_at: createdAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("inventory_asset_movements", ["asset_event_id"], { unique: true, where: { asset_event_id: { [Sequelize.Op.ne]: null } }, name: "inventory_asset_movement_event_uq", transaction });
      await queryInterface.addIndex("inventory_asset_movements", ["asset_id", "occurred_at"], { name: "inventory_asset_movement_asset_time_idx", transaction });

      await queryInterface.createTable("cgp_item_dispositions", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        cgp_item_id: { type: Sequelize.STRING, allowNull: false, references: { model: "customer_gold_purchase_items", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        disposition: { type: Sequelize.STRING(48), allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: true, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        gold_pool_id: { type: Sequelize.STRING, allowNull: true, references: { model: "customer_gold_pools", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        evidence: { type: Sequelize.TEXT, allowNull: false },
        decided_at: { type: Sequelize.DATE, allowNull: false },
        decided_by: { type: Sequelize.STRING, allowNull: true },
        created_at: createdAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("cgp_item_dispositions", ["cgp_item_id"], { unique: true, name: "cgp_item_disposition_source_uq", transaction });

      await queryInterface.createTable("legacy_product_asset_map", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        product_id: { type: Sequelize.STRING, allowNull: false, references: { model: "products", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        asset_id: { type: Sequelize.STRING, allowNull: true, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        ordinal: { type: Sequelize.INTEGER, allowNull: true },
        classification: { type: Sequelize.STRING(1), allowNull: false },
        mapping_status: { type: Sequelize.STRING(32), allowNull: false },
        evidence: { type: Sequelize.TEXT, allowNull: false },
        reason: { type: Sequelize.TEXT, allowNull: false },
        created_at: createdAt(Sequelize),
      }, { transaction });
      await queryInterface.addIndex("legacy_product_asset_map", ["product_id", "asset_id"], { unique: true, name: "legacy_product_asset_pair_uq", transaction });
      await queryInterface.addIndex("legacy_product_asset_map", ["asset_id"], { unique: true, where: { asset_id: { [Sequelize.Op.ne]: null } }, name: "legacy_product_asset_once_uq", transaction });
      await queryInterface.addIndex("legacy_product_asset_map", ["product_id"], { unique: true, where: { asset_id: null }, name: "legacy_product_unmapped_classification_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE legacy_product_asset_map ADD CONSTRAINT legacy_product_classification_ck CHECK (classification IN ('A','B','C','D','E'))", { transaction });

      await queryInterface.createTable("inventory_saved_views", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        owner_user_id: { type: Sequelize.STRING, allowNull: true },
        owner_employee_id: { type: Sequelize.STRING, allowNull: true },
        name: { type: Sequelize.STRING(120), allowNull: false },
        definition: { type: Sequelize.JSONB, allowNull: false },
        is_default: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        created_at: createdAt(Sequelize),
        updated_at: updatedAt(Sequelize),
        deleted_at: { type: Sequelize.DATE, allowNull: true },
      }, { transaction });
      await queryInterface.sequelize.query("ALTER TABLE inventory_saved_views ADD CONSTRAINT inventory_saved_view_owner_ck CHECK ((owner_user_id IS NOT NULL)::int + (owner_employee_id IS NOT NULL)::int = 1)", { transaction });
      await queryInterface.sequelize.query("CREATE UNIQUE INDEX inventory_saved_view_owner_name_uq ON inventory_saved_views (company_id, COALESCE(owner_user_id, owner_employee_id), name) WHERE deleted_at IS NULL", { transaction });
      await queryInterface.sequelize.query("CREATE UNIQUE INDEX inventory_saved_view_one_default_uq ON inventory_saved_views (company_id, COALESCE(owner_user_id, owner_employee_id)) WHERE is_default AND deleted_at IS NULL", { transaction });

      const auditColumns = {
        audit_number: { type: Sequelize.STRING(64), allowNull: true },
        audit_date: { type: Sequelize.DATEONLY, allowNull: true },
        location_id: { type: Sequelize.STRING, allowNull: true, references: { model: "inventory_locations", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        audit_method: { type: Sequelize.STRING(24), allowNull: true },
        closed_at: { type: Sequelize.DATE, allowNull: true },
        closed_by: { type: Sequelize.STRING, allowNull: true },
      };
      for (const [name, definition] of Object.entries(auditColumns)) await queryInterface.addColumn("stock_audits", name, definition, { transaction });
      await queryInterface.addIndex("stock_audits", ["company_id", "audit_number"], { unique: true, name: "stock_audits_company_number_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE stock_audits ADD CONSTRAINT stock_audits_method_ck CHECK (audit_method IS NULL OR audit_method IN ('MANUAL_COUNT','BARCODE_SCAN','RFID_SCAN'))", { transaction });
      await queryInterface.addColumn("stock_audit_items", "result", { type: Sequelize.STRING(16), allowNull: true }, { transaction });
      await queryInterface.addColumn("stock_audit_items", "observed_at", { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn("stock_audit_items", "scan_method", { type: Sequelize.STRING(24), allowNull: true }, { transaction });
      await queryInterface.addIndex("stock_audit_items", ["stock_audit_id", "asset_id"], { unique: true, name: "stock_audit_items_asset_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE stock_audit_items ADD CONSTRAINT stock_audit_items_result_ck CHECK (result IS NULL OR result IN ('MATCHED','MISSING','EXTRA'))", { transaction });
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: custody, audit, lineage, and classification evidence require backup-based recovery");
  },
};
