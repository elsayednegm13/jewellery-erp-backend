const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const serviceSource = fs.readFileSync(path.join(root, "src/services/inventory-audit-canonical.service.js"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "src/routes/erp.routes.js"), "utf8");
const pageSource = fs.readFileSync(path.join(root, "../app/[locale]/(dashboard)/inventory/stock-audit/page.tsx"), "utf8");
const semanticsSource = fs.readFileSync(path.join(root, "../components/inventory/count-semantics.ts"), "utf8");
const { ConflictError } = require(path.join(root, "src/utils/errors.js"));
const { canonicalErrorPayload } = require(path.join(root, "src/utils/error-contract.js"));

test("eligibility conflicts preserve a stable safe reason contract", () => {
  const error = new ConflictError("Scanned Asset is not count-eligible.", {
    reasonCode: "ASSET_SOLD",
    assetId: "AST-1",
    barcode: "TEST-1",
    currentOperationalStatus: "SOLD",
  });
  const payload = canonicalErrorPayload({ status: error.statusCode, code: error.errorCode, message: error.message, details: error.details, requestId: "REQ-1" });
  assert.equal(payload.error.code, "STATE_CONFLICT");
  assert.deepEqual(payload.error.details, {
    reasonCode: "ASSET_SOLD",
    assetId: "AST-1",
    barcode: "TEST-1",
    currentOperationalStatus: "SOLD",
  });
});

test("canonical observe keeps the guard and classifies every proven rejection branch", () => {
  assert.match(serviceSource, /eligibilityConflict\("Scanned Asset is not count-eligible\.", reasonCode, asset\)/);
  for (const reason of ["ASSET_SOLD", "ASSET_MELTED", "ASSET_MISSING", "ASSET_BRANCH_MISMATCH", "ASSET_LOCATION_MISMATCH", "ASSET_NOT_IN_FROZEN_SET"]) {
    assert.match(serviceSource, new RegExp(reason));
  }
  assert.match(serviceSource, /operationalStatus === "SOLD"/);
  assert.match(serviceSource, /String\(asset\.branchId\) !== String\(branchId\)/);
  assert.match(serviceSource, /String\(asset\.locationId \|\| ""\) !== String\(audit\.locationId \|\| ""\)/);
});

test("read model marks lifecycle changes without changing frozen Count evidence", () => {
  assert.match(routeSource, /lifecycleChangedAfterSnapshot/);
  assert.match(routeSource, /new Date\(item\.asset\.updatedAt\)\.getTime\(\) > new Date\(item\.createdAt\)\.getTime\(\)/);
  assert.match(routeSource, /expectedCount: items\.length/);
  assert.match(routeSource, /countedCount: items\.filter\(\(item\) => item\.result === "MATCHED"\)/);
});

test("AR and EN UI separate Count evidence, current lifecycle, and rejection reason", () => {
  for (const text of [
    "حالة القطعة الحالية",
    "السبب",
    "تغيرت الحالة بعد تثبيت قائمة الجرد",
    "هذه القطعة مباعة حاليًا ولا يمكن احتسابها في هذا الجرد.",
    "Current Asset state",
    "Reason",
    "Lifecycle changed after the Count snapshot",
    "This Asset is currently sold and cannot be counted in this Count.",
  ]) assert.match(pageSource, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(pageSource, /cause\.details\?\.reasonCode/);
  assert.match(pageSource, /item\.asset\?\.operationalStatus/);
  assert.match(pageSource, /countItemDisplayState\(item, count\?\.status \|\| "in-progress"\)/);
  assert.doesNotMatch(pageSource, /item\.status === "matched"/);
  assert.match(semanticsSource, /if \(result === "MATCHED"\) return "MATCHED"/);
  assert.match(semanticsSource, /if \(result === "MISSING"\) return "MISSING"/);
  assert.match(semanticsSource, /if \(result === "EXTRA"\) return "UNEXPECTED"/);
  assert.match(semanticsSource, /countStatus === "in-progress" \? "UNOBSERVED"/);
});

test("rejected scans do not create a local observation or automatic retry", () => {
  const scanBlock = pageSource.slice(pageSource.indexOf("const scanBarcode"), pageSource.indexOf("const lifecycleLabel"));
  const catchBlock = scanBlock.slice(scanBlock.indexOf("} catch"));
  assert.doesNotMatch(catchBlock, /loadCount\(count\.id\)/);
  assert.doesNotMatch(scanBlock, /setTimeout|retry|Retry/i);
  assert.match(scanBlock, /setScanRejection/);
});
