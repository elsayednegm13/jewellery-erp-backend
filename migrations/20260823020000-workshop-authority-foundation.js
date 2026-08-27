"use strict";

const WORKSHOP_PERMISSIONS = [
  ["inventory.workshop.read", "Read Workshop custody and lifecycle records"],
  ["inventory.workshop.send", "Send an existing Asset to Workshop custody"],
  ["inventory.workshop.complete", "Complete Workshop work and return an Asset"],
  ["inventory.workshop.cancel", "Cancel a Workshop request before completion"],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn("inventory_workshop_orders", "workshop_location_id", {
        type: Sequelize.STRING,
        allowNull: true,
        references: { model: "inventory_locations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      }, { transaction });
      await queryInterface.addColumn("inventory_workshop_orders", "return_location_id", {
        type: Sequelize.STRING,
        allowNull: true,
        references: { model: "inventory_locations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      }, { transaction });

      for (const [name, description] of WORKSHOP_PERMISSIONS) {
        await queryInterface.sequelize.query(`
          INSERT INTO permissions (id,name,module,action,description,created_at,updated_at)
          VALUES (:id,:name,'inventory',:action,:description,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT (name) DO UPDATE SET
            module=EXCLUDED.module,
            action=EXCLUDED.action,
            description=EXCLUDED.description,
            updated_at=CURRENT_TIMESTAMP
        `, {
          replacements: { id: `PERM-${name}`, name, action: name.split(".").at(-1), description },
          transaction,
        });
      }

      await queryInterface.sequelize.query(`
        INSERT INTO role_permissions (role_id, permission_id, created_at, updated_at)
        SELECT r.id, p.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM roles r
        CROSS JOIN permissions p
        WHERE r.slug IN ('admin', 'owner', 'manager')
          AND p.name IN (:permissions)
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `, { replacements: { permissions: WORKSHOP_PERMISSIONS.map(([name]) => name) }, transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        DELETE FROM role_permissions
        WHERE permission_id IN (SELECT id FROM permissions WHERE name IN (:permissions))
      `, { replacements: { permissions: WORKSHOP_PERMISSIONS.map(([name]) => name) }, transaction });
      await queryInterface.bulkDelete("permissions", { name: WORKSHOP_PERMISSIONS.map(([name]) => name) }, { transaction });
      await queryInterface.removeColumn("inventory_workshop_orders", "return_location_id", { transaction });
      await queryInterface.removeColumn("inventory_workshop_orders", "workshop_location_id", { transaction });
    });
  },
};
