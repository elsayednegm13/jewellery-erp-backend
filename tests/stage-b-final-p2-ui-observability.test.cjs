const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const stockAuditSource = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/inventory/stock-audit/page.tsx"), "utf8");
const assetDetailsSource = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/inventory/[id]/page.tsx"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "backend/src/routes/erp.routes.js"), "utf8");

test("closed Count history uses the canonical read endpoint and business labels", () => {
  assert.match(stockAuditSource, /\/inventory-v2\/audits\?status=closed/);
  assert.match(stockAuditSource, /Closed Count history/);
  assert.match(stockAuditSource, /سجل الجرد المغلق/);
  assert.match(stockAuditSource, /Expected/);
  assert.match(stockAuditSource, /Counted/);
  assert.match(stockAuditSource, /Missing/);
  assert.match(stockAuditSource, /Variance/);
  assert.match(stockAuditSource, /closed: "مغلق"/);
  assert.match(stockAuditSource, /closed: "Closed"/);
  assert.match(routeSource, /router\.get\("\/inventory-v2\/audits"/);
});

test("closed Count history is read-only and does not add a mutation path", () => {
  assert.match(stockAuditSource, /Read-only preserved evidence/);
  assert.doesNotMatch(stockAuditSource, /history.*onClick|onClick.*history/);
  assert.match(routeSource, /router\.get\("\/inventory-v2\/audits"/);
});

test("Asset event codes are mapped in the UI without changing stored event data", () => {
  for (const code of ["TRANSFER_REQUEST", "TRANSFER_OUT", "TRANSFER_IN", "WORKSHOP_SENT", "WORKSHOP_RETURNED", "PURCHASE_RECEIVED"]) {
    assert.match(assetDetailsSource, new RegExp(`${code}:`));
  }
  assert.match(assetDetailsSource, /eventLabel\(entry\.eventType, rtl\)/);
  assert.match(assetDetailsSource, /Immutable AssetEvents/);
  assert.doesNotMatch(assetDetailsSource, /entry\.eventType\s*=/);
});

test("event display includes the current RFID event catalog", () => {
  for (const code of ["RFID_ASSIGNED", "RFID_REPLACED", "RFID_UNASSIGNED"]) assert.match(assetDetailsSource, new RegExp(`${code}:`));
});

test("B4 lifecycle remains read-only with no generic status writer", () => {
  assert.match(assetDetailsSource, /does not perform generic status changes/);
  assert.doesNotMatch(assetDetailsSource, /\/inventory-v2\/assets\/.*\/status/);
});
