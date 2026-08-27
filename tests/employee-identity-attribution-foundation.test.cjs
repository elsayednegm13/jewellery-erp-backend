const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const actorContext = require("../src/services/command-actor-context.service");

test("B1 attribution contract separates technical user and employee operator identity", () => {
  const contract = actorContext.buildAttributionContract({
    user: { id: "USR-1", firstName: "Tech", lastName: "User" },
    companyId: "CMP-1",
    branchId: "BR-1",
    operatorContext: {
      employeeId: "EMP-1",
      employeeCode: " e-001 ",
      employeeName: "Employee One",
      branchId: "BR-1",
      operatorSessionId: "OPS-1"
    }
  }, {
    sourceOperation: "employees.update",
    sourceReference: "EMP-1",
    occurredAt: "2026-08-25T10:00:00.000Z"
  });

  assert.deepEqual(contract, {
    technicalUserId: "USR-1",
    employeeId: "EMP-1",
    employeeCodeSnapshot: " e-001 ",
    employeeNameSnapshot: "Employee One",
    companyId: "CMP-1",
    branchId: "BR-1",
    operatorSessionId: "OPS-1",
    sourceOperation: "employees.update",
    sourceReference: "EMP-1",
    occurredAt: "2026-08-25T10:00:00.000Z"
  });
});

test("B1 attribution contract does not expose permission authority or create a second identity", () => {
  const contract = actorContext.buildAttributionContract({
    user: { id: "USR-1" },
    companyId: "CMP-1",
    branchId: "BR-1",
    operatorContext: { employeeId: "EMP-1", employeeCode: "E-001", branchId: "BR-1" }
  }, { sourceOperation: "pos.checkout", sourceReference: "INV-1" });

  assert.equal(contract.employeeId, "EMP-1");
  assert.equal(contract.technicalUserId, "USR-1");
  assert.equal(contract.companyId, "CMP-1");
  assert.equal(contract.branchId, "BR-1");
  assert.equal(Object.prototype.hasOwnProperty.call(contract, "permissions"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(contract, "rolePermissions"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(contract, "employeeName"), false);
});

test("B1 request actor context remains deterministic for idempotency callers", () => {
  const req = {
    user: { id: "USR-1", firstName: "Tech", lastName: "User" },
    branchId: "BR-1",
    operatorContext: { employeeId: "EMP-1", employeeCode: "E-001", branchId: "BR-1" }
  };

  assert.deepEqual(actorContext.fromRequest(req), actorContext.fromRequest(req));
  assert.equal(Object.prototype.hasOwnProperty.call(actorContext.fromRequest(req), "occurredAt"), false);
});

test("B1 Employee lifecycle routes use dual actor attribution inside their transactions", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/routes/erp.routes.js"), "utf8");
  for (const operation of ["employees.create", "employees.update", "employees.deactivate", "employees.reactivate"]) {
    assert.match(routes, new RegExp(`sourceOperation: "${operation}"`));
    assert.match(routes, /commandActorContext\.attachAuditActor\(req/);
  }
  assert.match(routes, /employee\.update\(\{ status: "inactive"[\s\S]*?\}, \{ transaction: t \}\)/);
  assert.match(routes, /employee\.update\(\{ status: "present", deactivateReason: null \}[\s\S]*?\}, \{ transaction: t \}\)/);
  assert.match(routes, /employee\.deactivated[\s\S]*?await t\.commit\(\);/);
  assert.match(routes, /employee\.reactivated[\s\S]*?await t\.commit\(\);/);
});
