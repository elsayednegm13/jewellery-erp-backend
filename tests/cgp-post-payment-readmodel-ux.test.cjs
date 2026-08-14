"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const summary = require(path.join(root, "src/services/cgp-payment-summary"));
const view = fs.readFileSync(path.join(root, "src/services/cgp-business-view.service.js"), "utf8");
const workspace = fs.readFileSync(path.resolve(__dirname, "../../features/gold-purchases/components/GoldPurchaseDraftWorkspace.tsx"), "utf8");
const draftService = fs.readFileSync(path.join(root, "src/services/gold-purchase-draft.service.js"), "utf8");

test("zero outstanding is preserved and null falls back only when absent", () => {
  const full = summary.buildPaymentSummary({ originalAmount: "5182.4854", settledAmount: 5182.4854, outstandingAmount: 0 });
  assert.equal(full.outstandingAmount, "0.0000");
  assert.equal(full.remainingAmount, "0.0000");
  assert.equal(full.paymentStatus, "FULLY_PAID");

  const absent = summary.buildPaymentSummary({ originalAmount: "100.0000", settledAmount: null, outstandingAmount: null, settlementPaidAmount: "0.0000" });
  assert.equal(absent.outstandingAmount, "100.0000");
  assert.equal(absent.paymentStatus, "UNPAID");
});

test("partial and unpaid states are derived without a persisted lifecycle status", () => {
  assert.equal(summary.derivePaymentStatus({ originalAmount: "100", paidAmount: "25", outstandingAmount: "75" }), "PARTIALLY_PAID");
  assert.equal(summary.derivePaymentStatus({ originalAmount: "100", paidAmount: "0", outstandingAmount: "100" }), "UNPAID");
  assert.match(view, /settlementSummary: \{ \.\.\.paymentSummary, status:/);
  assert.doesNotMatch(view, /serialized\.totalPayableToCustomer \|\|/);
});

test("CGP list payment badge uses one batched Liability lookup", () => {
  assert.match(draftService, /CustomerFinancialLiability\.findAll/);
  assert.match(draftService, /sourceDocumentId: \{ \[Op\.in\]: items\.map/);
  assert.match(workspace, /cgpPaymentStatusLabel\(draft\.paymentStatus/);
  assert.match(workspace, /settlementActionable/);
  assert.match(workspace, /paymentStatus === "FULLY_PAID"/);
  assert.match(workspace, /cgp-technical/);
});

console.log("CGP_READMODEL_ZERO_OUTSTANDING_TEST: PASS");
console.log("CGP_PAYMENT_STATE_DERIVATION_TEST: PASS");
console.log("CGP_LIST_BADGE_BATCH_QUERY_TEST: PASS");
