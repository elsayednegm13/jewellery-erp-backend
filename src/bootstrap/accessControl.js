const { Permission, Role, RolePermission, UserRole } = require("../models");

const PERMISSIONS = [
  "dashboard.view",
  "customers.view", "customers.create", "customers.update", "customers.delete", "customers.export",
  "sales.view", "sales.create", "sales.approve", "sales.export", "sales.print",
  "inventory.view", "inventory.create", "inventory.update", "inventory.delete", "inventory.adjust", "inventory.export", "inventory.print",
  "suppliers.view", "suppliers.create", "suppliers.update", "suppliers.delete", "suppliers.export",
  "accounting.view", "accounting.post", "accounting.export", "treasury.view", "treasury.update",
  "reports.view", "reports.export", "settings.view", "settings.update",
  "users.view", "users.create", "users.update", "users.delete", "users.manage",
  "roles.view", "roles.manage", "permissions.manage",
  "notifications.view", "notifications.manage", "approvals.view", "approvals.manage",
  "audit.view", "gold.view", "gold.update", "payroll.view", "payroll.manage"
];

const ROLE_DEFS = {
  admin: PERMISSIONS,
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => !["accounting.post", "users.delete", "roles.manage", "permissions.manage"].includes(p)),
  accountant: [
    "dashboard.view", "sales.view", "customers.view", "suppliers.view", "accounting.view", "accounting.post",
    "treasury.view", "treasury.update", "reports.view", "reports.export", "settings.view",
    "notifications.view", "audit.view"
  ],
  sales: [
    "dashboard.view", "sales.view", "sales.create", "sales.print", "customers.view", "customers.create",
    "customers.update", "inventory.view", "notifications.view"
  ]
};

async function ensurePermissions() {
  const rows = [];
  for (const name of PERMISSIONS) {
    const [module, action] = name.split(".");
    rows.push({ id: `PERM-${name}`, name, module, action, description: name });
  }
  await Permission.bulkCreate(rows, { ignoreDuplicates: true });
}

async function ensureRolesForCompany(companyId) {
  await ensurePermissions();
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
      }
    });
    const permissions = await Permission.findAll({ where: { name: permissionNames } });
    await RolePermission.bulkCreate(
      permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      { ignoreDuplicates: true }
    );
  }
}

async function assignUserRole(userId, companyId, slug) {
  await ensureRolesForCompany(companyId);
  const role = await Role.findOne({ where: { companyId, slug } });
  if (!role) return null;
  await UserRole.findOrCreate({ where: { userId, roleId: role.id } });
  return role;
}

module.exports = {
  PERMISSIONS,
  ROLE_DEFS,
  ensurePermissions,
  ensureRolesForCompany,
  assignUserRole
};
