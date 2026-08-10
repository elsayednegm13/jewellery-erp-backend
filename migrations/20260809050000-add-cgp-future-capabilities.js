"use strict";

const { CGP_FUTURE_CAPABILITIES } = require("../src/bootstrap/cgp-permission-catalog-v3");

module.exports = {
  async up(queryInterface) {
    for (const permission of CGP_FUTURE_CAPABILITIES) {
      await queryInterface.sequelize.query(`
        INSERT INTO permissions (id, name, module, action, description, created_at, updated_at)
        VALUES (:id, :name, :module, :action, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (name) DO NOTHING
      `, {
        replacements: {
          id: `PERM-${permission.name}`,
          ...permission,
        },
      });
    }
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM permissions
      WHERE name IN (:names)
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp WHERE rp.permission_id = permissions.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM employee_permission_grants epg WHERE epg.permission_id = permissions.id
        )
    `, { replacements: { names: CGP_FUTURE_CAPABILITIES.map((permission) => permission.name) } });
  },
};
