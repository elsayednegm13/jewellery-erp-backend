"use strict";

const Decimal = require("decimal.js");

function decimalOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function amountOrFallback(value, fallback = "0.0000") {
  const decimal = decimalOrNull(value) ?? decimalOrNull(fallback) ?? new Decimal(0);
  return decimal.toFixed(4);
}

function derivePaymentStatus({ originalAmount, paidAmount, outstandingAmount }) {
  const original = decimalOrNull(originalAmount) ?? new Decimal(0);
  const paid = decimalOrNull(paidAmount) ?? new Decimal(0);
  const outstanding = decimalOrNull(outstandingAmount) ?? new Decimal(0);
  if (original.gt(0) && outstanding.eq(0) && paid.gte(original)) return "FULLY_PAID";
  if (paid.gt(0) && outstanding.gt(0)) return "PARTIALLY_PAID";
  return "UNPAID";
}

function buildPaymentSummary({ originalAmount, settledAmount, outstandingAmount, settlementPaidAmount }) {
  const original = amountOrFallback(originalAmount);
  const paid = amountOrFallback(settledAmount, settlementPaidAmount ?? "0.0000");
  const outstanding = amountOrFallback(outstandingAmount, original);
  return {
    originalAmount: original,
    paidAmount: paid,
    outstandingAmount: outstanding,
    remainingAmount: outstanding,
    paymentStatus: derivePaymentStatus({ originalAmount: original, paidAmount: paid, outstandingAmount: outstanding }),
  };
}

module.exports = { amountOrFallback, derivePaymentStatus, buildPaymentSummary };
