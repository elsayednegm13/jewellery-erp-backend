"use strict";

const { Op } = require("sequelize");
const models = require("../models");
const ledgerReportingService = require("./ledger-reporting.service");

const round4 = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

async function balances({ companyId, branchId, from = null, to = null, asOf = null }) {
  await ledgerReportingService.assertReportableLedgerIntegrity({ companyId, branchId });
  const entryWhere = {
    companyId,
    status: { [Op.in]: ledgerReportingService.REPORTABLE_LEDGER_STATUSES },
  };
  if (branchId) entryWhere.branchId = branchId;
  if (from || to || asOf) {
    entryWhere.date = {};
    if (from) entryWhere.date[Op.gte] = from;
    if (to || asOf) entryWhere.date[Op.lte] = to || asOf;
  }
  const lines = await models.JournalLine.findAll({
    attributes: ["debit", "credit"],
    include: [
      {
        model: models.JournalEntry,
        as: "journalEntry",
        attributes: [],
        required: true,
        where: entryWhere,
      },
      {
        model: models.Account,
        as: "account",
        attributes: ["id", "code", "name", "nameAr", "nature", "statementClassification"],
        required: true,
        where: { companyId },
      },
    ],
  });
  const grouped = new Map();
  for (const line of lines) {
    const account = line.account;
    const current = grouped.get(account.id) || {
      id: account.id,
      code: account.code,
      name: account.name,
      nameAr: account.nameAr,
      classification: account.statementClassification,
      balance: 0,
    };
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    current.balance += account.nature === "credit" ? credit - debit : debit - credit;
    grouped.set(account.id, current);
  }
  return [...grouped.values()].map((row) => ({ ...row, balance: round4(row.balance) })).sort((a, b) => a.code.localeCompare(b.code));
}

function section(rows, classifications) {
  const accounts = rows.filter((row) => classifications.includes(row.classification));
  return { accounts, total: round4(accounts.reduce((sum, row) => sum + row.balance, 0)) };
}

async function incomeStatement({ companyId, branchId, from, to }) {
  const rows = await balances({ companyId, branchId, from, to });
  const revenue = section(rows, ["revenue"]);
  const otherIncome = section(rows, ["other_income"]);
  const costOfGoodsSold = section(rows, ["cost_of_goods_sold"]);
  const operatingExpenses = section(rows, ["operating_expense"]);
  const grossProfit = round4(revenue.total - costOfGoodsSold.total);
  const netIncome = round4(grossProfit + otherIncome.total - operatingExpenses.total);
  return {
    report: "income_statement",
    scope: { branchId },
    period: { from, to },
    revenue,
    otherIncome,
    costOfGoodsSold,
    operatingExpenses,
    grossProfit,
    netIncome,
    ledgerBased: true,
  };
}

async function balanceSheet({ companyId, branchId, asOf }) {
  const rows = await balances({ companyId, branchId, asOf });
  const assets = section(rows, ["asset"]);
  const liabilities = section(rows, ["liability"]);
  const equity = section(rows, ["equity"]);
  const revenue = section(rows, ["revenue", "other_income"]).total;
  const expenses = section(rows, ["cost_of_goods_sold", "operating_expense"]).total;
  const currentEarnings = round4(revenue - expenses);
  const liabilitiesAndEquity = round4(liabilities.total + equity.total + currentEarnings);
  return {
    report: "balance_sheet",
    scope: { branchId },
    asOf,
    assets,
    liabilities,
    equity,
    currentEarnings,
    liabilitiesAndEquity,
    difference: round4(assets.total - liabilitiesAndEquity),
    balanced: Math.abs(assets.total - liabilitiesAndEquity) <= 0.01,
    ledgerBased: true,
  };
}

module.exports = { incomeStatement, balanceSheet };
