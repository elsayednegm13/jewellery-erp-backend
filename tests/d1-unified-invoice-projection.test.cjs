const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  ACTIVE_INVOICE_TYPES,
  ACTIVE_PROJECTION_SOURCE_TYPES,
  PROJECTION_ERROR_CODES,
  SOURCE_REGISTRY,
  assertActiveSourceType,
  buildCgpProjection,
  buildInvoiceProjection,
  getSourceEntry,
  mapInvoiceSummary,
} = require("../src/services/invoice-projection.service");

function sampleInvoice(overrides = {}) {
  return {
    id: "INV-D1-001",
    companyId: "CMP-1",
    branchId: "BR-1",
    type: "sale",
    invoiceNumber: "INV-2026-000001",
    date: "2026-08-23",
    customerId: "CUS-1",
    customerName: "Customer One",
    subtotal: "100.0000",
    discount: "2.0000",
    tax: "14.0000",
    vatRate: "14.000",
    total: "112.0000",
    status: "paid",
    postingStatus: "posted",
    createdByEmployeeId: "EMP-1",
    finalizedByEmployeeId: null,
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:01:00.000Z",
    relatedInvoiceId: null,
    items: [{
      id: 10,
      assetId: "AST-1",
      name: "Gold Ring",
      quantity: 1,
      price: "100.0000",
      discount: "2.0000",
      weight: "5.0000",
      karat: 21,
      makingCharge: "0.0000",
      stoneValue: "0.0000",
    }],
    payments: [{ id: "PAY-1", invoiceId: "INV-D1-001", paymentMethod: "cash", amount: "112.0000", date: "2026-08-23" }],
    installments: [],
    createdByEmployee: { id: "EMP-1", firstName: "A", lastName: "Operator" },
    finalizedByEmployee: null,
    ...overrides,
  };
}

test("registry has the five Invoice adapters plus the active read-only CGP adapter", () => {
  assert.deepEqual(ACTIVE_INVOICE_TYPES, ["sale", "return", "exchange", "installment", "deposit"]);
  assert.deepEqual(ACTIVE_PROJECTION_SOURCE_TYPES, [...ACTIVE_INVOICE_TYPES, "customer_gold_purchase"]);
  for (const sourceType of ACTIVE_INVOICE_TYPES) {
    assert.equal(SOURCE_REGISTRY[sourceType].status, "SUPPORTED_NOW");
    assert.equal(SOURCE_REGISTRY[sourceType].adapter, "invoice");
    assert.equal(getSourceEntry(sourceType).sourceTable, "invoices");
  }
  assert.equal(SOURCE_REGISTRY.customer_gold_purchase.status, "SUPPORTED_NOW");
  assert.equal(SOURCE_REGISTRY.customer_gold_purchase.adapter, "customer_gold_purchase");
  assert.equal(SOURCE_REGISTRY.customer_gold_purchase.sourceTable, "customer_gold_purchase_documents");
  assert.equal(SOURCE_REGISTRY.customer_gold_purchase.displayNumberField, "customer_gold_purchase_documents.draft_number");
  assert.equal(SOURCE_REGISTRY.purchase_order.status, "NOT_AN_INVOICE");
});

test("unsupported source types fail closed with a stable error code", () => {
  assert.throws(() => assertActiveSourceType("gift_voucher"), (error) => {
    assert.equal(error.errorCode, PROJECTION_ERROR_CODES.UNSUPPORTED_SOURCE_TYPE);
    assert.equal(error.statusCode, 422);
    return true;
  });
  assert.throws(() => assertActiveSourceType("unknown"), (error) => {
    assert.equal(error.errorCode, PROJECTION_ERROR_CODES.UNSUPPORTED_SOURCE_TYPE);
    return true;
  });
});

test("CGP adapter preserves source identity, stored gold evidence, payment source and no-tax semantics", () => {
  const documentId = "CGPD-D1-001";
  const itemId = `${documentId}:L1`;
  const data = buildCgpProjection({
    document: {
      id: documentId,
      companyId: "CMP-1",
      branchId: "BR-1",
      draftNumber: "CGPD-000001",
      customerId: "CUS-1",
      transactionDate: "2026-08-23",
      currency: "AED",
      businessStatus: "POSTED",
      status: "approved",
      totalGoldValue: "5432.8910",
      totalPayableToCustomer: "5432.8910",
      postingReference: `CGP-POSTED:${documentId}`,
      createdBy: "USR-1",
      postedBy: "USR-1",
      customer: { id: "CUS-1", name: "Customer One" },
      items: [{
        id: itemId,
        goldType: "gold",
        karat: 24,
        fineness: "0.999000",
        purityFactor: "1.000000",
        grossWeight: "10.000000",
        stoneWeight: "0.000000",
        netWeight: "10.000000",
        pureGoldWeight: "10.000000",
        proposedRate: "543.2891",
        referenceMarketRate: "543.2891",
      }],
    },
    snapshots: [{
      cgpDocumentId: documentId,
      cgpItemId: itemId,
      priceSource: "GOLD_MARKET_GOLDAPI_IO",
      priceVersion: "2026-08-23T15:48:58.000Z",
      priceTimestamp: "2026-08-23T15:48:58.000Z",
      approvedKaratRate: "543.2891",
      finalEffectiveRate: "543.2891",
      lineGoldValue: "5432.8910",
      rateBasis: "KARAT_SPECIFIC",
      pricingMode: "LIVE_PROVIDER",
      provider: "goldapi.io",
      marketQuoteId: "QUOTE-1",
    }],
    assetLinks: [{ cgpItemId: itemId, assetId: "CGPA-1", barcode: "GWANK24000001", status: "available", operationalStatus: "AVAILABLE", branchId: "BR-1" }],
    liability: {
      originalAmount: "5432.8910",
      settledAmount: "0.0000",
      outstandingAmount: "5432.8910",
      journalEntryId: "JE-1",
    },
    journals: [{ id: "JE-1", sourceType: "CUSTOMER_GOLD_PURCHASE_ACCOUNTING_RECOGNITION", sourceId: `CGP-POSTED:${documentId}`, status: "posted", totalDebit: "5432.8910", totalCredit: "5432.8910", branchId: "BR-1" }],
    journalLines: [{ id: "JL-1", journalEntryId: "JE-1", accountCode: "CUSTOMER_GOLD_LIABILITY", debit: "0.0000", credit: "5432.8910" }],
  });

  assert.equal(data.summary.projectionReference, `invoice:customer_gold_purchase:${documentId}`);
  assert.equal(data.summary.displayNumber, "CGPD-000001");
  assert.equal(data.summary.partyType, "CUSTOMER");
  assert.equal(data.summary.grandTotal, "5432.8910");
  assert.equal(data.lines[0].goldPurchase.netWeight, "10.000000");
  assert.equal(data.lines[0].goldPurchase.rate.value, "543.2891");
  assert.equal(data.lines[0].goldPurchase.lineValue, "5432.8910");
  assert.equal(data.lines[0].assetLinks[0].barcode, "GWANK24000001");
  assert.equal(data.taxSummary.tax, null);
  assert.equal(data.taxSummary.snapshotStatus, "NOT_APPLICABLE_SOURCE");
  assert.equal(data.paymentSummary.paymentStatus, "UNPAID");
  assert.equal(data.sourceLinks.accounting[0].sourceId, `CGP-POSTED:${documentId}`);
  assert.equal(data.audit.readOnly, true);
});

test("summary preserves source identity and source financial values without recalculation", () => {
  const invoice = sampleInvoice();
  const summary = mapInvoiceSummary(invoice);
  assert.equal(summary.sourceId, invoice.id);
  assert.equal(summary.displayNumber, invoice.invoiceNumber);
  assert.equal(summary.companyId, invoice.companyId);
  assert.equal(summary.branchId, invoice.branchId);
  assert.equal(summary.partyId, invoice.customerId);
  assert.equal(summary.subtotal, invoice.subtotal);
  assert.equal(summary.discountTotal, invoice.discount);
  assert.equal(summary.taxTotal, invoice.tax);
  assert.equal(summary.grandTotal, invoice.total);
  assert.equal(summary.paymentStatus, invoice.status);
  assert.equal(summary.businessStatus, invoice.postingStatus);
  assert.equal(summary.projectionReference, "invoice:sale:INV-D1-001");
});

test("detail preserves Asset identity, related source links, payment rows and tax evidence", () => {
  const invoice = sampleInvoice();
  const data = buildInvoiceProjection({
    invoice,
    assetLinks: [{
      invoiceItemId: 10,
      assetId: "AST-1",
      ordinal: 1,
      mappingClassification: "V2_RUNTIME_SALE",
      costSnapshotRevisionId: "COST-1",
      quoteSnapshot: { price: "100.0000" },
    }],
    journals: [{ id: "JE-1", sourceType: "invoice", sourceId: invoice.id, status: "posted", totalDebit: "112.0000", totalCredit: "112.0000" }],
    journalLines: [],
    cashTransactions: [{ id: "CT-1", type: "cash_in", amount: "112.0000", reference: invoice.id, status: "posted" }],
  });
  assert.equal(data.summary.sourceId, invoice.id);
  assert.equal(data.lines[0].assetReference, "AST-1");
  assert.equal(data.lines[0].assetLinks[0].assetId, "AST-1");
  assert.equal(data.sourceLinks.accounting[0].sourceId, invoice.id);
  assert.equal(data.paymentSummary.rows[0].amount, "112.0000");
  assert.equal(data.paymentSummary.cashTransactions[0].reference, invoice.id);
  assert.equal(data.taxSummary.tax, invoice.tax);
  assert.equal(data.taxSummary.vatRate, invoice.vatRate);
  assert.equal(data.taxSummary.grandTotal, invoice.total);
  assert.equal(data.taxSummary.taxableBase, null);
  assert.equal(data.taxSummary.snapshotStatus, "HISTORICAL_DATA_GAP");
});

test("repeated projection reads are semantically stable", () => {
  const invoice = sampleInvoice();
  const first = buildInvoiceProjection({ invoice });
  const second = buildInvoiceProjection({ invoice });
  assert.deepEqual(second, first);
});

test("projection route keeps reads GET-only and exposes only explicit print authorization", () => {
  const route = fs.readFileSync(require.resolve("../src/routes/invoice-projection.routes.js"), "utf8");
  const index = fs.readFileSync(require.resolve("../src/routes/index.js"), "utf8");
  assert.match(route, /router\.get\("\/sources"/);
  assert.match(route, /router\.get\("\/summaries"/);
  assert.match(route, /router\.get\("\/:sourceType\/:sourceId"/);
  assert.match(route, /router\.post\(\s*\n\s*"\/:sourceType\/:sourceId\/print-events"/);
  assert.doesNotMatch(route, /router\.(put|patch|delete)\s*\(/i);
  assert.match(route, /requireBusinessPermission\("sales\.view"\)/);
  assert.match(index, /router\.use\("\/invoice-projection", invoiceProjectionRoutes\)/);
});
