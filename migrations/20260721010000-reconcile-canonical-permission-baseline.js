"use strict";

// This release's immutable source snapshot is intentionally imported from the
// versioned v1 baseline. Existing databases receive only absent catalog rows
// and absent grants on the five built-in system roles; custom roles are never
// expanded by this migration.
const {
  PERMISSIONS,
  ROLE_DEFS,
  SALES_ADJUSTMENT_PERMISSIONS
} = require("../src/bootstrap/permission-baseline-v1");

function permissionRow(name, now) {
  const parts = name.split(".");
  const action = parts.pop();
  return {
    id: `PERM-${name}`,
    name,
    module: parts.join("."),
    action,
    description: name,
    created_at: now,
    updated_at: now
  };
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const now = new Date();
      await queryInterface.bulkInsert(
        "permissions",
        SALES_ADJUSTMENT_PERMISSIONS.map((name) => permissionRow(name, now)),
        { ignoreDuplicates: true, transaction }
      );

      for (const [slug, permissionNames] of Object.entries(ROLE_DEFS)) {
        await queryInterface.sequelize.query(
          `
            INSERT INTO role_permissions (role_id, permission_id, created_at, updated_at)
            SELECT role.id, permission.id, :now, :now
            FROM roles role
            JOIN permissions permission ON permission.name IN (:permissionNames)
            WHERE role.is_system = true AND role.slug = :slug
            ON CONFLICT (role_id, permission_id) DO NOTHING
          `,
          { replacements: { now, slug, permissionNames }, transaction }
        );
      }

      const [missing] = await queryInterface.sequelize.query(
        "SELECT name FROM permissions WHERE name IN (:permissionNames)",
        { replacements: { permissionNames: PERMISSIONS }, transaction }
      );
      if (missing.length !== PERMISSIONS.length) {
        throw new Error("CANONICAL_PERMISSION_BASELINE_INCOMPLETE");
      }
    });
  },

  // Intentionally non-destructive: a rollback after operators have changed
  // role memberships must not delete canonical rows or historical grants.
  async down() {}
};
