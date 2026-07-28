const { Permission, Role, RolePermission, UserRole } = require("../models");
const { PERMISSIONS, ROLE_DEFS } = require("./permission-baseline-v1");

async function ensurePermissions({ transaction } = {}) {
  const rows = [];
  for (const name of PERMISSIONS) {
    const parts = name.split(".");
    const action = parts.pop();
    const moduleName = parts.join(".");
    rows.push({ id: `PERM-${name}`, name, module: moduleName, action, description: name });
  }
  await Permission.bulkCreate(rows, { ignoreDuplicates: true, transaction });
}

async function ensureRolesForCompany(companyId, { transaction } = {}) {
  await ensurePermissions({ transaction });
  for (const [slug, permissionNames] of Object.entries(ROLE_DEFS)) {
    const [role] = await Role.findOrCreate({
      where: { companyId, slug },
      defaults: {
        id: `ROLE-${companyId}-${slug}`,
        companyId,
        name: slug.charAt(0).toUpperCase() + slug.slice(1),
        description: `${slug} role`,
        isSystem: true,
        isAdmin: slug === "admin" || slug === "owner"
      },
      transaction
    });
    const permissions = await Permission.findAll({ where: { name: permissionNames }, transaction });
    await RolePermission.bulkCreate(
      permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      { ignoreDuplicates: true, transaction }
    );
  }
}

async function assignUserRole(userId, companyId, slug, { transaction } = {}) {
  await ensureRolesForCompany(companyId, { transaction });
  const role = await Role.findOne({ where: { companyId, slug }, transaction });
  if (!role) return null;
  await UserRole.findOrCreate({ where: { userId, roleId: role.id }, transaction });
  return role;
}

module.exports = {
  PERMISSIONS,
  ROLE_DEFS,
  ensurePermissions,
  ensureRolesForCompany,
  assignUserRole
};
