"use strict";

const COUNT_PERMISSIONS = [
  ["inventory.count.read", "Read branch-scoped Inventory Count sessions and variances"],
  ["inventory.count.create", "Create a branch/location-scoped Inventory Count session"],
  ["inventory.count.scan", "Scan Asset Barcode/RFID identities into an Inventory Count"],
  ["inventory.count.complete", "Complete and close an Inventory Count session"],
];

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      for (const [name, description] of COUNT_PERMISSIONS) {
        await queryInterface.sequelize.query(`
          INSERT INTO permissions (id,name,module,action,description,created_at,updated_at)
          VALUES (:id,:name,'inventory',:action,:description,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT (name) DO UPDATE SET module=EXCLUDED.module,action=EXCLUDED.action,description=EXCLUDED.description,updated_at=CURRENT_TIMESTAMP
        `, { replacements: { id: `PERM-${name}`, name, action: name.split(".").at(-1), description }, transaction });
      }
      await queryInterface.sequelize.query(`
        INSERT INTO role_permissions (role_id,permission_id,created_at,updated_at)
        SELECT r.id,p.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        FROM roles r CROSS JOIN permissions p
        WHERE r.slug IN ('admin','owner','manager') AND p.name IN (:permissions)
        ON CONFLICT DO NOTHING
      `, { replacements: { permissions: COUNT_PERMISSIONS.map(([name]) => name) }, transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(`
        DELETE FROM role_permissions
        WHERE permission_id IN (SELECT id FROM permissions WHERE name IN (:permissions))
      `, { replacements: { permissions: COUNT_PERMISSIONS.map(([name]) => name) }, transaction });
      await queryInterface.sequelize.query("DELETE FROM permissions WHERE name IN (:permissions)", { replacements: { permissions: COUNT_PERMISSIONS.map(([name]) => name) }, transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
