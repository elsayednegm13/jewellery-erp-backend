"use strict";

// Generic Customer read models. They are source-bound projections and never
// become the owner of an operational document or of a customer balance.
module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await queryInterface.tableExists("customer_transaction_history"))) {
      await queryInterface.createTable("customer_transaction_history", {
        id: { type: Sequelize.STRING, primaryKey: true },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        customer_id: { type: Sequelize.STRING, allowNull: false, references: { model: "customers", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        transaction_type: { type: Sequelize.STRING(96), allowNull: false },
        source_domain: { type: Sequelize.STRING(64), allowNull: false },
        source_document_type: { type: Sequelize.STRING(128), allowNull: false },
        source_document_id: { type: Sequelize.STRING(128), allowNull: false },
        source_document_number: { type: Sequelize.STRING(128), allowNull: false },
        source_event_id: { type: Sequelize.STRING(128), allowNull: false },
        occurred_at: { type: Sequelize.DATE, allowNull: false },
        currency: { type: Sequelize.STRING(3), allowNull: false },
        amount: { type: Sequelize.DECIMAL(20, 4), allowNull: false },
        status: { type: Sequelize.STRING(32), allowNull: false },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
      await queryInterface.addIndex("customer_transaction_history", ["company_id", "source_event_id"], { unique: true, name: "customer_transaction_history_company_event_uq" });
      await queryInterface.addIndex("customer_transaction_history", ["company_id", "customer_id", "occurred_at"], { name: "customer_transaction_history_customer_occurred_idx" });
    }
    if (!(await queryInterface.tableExists("customer_timelines"))) {
      await queryInterface.createTable("customer_timelines", {
        id: { type: Sequelize.STRING, primaryKey: true },
        company_id: { type: Sequelize.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        branch_id: { type: Sequelize.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        customer_id: { type: Sequelize.STRING, allowNull: false, references: { model: "customers", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        event_type: { type: Sequelize.STRING(128), allowNull: false },
        source_document_type: { type: Sequelize.STRING(128), allowNull: false },
        source_document_id: { type: Sequelize.STRING(128), allowNull: false },
        source_event_id: { type: Sequelize.STRING(128), allowNull: false },
        occurred_at: { type: Sequelize.DATE, allowNull: false },
        summary: { type: Sequelize.TEXT, allowNull: false },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      });
      await queryInterface.addIndex("customer_timelines", ["company_id", "source_event_id"], { unique: true, name: "customer_timelines_company_event_uq" });
      await queryInterface.addIndex("customer_timelines", ["company_id", "customer_id", "occurred_at"], { name: "customer_timelines_customer_occurred_idx" });
    }
  },
  async down(queryInterface) {
    if (await queryInterface.tableExists("customer_timelines")) await queryInterface.dropTable("customer_timelines");
    if (await queryInterface.tableExists("customer_transaction_history")) await queryInterface.dropTable("customer_transaction_history");
  },
};
