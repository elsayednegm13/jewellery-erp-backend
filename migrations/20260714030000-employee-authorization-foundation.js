"use strict";

const { DataTypes } = require("sequelize");

const EMPLOYEE_AUTH_PERMISSIONS = [
  "employees.credentials.manage",
  "employees.permissions.manage",
  "employees.branches.manage",
  "employees.verification.view"
];

function normalizeEmployeeCodeForMigration(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().normalize("NFKC").toUpperCase();
  if (!normalized || normalized.length > 64) return null;
  return /^[A-Z0-9][A-Z0-9_.-]*$/.test(normalized) ? normalized : null;
}

async function backfillEmployeeCodes(queryInterface) {
  const [employees] = await queryInterface.sequelize.query(`
    SELECT id, company_id
    FROM employees
    WHERE deleted_at IS NULL
    ORDER BY company_id, id
  `);
  const counts = new Map();
  const candidates = [];
  for (const employee of employees) {
    const normalized = normalizeEmployeeCodeForMigration(employee.id);
    if (!normalized) continue;
    const key = `${employee.company_id}::${normalized}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    candidates.push({ ...employee, normalized, key });
  }
  for (const candidate of candidates) {
    if (counts.get(candidate.key) !== 1) continue;
    await queryInterface.sequelize.query(`
      UPDATE employees
      SET employee_code = :employeeCode,
          employee_code_normalized = :normalized,
          updated_at = NOW()
      WHERE id = :id
        AND company_id = :companyId
        AND employee_code IS NULL
        AND employee_code_normalized IS NULL
    `, {
      replacements: {
        id: candidate.id,
        companyId: candidate.company_id,
        employeeCode: candidate.id,
        normalized: candidate.normalized
      }
    });
  }
}

async function backfillBranchAccess(queryInterface) {
  await queryInterface.sequelize.query(`
    INSERT INTO employee_branch_access
      (id, company_id, employee_id, branch_id, active, valid_from, created_at, updated_at)
    SELECT
      'EBA-' || e.id || '-' || e.branch_id,
      e.company_id,
      e.id,
      e.branch_id,
      true,
      NOW(),
      NOW(),
      NOW()
    FROM employees e
    JOIN branches b
      ON b.id = e.branch_id
     AND b.company_id = e.company_id
    WHERE e.deleted_at IS NULL
      AND e.branch_id IS NOT NULL
    ON CONFLICT (company_id, employee_id, branch_id) DO NOTHING
  `);
}

async function addPermissionCatalog(queryInterface) {
  const now = new Date();
  await queryInterface.bulkInsert("permissions", EMPLOYEE_AUTH_PERMISSIONS.map((name) => {
    const [, action] = name.split(".");
    return {
      id: `PERM-${name}`,
      name,
      module: "employees",
      action: action.replace("_", "."),
      description: name,
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
  `, { replacements: { permissionNames: EMPLOYEE_AUTH_PERMISSIONS } });
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("employees", "employee_code", {
      type: DataTypes.STRING(64),
      allowNull: true
    });
    await queryInterface.addColumn("employees", "employee_code_normalized", {
      type: DataTypes.STRING(64),
      allowNull: true
    });
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS employees_company_code_normalized_uq
      ON employees (company_id, employee_code_normalized)
      WHERE employee_code_normalized IS NOT NULL
    `);

    await queryInterface.createTable("employee_credentials", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      employee_id: { type: DataTypes.STRING, allowNull: false, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      pin_hash: { type: DataTypes.STRING(255), allowNull: false },
      credential_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      failed_attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      locked_until: { type: DataTypes.DATE, allowNull: true },
      last_failed_at: { type: DataTypes.DATE, allowNull: true },
      last_verified_at: { type: DataTypes.DATE, allowNull: true },
      pin_changed_at: { type: DataTypes.DATE, allowNull: true },
      reset_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      reset_at: { type: DataTypes.DATE, allowNull: true },
      reset_by_user_id: { type: DataTypes.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("employee_credentials", ["employee_id"], { unique: true, name: "employee_credentials_employee_uq" });
    await queryInterface.addIndex("employee_credentials", ["company_id"], { name: "employee_credentials_company_idx" });

    await queryInterface.createTable("employee_branch_access", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      employee_id: { type: DataTypes.STRING, allowNull: false, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      branch_id: { type: DataTypes.STRING, allowNull: false, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      valid_from: { type: DataTypes.DATE, allowNull: true },
      valid_to: { type: DataTypes.DATE, allowNull: true },
      created_by_user_id: { type: DataTypes.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("employee_branch_access", ["company_id", "employee_id", "branch_id"], { unique: true, name: "employee_branch_access_unique" });
    await queryInterface.addIndex("employee_branch_access", ["employee_id"], { name: "employee_branch_access_employee_idx" });
    await queryInterface.addIndex("employee_branch_access", ["branch_id"], { name: "employee_branch_access_branch_idx" });

    await queryInterface.createTable("employee_role_assignments", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      employee_id: { type: DataTypes.STRING, allowNull: false, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      role_id: { type: DataTypes.STRING, allowNull: false, references: { model: "roles", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      assigned_by_user_id: { type: DataTypes.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("employee_role_assignments", ["company_id", "employee_id", "role_id"], { unique: true, name: "employee_role_assignments_unique" });
    await queryInterface.addIndex("employee_role_assignments", ["employee_id"], { name: "employee_role_assignments_employee_idx" });

    for (const table of ["employee_permission_grants", "employee_permission_denials"]) {
      await queryInterface.createTable(table, {
        id: { type: DataTypes.STRING, primaryKey: true },
        company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        employee_id: { type: DataTypes.STRING, allowNull: false, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
        permission_id: { type: DataTypes.STRING, allowNull: false, references: { model: "permissions", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        [table === "employee_permission_grants" ? "granted_by_user_id" : "denied_by_user_id"]: { type: DataTypes.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false }
      });
      await queryInterface.addIndex(table, ["company_id", "employee_id", "permission_id"], { unique: true, name: `${table}_unique` });
      await queryInterface.addIndex(table, ["employee_id"], { name: `${table}_employee_idx` });
    }

    await queryInterface.createTable("employee_verification_attempts", {
      id: { type: DataTypes.STRING, primaryKey: true },
      company_id: { type: DataTypes.STRING, allowNull: false, references: { model: "companies", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      branch_id: { type: DataTypes.STRING, allowNull: true, references: { model: "branches", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      technical_user_id: { type: DataTypes.STRING, allowNull: true, references: { model: "users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      employee_id: { type: DataTypes.STRING, allowNull: true, references: { model: "employees", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      employee_code_normalized: { type: DataTypes.STRING(64), allowNull: true },
      requested_permission: { type: DataTypes.STRING(160), allowNull: true },
      requested_operation: { type: DataTypes.STRING(160), allowNull: true },
      requested_level: { type: DataTypes.INTEGER, allowNull: false },
      result: { type: DataTypes.ENUM("success", "failure"), allowNull: false },
      failure_code: { type: DataTypes.STRING(80), allowNull: true },
      ip_address: { type: DataTypes.STRING(80), allowNull: true },
      user_agent: { type: DataTypes.STRING(255), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("employee_verification_attempts", ["company_id", "created_at"], { name: "employee_verification_company_created_idx" });
    await queryInterface.addIndex("employee_verification_attempts", ["employee_id", "created_at"], { name: "employee_verification_employee_created_idx" });
    await queryInterface.addIndex("employee_verification_attempts", ["technical_user_id", "created_at"], { name: "employee_verification_user_created_idx" });
    await queryInterface.addIndex("employee_verification_attempts", ["branch_id", "created_at"], { name: "employee_verification_branch_created_idx" });
    await queryInterface.addIndex("employee_verification_attempts", ["result", "created_at"], { name: "employee_verification_result_created_idx" });

    await backfillEmployeeCodes(queryInterface);
    await backfillBranchAccess(queryInterface);
    await addPermissionCatalog(queryInterface);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name IN (:permissionNames))",
      { replacements: { permissionNames: EMPLOYEE_AUTH_PERMISSIONS } }
    );
    await queryInterface.sequelize.query(
      "DELETE FROM permissions WHERE name IN (:permissionNames)",
      { replacements: { permissionNames: EMPLOYEE_AUTH_PERMISSIONS } }
    );
    await queryInterface.dropTable("employee_verification_attempts");
    await queryInterface.dropTable("employee_permission_denials");
    await queryInterface.dropTable("employee_permission_grants");
    await queryInterface.dropTable("employee_role_assignments");
    await queryInterface.dropTable("employee_branch_access");
    await queryInterface.dropTable("employee_credentials");
    await queryInterface.removeIndex("employees", "employees_company_code_normalized_uq").catch(() => {});
    await queryInterface.removeColumn("employees", "employee_code_normalized");
    await queryInterface.removeColumn("employees", "employee_code");
  }
};
