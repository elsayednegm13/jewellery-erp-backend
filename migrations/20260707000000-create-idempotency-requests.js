"use strict";

/**
 * Phase 21.3-Fix — central, race-safe idempotency store.
 *
 * Additive & reversible: creates `idempotency_requests` with a UNIQUE
 * (company_id, scope, key) so an insert-first "claim" makes a concurrent
 * duplicate request fail fast (→ replay of the saved response, or 409). No data
 * is altered; the existing per-table `idempotency_key` columns are left intact.
 */

async function tableExists(qi, name) {
  try { await qi.describeTable(name); return true; } catch { return false; }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    if (await tableExists(queryInterface, "idempotency_requests")) return;

    await queryInterface.createTable("idempotency_requests", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      company_id: { type: Sequelize.STRING, allowNull: false },
      scope: { type: Sequelize.STRING(100), allowNull: false },
      key: { type: Sequelize.STRING(191), allowNull: false },
      request_hash: { type: Sequelize.STRING(128), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "processing" },
      status_code: { type: Sequelize.INTEGER, allowNull: true },
      response_body: { type: Sequelize.JSONB, allowNull: true },
      expires_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex("idempotency_requests", ["company_id", "scope", "key"], {
      name: "idempotency_requests_company_scope_key_uq",
      unique: true,
    });
    await queryInterface.addIndex("idempotency_requests", ["company_id", "scope", "created_at"], {
      name: "idempotency_requests_company_scope_created_idx",
    });
    await queryInterface.addIndex("idempotency_requests", ["expires_at"], {
      name: "idempotency_requests_expires_idx",
    });
  },

  down: async (queryInterface) => {
    if (await tableExists(queryInterface, "idempotency_requests")) {
      await queryInterface.dropTable("idempotency_requests");
    }
  },
};
