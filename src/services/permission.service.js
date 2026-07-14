const { Op } = require("sequelize");
const { Role, Permission, UserRole } = require("../models");

const ADMIN_LEGACY_ROLES = new Set(["admin", "owner"]);

async function getUserRoles(user) {
  if (!user) return [];
  const roles = await Role.findAll({
    include: [
      {
        model: Permission,
        as: "permissions",
        through: { attributes: [] }
      }
    ],
    where: {
      companyId: user.companyId,
      id: {
        [Op.in]: (await UserRole.findAll({ where: { userId: user.id } })).map((row) => row.roleId)
      }
    }
  });

  // Fallback for legacy users if user_roles is not seeded yet.
  if (!roles.length && user.role) {
    return Role.findAll({
      include: [{ model: Permission, as: "permissions", through: { attributes: [] } }],
      where: { companyId: user.companyId, slug: user.role }
    });
  }

  return roles;
}

async function getUserPermissionNames(user) {
  if (!user) return [];
  if ((user.accountType || "legacy") === "branch_shell") {
    return [];
  }
  if (ADMIN_LEGACY_ROLES.has(user.role)) {
    const all = await Permission.findAll({ attributes: ["name"] });
    return all.map((p) => p.name);
  }

  const roles = await getUserRoles(user);
  const permissions = new Set();
  for (const role of roles) {
    for (const permission of role.permissions || []) {
      permissions.add(permission.name);
    }
  }
  return [...permissions].sort();
}

async function userHasPermission(user, permissionName) {
  if (!user) return false;
  if ((user.accountType || "legacy") === "branch_shell") return false;
  if (ADMIN_LEGACY_ROLES.has(user.role)) return true;
  const names = await getUserPermissionNames(user);
  return names.includes(permissionName);
}

async function userHasAnyPermission(user, permissionNames) {
  if (!user) return false;
  if ((user.accountType || "legacy") === "branch_shell") return false;
  if (ADMIN_LEGACY_ROLES.has(user.role)) return true;
  const names = await getUserPermissionNames(user);
  return permissionNames.some((name) => names.includes(name));
}

module.exports = {
  getUserRoles,
  getUserPermissionNames,
  userHasPermission,
  userHasAnyPermission
};
