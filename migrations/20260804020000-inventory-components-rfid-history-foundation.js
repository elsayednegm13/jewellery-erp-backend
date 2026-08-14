"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("asset_components", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        role: { type: Sequelize.STRING(24), allowNull: false },
        component_kind: { type: Sequelize.STRING(24), allowNull: false },
        sequence: { type: Sequelize.INTEGER, allowNull: false },
        component_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        component_weight: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        component_carat: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        measurement_unit: { type: Sequelize.STRING(24), allowNull: true },
        name: { type: Sequelize.STRING(160), allowNull: true },
        component_type: { type: Sequelize.STRING(160), allowNull: true },
        purchase_cost: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        current_value: { type: Sequelize.DECIMAL(20, 8), allowNull: true },
        certificate_id: { type: Sequelize.STRING, allowNull: true, references: { model: "asset_certificates", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        notes: { type: Sequelize.TEXT, allowNull: true },
        mapping_classification: { type: Sequelize.STRING(64), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("asset_components", ["asset_id", "sequence"], { unique: true, name: "asset_components_asset_sequence_uq", transaction });
      await queryInterface.sequelize.query(`ALTER TABLE asset_components ADD CONSTRAINT asset_components_semantics_ck CHECK (
        role IN ('EMBEDDED','PRIMARY_SUBJECT') AND
        component_kind IN ('DIAMOND','GEMSTONE','PEARL','OTHER') AND
        sequence >= 0 AND component_count >= 1 AND
        (role <> 'PRIMARY_SUBJECT' OR component_count = 1) AND
        (component_weight IS NULL OR component_weight >= 0) AND
        (component_carat IS NULL OR component_carat >= 0)
      )`, { transaction });

      const subtypeTables = {
        asset_diamond_component_details: ["treatment", "color", "tone", "saturation", "clarity", "cut", "shape", "origin", "position", "setting"],
        asset_gemstone_component_details: ["shape", "color", "tone", "tone_level", "saturation", "optical_effect", "origin", "position", "setting"],
        asset_pearl_component_details: ["size", "pearl_type", "color", "overtone", "orient", "shape", "luster", "surface_quality", "nacre_quality", "origin"],
      };
      for (const [table, fields] of Object.entries(subtypeTables)) {
        const columns = {
          component_id: { type: Sequelize.STRING, primaryKey: true, allowNull: false, references: { model: "asset_components", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        };
        for (const field of fields) columns[field] = { type: Sequelize.STRING(160), allowNull: true };
        columns.created_at = { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") };
        columns.updated_at = { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") };
        await queryInterface.createTable(table, columns, { transaction });
      }

      await queryInterface.createTable("asset_rfid_assignments", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        rfid_number: { type: Sequelize.STRING(128), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
        is_current: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        assigned_at: { type: Sequelize.DATE, allowNull: false },
        assigned_by: { type: Sequelize.STRING, allowNull: true },
        ended_at: { type: Sequelize.DATE, allowNull: true },
        ended_by: { type: Sequelize.STRING, allowNull: true },
        replacement_reason: { type: Sequelize.TEXT, allowNull: true },
        mapping_classification: { type: Sequelize.STRING(64), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("asset_rfid_assignments", ["rfid_number"], { unique: true, name: "asset_rfid_number_global_uq", transaction });
      await queryInterface.addIndex("asset_rfid_assignments", ["asset_id"], { unique: true, where: { is_current: true }, name: "asset_rfid_one_current_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE asset_rfid_assignments ADD CONSTRAINT asset_rfid_status_ck CHECK (status IN ('ACTIVE','INACTIVE','REPLACED','MISSING'))", { transaction });

      await queryInterface.createTable("rfid_scan_events", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        assignment_id: { type: Sequelize.STRING, allowNull: false, references: { model: "asset_rfid_assignments", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        scanned_at: { type: Sequelize.DATE, allowNull: false },
        device_id: { type: Sequelize.STRING, allowNull: true },
        operator_id: { type: Sequelize.STRING, allowNull: true },
        operator_name: { type: Sequelize.STRING, allowNull: true },
        source_type: { type: Sequelize.STRING(40), allowNull: true },
        source_id: { type: Sequelize.STRING, allowNull: true },
        method: { type: Sequelize.STRING(24), allowNull: false },
        result: { type: Sequelize.STRING(24), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("rfid_scan_events", ["asset_id", "scanned_at"], { name: "rfid_scan_events_asset_time_idx", transaction });

      await queryInterface.createTable("asset_tag_print_events", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        print_kind: { type: Sequelize.STRING(16), allowNull: false },
        template_name: { type: Sequelize.STRING(120), allowNull: true },
        template_version: { type: Sequelize.STRING(40), allowNull: true },
        printer_name: { type: Sequelize.STRING(160), allowNull: true },
        device_id: { type: Sequelize.STRING, allowNull: true },
        operator_id: { type: Sequelize.STRING, allowNull: true },
        operator_name: { type: Sequelize.STRING, allowNull: true },
        reason: { type: Sequelize.TEXT, allowNull: true },
        printed_at: { type: Sequelize.DATE, allowNull: false },
        result: { type: Sequelize.STRING(24), allowNull: false },
        idempotency_key: { type: Sequelize.STRING(128), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("asset_tag_print_events", ["company_id", "idempotency_key"], { unique: true, name: "asset_tag_print_idempotency_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE asset_tag_print_events ADD CONSTRAINT asset_tag_print_kind_ck CHECK (print_kind IN ('INITIAL','REPRINT'))", { transaction });

      const eventColumns = {
        company_id: { type: Sequelize.STRING, allowNull: true, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        branch_id: { type: Sequelize.STRING, allowNull: true, references: { model: "branches", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        event_type: { type: Sequelize.STRING(48), allowNull: true },
        occurred_at: { type: Sequelize.DATE, allowNull: true },
        user_id: { type: Sequelize.STRING, allowNull: true },
        employee_code: { type: Sequelize.STRING, allowNull: true },
        employee_name: { type: Sequelize.STRING, allowNull: true },
        operator_session_id: { type: Sequelize.STRING, allowNull: true },
        device_id: { type: Sequelize.STRING, allowNull: true },
        source_type: { type: Sequelize.STRING(48), allowNull: true },
        source_id: { type: Sequelize.STRING, allowNull: true },
        old_context: { type: Sequelize.JSONB, allowNull: true },
        new_context: { type: Sequelize.JSONB, allowNull: true },
        notes: { type: Sequelize.TEXT, allowNull: true },
        idempotency_key: { type: Sequelize.STRING(128), allowNull: true },
      };
      for (const [name, definition] of Object.entries(eventColumns)) {
        await queryInterface.addColumn("asset_events", name, definition, { transaction });
      }
      await queryInterface.addIndex("asset_events", ["asset_id", "occurred_at"], { name: "asset_events_asset_occurred_idx", transaction });
      await queryInterface.addIndex("asset_events", ["source_type", "source_id"], { name: "asset_events_source_idx", transaction });
      await queryInterface.addIndex("asset_events", ["company_id", "idempotency_key"], { unique: true, where: { idempotency_key: { [Sequelize.Op.ne]: null } }, name: "asset_events_idempotency_uq", transaction });
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: component, RFID, print, and lifecycle evidence cannot be dropped safely");
  },
};
