"use strict";

/**
 * Additive, non-destructive: add a customer-facing `invoice_number` separate
 * from the primary key `id` (which must never change, since InvoiceItems /
 * Payments / CashTransactions / JournalEntries / relatedInvoiceId all reference
 * it). Posted invoices carry a sequential INV-* number here; drafts keep it NULL
 * until posted.
 *
 *  - lookup index on (company_id, invoice_number)
 *  - partial UNIQUE index so a number is unique within a company when present
 *    (NULL drafts are exempt).
 *
 * No id change, no data rewrite, no FK touched, no DB reset.
 */
const { Op } = require("sequelize");

async function columnExists(qi, table, col) {
  try { return Boolean((await qi.describeTable(table))[col]); } catch { return false; }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    if (!(await columnExists(queryInterface, "invoices", "invoice_number"))) {
      await queryInterface.addColumn("invoices", "invoice_number", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
    try {
      await queryInterface.addIndex("invoices", ["company_id", "invoice_number"], {
        name: "invoices_company_invoice_number_idx",
      });
    } catch { /* exists */ }
    try {
      await queryInterface.addIndex("invoices", ["company_id", "invoice_number"], {
        name: "invoices_company_invoice_number_unique",
        unique: true,
        where: { invoice_number: { [Op.ne]: null } },
      });
    } catch { /* exists */ }
  },

  down: async (queryInterface) => {
    for (const name of ["invoices_company_invoice_number_unique", "invoices_company_invoice_number_idx"]) {
      try { await queryInterface.removeIndex("invoices", name); } catch { /* ignore */ }
    }
    if (await columnExists(queryInterface, "invoices", "invoice_number")) {
      await queryInterface.removeColumn("invoices", "invoice_number");
    }
  },
};
