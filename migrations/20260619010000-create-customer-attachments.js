"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes("customer_attachments")) return;

    await queryInterface.createTable("customer_attachments", {
      id: { type: Sequelize.STRING, primaryKey: true },
      company_id: {
        type: Sequelize.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      customer_id: {
        type: Sequelize.STRING,
        allowNull: false,
        references: { model: "customers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      file_name: { type: Sequelize.STRING, allowNull: false },
      original_file_name: { type: Sequelize.STRING, allowNull: false },
      mime_type: { type: Sequelize.STRING, allowNull: false },
      file_size: { type: Sequelize.INTEGER, allowNull: false },
      file_url: { type: Sequelize.STRING, allowNull: false },
      category: { type: Sequelize.STRING },
      uploaded_by: { type: Sequelize.STRING },
      uploaded_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.addIndex("customer_attachments", ["company_id", "customer_id"]);
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes("customer_attachments")) {
      await queryInterface.dropTable("customer_attachments");
    }
  }
};
