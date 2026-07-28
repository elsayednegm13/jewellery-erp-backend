"use strict";

// A single durable marker is required because the first-run operation has no
// Company before it succeeds and therefore cannot use company-scoped
// idempotency_requests.  The service always uses the fixed GLOBAL row under a
// database transaction; this table never stores a bootstrap secret or password.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("first_run_setup_states", {
      id: { type: Sequelize.STRING(32), primaryKey: true, allowNull: false },
      state: { type: Sequelize.STRING(48), allowNull: false },
      idempotency_key_hash: { type: Sequelize.STRING(128), allowNull: true },
      payload_hash: { type: Sequelize.STRING(128), allowNull: true },
      result: { type: Sequelize.JSONB, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      last_error_code: { type: Sequelize.STRING(96), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("first_run_setup_states");
  }
};
