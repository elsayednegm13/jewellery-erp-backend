const { DataTypes } = require("sequelize");

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

module.exports = {
  up: async (queryInterface) => {
    const now = new Date();

    await queryInterface.createTable("permissions", {
      id: { type: DataTypes.STRING, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false, unique: true },
      module: { type: DataTypes.STRING, allowNull: false },
      action: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.createTable("roles", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT },
      is_system: { type: DataTypes.BOOLEAN, defaultValue: false },
      is_admin: { type: DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("roles", ["company_id", "slug"], { unique: true });

    await queryInterface.createTable("role_permissions", {
      role_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "roles", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        primaryKey: true
      },
      permission_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "permissions", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        primaryKey: true
      },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.createTable("user_roles", {
      user_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        primaryKey: true
      },
      role_id: {
        type: DataTypes.STRING,
        allowNull: false,
        references: { model: "roles", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        primaryKey: true
      },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.bulkInsert("permissions", PERMISSIONS.map((name) => {
      const [module, action] = name.split(".");
      return { id: `PERM-${name}`, name, module, action, description: name, created_at: now, updated_at: now };
    }));

    const companies = await queryInterface.sequelize.query("SELECT id FROM companies", { type: queryInterface.sequelize.QueryTypes.SELECT });
    const roleRows = [];
    const rolePermissionRows = [];
    for (const company of companies) {
      for (const [slug, perms] of Object.entries(ROLE_DEFS)) {
        const roleId = `ROLE-${company.id}-${slug}`;
        roleRows.push({
          id: roleId,
          company_id: company.id,
          name: slug.charAt(0).toUpperCase() + slug.slice(1),
          slug,
          description: `${slug} role`,
          is_system: true,
          is_admin: slug === "admin" || slug === "owner",
          created_at: now,
          updated_at: now
        });
        for (const permission of perms) {
          rolePermissionRows.push({ role_id: roleId, permission_id: `PERM-${permission}`, created_at: now, updated_at: now });
        }
      }
    }
    if (roleRows.length) await queryInterface.bulkInsert("roles", roleRows);
    if (rolePermissionRows.length) await queryInterface.bulkInsert("role_permissions", rolePermissionRows);

    const users = await queryInterface.sequelize.query("SELECT id, company_id, role FROM users", { type: queryInterface.sequelize.QueryTypes.SELECT });
    const userRoleRows = users.map((user) => ({
      user_id: user.id,
      role_id: `ROLE-${user.company_id}-${user.role || "sales"}`,
      created_at: now,
      updated_at: now
    }));
    if (userRoleRows.length) await queryInterface.bulkInsert("user_roles", userRoleRows);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("user_roles");
    await queryInterface.dropTable("role_permissions");
    await queryInterface.dropTable("roles");
    await queryInterface.dropTable("permissions");
  }
};
