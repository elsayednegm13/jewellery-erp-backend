const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const state = read("backend/src/services/supplier-payment-state.service.js");
const routes = read("backend/src/routes/erp.routes.js");
const interfaces = read("lib/repositories/interfaces.ts");
const api = read("lib/repositories/api-impl.ts");
const local = read("lib/repositories/local-impl.ts");
const supplierUi = read("app/[locale]/(dashboard)/suppliers/[id]/page.tsx");

test("supplier settlement is explicitly 2DP and uses posted AP authority", () => {
  assert.match(state, /toDecimalPlaces\(2, Decimal\.ROUND_HALF_UP\)/);
  assert.match(state, /postedPayableByReference/);
  assert.match(state, /ACCOUNT_ROLE_CATALOG\.SUPPLIER_PAYABLE\.code/);
  assert.match(state, /originalPayable/);
  assert.match(routes, /const amount = supplierPaymentState\.round2\(b\.amount\)/);
  assert.match(routes, /postedPayableByReference\(models, req\.companyId, \[po\.id\], t\)/);
});

test("effective payment state preserves single-PO allocation and subtracts reversals", () => {
  assert.match(state, /type: "cash_out", category: "supplier_purchase"/);
  assert.match(state, /type: "cash_in", category: "supplier_payment_reversal"/);
  assert.match(state, /r\.type === "cash_in" \? -amount : amount/);
  assert.match(routes, /PAYMENT REVERSAL/);
  assert.match(routes, /purchase\.payment\.reversal/);
});

test("supplier reversal is append-only, idempotent, scoped, and journal-linked", () => {
  assert.match(routes, /\/purchase-orders\/:poId\/payments\/:paymentId\/reverse/);
  assert.match(routes, /A reason is required to reverse a supplier payment/);
  assert.match(routes, /type: "cash_in"/);
  assert.match(routes, /category: "supplier_payment_reversal"/);
  assert.match(routes, /reversalOf: originalJournal\.id/);
  assert.match(routes, /supplier\.payment\.reversal/);
  assert.match(routes, /idempotencyService\.succeed/);
  assert.match(routes, /resolveAuthorizedBranchId\(req, paymentBranchId/);
  assert.doesNotMatch(routes, /CashTransaction\.destroy\(\{[^}]*supplier_payment_reversal/s);
});

test("reversal caller respects the plain-JSON postEntry contract", () => {
  assert.match(routes, /postCashEntry\(reversalTx\.toJSON\(\), actor/);
  assert.match(routes, /models\.JournalEntry\.findOne\(\{[\s\S]*reversalJournal\.id[\s\S]*sourceId: reversalTx\.id/);
  assert.match(routes, /persistedReversalJournal\.update\(\{ reversalOf: originalJournal\.id \}/);
  assert.doesNotMatch(routes, /reversalJournal\.update\(\{ reversalOf: originalJournal\.id \}/);
  assert.match(routes, /SUPPLIER_REVERSAL_JOURNAL_REQUIRED/);
});

test("reversal keeps transaction, company, branch, permission, and concurrency guards", () => {
  assert.match(routes, /requireBusinessPermission\("treasury\.update"/);
  assert.match(routes, /where: \{ id: req\.params\.poId, companyId: req\.companyId \}/);
  assert.match(routes, /where: \{[\s\S]*id: req\.params\.paymentId,[\s\S]*companyId: req\.companyId/);
  assert.match(routes, /resolveAuthorizedBranchId\(req, paymentBranchId/);
  assert.match(routes, /lock: t\.LOCK\.UPDATE/);
  assert.match(routes, /existingReversal/);
  assert.match(routes, /await t\.rollback\(\)/);
});

test("statement exposes payment reversals without becoming a full subledger", () => {
  assert.match(routes, /supplier_payment_reversal/);
  assert.match(routes, /isReversal \? "supplier_payment_reversal" : "supplier_payment"/);
  assert.match(routes, /debit: isReversal \? 0 : amount/);
  assert.match(routes, /credit: isReversal \? amount : 0/);
  assert.match(routes, /meta: \{ source: "source_documents", ledgerBased: false/);
});

test("frontend and repositories expose a single safe reversal contract", () => {
  assert.match(interfaces, /reverseSupplierPayment\(/);
  assert.match(api, /payments\/\$\{encodeURIComponent\(paymentId\)\}\/reverse/);
  assert.match(local, /Supplier payment reversals are only available in API mode/);
  assert.match(supplierUi, /Reversal reason \(required\)/);
  assert.match(supplierUi, /reverseSupplierPayment\(/);
  assert.match(supplierUi, /payment\.reversible === true/);
});

test("no migration was added for the settlement closure", () => {
  const migrationDir = path.join(root, "backend/migrations");
  const names = fs.readdirSync(migrationDir);
  assert.equal(names.some((name) => /supplier.*payment|settlement.*reversal/i.test(name)), false);
});
