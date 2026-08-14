"use strict";

/**
 * Phase 23-Fix — Customer Credit Ledger (infrastructure only).
 *
 * Additive & reversible: creates `customer_credit_transactions`, a per-customer
 * audit ledger for customer credit movements (credit_in / credit_out) with
 * source links and OPTIONAL GL-bridge columns (journal_entry_id) to account 2300
 * "Customer Deposits". No existing table is altered; `Customer.balance` stays
 * AR-only. No credit is created by any current flow — this phase is the table +
 * model + service + read endpoint only. The GL posting bridge is deferred, so
 * `journal_entry_id` is nullable.
 */

async function tableExists(qi, name) {
  try { await qi.describeTable(name); return true; } catch { return false; }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    if (await tableExists(queryInterface, "customer_credit_transactions")) return;

    await queryInterface.createTable("customer_credit_transactions", {
      id: { type: Sequelize.STRING, primaryKey: true },
      company_id: { type: Sequelize.STRING, allowNull: false },
      branch_id: { type: Sequelize.STRING, allowNull: true },
      customer_id: { type: Sequelize.STRING, allowNull: false },
      // opening_balance | return_credit | exchange_credit | overpayment |
      // credit_application | credit_refund | manual_adjustment | migration_seed
      source_type: { type: Sequelize.STRING(40), allowNull: false },
      source_id: { type: Sequelize.STRING, allowNull: true },
      // credit_in (raises available credit) | credit_out (consumes it)
      direction: { type: Sequelize.STRING(16), allowNull: false },
      amount: { type: Sequelize.DECIMAL(15, 4), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "AED" },
      description: { type: Sequelize.STRING, allowNull: true },
      // active | reversed | void
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "active" },
      journal_entry_id: { type: Sequelize.STRING, allowNull: true },
      cash_transaction_id: { type: Sequelize.STRING, allowNull: true },
      invoice_id: { type: Sequelize.STRING, allowNull: true },
      created_by: { type: Sequelize.STRING, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex("customer_credit_transactions", ["company_id", "customer_id", "created_at"], {
      name: "cct_company_customer_created_idx",
    });
    await queryInterface.addIndex("customer_credit_transactions", ["company_id", "source_type", "source_id"], {
      name: "cct_company_source_idx",
    });
    await queryInterface.addIndex("customer_credit_transactions", ["journal_entry_id"], {
      name: "cct_journal_entry_idx",
    });
    await queryInterface.addIndex("customer_credit_transactions", ["cash_transaction_id"], {
      name: "cct_cash_transaction_idx",
    });
    await queryInterface.addIndex("customer_credit_transactions", ["invoice_id"], {
      name: "cct_invoice_idx",
    });
  },

  down: async (queryInterface) => {
    if (await tableExists(queryInterface, "customer_credit_transactions")) {
      await queryInterface.dropTable("customer_credit_transactions");
    }
  },
};
