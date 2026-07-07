#!/usr/bin/env node
/**
 * Phase 26.1-Fix — dry-run-only CustomerCreditTransaction GL bridge checker.
 *
 * This script inspects existing customer credit rows and validates their linked
 * JournalEntry / JournalLine bridge state when `journalEntryId` is present.
 * It never writes data and has no apply/backfill mode.
 */

const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});
const { Op } = require("sequelize");

const {
  sequelize,
  CustomerCreditTransaction,
  JournalEntry,
  JournalLine,
  Account,
  Customer,
} = require("../src/models");

const TOLERANCE = 0.0001;
const ACCOUNT_2300 = "2300";
const FORBIDDEN_FLAGS = new Set(["--apply", "--write", "--fix", "--update", "--backfill", "--confirm"]);
const SUPPORTED_FLAGS = new Set(["--company-id", "--customer-id", "--source-type", "--status", "--limit", "--json"]);

const CREDIT_ATTRIBUTES = [
  "id",
  "companyId",
  "branchId",
  "customerId",
  "sourceType",
  "sourceId",
  "direction",
  "amount",
  "status",
  "journalEntryId",
  "cashTransactionId",
  "invoiceId",
  "createdAt",
];
const JOURNAL_ENTRY_ATTRIBUTES = [
  "id",
  "companyId",
  "branchId",
  "status",
  "amount",
  "totalDebit",
  "totalCredit",
  "sourceType",
  "sourceId",
  "date",
];
const JOURNAL_LINE_ATTRIBUTES = [
  "id",
  "journalEntryId",
  "accountCode",
  "accountName",
  "debit",
  "credit",
];
const ACCOUNT_ATTRIBUTES = ["id", "companyId", "code", "name", "type", "nature"];
const CUSTOMER_ATTRIBUTES = ["id", "companyId", "name", "status"];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round4(value) {
  return Math.round(toNumber(value) * 10000) / 10000;
}

function differs(a, b) {
  return Math.abs(round4(a) - round4(b)) > TOLERANCE;
}

function parsePositiveLimit(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error("--limit must be a positive integer");
  return n;
}

function parseArgs(argv) {
  const filters = {
    companyId: undefined,
    customerId: undefined,
    sourceType: undefined,
    status: undefined,
    limit: undefined,
  };
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) {
      throw new Error("This checker is dry-run only and never writes data.");
    }
    if (!SUPPORTED_FLAGS.has(arg)) {
      throw new Error(`Unsupported flag: ${arg}`);
    }
    if (arg === "--json") {
      json = true;
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    i += 1;

    if (arg === "--company-id") filters.companyId = value;
    if (arg === "--customer-id") filters.customerId = value;
    if (arg === "--source-type") filters.sourceType = value;
    if (arg === "--status") filters.status = value;
    if (arg === "--limit") filters.limit = parsePositiveLimit(value);
  }

  return { filters, json };
}

function displayFilters(filters) {
  return {
    companyId: filters.companyId || null,
    customerId: filters.customerId || null,
    sourceType: filters.sourceType || null,
    status: filters.status || null,
    limit: filters.limit || null,
  };
}

async function loadCreditRows(filters) {
  const where = {};
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.sourceType) where.sourceType = filters.sourceType;
  if (filters.status) where.status = filters.status;

  const options = {
    where,
    attributes: CREDIT_ATTRIBUTES,
    order: [["created_at", "DESC"]],
  };
  if (filters.limit) options.limit = filters.limit;
  return CustomerCreditTransaction.findAll(options);
}

async function loadCustomerMap(rows) {
  const keys = rows
    .filter((row) => row.companyId && row.customerId)
    .map((row) => `${row.companyId}|${row.customerId}`);
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length === 0) return new Map();

  const customerWhere = { [Op.or]: uniqueKeys.map((key) => {
    const [companyId, id] = key.split("|");
    return { companyId, id };
  }) };
  const customers = await Customer.findAll({
    where: customerWhere,
    attributes: CUSTOMER_ATTRIBUTES,
    raw: true,
  });
  return new Map(customers.map((customer) => [`${customer.companyId}|${customer.id}`, customer]));
}

async function loadJournalMaps(rows) {
  const ids = [...new Set(rows.map((row) => row.journalEntryId).filter(Boolean))];
  if (ids.length === 0) return { journalById: new Map(), linesByJournalId: new Map() };

  const [entries, lines] = await Promise.all([
    JournalEntry.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: JOURNAL_ENTRY_ATTRIBUTES,
      raw: true,
    }),
    JournalLine.findAll({
      where: { journalEntryId: { [Op.in]: ids } },
      attributes: JOURNAL_LINE_ATTRIBUTES,
      raw: true,
    }),
  ]);
  const journalById = new Map(entries.map((entry) => [entry.id, entry]));
  const linesByJournalId = new Map();
  for (const line of lines) {
    const bucket = linesByJournalId.get(line.journalEntryId) || [];
    bucket.push(line);
    linesByJournalId.set(line.journalEntryId, bucket);
  }
  return { journalById, linesByJournalId };
}

async function loadAccountSnapshot(rows) {
  const companyIds = [...new Set(rows.map((row) => row.companyId).filter(Boolean))];
  if (companyIds.length === 0) return [];
  return Account.findAll({
    where: { companyId: { [Op.in]: companyIds }, code: ACCOUNT_2300 },
    attributes: ACCOUNT_ATTRIBUTES,
    raw: true,
  });
}

function reasonPush(reasons, value) {
  if (value) reasons.push(value);
}

function classifyRow(row, ctx) {
  const amount = round4(row.amount);
  const customer = ctx.customerMap.get(`${row.companyId}|${row.customerId}`) || null;
  const base = {
    creditTransactionId: row.id,
    companyId: row.companyId || null,
    customerId: row.customerId || null,
    customerName: customer ? customer.name : null,
    direction: row.direction,
    amount,
    status: row.status,
    sourceType: row.sourceType,
    sourceId: row.sourceId || null,
    journalEntryId: row.journalEntryId || null,
    classification: "OK",
    reason: "ok",
    journalDebitTotal: null,
    journalCreditTotal: null,
    account2300Side: null,
    amountDifference: null,
  };

  const ignoredReasons = [];
  reasonPush(ignoredReasons, row.status !== "active" ? "inactive_or_reversed" : null);
  reasonPush(ignoredReasons, amount <= 0 ? "zero_or_negative_amount" : null);
  reasonPush(ignoredReasons, !row.companyId ? "missing_company" : null);
  reasonPush(ignoredReasons, !row.customerId ? "missing_customer" : null);
  reasonPush(ignoredReasons, !["credit_in", "credit_out"].includes(row.direction) ? "unknown_direction" : null);
  reasonPush(ignoredReasons, row.companyId && row.customerId && !customer ? "customer_not_found" : null);
  if (ignoredReasons.length) {
    return { ...base, classification: "Ignored / Not Eligible", reason: ignoredReasons.join(",") };
  }

  if (!row.journalEntryId) {
    return { ...base, classification: "Needs GL Bridge Review", reason: "missing_journalEntryId" };
  }

  const journal = ctx.journalById.get(row.journalEntryId);
  if (!journal) {
    return { ...base, classification: "Broken Link", reason: "journal_not_found" };
  }

  const lines = ctx.linesByJournalId.get(row.journalEntryId) || [];
  const journalDebitTotal = round4(lines.reduce((sum, line) => sum + toNumber(line.debit), 0));
  const journalCreditTotal = round4(lines.reduce((sum, line) => sum + toNumber(line.credit), 0));
  const lines2300 = lines.filter((line) => line.accountCode === ACCOUNT_2300);
  const debit2300 = round4(lines2300.reduce((sum, line) => sum + toNumber(line.debit), 0));
  const credit2300 = round4(lines2300.reduce((sum, line) => sum + toNumber(line.credit), 0));
  const expectedSide = row.direction === "credit_in" ? "credit" : "debit";
  const expectedAmount = expectedSide === "credit" ? credit2300 : debit2300;
  const oppositeAmount = expectedSide === "credit" ? debit2300 : credit2300;
  const account2300Side = lines2300.length === 0
    ? "missing"
    : expectedSide === "credit"
      ? `debit:${debit2300},credit:${credit2300}`
      : `debit:${debit2300},credit:${credit2300}`;

  const invalidReasons = [];
  reasonPush(invalidReasons, journal.companyId !== row.companyId ? "wrong_company" : null);
  reasonPush(invalidReasons, journal.status !== "posted" ? "journal_not_posted" : null);
  reasonPush(invalidReasons, differs(journalDebitTotal, journalCreditTotal) ? "journal_unbalanced" : null);
  reasonPush(invalidReasons, lines2300.length === 0 ? "account_2300_missing" : null);
  reasonPush(invalidReasons, lines2300.length > 0 && oppositeAmount > TOLERANCE ? "account_2300_wrong_side" : null);
  reasonPush(invalidReasons, lines2300.length > 0 && differs(expectedAmount, amount) ? "amount_mismatch" : null);

  if (invalidReasons.length) {
    return {
      ...base,
      classification: "Invalid Journal",
      reason: invalidReasons.join(","),
      journalDebitTotal,
      journalCreditTotal,
      account2300Side,
      amountDifference: round4(expectedAmount - amount),
    };
  }

  return {
    ...base,
    journalDebitTotal,
    journalCreditTotal,
    account2300Side,
    amountDifference: round4(expectedAmount - amount),
  };
}

function addReason(counts, reason) {
  for (const part of String(reason || "unknown").split(",")) {
    counts[part] = (counts[part] || 0) + 1;
  }
}

function buildCustomerSummaries(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.status !== "active" || !row.companyId || !row.customerId) continue;
    const amount = round4(row.amount);
    const key = `${row.companyId}|${row.customerId}`;
    const item = map.get(key) || {
      companyId: row.companyId,
      customerId: row.customerId,
      creditInTotal: 0,
      creditOutTotal: 0,
      availableCredit: 0,
      rowCount: 0,
    };
    if (row.direction === "credit_in") item.creditInTotal = round4(item.creditInTotal + amount);
    if (row.direction === "credit_out") item.creditOutTotal = round4(item.creditOutTotal + amount);
    item.availableCredit = round4(item.creditInTotal - item.creditOutTotal);
    item.rowCount += 1;
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => Math.abs(b.availableCredit) - Math.abs(a.availableCredit));
}

function buildReport(rows, classifications, filters, accountSnapshot) {
  const activeRows = rows.filter((row) => row.status === "active");
  const creditInRows = activeRows.filter((row) => row.direction === "credit_in");
  const creditOutRows = activeRows.filter((row) => row.direction === "credit_out");
  const reasonCounts = {};
  for (const row of classifications) addReason(reasonCounts, row.reason);

  const byClass = (name) => classifications.filter((row) => row.classification === name);
  const summary = {
    mode: "dry-run",
    totalRowsInspected: rows.length,
    activeRows: activeRows.length,
    creditInCount: creditInRows.length,
    creditInTotal: round4(creditInRows.reduce((sum, row) => sum + toNumber(row.amount), 0)),
    creditOutCount: creditOutRows.length,
    creditOutTotal: round4(creditOutRows.reduce((sum, row) => sum + toNumber(row.amount), 0)),
    availableCreditTotal: round4(
      creditInRows.reduce((sum, row) => sum + toNumber(row.amount), 0) -
      creditOutRows.reduce((sum, row) => sum + toNumber(row.amount), 0)
    ),
    rowsWithJournalEntryId: rows.filter((row) => Boolean(row.journalEntryId)).length,
    rowsMissingJournalEntryId: rows.filter((row) => !row.journalEntryId).length,
    okCount: byClass("OK").length,
    needsReviewCount: byClass("Needs GL Bridge Review").length,
    brokenLinkCount: byClass("Broken Link").length,
    invalidJournalCount: byClass("Invalid Journal").length,
    ignoredCount: byClass("Ignored / Not Eligible").length,
    reasonCounts,
    account2300CompanyCount: accountSnapshot.length,
  };
  const warnings = [
    "Dry-run only: no data was changed.",
    "Rows missing journalEntryId are not fixed by this script.",
    "Do not backfill before reviewing output.",
    "GL 2300 can include non-CustomerCreditTransaction sources.",
    "2300 may include other subledgers. This checker validates only CustomerCreditTransaction rows that reference journal entries.",
  ];
  return {
    summary,
    filters: displayFilters(filters),
    classifications,
    samples: classifications.slice(0, 20),
    customerSummaries: buildCustomerSummaries(rows),
    warnings,
  };
}

function isMissingCustomerCreditTableError(err) {
  const msg = String((err && (err.parent?.message || err.original?.message || err.message)) || "");
  return /customer_credit_transactions/i.test(msg) && /does not exist|no such table/i.test(msg);
}

function buildMissingTableReport(filters) {
  const report = buildReport([], [], filters, []);
  report.summary.tableAvailable = false;
  report.warnings.unshift("customer_credit_transactions table is not available in this database; run the additive migration before expecting live rows.");
  return report;
}

function printHuman(report) {
  const { summary, filters, samples, warnings } = report;
  console.log("Customer Credit GL Bridge Checker");
  console.log(`mode: ${summary.mode}`);
  console.log(`filters: ${JSON.stringify(filters)}`);
  console.log(`total rows inspected: ${summary.totalRowsInspected}`);
  console.log(`active rows: ${summary.activeRows}`);
  console.log(`credit_in total: ${summary.creditInTotal} (${summary.creditInCount} rows)`);
  console.log(`credit_out total: ${summary.creditOutTotal} (${summary.creditOutCount} rows)`);
  console.log(`available credit total: ${summary.availableCreditTotal}`);
  console.log(`rows with journalEntryId: ${summary.rowsWithJournalEntryId}`);
  console.log(`rows missing journalEntryId: ${summary.rowsMissingJournalEntryId}`);
  console.log(`OK count: ${summary.okCount}`);
  console.log(`needs review count: ${summary.needsReviewCount}`);
  console.log(`broken link count: ${summary.brokenLinkCount}`);
  console.log(`invalid journal count: ${summary.invalidJournalCount}`);
  console.log(`ignored count: ${summary.ignoredCount}`);
  console.log(`reason counts: ${JSON.stringify(summary.reasonCounts)}`);
  console.log("sample rows:");
  for (const row of samples) console.log(`- ${JSON.stringify(row)}`);
  console.log("warnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}

async function main() {
  const { filters, json } = parseArgs(process.argv.slice(2));
  let rows;
  try {
    rows = await loadCreditRows(filters);
  } catch (err) {
    if (isMissingCustomerCreditTableError(err)) {
      const report = buildMissingTableReport(filters);
      if (json) console.log(JSON.stringify(report, null, 2));
      else printHuman(report);
      return;
    }
    throw err;
  }
  const [customerMap, journalMaps, accountSnapshot] = await Promise.all([
    loadCustomerMap(rows),
    loadJournalMaps(rows),
    loadAccountSnapshot(rows),
  ]);
  const classifications = rows.map((row) => classifyRow(row, { customerMap, ...journalMaps }));
  const report = buildReport(rows, classifications, filters, accountSnapshot);

  if (json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
