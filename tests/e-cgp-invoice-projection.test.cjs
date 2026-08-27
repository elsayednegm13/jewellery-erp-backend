const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  ACTIVE_PROJECTION_SOURCE_TYPES,
  SOURCE_REGISTRY,
  buildCgpProjection,
} = require("../src/services/invoice-projection.service");

function cgpFixture() {
  const documentId = "CGPD-E-001";
  const itemId = `${documentId}:L1`;
  return {
    document: {
      id: documentId,
      companyId: "CMP-E",
      branchId: "BR-E",
      draftNumber: "CGPD-E-000001",
      customerId: "CUS-E",
      transactionDate: "2026-08-26",
      currency: "AED",
      status: "approved",
      businessStatus: "POSTED",
      totalGoldValue: "1250.5000",
      totalPayableToCustomer: "1250.5000",
      postingReference: `CGP-POSTED:${documentId}`,
      customer: { id: "CUS-E", name: "Synthetic Customer" },
      items: [{
        id: itemId,
        goldType: "gold",
        karat: 24,
        fineness: "0.999000",
        purityFactor: "1.000000",
        grossWeight: "2.500000",
        stoneWeight: "0.000000",
        netWeight: "2.500000",
        pureGoldWeight: "2.500000",
        proposedRate: "500.2000",
        referenceMarketRate: "500.2000",
      }],
    },
    snapshots: [{
      cgpDocumentId: documentId,
      cgpItemId: itemId,
      priceSource: "STORED_CGP_SNAPSHOT",
      priceVersion: "v1",
      priceTimestamp: "2026-08-26T10:00:00.000Z",
      approvedKaratRate: "500.2000",
      finalEffectiveRate: "500.2000",
      lineGoldValue: "1250.5000",
      rateBasis: "KARAT_SPECIFIC",
      pricingMode: "STORED_SNAPSHOT",
    }],
    assetLinks: [{ cgpItemId: itemId, assetId: "CGPA-E-1", barcode: "GWANK24000009", status: "available", operationalStatus: "AVAILABLE", branchId: "BR-E" }],
    liability: { originalAmount: "1250.5000", settledAmount: "0.0000", outstandingAmount: "1250.5000", journalEntryId: "JE-E-1" },
    journals: [{ id: "JE-E-1", companyId: "CMP-E", branchId: "BR-E", sourceType: "CUSTOMER_GOLD_PURCHASE_ACCOUNTING_RECOGNITION", sourceId: `CGP-POSTED:${documentId}`, status: "posted", totalDebit: "1250.5000", totalCredit: "1250.5000" }],
    journalLines: [],
  };
}

test("E activates exactly CGP while preserving future adapter boundaries", () => {
  assert.ok(ACTIVE_PROJECTION_SOURCE_TYPES.includes("customer_gold_purchase"));
  assert.equal(SOURCE_REGISTRY.customer_gold_purchase.status, "SUPPORTED_NOW");
  assert.equal(SOURCE_REGISTRY.customer_gold_purchase.adapter, "customer_gold_purchase");
  assert.equal(SOURCE_REGISTRY.gift_voucher.status, "SUPPORTED_LATER");
  assert.equal(SOURCE_REGISTRY.gift_voucher.adapter, null);
  assert.equal(SOURCE_REGISTRY.purchase_order.status, "NOT_AN_INVOICE");
  assert.equal(SOURCE_REGISTRY.repair.adapter, null);
});

test("E projection is a stable read-only adapter over stored CGP evidence", () => {
  const first = buildCgpProjection(cgpFixture());
  const second = buildCgpProjection(cgpFixture());
  assert.deepEqual(second, first);
  assert.equal(first.summary.projectionReference, "invoice:customer_gold_purchase:CGPD-E-001");
  assert.equal(first.summary.sourceId, "CGPD-E-001");
  assert.equal(first.summary.displayNumber, "CGPD-E-000001");
  assert.equal(first.summary.partyType, "CUSTOMER");
  assert.equal(first.summary.partyId, "CUS-E");
  assert.equal(first.lines[0].goldPurchase.rate.source, "STORED_CGP_SNAPSHOT");
  assert.equal(first.lines[0].goldPurchase.lineValue, "1250.5000");
  assert.equal(first.lines[0].assetReference, "CGPA-E-1");
  assert.equal(first.sourceLinks.accounting[0].sourceType, "CUSTOMER_GOLD_PURCHASE_ACCOUNTING_RECOGNITION");
  assert.equal(first.sourceLinks.accounting[0].totalDebit, "1250.5000");
  assert.equal(first.sourceLinks.accounting[0].totalCredit, "1250.5000");
  assert.equal(first.taxSummary.tax, null);
  assert.equal(first.taxSummary.vatRate, null);
  assert.equal(first.taxSummary.snapshotStatus, "NOT_APPLICABLE_SOURCE");
  assert.equal(first.audit.taxSnapshotStatus, "NOT_APPLICABLE_SOURCE");
  assert.equal(first.audit.readOnly, true);
});

test("E route exposes GET-only adapter and no CGP mutation boundary", () => {
  const route = fs.readFileSync(require.resolve("../src/routes/invoice-projection.routes.js"), "utf8");
  assert.match(route, /router\.get\("\/sources"/);
  assert.match(route, /router\.get\("\/summaries"/);
  assert.match(route, /router\.get\("\/:sourceType\/\:sourceId"/);
  assert.doesNotMatch(route, /router\.(put|patch|delete)\s*\(/i);
  assert.match(route, /router\.post\(\s*"\/:sourceType\/:sourceId\/print-events"/s);
  assert.match(route, /requireBusinessPermission\("sales\.view"\)/);
  assert.match(route, /ACTIVE_PROJECTION_SOURCE_TYPES/);
  assert.doesNotMatch(route, /CustomerGoldPurchaseDocument\.create|\.update\(|\.destroy\(/);
});
