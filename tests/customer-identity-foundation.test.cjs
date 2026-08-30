const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const routesSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "routes", "erp.routes.js"),
  "utf8"
);
const controllerSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "controllers", "erp.controller.js"),
  "utf8"
);

test("customer list search treats the canonical Customer ID as a searchable identity field", () => {
  assert.match(
    routesSource,
    /setupCrud\("customers",\s*models\.Customer,\s*\["id",\s*"name",\s*"phone",\s*"email"\]\)/,
    "the API customer list must search by canonical id as well as contact fields"
  );
});

test("customer identity route keeps company and branch scope enforcement in the shared CRUD path", () => {
  assert.match(
    routesSource,
    /setupCrud\("customers",\s*models\.Customer/,
    "customers must remain on the shared scoped CRUD controller"
  );
  assert.match(
    controllerSource,
    /applyBranchReadScope\(this\.model, req, whereClause\)/,
    "customer list reads must continue through branch read scoping"
  );
});
