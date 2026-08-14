"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable("purchase_order_item_asset_links", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        purchase_order_item_id: { type: Sequelize.STRING, allowNull: false, references: { model: "purchase_order_items", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        ordinal: { type: Sequelize.INTEGER, allowNull: false },
        received_at: { type: Sequelize.DATE, allowNull: true },
        received_by: { type: Sequelize.STRING, allowNull: true },
        mapping_classification: { type: Sequelize.STRING(48), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("purchase_order_item_asset_links", ["asset_id"], { unique: true, name: "po_item_asset_links_asset_uq", transaction });
      await queryInterface.addIndex("purchase_order_item_asset_links", ["purchase_order_item_id", "ordinal"], { unique: true, name: "po_item_asset_links_ordinal_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE purchase_order_item_asset_links ADD CONSTRAINT po_item_asset_links_ordinal_ck CHECK (ordinal >= 1)", { transaction });

      await queryInterface.createTable("invoice_item_asset_links", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        invoice_item_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: "invoice_items", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        asset_id: { type: Sequelize.STRING, allowNull: false, references: { model: "assets", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        ordinal: { type: Sequelize.INTEGER, allowNull: false },
        quote_snapshot: { type: Sequelize.JSONB, allowNull: true },
        cost_snapshot_revision_id: { type: Sequelize.STRING, allowNull: true, references: { model: "asset_purchase_cost_revisions", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        mapping_classification: { type: Sequelize.STRING(48), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("invoice_item_asset_links", ["invoice_item_id", "asset_id"], { unique: true, name: "invoice_item_asset_links_pair_uq", transaction });
      await queryInterface.addIndex("invoice_item_asset_links", ["asset_id"], { unique: true, name: "invoice_item_asset_links_asset_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE invoice_item_asset_links ADD CONSTRAINT invoice_item_asset_links_ordinal_ck CHECK (ordinal >= 1)", { transaction });

      await queryInterface.createTable("inventory_source_link_classifications", {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
        source_table: { type: Sequelize.STRING(64), allowNull: false },
        source_row_id: { type: Sequelize.STRING, allowNull: false },
        source_value: { type: Sequelize.STRING, allowNull: true },
        classification: { type: Sequelize.STRING(40), allowNull: false },
        reason: { type: Sequelize.TEXT, allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      }, { transaction });
      await queryInterface.addIndex("inventory_source_link_classifications", ["source_table", "source_row_id"], { unique: true, name: "inventory_source_link_classification_uq", transaction });
      await queryInterface.sequelize.query("ALTER TABLE inventory_source_link_classifications ADD CONSTRAINT inventory_source_link_class_ck CHECK (classification IN ('ASSET_LINK_PROVEN','PRODUCT_LINK_LEGACY','AMBIGUOUS','NO_LINK'))", { transaction });
    });
  },

  async down() {
    throw new Error("NON_DESTRUCTIVE_FORWARD_ONLY: source-document identity evidence cannot be dropped safely");
  },
};
