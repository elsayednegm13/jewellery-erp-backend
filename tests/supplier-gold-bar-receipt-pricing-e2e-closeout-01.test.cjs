"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const page = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/suppliers/purchases/page.tsx"), "utf8");
const clone = fs.readFileSync(path.join(root, "backend/scripts/supplier-gold-bar-receipt-pricing-e2e-closeout-01.js"), "utf8");

test("receiving closeout layout keeps the main form compact with a desktop summary rail", () => {
  assert.match(page, /xl:grid-cols-\[minmax\(0,8fr\)_minmax\(280px,4fr\)\]/);
  assert.match(page, /xl:sticky xl:top-4/);
  assert.match(page, /ملخص الاستلام/);
  assert.match(page, /بيانات إضافية اختيارية/);
  assert.match(page, /السعر الحالي من Gold Center للقراءة فقط/);
  assert.match(page, /سعر الشراء/);
});

test("receiving closeout source preserves the locked bar and general karat contracts", () => {
  assert.match(page, /is24kGoldBar/);
  for (const karat of [14, 18, 21, 22, 24]) assert.match(page, new RegExp(`value="${karat}"`));
  assert.match(clone, /GOLD_BAR_24K/);
  assert.match(clone, /karat: 22/);
  assert.match(clone, /assert\.ok\(non24\.status >= 400/);
});

test("clone runner is fail-closed against both shared databases", () => {
  assert.match(clone, /SELECT current_database\(\)/);
  assert.match(clone, /assert\.equal\(.*ACCEPTANCE/);
  assert.match(clone, /assert\.notEqual\(db, ACCEPTANCE\)/);
  assert.match(clone, /assert\.notEqual\(db, PERSISTENT\)/);
  assert.match(clone, /dropClone\(sourceConfig, clone\)/);
});
