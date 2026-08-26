const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = require(path.join(root, "src/bootstrap/permission-catalog-source.js"));
const reconciler = require(path.join(root, "src/bootstrap/permission-catalog-reconciler.js"));

test("canonical permission source is the 152-entry union and has no duplicate authority", () => {
  assert.equal(source.PERMISSION_CATALOG.length, 152);
  assert.equal(source.CATALOG_INDEX.count, 152);
  assert.deepEqual(
    source.PERMISSION_CATALOG.filter((permission) => permission.name.startsWith("inventory.revision.")).map((permission) => permission.name),
    ["inventory.revision.create", "inventory.revision.view"],
  );
});

test("duplicate permission names and module/action pairs fail closed", () => {
  assert.throws(
    () => source.validatePermissionCatalog([{ name: "x.view", module: "x", action: "view" }, { name: "x.view", module: "x", action: "view" }]),
    (error) => error.code === "DUPLICATE_PERMISSION_NAME",
  );
  assert.throws(
    () => source.validatePermissionCatalog([{ name: "x.one", module: "x", action: "same" }, { name: "x.two", module: "x", action: "same" }], { enforceUniqueModuleAction: true }),
    (error) => error.code === "DUPLICATE_PERMISSION_MODULE_ACTION",
  );
});

test("source-to-DB diff detects exactly the accepted Revision pair without deleting extras", () => {
  const dbRows = source.PERMISSION_CATALOG
    .filter((permission) => !["inventory.revision.create", "inventory.revision.view"].includes(permission.name));
  const exact = reconciler.comparePermissionCatalog({ sourceCatalog: source.PERMISSION_CATALOG, dbRows });
  assert.deepEqual(exact.missing, ["inventory.revision.create", "inventory.revision.view"]);
  assert.deepEqual(exact.extra, []);
  assert.deepEqual(exact.metadataMismatch, []);
  assert.equal(exact.destructiveDelta, false);
  const withHistoricalExtra = reconciler.comparePermissionCatalog({
    sourceCatalog: source.PERMISSION_CATALOG,
    dbRows: [...dbRows, { id: "legacy", name: "legacy.keep", module: "legacy", action: "keep", description: "historical" }],
  });
  assert.deepEqual(withHistoricalExtra.extra, ["legacy.keep"]);
  assert.equal(withHistoricalExtra.destructiveDelta, false);
});

test("unexpected source drift is rejected before execution", () => {
  assert.throws(
    () => reconciler.assertAllowedMissing(["inventory.revision.create", "unexpected.permission"]),
    (error) => error.code === "BLOCKED_UNEXPECTED_PERMISSION_DRIFT",
  );
  assert.doesNotThrow(() => reconciler.assertAllowedMissing([]));
});

test("protected target and actual database mismatch fail closed", () => {
  assert.throws(
    () => reconciler.assertTarget({ targetMode: "official", targetDb: "darfus_erp", actualDb: "darfus_erp", execute: true, officialApproval: "NO" }),
    (error) => error.code === "PROTECTED_PERMISSION_TARGET_REQUIRES_EXPLICIT_APPROVAL",
  );
  assert.throws(
    () => reconciler.assertTarget({ targetMode: "disposable", targetDb: "darfus_permission_reconcile_01", actualDb: "darfus_erp" }),
    (error) => error.code === "PERMISSION_TARGET_DB_MISMATCH",
  );
  assert.throws(
    () => reconciler.assertTarget({ targetMode: "", targetDb: "darfus_erp", actualDb: "darfus_erp" }),
    (error) => error.code === "PERMISSION_TARGET_MODE_REQUIRED",
  );
});

test("existing role-binding authority reports gaps without widening grants", () => {
  const diff = reconciler.comparePermissionCatalog({
    sourceCatalog: source.PERMISSION_CATALOG,
    dbRows: source.PERMISSION_CATALOG,
    expectedRoleBindings: [{ roleId: "ROLE-1", roleSlug: "admin", permissionNames: ["inventory.revision.view"], assignedPermissionNames: [] }],
  });
  assert.deepEqual(diff.roleBindingGaps, [{ roleId: "ROLE-1", roleSlug: "admin", permissionName: "inventory.revision.view" }]);
});

test("route guard permission keys are present in the canonical catalog", () => {
  const route = fs.readFileSync(path.join(root, "src/routes/asset-revision.routes.js"), "utf8");
  const names = [...route.matchAll(/requireRevisionPermission\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(names)].sort(), ["inventory.revision.create", "inventory.revision.view"]);
  for (const name of names) assert.ok(source.CATALOG_INDEX.byName.has(name), name);
});

test("the existing Super Admin resolver becomes effective from the DB catalog rows", async () => {
  const models = require(path.join(root, "src/models/index.js"));
  const permissionService = require(path.join(root, "src/services/permission.service.js"));
  const originalFindAll = models.Permission.findAll;
  models.Permission.findAll = async () => [
    { name: "inventory.revision.create" },
    { name: "inventory.revision.view" },
  ];
  try {
    const names = await permissionService.getUserPermissionNames({ id: "U1", accountType: "super_admin" });
    assert.deepEqual(names.sort(), ["inventory.revision.create", "inventory.revision.view"]);
  } finally {
    models.Permission.findAll = originalFindAll;
  }
});

test("effective resolver keeps the negative RBAC controls fail-closed", async () => {
  const models = require(path.join(root, "src/models/index.js"));
  const permissionService = require(path.join(root, "src/services/permission.service.js"));
  const originalPermissionFindAll = models.Permission.findAll;
  const originalRoleFindAll = models.Role.findAll;
  const originalUserRoleFindAll = models.UserRole.findAll;
  models.Permission.findAll = async () => [{ name: "inventory.revision.create" }, { name: "inventory.revision.view" }];
  models.UserRole.findAll = async () => [{ roleId: "ROLE-VIEW" }];
  models.Role.findAll = async () => [{ permissions: [{ name: "inventory.revision.view" }] }];
  try {
    assert.equal(await permissionService.userHasPermission({ id: "BRANCH", accountType: "branch_shell" }, "inventory.revision.view"), false);
    assert.equal(await permissionService.userHasPermission({ id: "VIEW", accountType: "legacy", role: "sales", companyId: "C1" }, "inventory.revision.view"), true);
    assert.equal(await permissionService.userHasPermission({ id: "VIEW", accountType: "legacy", role: "sales", companyId: "C1" }, "inventory.revision.create"), false);
    assert.equal(await permissionService.userHasPermission({ id: "ADMIN", accountType: "super_admin" }, "inventory.revision.create"), true);
  } finally {
    models.Permission.findAll = originalPermissionFindAll;
    models.Role.findAll = originalRoleFindAll;
    models.UserRole.findAll = originalUserRoleFindAll;
  }
});
