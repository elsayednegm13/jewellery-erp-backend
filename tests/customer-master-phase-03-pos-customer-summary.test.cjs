"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const route = fs.readFileSync(path.join(root, "backend/src/routes/erp.routes.js"), "utf8");
const service = fs.readFileSync(path.join(root, "backend/src/services/customer-pos-summary.service.js"), "utf8");
const pos = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/pos/page.tsx"), "utf8");

test("POS customer summary is a single branch-scoped read-only projection", () => {
  const start = route.indexOf('router.get("/customers/:id/pos-summary"');
  const end = route.indexOf('setupCrud("suppliers"', start);
  const block = route.slice(start, end);
  assert.ok(start >= 0);
  assert.match(block, /authMiddleware/);
  assert.match(block, /requireBusinessPermission\("customers\.view"\)/);
  assert.match(block, /requireBranchCustomerResource/);
  assert.match(block, /customerPosSummaryService\.getCustomerPosSummary/);
  assert.doesNotMatch(block, /\.create\(|\.update\(|\.destroy\(|\.bulkCreate\(/);
  assert.match(service, /customerCreditService\.getCustomerCreditSummary/);
  assert.match(service, /availableCreditSource:\s*"customer_credit_ledger"/);
  assert.match(service, /totalPurchasesSource:\s*"customers\.purchases"/);
  assert.match(service, /resolvePrimaryAddress/);
  assert.doesNotMatch(service, /Customer\.balance|creditLimit\s*-/);
});

test("POS calls one summary endpoint only after selected customer changes", () => {
  assert.match(pos, /\/customers\/\$\{encodeURIComponent\(customerId\)\}\/pos-summary/);
  assert.match(pos, /if \(!customerId \|\| !isApi\)/);
  assert.match(pos, /customerSummaryGenerationRef/);
  assert.match(pos, /new AbortController\(\)/);
  assert.match(pos, /setCustomerSummary\(null\)/);
  assert.match(pos, /generation !== customerSummaryGenerationRef\.current/);
  assert.doesNotMatch(pos, /selectedCustomer\.balance/);
  assert.doesNotMatch(pos, /creditLimit\s*-/);
  assert.doesNotMatch(pos, /addresses\[0\]/);
});

test("POS card renders the frozen DTO labels and remains read-only", () => {
  for (const text of ["الاسم", "العنوان", "الهاتف", "التصنيف", "النقاط", "إجمالي المشتريات"]) {
    assert.match(pos, new RegExp(text));
  }
  assert.doesNotMatch(pos, /customerSummary\.status/);
  assert.doesNotMatch(pos, /customerSummary\.availableCredit/);
  assert.doesNotMatch(pos, /الرصيد المتاح/);
  assert.doesNotMatch(pos, /العنوان الأساسي/);
  assert.match(pos, /customerSummary\.totalPurchases/);
  assert.match(pos, /formatCustomerAddress\(customerSummary\.primaryAddress\)/);
  assert.match(pos, /العنوان غير مسجل/);
  assert.doesNotMatch(pos, /customerSummary[\s\S]{0,800}(?:setPrimary|إضافة عنوان|تعديل بيانات العميل)/);
});

test("POS card uses one compact row card per visible field", () => {
  const rowClass = /flex min-h-9 w-full min-w-0 items-(?:center|start) justify-between gap-3 rounded-lg border/g;
  assert.equal((pos.match(rowClass) || []).length, 6);
  assert.match(pos, /dir=\{rtl \? "rtl" : "ltr"\}/);
  assert.match(pos, /break-words/);
});
