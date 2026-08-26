const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  ACTIVE_INVOICE_TYPES,
  PROJECTION_ERROR_CODES,
  SOURCE_REGISTRY,
  assertActiveSourceType,
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

test("registry has exactly the five current Invoice adapters and explicit future boundaries", () => {
  assert.deepEqual(ACTIVE_INVOICE_TYPES, ["sale", "return", "exchange", "installment", "deposit"]);
  for (const sourceType of ACTIVE_INVOICE_TYPES) {
    assert.equal(SOURCE_REGISTRY[sourceType].status, "SUPPORTED_NOW");
    assert.equal(SOURCE_REGISTRY[sourceType].adapter, "invoice");
    assert.equal(getSourceEntry(sourceType).sourceTable, "invoices");
  }
  assert.equal(SOURCE_REGISTRY.customer_gold_purchase.status, "SUPPORTED_LATER");
  assert.equal(SOURCE_REGISTRY.customer_gold_purchase.extensionPoint, "CGP_ADAPTER");
  assert.equal(SOURCE_REGISTRY.purchase_order.status, "NOT_AN_INVOICE");
});

test("unsupported source types fail closed with a stable error code", () => {
  assert.throws(() => assertActiveSourceType("customer_gold_purchase"), (error) => {
    assert.equal(error.errorCode, PROJECTION_ERROR_CODES.UNSUPPORTED_SOURCE_TYPE);
    assert.equal(error.statusCode, 422);
    return true;
  });
  assert.throws(() => assertActiveSourceType("unknown"), (error) => {
    assert.equal(error.errorCode, PROJECTION_ERROR_CODES.UNSUPPORTED_SOURCE_TYPE);
    return true;
  });
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

test("D1 route is GET-only and is mounted as a separate read-only surface", () => {
  const route = fs.readFileSync(require.resolve("../src/routes/invoice-projection.routes.js"), "utf8");
  const index = fs.readFileSync(require.resolve("../src/routes/index.js"), "utf8");
  assert.match(route, /router\.get\("\/sources"/);
  assert.match(route, /router\.get\("\/summaries"/);
  assert.match(route, /router\.get\("\/:sourceType\/:sourceId"/);
  assert.doesNotMatch(route, /router\.(post|put|patch|delete)\s*\(/i);
  assert.match(route, /requireBusinessPermission\("sales\.view"\)/);
  assert.match(index, /router\.use\("\/invoice-projection", invoiceProjectionRoutes\)/);
});

