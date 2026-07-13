const { ValidationError } = require("../utils/errors");
const { roundMoney, resolveExcessSettlement } = require("./sales.service");

const TARGET_TAX_POLICY = Object.freeze({
  taxAppliesTo: "new_items_only",
  returnedValueTaxable: false,
  excessTaxable: false,
  settlementAffectsVat: false,
});

function buildCustomerFacingExchangePolicy({
  returnedValue = 0,
  newSubtotal = 0,
  newTax = 0,
  newGross = 0,
  amountDueFromCustomer = 0,
  arRelief = 0,
  excessDueToCustomer = 0,
  settlementPreview = null,
  currency = "AED",
} = {}) {
  const safeReturnedValue = Math.max(0, roundMoney(returnedValue));
  const safeNewSubtotal = Math.max(0, roundMoney(newSubtotal));
  const safeNewTax = Math.max(0, roundMoney(newTax));
  const safeNewGross = Math.max(0, roundMoney(newGross));
  const dueFromCustomer = Math.max(0, roundMoney(amountDueFromCustomer));
  const relief = Math.max(0, roundMoney(arRelief));
  const dueToCustomer = Math.max(0, roundMoney(excessDueToCustomer));

  return {
    showNegativeLines: false,
    showNegativeTotal: false,
    balanceDueLabel: dueToCustomer > 0 ? "Balance due to customer" : "Balance due from customer",
    policyNote: "VAT applies to the new replacement items only. Remaining balance due to customer is not taxed again.",
    currency,
    lines: [
      { key: "returnedValue", label: "Returned item value", amount: safeReturnedValue, displayAs: "exchange_credit" },
      { key: "newSubtotal", label: "New replacement items subtotal", amount: safeNewSubtotal, displayAs: "sale_subtotal" },
      { key: "newTax", label: "VAT on new replacement items", amount: safeNewTax, displayAs: "tax" },
      { key: "newGross", label: "New replacement items gross", amount: safeNewGross, displayAs: "sale_gross" },
      { key: "amountDueFromCustomer", label: "Amount due from customer", amount: dueFromCustomer, displayAs: "customer_due" },
      { key: "arRelief", label: "Receivable relief", amount: relief, displayAs: "ar_relief" },
      { key: "excessDueToCustomer", label: "Balance due to customer", amount: dueToCustomer, displayAs: "customer_refund_or_credit" },
    ],
    displayTotal: dueFromCustomer > 0 ? dueFromCustomer : dueToCustomer,
    settlementSummary: settlementPreview
      ? {
          cashAmount: Math.max(0, roundMoney(settlementPreview.cashAmount)),
          bankAmount: Math.max(0, roundMoney(settlementPreview.bankAmount)),
          creditAmount: Math.max(0, roundMoney(settlementPreview.creditAmount)),
          remainingToAllocate: Math.max(0, roundMoney(settlementPreview.remainingToAllocate)),
          isValid: Boolean(settlementPreview.isValid),
        }
      : null,
  };
}

function computeExchangePolicyPreview({
  originalInvoiceId,
  customerId,
  currency = "AED",
  vatRate = 0,
  returnedValue = 0,
  newSubtotal = 0,
  outstandingAR = 0,
  settlement,
} = {}) {
  const rate = Number(vatRate) || 0;
  const returned = Math.max(0, roundMoney(returnedValue));
  const subtotal = Math.max(0, roundMoney(newSubtotal));
  const outstanding = Math.max(0, roundMoney(outstandingAR));
  if (returned <= 0) throw new ValidationError("Returned value must be greater than zero");
  if (subtotal <= 0) throw new ValidationError("New replacement item subtotal must be greater than zero");

  const newTax = roundMoney(subtotal * (rate / 100));
  const newGross = roundMoney(subtotal + newTax);
  const difference = roundMoney(newGross - returned);
  const amountDueFromCustomer = difference > 0 ? difference : 0;
  const refundValue = difference < 0 ? roundMoney(Math.abs(difference)) : 0;
  const arRelief = refundValue > 0 ? roundMoney(Math.min(refundValue, outstanding)) : 0;
  const excessDueToCustomer = refundValue > 0 ? roundMoney(refundValue - arRelief) : 0;

  let settlementPreview = {
    provided: false,
    cashAmount: 0,
    bankAmount: 0,
    creditAmount: 0,
    cashAccountCode: "1110",
    bankAccountCode: "1120",
    isValid: true,
    remainingToAllocate: excessDueToCustomer,
  };

  if (settlement !== undefined && settlement !== null) {
    const normalized = resolveExcessSettlement({
      excessAmount: excessDueToCustomer,
      settlement,
      hasCustomer: Boolean(customerId),
    });
    settlementPreview = {
      provided: true,
      cashAmount: normalized.cashAmount,
      bankAmount: normalized.bankAmount,
      creditAmount: normalized.creditAmount,
      cashAccountCode: normalized.cashAccountCode,
      bankAccountCode: normalized.bankAccountCode,
      isValid: true,
      remainingToAllocate: 0,
      reference: normalized.reference,
      description: normalized.description,
    };
  }

  const preview = {
    originalInvoiceId,
    customerId,
    currency,
    vatRate: rate,
    returnedValue: returned,
    newSubtotal: subtotal,
    newTax,
    newGross,
    difference,
    amountDueFromCustomer,
    arRelief,
    excessDueToCustomer,
    settlementPreview,
    taxPolicy: { ...TARGET_TAX_POLICY },
    readOnly: true,
  };

  return {
    ...preview,
    customerFacing: buildCustomerFacingExchangePolicy(preview),
  };
}

module.exports = {
  TARGET_TAX_POLICY,
  buildCustomerFacingExchangePolicy,
  computeExchangePolicyPreview,
};
