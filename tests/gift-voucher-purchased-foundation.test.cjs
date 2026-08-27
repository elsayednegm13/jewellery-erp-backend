const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const voucherService = require("../src/services/gift-voucher.service");
const postingService = require("../src/services/posting.service");

const service = read("backend/src/services/gift-voucher.service.js");
const route = read("backend/src/routes/erp.routes.js");
const posting = read("backend/src/services/posting.service.js");
const migration = read("backend/migrations/20260827010000-gift-voucher-purchased-foundation.js");
const pos = read("app/[locale]/(dashboard)/pos/page.tsx");

test("GV-FOUNDATION-01: code normalization and four-decimal equality are deterministic", () => {
  assert.equal(voucherService.normalizeVoucherCode(" gv-ab12-9 "), "GV-AB12-9");
  assert.equal(voucherService.moneyEqual("100.0000", 100), true);
  assert.equal(voucherService.moneyEqual("100.0001", 100), false);
  assert.throws(() => voucherService.normalizeVoucherCode("gv invalid"));
});

test("GV-FOUNDATION-02: the migration is fail-closed for non-empty legacy rows and protects identity", () => {
  assert.match(migration, /GIFT_VOUCHER_LEGACY_DATA_MIGRATION_REQUIRED/);
  assert.match(migration, /gift_vouchers_voucher_code_uq/);
  assert.match(migration, /gift_vouchers_voucher_number_uq/);
  assert.match(migration, /gift_vouchers_identity_immutable_trg/);
  assert.match(migration, /gift_vouchers_delete_forbidden_trg/);
  assert.match(migration, /GIFT_VOUCHER_DOWN_REQUIRES_EMPTY_DISPOSABLE_SCHEMA/);
});

test("GV-FOUNDATION-03: only purchased issuance is schema-authorized", () => {
  assert.match(migration, /voucher_type IN \('PURCHASED_GIFT_VOUCHER'\)/);
  assert.match(service, /PURCHASED_FUNDING_SOURCE/);
  assert.match(service, /GIFT_VOUCHER_FUNDING_SOURCE_NOT_ENABLED/);
  assert.match(service, /GIFT_VOUCHER_CURRENCY_NOT_CONFIGURED/);
});

test("GV-FOUNDATION-04: issuance uses semantic accounts and an exact four-decimal liability journal", () => {
  assert.match(service, /resolveRequiredBranchFinancialAccount/);
  assert.match(service, /resolveRequiredSemanticAccount/);
  assert.match(service, /GIFT_VOUCHER_LIABILITY/);
  assert.match(service, /precision: MONEY_DECIMALS/);
  assert.match(service, /sourceType: "gift_voucher_issue"/);
  assert.doesNotMatch(service, /accountCode:\s*"2400"/);
  assert.doesNotMatch(service, /accountCode:\s*"4100"/);
});

test("GV-FOUNDATION-05: strict full-value redemption is locked before canonical sale writes", () => {
  const prepareAt = route.indexOf("giftVoucherService.prepareGiftVoucherSettlement");
  const invoiceCreateAt = route.indexOf("models.Invoice.create");
  assert.ok(prepareAt >= 0 && invoiceCreateAt >= 0 && prepareAt < invoiceCreateAt);
  assert.match(service, /GIFT_VOUCHER_FULL_VALUE_REQUIRED/);
  assert.match(service, /GIFT_VOUCHER_VALUE_EXCEEDS_INVOICE_TOTAL/);
  assert.match(service, /GIFT_VOUCHER_SPLIT_TOTAL_MISMATCH/);
  assert.match(service, /lock: transaction\.LOCK\.UPDATE/);
  assert.match(service, /GIFT_VOUCHER_PAYMENT_LINKAGE_INVALID/);
});

test("GV-FOUNDATION-06: payment and invoice posting use the liability adapter, not a cash receipt", () => {
  assert.match(route, /giftVoucherId: split\.giftVoucherId/);
  assert.match(route, /if \(String\(pay\.paymentMethod\)\.toLowerCase\(\) === giftVoucherService\.GIFT_VOUCHER_PAYMENT_METHOD\) continue/);
  assert.match(posting, /Gift Voucher settlement must supply an exact semantic liability account/);
  assert.match(posting, /تسوية التزام قسيمة هدية/);
  assert.match(route, /giftVoucherService\.completeGiftVoucherSettlement/);
});

test("GV-FOUNDATION-07: direct redemption remains forbidden and the POS UI only sends a verified full-value split leg", () => {
  assert.match(route, /GIFT_VOUCHER_DIRECT_REDEEM_DISABLED_USE_POS/);
  assert.match(pos, /verifyGiftVoucher/);
  assert.match(pos, /splitGiftVoucher\?\.faceValue/);
  assert.match(pos, /method: "gift_voucher"/);
  assert.match(pos, /Verify the Gift Voucher before completing the sale/);
});

test("GV-FOUNDATION-08: lifecycle, branch eligibility, idempotency, and print/reprint events are explicit", () => {
  assert.match(service, /Only an issued Gift Voucher can be activated/);
  assert.match(service, /GIFT_VOUCHER_BRANCH_INELIGIBLE/);
  assert.match(route, /scope: "gift_voucher\.issue"/);
  assert.match(route, /scope: "gift_voucher\.activate"/);
  assert.match(route, /scope: "gift_voucher\.print"/);
  assert.match(service, /printKind: priorCount === 0 \? "original" : "reprint"/);
});

test("GV-FOUNDATION-09: POS preview and checkout select profile pricing through the same canonical registry", () => {
  const previewStart = route.indexOf('router.post("/pricing/calculate"');
  const preview = route.slice(previewStart, route.indexOf('// Create a sales invoice', previewStart));
  assert.match(preview, /goldSalePricingService\.isSalePricingProfile\(profile\)/);
});

test("GV-FOUNDATION-10: a sub-cent Invoice posts through the exact four-decimal journal path", async () => {
  const originalPostEntry = postingService.postEntry;
  const originalResolveAccountingByKarat = postingService.resolveAccountingByKarat;
  let captured = null;
  postingService.postEntry = async (_companyId, options, lines) => {
    captured = { options, lines };
    return captured;
  };
  postingService.resolveAccountingByKarat = async () => false;
  try {
    await postingService.postInvoiceEntry({
      id: "GV-EXACT-INVOICE",
      companyId: "GV-COMPANY",
      customerName: "Synthetic",
      total: "3039.4744",
      tax: "373.2688",
      subtotal: "2666.2056",
      paymentMethod: "split",
      paymentSplits: [{ method: "gift_voucher", giftVoucherId: "GV-1", amount: "3039.4744" }],
      branchId: "GV-BRANCH",
      date: "2026-08-27",
    }, [{ cost: "1871.1234", quantity: 1 }], "Synthetic", {
      giftVoucherSettlements: [{ voucherId: "GV-1", amount: "3039.4744", liabilityAccountId: "GV-LIABILITY" }],
    });
    assert.equal(captured.options.precision, 4);
    const debit = captured.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = captured.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    assert.equal(debit.toFixed(4), credit.toFixed(4));
  } finally {
    postingService.postEntry = originalPostEntry;
    postingService.resolveAccountingByKarat = originalResolveAccountingByKarat;
  }
});

test("GV-FOUNDATION-11: print/reprint serializes on the Voucher identity, not an invalid aggregate row lock", () => {
  assert.match(service, /lock: transaction\.LOCK\.UPDATE/);
  assert.match(service, /GiftVoucherPrintEvent\.count\(\{ where: \{ voucherId: voucher\.id \}, transaction \}\)/);
  assert.doesNotMatch(service, /GiftVoucherPrintEvent\.count\([^\n]*lock: transaction\.LOCK\.UPDATE/);
});
