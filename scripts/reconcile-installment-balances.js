#!/usr/bin/env node
/**
 * Phase 24.1-Fix — dry-run-only historical installment mirror drift report.
 *
 * This script is intentionally read-only. It reports likely drift between linked
 * Payment rows and the operational AR mirrors on Invoice/Customer records.
 */

const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});
const { Op } = require("sequelize");

const {
  sequelize,
  Invoice,
  Payment,
  Installment,
  Customer,
} = require("../src/models");

const TOLERANCE = 0.0001;
const FORBIDDEN_FLAGS = new Set(["--apply", "--write", "--fix", "--update", "--confirm"]);
const SUPPORTED_FLAGS = new Set(["--company-id", "--invoice-id", "--customer-id", "--limit", "--json"]);
const INVOICE_ATTRIBUTES = [
  "id",
  "companyId",
  "customerId",
  "customerName",
  "type",
  "status",
  "paymentMethod",
  "notes",
  "total",
  "paidAmount",
  "remainingAmount",
  "relatedInvoiceId",
  "createdAt",
];
const RELATED_INVOICE_ATTRIBUTES = [
  "id",
  "companyId",
  "customerId",
  "type",
  "status",
  "total",
  "relatedInvoiceId",
];
const PAYMENT_ATTRIBUTES = ["id", "companyId", "invoiceId", "amount", "paymentMethod", "date", "createdAt"];
const INSTALLMENT_ATTRIBUTES = [
  "id",
  "companyId",
  "invoiceId",
  "customerId",
  "paidAmount",
  "amount",
  "status",
  "createdAt",
];
const CUSTOMER_ATTRIBUTES = ["id", "companyId", "name", "balance"];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 10000) / 10000;
}

function isDrift(delta) {
  return Math.abs(roundMoney(delta)) > TOLERANCE;
}

function parsePositiveLimit(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return n;
}

function parseArgs(argv) {
  const filters = {
    companyId: undefined,
    invoiceId: undefined,
    customerId: undefined,
    limit: undefined,
  };
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) {
      throw new Error("This script is dry-run only and never writes data.");
    }
    if (!SUPPORTED_FLAGS.has(arg)) {
      throw new Error(`Unsupported flag: ${arg}`);
    }
    if (arg === "--json") {
      json = true;
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    i += 1;

    if (arg === "--company-id") filters.companyId = value;
    if (arg === "--invoice-id") filters.invoiceId = value;
    if (arg === "--customer-id") filters.customerId = value;
    if (arg === "--limit") filters.limit = parsePositiveLimit(value);
  }

  return { filters, json };
}

function displayFilters(filters) {
  return {
    companyId: filters.companyId || null,
    invoiceId: filters.invoiceId || null,
    customerId: filters.customerId || null,
    limit: filters.limit || null,
  };
}

function skip(skipped, reason, invoice, extra = {}) {
  skipped.push({
    invoiceId: invoice?.id || extra.invoiceId || null,
    invoiceNumber: invoice?.invoiceNumber || null,
    customerId: invoice?.customerId || extra.customerId || null,
    customerName: invoice?.customerName || null,
    skipReason: reason,
    ...extra,
  });
}

function countReasons(skipped) {
  return skipped.reduce((acc, row) => {
    acc[row.skipReason] = (acc[row.skipReason] || 0) + 1;
    return acc;
  }, {});
}

function looksLikeGoldFlow(invoice) {
  const haystack = [
    invoice.type,
    invoice.paymentMethod,
    invoice.notes,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes("gold");
}

async function findCandidateInvoices(filters) {
  const where = {
    type: "installment",
  };
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.invoiceId) where.id = filters.invoiceId;
  if (filters.customerId) where.customerId = filters.customerId;

  const options = {
    where,
    order: [["createdAt", "ASC"]],
  };
  if (filters.limit) options.limit = filters.limit;

  options.attributes = INVOICE_ATTRIBUTES;

  return Invoice.findAll(options);
}

async function hasRelatedReturnOrExchange(invoice) {
  const related = await Invoice.findAll({
    where: {
      companyId: invoice.companyId,
      relatedInvoiceId: invoice.id,
      type: { [Op.in]: ["return", "exchange"] },
      status: { [Op.ne]: "cancelled" },
    },
    attributes: RELATED_INVOICE_ATTRIBUTES,
    limit: 1,
  });
  return related.length > 0;
}

async function analyzeInvoice(invoice, skipped, customerDeltas) {
  if (!invoice.companyId) {
    skip(skipped, "missing_company", invoice);
    return null;
  }
  if (!invoice.customerId) {
    skip(skipped, "missing_customer_id", invoice);
    return null;
  }
  if (["cancelled", "canceled", "void", "returned"].includes(String(invoice.status || "").toLowerCase())) {
    skip(skipped, "cancelled_or_non_active", invoice);
    return null;
  }

  const total = roundMoney(invoice.total);
  if (total <= 0) {
    skip(skipped, "zero_or_negative_total", invoice, { storedTotal: total });
    return null;
  }
  if (looksLikeGoldFlow(invoice)) {
    skip(skipped, "possible_gold_flow", invoice);
    return null;
  }
  if (await hasRelatedReturnOrExchange(invoice)) {
    skip(skipped, "related_return_exchange", invoice);
    return null;
  }

  const [payments, installments, customer] = await Promise.all([
    Payment.findAll({
      where: {
        companyId: invoice.companyId,
        invoiceId: invoice.id,
      },
      attributes: PAYMENT_ATTRIBUTES,
    }),
    Installment.findAll({
      where: {
        companyId: invoice.companyId,
        invoiceId: invoice.id,
      },
      attributes: INSTALLMENT_ATTRIBUTES,
    }),
    Customer.findOne({
      where: {
        id: invoice.customerId,
        companyId: invoice.companyId,
      },
      attributes: CUSTOMER_ATTRIBUTES,
    }),
  ]);

  if (!customer) {
    skip(skipped, "missing_customer", invoice);
    return null;
  }
  if (payments.length === 0) {
    skip(skipped, "missing_payments", invoice, { customerName: customer.name });
    return null;
  }
  if (installments.length === 0) {
    skip(skipped, "missing_installments", invoice, { customerName: customer.name });
    return null;
  }

  const expectedPaidAmount = roundMoney(payments.reduce((sum, row) => sum + toNumber(row.amount), 0));
  if (expectedPaidAmount > total + TOLERANCE) {
    skip(skipped, "suspicious_overpayment", invoice, {
      customerName: customer.name,
      storedTotal: total,
      expectedPaidAmount,
    });
    return null;
  }

  const expectedRemainingAmount = roundMoney(Math.max(0, total - expectedPaidAmount));
  const storedPaidAmount = roundMoney(invoice.paidAmount);
  const storedRemainingAmount = roundMoney(invoice.remainingAmount);
  const paidAmountDelta = roundMoney(expectedPaidAmount - storedPaidAmount);
  const remainingAmountDelta = roundMoney(expectedRemainingAmount - storedRemainingAmount);

  const customerKey = `${invoice.companyId}:${customer.id}`;
  const currentCustomerDelta = customerDeltas.get(customerKey) || {
    companyId: invoice.companyId,
    customerId: customer.id,
    customerName: customer.name,
    storedCustomerBalance: roundMoney(customer.balance),
    customerBalanceDelta: 0,
    expectedCustomerBalance: roundMoney(customer.balance),
    invoiceCount: 0,
  };
  currentCustomerDelta.customerBalanceDelta = roundMoney(currentCustomerDelta.customerBalanceDelta + remainingAmountDelta);
  currentCustomerDelta.expectedCustomerBalance = roundMoney(
    Math.max(0, currentCustomerDelta.storedCustomerBalance + currentCustomerDelta.customerBalanceDelta),
  );
  currentCustomerDelta.invoiceCount += 1;
  customerDeltas.set(customerKey, currentCustomerDelta);

  const row = {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber || null,
    companyId: invoice.companyId,
    customerId: customer.id,
    customerName: customer.name,
    storedTotal: total,
    paymentCount: payments.length,
    installmentCount: installments.length,
    storedPaidAmount,
    expectedPaidAmount,
    paidAmountDelta,
    storedRemainingAmount,
    expectedRemainingAmount,
    remainingAmountDelta,
    storedCustomerBalance: roundMoney(customer.balance),
    expectedCustomerBalance: currentCustomerDelta.expectedCustomerBalance,
  };

  return {
    analyzed: row,
    drifted: isDrift(paidAmountDelta) || isDrift(remainingAmountDelta) ? row : null,
  };
}

function buildReport({ filters, analyzedRows, driftedInvoices, skipped, customerDeltas }) {
  const totalPaidAmountDelta = roundMoney(
    driftedInvoices.reduce((sum, row) => sum + row.paidAmountDelta, 0),
  );
  const totalRemainingAmountDelta = roundMoney(
    driftedInvoices.reduce((sum, row) => sum + row.remainingAmountDelta, 0),
  );
  const customerDeltaRows = Array.from(customerDeltas.values())
    .filter((row) => isDrift(row.customerBalanceDelta))
    .sort((a, b) => Math.abs(b.customerBalanceDelta) - Math.abs(a.customerBalanceDelta));
  const totalCustomerBalanceDelta = roundMoney(
    customerDeltaRows.reduce((sum, row) => sum + row.customerBalanceDelta, 0),
  );

  const warnings = [
    "Dry-run only: no data was changed.",
    "Invoices with related posted returns/exchanges are skipped for manual review.",
    "Customer.balance deltas are projected only from safe analyzed invoice mirror deltas.",
    "Review real output before designing any guarded apply-mode backfill.",
  ];

  return {
    summary: {
      mode: "dry-run",
      candidateCount: analyzedRows.length,
      driftedInvoiceCount: driftedInvoices.length,
      skippedRiskyCount: skipped.length,
      skippedReasonCounts: countReasons(skipped),
      totalPaidAmountDelta,
      totalRemainingAmountDelta,
      totalCustomerBalanceDelta,
    },
    filters: displayFilters(filters),
    driftedInvoices,
    skipped,
    customerDeltas: customerDeltaRows,
    warnings,
  };
}

function printTextReport(report) {
  console.log("Installment balance reconciliation report");
  console.log("mode: dry-run");
  console.log("filters used:", JSON.stringify(report.filters));
  console.log("candidate count:", report.summary.candidateCount);
  console.log("drifted invoice count:", report.summary.driftedInvoiceCount);
  console.log("skipped risky count:", report.summary.skippedRiskyCount);
  console.log("skipped reason counts:", JSON.stringify(report.summary.skippedReasonCounts));
  console.log("total paidAmount delta:", report.summary.totalPaidAmountDelta);
  console.log("total remainingAmount delta:", report.summary.totalRemainingAmountDelta);
  console.log("total customer balance delta:", report.summary.totalCustomerBalanceDelta);
  console.log("");
  console.log("sample drift rows:");
  const samples = report.driftedInvoices.slice(0, 10);
  if (samples.length === 0) {
    console.log("  none");
  } else {
    for (const row of samples) {
      console.log(JSON.stringify(row));
    }
  }
  console.log("");
  console.log("manual review warnings:");
  for (const warning of report.warnings) {
    console.log(`- ${warning}`);
  }
}

async function main() {
  const { filters, json } = parseArgs(process.argv.slice(2));
  const invoices = await findCandidateInvoices(filters);
  const analyzedRows = [];
  const driftedInvoices = [];
  const skipped = [];
  const customerDeltas = new Map();

  for (const invoice of invoices) {
    const result = await analyzeInvoice(invoice, skipped, customerDeltas);
    if (!result) continue;
    analyzedRows.push(result.analyzed);
    if (result.drifted) driftedInvoices.push(result.drifted);
  }

  const report = buildReport({
    filters,
    analyzedRows,
    driftedInvoices,
    skipped,
    customerDeltas,
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });
