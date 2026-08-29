const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SOURCE_REGISTRY,
  buildGiftVoucherProjection,
  giftVoucherDisplayStatus,
  giftVoucherIsInBranchScope,
} = require("../src/services/invoice-projection.service");

function voucherFixture(overrides = {}) {
  return {
    id: "GV-D2F-001",
    companyId: "CMP-D2F",
    voucherNumber: "GVN-D2F-000001",
    voucherCode: "GV-D2F-ABC123",
    issueBranchId: "BR-D2F-1",
    voucherType: "PURCHASED_GIFT_VOUCHER",
    fundingSource: "PURCHASED",
    faceValue: "3235.5300",
    currency: "AED",
    branchEligibilityMode: "SELECTED_BRANCHES",
    customerId: "CUS-D2F-1",
    status: "active",
    issuedAt: "2026-08-29T08:00:00.000Z",
    issuedByUserId: "USR-D2F-1",
    issuedByEmployeeId: "EMP-D2F-1",
    customer: { id: "CUS-D2F-1", name: "Synthetic Customer" },
    issueBranch: { id: "BR-D2F-1", name: "Branch 1" },
    branchEligibilities: [{ branchId: "BR-D2F-2" }],
    printEvents: [{ id: "GVPRINT-1", printKind: "original", printedAt: "2026-08-29T08:05:00.000Z", branchId: "BR-D2F-1" }],
    ...overrides,
  };
}

test("D2F activates a dedicated read-only Gift Voucher adapter", () => {
  assert.equal(SOURCE_REGISTRY.gift_voucher.status, "SUPPORTED_NOW");
  assert.equal(SOURCE_REGISTRY.gift_voucher.adapter, "gift_voucher");
  assert.equal(SOURCE_REGISTRY.gift_voucher.canViewDetail, true);
  assert.equal(SOURCE_REGISTRY.gift_voucher.canPrint, true);
});

test("Gift Voucher projection maps canonical identity and stored financial evidence without recalculation", () => {
  const first = buildGiftVoucherProjection({
    voucher: voucherFixture(),
    payments: [{ id: "PAY-D2F-1", invoiceId: "INV-1", giftVoucherId: "GV-D2F-001", paymentMethod: "gift_voucher", amount: "3235.5300", date: "2026-08-29" }],
    cashTransactions: [{ id: "TX-D2F-1", type: "cash_in", amount: "3235.5300", reference: "GV-D2F-001", journalEntryId: "JE-D2F-1", status: "posted", date: "2026-08-29" }],
    journals: [{ id: "JE-D2F-1", companyId: "CMP-D2F", branchId: "BR-D2F-1", sourceType: "gift_voucher_issue", sourceId: "GV-D2F-001", status: "posted", totalDebit: "3235.5300", totalCredit: "3235.5300" }],
    journalLines: [{ id: "JL-D2F-1", journalEntryId: "JE-D2F-1", accountCode: "SYS-CASH", debit: "3235.5300", credit: "0.0000" }],
  });
  const second = buildGiftVoucherProjection({ voucher: voucherFixture() });
  assert.deepEqual(buildGiftVoucherProjection({ voucher: voucherFixture() }), second);
  assert.equal(first.summary.projectionReference, "invoice:gift_voucher:GV-D2F-001");
  assert.equal(first.summary.displayNumber, "GVN-D2F-000001");
  assert.equal(first.summary.voucherCode, "GV-D2F-ABC123");
  assert.equal(first.summary.grandTotal, "3235.5300");
  assert.equal(first.summary.taxTotal, null);
  assert.equal(first.summary.currency, "AED");
  assert.equal(first.voucher.status, "active");
  assert.equal(first.lines[0].lineTotal, "3235.5300");
  assert.equal(first.taxSummary.tax, null);
  assert.equal(first.taxSummary.vatRate, null);
  assert.equal(first.taxSummary.snapshotStatus, "NOT_APPLICABLE_SOURCE");
  assert.equal(first.paymentSummary.rows[0].giftVoucherId, "GV-D2F-001");
  assert.equal(first.sourceLinks.accounting[0].sourceId, "GV-D2F-001");
  assert.equal(first.sourceLinks.printEvents[0].printKind, "original");
  assert.equal(first.audit.readOnly, true);
});

test("Gift Voucher scope is company/branch fail-closed and status display preserves final state", () => {
  const voucher = voucherFixture();
  assert.equal(giftVoucherIsInBranchScope(voucher, "BR-D2F-1"), true);
  assert.equal(giftVoucherIsInBranchScope(voucher, "BR-D2F-2"), true);
  assert.equal(giftVoucherIsInBranchScope(voucher, "BR-D2F-3"), false);
  assert.equal(giftVoucherDisplayStatus({ status: "active" }), "posted");
  assert.equal(giftVoucherDisplayStatus({ status: "redeemed" }), "closed");
  assert.equal(giftVoucherDisplayStatus({ status: "cancelled" }), "cancelled");
});
