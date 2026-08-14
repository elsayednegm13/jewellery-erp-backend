const PERMISSIONS = [
  "branches.create",
  "branches.update",
  "branches.deactivate",
  "branches.reactivate",
  "branches.delete",
  "customers.deactivate",
  "customers.reactivate",
  "suppliers.deactivate",
  "suppliers.reactivate"
];

module.exports = {
  up: async (queryInterface) => {
    const now = new Date();
    for (const name of PERMISSIONS) {
      const [moduleName, action] = name.split(".");
      await queryInterface.sequelize.query(
        `
        INSERT INTO permissions (id, name, module, action, description, created_at, updated_at)
        VALUES (:id, :name, :moduleName, :action, :description, :createdAt, :updatedAt)
        ON CONFLICT (name) DO NOTHING
        `,
        {
          replacements: {
            id: `PERM-${name}`,
            name,
            moduleName,
            action,
            description: name,
            createdAt: now,
            updatedAt: now
          }
        }
      );
    }

    await queryInterface.sequelize.query(
      `
      INSERT INTO role_permissions (role_id, permission_id, created_at, updated_at)
      SELECT r.id, p.id, :createdAt, :updatedAt
      FROM roles r
      JOIN permissions p ON p.name IN (:permissionNames)
      WHERE r.slug IN ('admin', 'owner') OR r.is_admin = true
      ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      {
        replacements: {
          permissionNames: PERMISSIONS,
          createdAt: now,
          updatedAt: now
        }
      }
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      "DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name IN (:permissionNames))",
      { replacements: { permissionNames: PERMISSIONS } }
    );
    await queryInterface.sequelize.query(
      "DELETE FROM permissions WHERE name IN (:permissionNames)",
      { replacements: { permissionNames: PERMISSIONS } }
    );
  }
};
