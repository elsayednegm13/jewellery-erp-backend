const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const authority = read("docs/client-requirements/DARFUS_GIFT_VOUCHER_FULL_REDEMPTION_AUTHORITY.md");
const drift = read("docs/client-requirements/DARFUS_GIFT_VOUCHER_CONTRACT_DRIFT_MATRIX.md");
const rules = read("docs/client-requirements/DARFUS_GIFT_VOUCHER_EFFECTIVE_BUSINESS_RULES.md");
const finance = read("docs/client-requirements/DARFUS_GIFT_VOUCHER_FINANCIAL_BOUNDARY_CONTRACT.md");
const matrix = read("docs/client-requirements/DARFUS_GIFT_VOUCHER_FULL_REDEMPTION_CONTRACT_TEST_MATRIX.md");
const eventMatrix = read("docs/client-requirements/DARFUS_D2F_GV_FINANCIAL_EVENT_MATRIX.md");
const policy = read("docs/client-requirements/DARFUS_D2F_GV_PURCHASED_VOUCHER_UAE_FINANCIAL_POLICY.md");
const route = read("backend/src/routes/erp.routes.js");
const posting = read("backend/src/services/posting.service.js");
const projection = read("backend/src/services/invoice-projection.service.js");
const genericNonVoucher = read("backend/src/services/reservation.service.js");

test("GV-CONTRACT-01: specialized redemption mode is full-only", () => {
  assert.match(authority, /Redemption mode \| `FULL_REDEMPTION_ONLY`/);
  assert.match(rules, /`FULL_REDEMPTION_ONLY`/);
});

test("GV-CONTRACT-02: partial allocation and residual balance are forbidden", () => {
  assert.match(authority, /Partial allocation \| `NO`/);
  assert.match(authority, /Residual balance \| `NO`/);
  assert.match(eventMatrix, /Partial redemption \| \*\*Not a valid Gift Voucher event/);
  assert.doesNotMatch(eventMatrix, /Same as redemption for applied amount/);
});

test("GV-CONTRACT-03: one-time redemption forbids multi-transaction consumption", () => {
  assert.match(authority, /Redemption cardinality \| `ONE_TIME`/);
  assert.match(authority, /Multi-transaction consumption \| `NO`/);
  assert.match(rules, /One successful eligible redemption consumes the voucher once/);
});

test("GV-CONTRACT-04: code safety now has a dedicated, empty-legacy-data migration boundary", () => {
  assert.match(authority, /Code identity \| Globally unique, immutable, never reused/);
  const migration = read("backend/migrations/20260827010000-gift-voucher-purchased-foundation.js");
  assert.match(migration, /GIFT_VOUCHER_LEGACY_DATA_MIGRATION_REQUIRED/);
  assert.match(migration, /gift_vouchers_voucher_code_uq/);
  assert.match(migration, /gift_vouchers_voucher_number_uq/);
  assert.match(migration, /gift_vouchers_identity_immutable_trg/);
  assert.match(matrix, /GV-CONTRACT-04/);
});

test("GV-CONTRACT-05: lifecycle boundaries, optional customer, and fixed value are explicit", () => {
  assert.match(authority, /Issuance vs activation \| Separate lifecycle events/);
  assert.match(authority, /Customer at issuance \| Optional/);
  assert.match(authority, /Face value \| Fixed at issuance/);
});

test("GV-CONTRACT-06: currency and branch are server/company authorities", () => {
  assert.match(authority, /Currency \| Server\/company authority/);
  assert.match(authority, /Branch eligibility \| Canonical server-side branch policy/);
  assert.match(finance, /Server-authoritative context/);
});

test("GV-CONTRACT-07: central allocation, atomicity, concurrency, and idempotency boundaries are frozen", () => {
  assert.match(authority, /Central Payment Engine with a strict Gift Voucher adapter/);
  assert.match(authority, /Serialized\/guarded one-time consumption/);
  assert.match(authority, /Existing canonical idempotency authority/);
  assert.match(finance, /No voucher\/journal\/payment mutation on failure/);
});

test("GV-CONTRACT-08: purchased issue has liability boundary without revenue or output VAT", () => {
  assert.match(finance, /REAL_MONEY_PURCHASED_VOUCHER_ISSUE = DR_RESOLVED_TREASURY \+ CR_RESOLVED_GIFT_VOUCHER_LIABILITY/);
  assert.match(finance, /No Sales Revenue at issue/);
  assert.match(finance, /No Output VAT at issue/);
  assert.match(policy, /PURCHASED_VOUCHER_ISSUE_OUTPUT_VAT = NO/);
});

test("GV-CONTRACT-09: actual Sales Invoice and Tax Engine own redemption revenue and VAT", () => {
  assert.match(finance, /Taxable base and Output VAT \| Tax Engine through the actual invoice/);
  assert.match(finance, /Voucher service does not calculate a second VAT/);
  assert.match(policy, /Payment Engine allocates the voucher amount against that invoice/);
});

test("GV-CONTRACT-10: non-purchased classes fail closed pending separate policy", () => {
  assert.match(rules, /Promotional\/loyalty\/compensation\/corporate\/manual/);
  assert.match(rules, /Fail closed/);
  assert.match(policy, /no approved cash, liability, VAT, revenue/);
});

test("GV-CONTRACT-11: unresolved lifecycle financial actions fail closed", () => {
  assert.match(rules, /Expiry policy must be explicit/);
  assert.match(rules, /Cancellation policy must be explicit/);
  assert.match(rules, /No automatic breakage revenue/);
  assert.match(finance, /Expiry, cancellation, breakage, refund, and write-off require separate approved\s+policies/);
});

test("GV-CONTRACT-12: print/reprint identity and read-only projection boundaries are explicit", () => {
  assert.match(authority, /Print\/reprint \| Same voucher identity/);
  assert.match(authority, /Projection \| Read-only adapter\/projection only/);
  assert.match(projection, /gift_voucher:[\s\S]*?status: "SUPPORTED_NOW"[\s\S]*?adapter: "gift_voucher"[\s\S]*?canPrint: true/);
});

test("GV-CONTRACT-13: security, scope, and command idempotency remain fail-closed", () => {
  assert.match(authority, /Existing User\/Auth\/RBAC, company, branch, and audit controls/);
  const giftRoutes = route.slice(route.indexOf('router.get("/gift-vouchers"'), route.indexOf('// ─────────────────────────────────────────────────────────────────────────────\n// TREASURY', route.indexOf('router.get("/gift-vouchers"')));
  assert.match(giftRoutes, /requireBusinessPermission\("sales\.create"/);
  assert.match(giftRoutes, /requireBusinessPermission\("treasury\.update"/);
  assert.match(route, /Idempotency-Key is required/);
  assert.match(giftRoutes, /resolveAuthorizedBranch/);
  assert.doesNotMatch(giftRoutes, /models\.GiftVoucher\.(create|update|destroy|bulkCreate)/);
});

test("GV-CONTRACT-14: issue is a guarded command and direct redemption stays disabled", () => {
  const issueStart = route.indexOf('router.post("/gift-vouchers/issue"');
  const redeemStart = route.indexOf('router.post("/gift-vouchers/redeem"');
  const treasuryStart = route.indexOf('// ─────────────────────────────────────────────────────────────────────────────\n// TREASURY', redeemStart);
  const issue = route.slice(issueStart, redeemStart);
  const redeem = route.slice(redeemStart, treasuryStart);
  assert.match(issue, /runGiftVoucherIdempotentCommand/);
  assert.match(issue, /giftVoucherService\.issuePurchasedVoucher/);
  assert.doesNotMatch(issue, /models\.GiftVoucher\.(create|update|destroy|bulkCreate)/);
  assert.match(redeem, /stableForbidden/);
  assert.match(redeem, /GIFT_VOUCHER_DIRECT_REDEEM_DISABLED_USE_POS/);
});

test("GV-CONTRACT-15: legacy direct account helpers are retained but not reachable authority", () => {
  assert.match(posting, /postVoucherIssueEntry/);
  assert.match(posting, /postVoucherRedeemEntry/);
  assert.match(posting, /accountCode: "2400"/);
  assert.match(posting, /accountCode: "4100"/);
  const routeGiftSection = route.slice(route.indexOf('router.get("/gift-vouchers"'), route.indexOf('// ─────────────────────────────────────────────────────────────────────────────\n// TREASURY', route.indexOf('router.get("/gift-vouchers"')));
  assert.doesNotMatch(routeGiftSection, /postVoucher(Issue|Redeem)Entry/);
  assert.match(drift, /INACTIVE_DANGEROUS_HELPER/);
});

test("GV-CONTRACT-16: generic partial payment behavior remains outside this contract", () => {
  assert.match(authority, /Generic Payment Engine partial-payment capability for non-Gift-Voucher methods/);
  assert.match(drift, /Generic partial payment behavior remains valid outside Gift Voucher/);
  assert.match(genericNonVoucher, /remaining|refundable|allocation/i);
});

test("contract matrix covers all sixteen required contract cases", () => {
  for (let i = 1; i <= 16; i += 1) {
    assert.match(matrix, new RegExp(`GV-CONTRACT-${String(i).padStart(2, "0")}`));
  }
});
