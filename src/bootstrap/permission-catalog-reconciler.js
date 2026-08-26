"use strict";

const { QueryTypes } = require("sequelize");
const models = require("../models");
const { ROLE_DEFS } = require("./permission-baseline-v1");
const {
  PERMISSION_CATALOG,
  CATALOG_INDEX,
  validatePermissionCatalog,
} = require("./permission-catalog-source");

const OFFICIAL_DATABASE = "darfus_erp";
const APPROVED_REVISION_MISSING = Object.freeze([
  "inventory.revision.create",
  "inventory.revision.view",
]);

function normalizeRows(rows = []) {
  return rows.map((row) => {
    const value = typeof row?.get === "function" ? row.get({ plain: true }) : row;
    return {
      id: value.id,
      name: String(value.name || "").trim(),
      module: String(value.module || "").trim(),
      action: String(value.action || "").trim(),
      description: value.description == null ? null : String(value.description),
    };
  });
}

function comparePermissionCatalog({ sourceCatalog = PERMISSION_CATALOG, dbRows = [], expectedRoleBindings = [] } = {}) {
  const index = validatePermissionCatalog(sourceCatalog);
  const databaseRows = normalizeRows(dbRows);
  const dbByName = new Map(databaseRows.map((row) => [row.name, row]));
  const missing = sourceCatalog.filter((row) => !dbByName.has(row.name)).map((row) => row.name);
  const extra = databaseRows.filter((row) => !index.byName.has(row.name)).map((row) => row.name);
  const metadataMismatch = sourceCatalog.flatMap((source) => {
    const db = dbByName.get(source.name);
    if (!db) return [];
    const fields = ["module", "action", "description"].filter((field) => {
      const expected = source[field] == null ? null : String(source[field]);
      return db[field] !== expected;
    });
    return fields.length ? [{ name: source.name, fields }] : [];
  });
  const roleBindingGaps = expectedRoleBindings.flatMap((expected) => {
    const assigned = new Set((expected.assignedPermissionNames || []).map(String));
    return (expected.permissionNames || []).filter((name) => !assigned.has(name)).map((name) => ({
      roleId: expected.roleId,
      roleSlug: expected.roleSlug,
      permissionName: name,
    }));
  });
  return {
    sourcePermissionCount: sourceCatalog.length,
    dbPermissionCount: databaseRows.length,
    missing,
    extra,
    metadataMismatch,
    roleBindingGaps,
    destructiveDelta: false,
    exactApprovedRevisionDiff: missing.length === APPROVED_REVISION_MISSING.length
      && APPROVED_REVISION_MISSING.every((name) => missing.includes(name))
      && extra.length === 0
      && metadataMismatch.length === 0,
  };
}

function assertTarget({ targetMode, targetDb, actualDb, execute = false, officialApproval = "NO", officialDb = OFFICIAL_DATABASE } = {}) {
  if (!["disposable", "official"].includes(String(targetMode || "").trim().toLowerCase())) {
    throw Object.assign(new Error("PERMISSION_TARGET_MODE_REQUIRED"), { code: "PERMISSION_TARGET_MODE_REQUIRED" });
  }
  if (!String(targetDb || "").trim()) {
    throw Object.assign(new Error("PERMISSION_TARGET_DB_REQUIRED"), { code: "PERMISSION_TARGET_DB_REQUIRED" });
  }
  if (String(targetDb) !== String(actualDb)) {
    throw Object.assign(new Error("PERMISSION_TARGET_DB_MISMATCH"), { code: "PERMISSION_TARGET_DB_MISMATCH", details: { targetDb, actualDb } });
  }
  if (String(actualDb) === String(officialDb) && execute && String(officialApproval).toUpperCase() !== "YES") {
    throw Object.assign(new Error("PROTECTED_PERMISSION_TARGET_REQUIRES_EXPLICIT_APPROVAL"), { code: "PROTECTED_PERMISSION_TARGET_REQUIRES_EXPLICIT_APPROVAL", details: { actualDb, officialDb } });
  }
  if (String(targetMode).toLowerCase() === "official" && String(actualDb) !== String(officialDb)) {
    throw Object.assign(new Error("OFFICIAL_PERMISSION_TARGET_DB_REQUIRED"), { code: "OFFICIAL_PERMISSION_TARGET_DB_REQUIRED", details: { actualDb, officialDb } });
  }
}

function assertAllowedMissing(missing, allowedMissing = APPROVED_REVISION_MISSING) {
  const expected = [...new Set(allowedMissing)].sort();
  const actual = [...new Set(missing)].sort();
  if (actual.length === 0) return;
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw Object.assign(new Error("BLOCKED_UNEXPECTED_PERMISSION_DRIFT"), { code: "BLOCKED_UNEXPECTED_PERMISSION_DRIFT", details: { expected, actual } });
  }
}

async function readDatabaseIdentity(sequelize = models.sequelize) {
  const [rows] = await sequelize.query("SELECT current_database() AS current_database, current_user AS current_user");
  return rows[0];
}

async function readPermissionRows(sequelize = models.sequelize) {
  return sequelize.query("SELECT id, name, module, action, description FROM permissions ORDER BY name", { type: QueryTypes.SELECT });
}

async function readRoleBindingRows(sequelize = models.sequelize) {
  return sequelize.query(
    `SELECT role.id AS role_id, role.slug AS role_slug, permission.name AS permission_name
       FROM roles role
       JOIN role_permissions binding ON binding.role_id = role.id
       JOIN permissions permission ON permission.id = binding.permission_id
      ORDER BY role.slug, permission.name`,
    { type: QueryTypes.SELECT },
  );
}

async function reconcilePermissionCatalog({
  sequelize = models.sequelize,
  sourceCatalog = PERMISSION_CATALOG,
  targetMode,
  targetDb,
  officialApproval = "NO",
  officialDb = OFFICIAL_DATABASE,
  execute = false,
  allowedMissing = APPROVED_REVISION_MISSING,
} = {}) {
  const identity = await readDatabaseIdentity(sequelize);
  assertTarget({ targetMode, targetDb, actualDb: identity.current_database, execute, officialApproval, officialDb });
  const [dbRows, roleRows] = await Promise.all([readPermissionRows(sequelize), readRoleBindingRows(sequelize)]);
  const bindingsByRole = new Map();
  for (const row of roleRows) {
    const key = String(row.role_id);
    if (!bindingsByRole.has(key)) bindingsByRole.set(key, { roleId: row.role_id, roleSlug: row.role_slug, assignedPermissionNames: [] });
    bindingsByRole.get(key).assignedPermissionNames.push(row.permission_name);
  }
  const expectedRoleBindings = [...bindingsByRole.values()]
    .filter((role) => Array.isArray(ROLE_DEFS[role.roleSlug]))
    .map((role) => ({ ...role, permissionNames: ROLE_DEFS[role.roleSlug] }));
  const diff = comparePermissionCatalog({ sourceCatalog, dbRows, expectedRoleBindings });
  const result = {
    target: { mode: targetMode, requestedDb: targetDb, actualDb: identity.current_database, dbUser: identity.current_user },
    execute,
    ...diff,
    roleBindingRows: [...bindingsByRole.values()],
    writes: 0,
  };
  if (!execute) return result;
  if (diff.extra.length || diff.metadataMismatch.length) {
    throw Object.assign(new Error("BLOCKED_UNEXPECTED_PERMISSION_DRIFT"), { code: "BLOCKED_UNEXPECTED_PERMISSION_DRIFT", details: { extra: diff.extra, metadataMismatch: diff.metadataMismatch } });
  }
  assertAllowedMissing(diff.missing, allowedMissing);
  if (diff.missing.length === 0) return result;
  await sequelize.transaction(async (transaction) => {
    const now = new Date();
    const rows = diff.missing.map((name) => {
      const source = CATALOG_INDEX.byName.get(name) || sourceCatalog.find((permission) => permission.name === name);
      return { id: `PERM-${source.name}`, name: source.name, module: source.module, action: source.action, description: source.description, created_at: now, updated_at: now };
    });
    await sequelize.getQueryInterface().bulkInsert("permissions", rows, { transaction });
  });
  return { ...result, writes: diff.missing.length };
}

module.exports = {
  OFFICIAL_DATABASE,
  APPROVED_REVISION_MISSING,
  normalizeRows,
  comparePermissionCatalog,
  assertTarget,
  assertAllowedMissing,
  readDatabaseIdentity,
  readPermissionRows,
  readRoleBindingRows,
  reconcilePermissionCatalog,
};
