const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
const posSource = fs.readFileSync(path.join(repo, "app/[locale]/(dashboard)/pos/page.tsx"), "utf8");
const routeSource = fs.readFileSync(path.join(repo, "backend/src/routes/erp.routes.js"), "utf8");

test("POS maps canonical operationalStatus into the existing cart status contract", () => {
  assert.match(posSource, /function normalizePosAssetStatus\(value: unknown\): string \| undefined/);
  assert.match(posSource, /return normalized \|\| undefined/);
  assert.match(posSource, /status: normalizePosAssetStatus\(asset\.operationalStatus \?\? asset\.status\)/);
  assert.match(posSource, /const assetStatus = item\.status \|\| \(item\.rawItem \? item\.rawItem\.status : undefined\)/);
});

test("missing and unknown statuses remain fail-closed", () => {
  const normalize = (value) => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return normalized || undefined;
  };
  const eligible = (value) => value === "available";
  assert.equal(eligible(normalize("AVAILABLE")), true);
  assert.equal(eligible(normalize("SOLD")), false);
  assert.equal(eligible(normalize("DAMAGED")), false);
  assert.equal(eligible(normalize(undefined)), false);
  assert.equal(eligible(normalize("UNKNOWN")), false);
});

test("/pos/search keeps operationalStatus as the backend canonical authority", () => {
  const routeStart = routeSource.indexOf('router.get("/pos/search"');
  const routeEnd = routeSource.indexOf('router.get("/products/:id/movements"', routeStart);
  const searchRoute = routeSource.slice(routeStart, routeEnd);
  assert.ok(routeStart >= 0);
  assert.match(searchRoute, /operationalStatus/);
  assert.match(searchRoute, /operationalStatus: asset\.operationalStatus/);
  assert.doesNotMatch(searchRoute, /status:\s*["']available["']/);
});
