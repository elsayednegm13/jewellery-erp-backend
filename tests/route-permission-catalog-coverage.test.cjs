const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = require(path.join(root, "src/bootstrap/permission-catalog-source.js"));
const consumerCoverage = require(path.join(root, "src/bootstrap/permission-consumer-coverage.js"));

function walkJavaScript(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkJavaScript(absolute));
    else if (/\.(?:js|cjs)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function collectCallText(text, start) {
  const opening = text.indexOf("(", start);
  if (opening < 0) return "";
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = opening; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(opening + 1, index);
    }
  }
  return "";
}

function firstArgumentPermissionNames(argumentText) {
  const firstArgument = argumentText.split(/,(?![^\[\{]*[\]\}])/)[0];
  return [...firstArgument.matchAll(/["']([a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*)["']/gi)].map((match) => match[1]);
}

function collectDirectPermissionConsumers() {
  const names = new Map();
  const callPattern = /\b(?:require|requireBusiness|requireAny|requireAnyBusiness)Permission\s*\(/g;
  const servicePattern = /\buserHas(?:Any)?Permission\s*\(/g;
  for (const file of walkJavaScript(path.join(root, "src"))) {
    const relative = path.relative(root, file);
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of [callPattern, servicePattern]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text))) {
        const call = collectCallText(text, match.index);
        for (const name of firstArgumentPermissionNames(call)) {
          if (!names.has(name)) names.set(name, new Set());
          names.get(name).add(relative);
        }
      }
    }
  }
  return names;
}

test("all generic CRUD guard candidates are registered in the canonical source", () => {
  for (const resourceName of Object.keys(consumerCoverage.CRUD_PERMISSIONS)) {
    for (const action of ["list", "get", "create", "update", "delete"]) {
      for (const permissionName of consumerCoverage.crudGuardPermissionCandidates(resourceName, action)) {
        assert.ok(source.CATALOG_INDEX.byName.has(permissionName), `${resourceName}.${action} -> ${permissionName}`);
      }
    }
  }
});

test("direct route, middleware, and service permission consumers use registered names", () => {
  const consumers = collectDirectPermissionConsumers();
  const unknown = [...consumers.keys()].filter((name) => !source.CATALOG_INDEX.byName.has(name));
  assert.deepEqual(unknown, [], unknown.map((name) => `${name}: ${[...consumers.get(name)].join(", ")}`).join("\n"));
});

test("branch read authority is the existing settings.view permission", () => {
  assert.equal(consumerCoverage.CRUD_READ_PERMISSION_OVERRIDES.branches, "settings.view");
  assert.ok(source.CATALOG_INDEX.byName.has("settings.view"));
  assert.equal(source.CATALOG_INDEX.byName.has("branches.view"), false);
});
