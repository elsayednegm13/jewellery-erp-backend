const exchangePolicyService = require("./exchange-policy.service");
const { roundMoney } = require("./sales.service");

const POLICY_VERSION = "exchange_tax_new_items_only_v1";
const TARGET_POLICY_STATUS = "target_policy";
const LEGACY_POLICY_STATUS = "legacy_or_unknown";

function positiveMoney(value) {
  return Math.max(0, roundMoney(Number(value) || 0));
}

function lineValue(item) {
  return roundMoney((Number(item.price) || 0) * (Number(item.quantity) || 1));
}

function splitExchangeItems(items = []) {
  const replacementSection = [];
  const returnedCreditSection = [];

  for (const item of items) {
    const value = lineValue(item);
    const isReturnedCredit = value < 0;
    const row = {
      invoiceItemId: item.id,
      assetId: item.assetId,
      name: item.name,
      quantity: Number(item.quantity) || 1,
      unitPrice: isReturnedCredit ? positiveMoney(Math.abs(Number(item.price) || 0)) : positiveMoney(item.price),
      amount: isReturnedCredit ? positiveMoney(Math.abs(value)) : positiveMoney(value),
    };
    if (isReturnedCredit) returnedCreditSection.push(row);
    else replacementSection.push(row);
  }

  return { replacementSection, returnedCreditSection };
}

function extractSavedExchangePolicy(idempotencyRequest, invoiceId) {
  if (!idempotencyRequest || idempotencyRequest.status !== "succeeded") return null;
  const body = idempotencyRequest.responseBody;
  const data = body && (body.data || body);
  if (!data || data.id !== invoiceId) return null;
  const policy = data && data.exchangePolicy;
  if (!policy || !policy.taxPolicy) return null;
  if (
    policy.taxPolicy.taxAppliesTo !== "new_items_only" ||
    policy.taxPolicy.returnedValueTaxable !== false ||
    policy.taxPolicy.excessTaxable !== false
  ) {
    return null;
  }
  return policy;
}

function buildSettlementSummary({ expectedExcess = 0, cashTransactions = [], creditTransactions = [], journalEntry = null }) {
  const cashAmount = roundMoney(cashTransactions
    .filter((row) => row.type === "cash_out" && row.account === "cash")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const bankAmount = roundMoney(cashTransactions
    .filter((row) => row.type === "cash_out" && row.account === "bank")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const creditAmount = roundMoney(creditTransactions
    .filter((row) => row.direction === "credit_in" && row.status === "active")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const allocated = roundMoney(cashAmount + bankAmount + creditAmount);
  const expected = positiveMoney(expectedExcess);
  const hasLinkedRecords = cashTransactions.length > 0 || creditTransactions.length > 0;
  const matchesExpected = Math.abs(allocated - expected) <= 0.01;

  let source = "unavailable";
  if (journalEntry && matchesExpected) source = "linked_records";
  else if (hasLinkedRecords) source = "best_effort";

  return {
    cashAmount,
    bankAmount,
    creditAmount,
    allocatedAmount: allocated,
    expectedAmount: expected,
    isComplete: source === "linked_records",
    source,
  };
}

function buildTargetPolicyDisplay({ invoice, savedPolicy, currency, settlementSummary }) {
  const figures = {
    returnedValue: positiveMoney(savedPolicy.returnedValue),
    newSubtotal: positiveMoney(savedPolicy.newSubtotal),
    newTax: positiveMoney(savedPolicy.newTax),
    newGross: positiveMoney(savedPolicy.newGross),
    difference: roundMoney(savedPolicy.difference),
    amountDueFromCustomer: positiveMoney(savedPolicy.amountDueFromCustomer),
    arRelief: positiveMoney(savedPolicy.arRelief),
    excessDueToCustomer: positiveMoney(savedPolicy.excessDueToCustomer),
  };
  const sections = splitExchangeItems(invoice.items);
  const policyModel = exchangePolicyService.buildCustomerFacingExchangePolicy({
    ...figures,
    currency,
    settlementPreview: settlementSummary.source === "unavailable" ? null : settlementSummary,
  });

  return {
    invoiceId: invoice.id,
    originalInvoiceId: invoice.relatedInvoiceId,
    customerId: invoice.customerId,
    currency,
    policyStatus: TARGET_POLICY_STATUS,
    policyVersion: POLICY_VERSION,
    readOnly: true,
    exchangePolicy: {
      vatAppliesTo: "new_items_only",
      returnedValueTaxable: false,
      excessTaxable: false,
      settlementAffectsVat: false,
    },
    figures,
    customerFacing: {
      ...policyModel,
      replacementSection: sections.replacementSection,
      returnedCreditSection: sections.returnedCreditSection,
      displayTotal: figures.amountDueFromCustomer > 0
        ? figures.amountDueFromCustomer
        : figures.excessDueToCustomer,
    },
    settlementSummary,
    legacyFallback: { isLegacyOrUnknown: false, message: null },
  };
}

function buildLegacyDisplay({ invoice, currency }) {
  const sections = splitExchangeItems(invoice.items);
  const storedSubtotal = roundMoney(invoice.subtotal);
  const storedTax = roundMoney(invoice.tax);
  const storedTotal = roundMoney(invoice.total);
  const returnedValue = roundMoney(sections.returnedCreditSection.reduce((sum, row) => sum + row.amount, 0));
  const replacementSubtotal = roundMoney(sections.replacementSection.reduce((sum, row) => sum + row.amount, 0));

  return {
    invoiceId: invoice.id,
    originalInvoiceId: invoice.relatedInvoiceId,
    customerId: invoice.customerId,
    currency,
    policyStatus: LEGACY_POLICY_STATUS,
    policyVersion: null,
    readOnly: true,
    exchangePolicy: {
      vatAppliesTo: "historical_stored_values",
      returnedValueTaxable: null,
      excessTaxable: null,
      settlementAffectsVat: null,
    },
    figures: {
      returnedValue,
      newSubtotal: replacementSubtotal,
      newTax: storedTax,
      newGross: null,
      difference: storedTotal,
      amountDueFromCustomer: storedTotal > 0 ? storedTotal : 0,
      arRelief: null,
      excessDueToCustomer: storedTotal < 0 ? Math.abs(storedTotal) : 0,
      storedSubtotal,
      storedTax,
      storedTotal,
    },
    customerFacing: {
      showNegativeLines: false,
      showNegativeTotal: false,
      replacementSection: sections.replacementSection,
      returnedCreditSection: sections.returnedCreditSection,
      balanceDueLabel: storedTotal < 0 ? "Historical balance due to customer" : "Historical exchange difference",
      policyNote: "Historical or unknown-policy exchange. Stored financial totals remain the source of truth; VAT has not been recalculated.",
      currency,
      displayTotal: Math.abs(storedTotal),
      lines: [],
      settlementSummary: null,
    },
    settlementSummary: {
      cashAmount: 0,
      bankAmount: 0,
      creditAmount: 0,
      allocatedAmount: 0,
      expectedAmount: null,
      isComplete: false,
      source: "unavailable",
    },
    legacyFallback: {
      isLegacyOrUnknown: true,
      message: "This exchange has no trusted target-policy marker. Stored historical totals are shown without tax recalculation.",
    },
  };
}

module.exports = {
  POLICY_VERSION,
  TARGET_POLICY_STATUS,
  LEGACY_POLICY_STATUS,
  extractSavedExchangePolicy,
  buildSettlementSummary,
  buildTargetPolicyDisplay,
  buildLegacyDisplay,
};
