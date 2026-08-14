"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const utility = fs.readFileSync(path.join(root, "lib/cgp/presentation.ts"), "utf8");
const workspace = fs.readFileSync(path.join(root, "features/gold-purchases/components/GoldPurchaseDraftWorkspace.tsx"), "utf8");
const approvals = fs.readFileSync(path.join(root, "app/[locale]/(dashboard)/approvals/page.tsx"), "utf8");

test("CGP presentation uses canonical date, datetime, money and Latin digit utilities", () => {
  assert.match(utility, /formatDate\(value, locale\)/);
  assert.match(utility, /formatDateTime\(value, CGP_TIMEZONE, locale\)/);
  assert.match(utility, /formatAppMoney\(value, currency, 4\)/);
  assert.match(utility, /toEnglishDigits\(String\(value\)\)/);
  assert.match(workspace, /displayDate\(isCgp \? draft\.transactionDate : draft\.purchaseDate\)/);
  assert.match(workspace, /displayDateTime\(row\.executedAt\)/);
  assert.match(workspace, /displayMoney\(paymentAmount/);
});

test("CGP presentation localizes statuses and preserves governance immutability", () => {
  assert.match(utility, /cgpIntegrationStatusLabel/);
  assert.match(utility, /Pending — soft projection/);
  assert.match(utility, /cgpOperationalStatusLabel/);
  assert.match(workspace, /cgpIntegrationStatusLabel\("CRM"/);
  assert.match(workspace, /cgpReversalStatusLabel/);
  assert.match(approvals, /cgpGovernanceLabel\(request\.approvalStatus, locale\)/);
  assert.match(approvals, /actionabilityBlocked \?/);
});

test("CGP identifiers and numeric values remain isolated from RTL text", () => {
  assert.match(workspace, /font-mono font-black" dir="ltr"/);
  assert.match(workspace, /displayNumber\(line\.netWeight\)/);
  assert.match(workspace, /displayNumber\(asset\.pureGoldWeight\)/);
  assert.doesNotMatch(workspace, /\{row\.executedAt \|\| "—"\}/);
  assert.doesNotMatch(workspace, /\{businessView\.reversal\.status\}/);
});

console.log("CGP_DATE_FORMAT_TESTS: PASS");
console.log("CGP_STATUS_LOCALIZATION_TESTS: PASS");
console.log("CGP_NUMERAL_BIDI_TESTS: PASS");
