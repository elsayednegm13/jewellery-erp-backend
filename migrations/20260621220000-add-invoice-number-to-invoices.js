"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable("invoices");

        if (!table.invoice_number) {
            await queryInterface.addColumn("invoices", "invoice_number", {
                type: Sequelize.STRING,
                allowNull: true,
            });
        }

        // Fill old invoices with a safe invoice number based on their existing id.
        await queryInterface.sequelize.query(`
      UPDATE invoices
      SET invoice_number = id
      WHERE invoice_number IS NULL OR invoice_number = '';
    `);

        const indexes = await queryInterface.showIndex("invoices");
        const hasIndex = indexes.some(
            (index) => index.name === "idx_invoices_company_invoice_number"
        );

        if (!hasIndex) {
            await queryInterface.addIndex("invoices", ["company_id", "invoice_number"], {
                name: "idx_invoices_company_invoice_number",
            });
        }
    },

    async down(queryInterface) {
        const indexes = await queryInterface.showIndex("invoices");
        const hasIndex = indexes.some(
            (index) => index.name === "idx_invoices_company_invoice_number"
        );

        if (hasIndex) {
            await queryInterface.removeIndex(
                "invoices",
                "idx_invoices_company_invoice_number"
            );
        }

        const table = await queryInterface.describeTable("invoices");

        if (table.invoice_number) {
            await queryInterface.removeColumn("invoices", "invoice_number");
        }
    },
};