"use strict";

const PERMISSIONS = [
  "gold_purchase.cgp.self_approve",
  "gold_purchase.igp.self_approve"
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.bulkInsert("permissions", PERMISSIONS.map((name) => {
      const [, aggregate] = name.split(".");
      return {
        id: `PERM-${name}`,
        name,
        module: `gold_purchase.${aggregate}`,
        action: "self_approve",
        description: aggregate === "cgp"
          ? "Controlled self-review override / تجاوز الموافقة الذاتية المنضبط"
          : "Controlled self-review override / تجاوز الموافقة الذاتية المنضبط",
        created_at: now,
        updated_at: now
      };
    }), { ignoreDuplicates: true });
    await queryInterface.sequelize.query(`
      INSERT INTO role_permissions (role_id, permission_id, created_at, updated_at)
      SELECT r.id, p.id, NOW(), NOW()
      FROM roles r
      JOIN permissions p ON p.name IN (:permissionNames)
      WHERE r.is_admin = true
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `, { replacements: { permissionNames: PERMISSIONS } });
  },

  async down(queryInterface) {
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
