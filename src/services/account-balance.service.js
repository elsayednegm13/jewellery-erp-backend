const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const {
  buildReportableLedgerPredicate,
  reportableLedgerReplacements,
  assertReportableLedgerIntegrity,
} = require("./ledger-reporting.service");

const round = (value) => Math.round((Number(value) || 0) * 10000) / 10000;
const TREASURY_ACCOUNT_CODES = Object.freeze({ cash: "1110", bank: "1120" });

async function calculateBalances({ companyId, branchId = null, accountCode = null, transaction = null, skipLedgerIntegrityCheck = false } = {}) {
  if (!companyId) throw new Error("calculateBalances requires companyId");
  if (!skipLedgerIntegrityCheck) {
    await assertReportableLedgerIntegrity({ companyId, branchId, transaction });
  }

  let replacements = { companyId };
  let accountFilter = "";
  let branchFilter = "";
  if (accountCode) {
    replacements.accountCode = String(accountCode);
    accountFilter = "AND a.code = :accountCode";
  }
  if (branchId) {
    replacements.branchId = String(branchId);
    branchFilter = "AND je.branch_id = :branchId";
  }
  replacements = reportableLedgerReplacements(replacements);
  const reportableLedgerPredicate = buildReportableLedgerPredicate("je");

  const rows = await sequelize.query(`
    SELECT
      a.id,
      a.code,
      a.name,
      a.name_ar AS "nameAr",
      a.type,
      a.nature,
      a.balance::numeric AS "storedBalance",
      COALESCE(SUM(CASE WHEN je.id IS NULL THEN 0 ELSE jl.debit::numeric END), 0) AS "postedDebit",
      COALESCE(SUM(CASE WHEN je.id IS NULL THEN 0 ELSE jl.credit::numeric END), 0) AS "postedCredit",
      MAX(je.date) AS "lastJournalDate"
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je
      ON je.id = jl.journal_entry_id
     AND je.company_id = a.company_id
     AND ${reportableLedgerPredicate}
     ${branchFilter}
    WHERE a.company_id = :companyId
      ${accountFilter}
    GROUP BY a.id, a.code, a.name, a.name_ar, a.type, a.nature, a.balance
    ORDER BY a.code
  `, { replacements, type: QueryTypes.SELECT, transaction });

  return rows.map((row) => {
    const debit = round(row.postedDebit);
    const credit = round(row.postedCredit);
    const stored = round(row.storedBalance);
    const calculated = row.nature === "credit" ? round(credit - debit) : round(debit - credit);
    const difference = round(stored - calculated);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      nameAr: row.nameAr,
      type: row.type,
      nature: row.nature,
      storedBalance: stored,
      postedDebit: debit,
      postedCredit: credit,
      calculatedBalance: calculated,
      difference,
      inSync: Math.abs(difference) < 0.0001,
      lastJournalDate: row.lastJournalDate || null
    };
  });
}

async function calculateAccountBalance(args = {}) {
  const rows = await calculateBalances(args);
  return rows[0] || null;
}

/**
 * One ledger-derived cash/bank view for treasury and accounting dashboards.
 * Account.balance remains a reconciliation mirror only; every amount here is
 * calculated from reportable journal lines scoped to the authorized company/branch.
 */
async function calculateTreasuryLedgerSummary({ companyId, branchId = null, transaction = null } = {}) {
  if (!companyId) throw new Error("calculateTreasuryLedgerSummary requires companyId");

  await assertReportableLedgerIntegrity({ companyId, branchId, transaction });

  const cashRow = await calculateAccountBalance({
    companyId,
    branchId,
    accountCode: TREASURY_ACCOUNT_CODES.cash,
    transaction,
    skipLedgerIntegrityCheck: true,
  });
  const bankRow = await calculateAccountBalance({
    companyId,
    branchId,
    accountCode: TREASURY_ACCOUNT_CODES.bank,
    transaction,
    skipLedgerIntegrityCheck: true,
  });

  let replacements = { companyId };
  let branchFilter = "";
  if (branchId) {
    replacements.branchId = String(branchId);
    branchFilter = "AND je.branch_id = :branchId";
  }
  replacements = reportableLedgerReplacements(replacements);
  const reportableLedgerPredicate = buildReportableLedgerPredicate("je");

  // Sum each original/reversal pair as one external cash activity. This keeps
  // all-time receipts/payments net of corrections while transfers remain zero.
  const movementRows = await sequelize.query(`
    SELECT
      COALESCE(je.reversal_of, je.id) AS "activityGroupId",
      COALESCE(SUM(jl.debit::numeric - jl.credit::numeric), 0) AS "combinedCashBankDelta"
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.company_id = :companyId
      AND ${reportableLedgerPredicate}
      ${branchFilter}
      AND jl.account_code IN (:cashAccountCode, :bankAccountCode)
    GROUP BY COALESCE(je.reversal_of, je.id)
  `, {
    replacements: {
      ...replacements,
      cashAccountCode: TREASURY_ACCOUNT_CODES.cash,
      bankAccountCode: TREASURY_ACCOUNT_CODES.bank,
    },
    type: QueryTypes.SELECT,
    transaction,
  });

  let receipts = 0;
  let payments = 0;
  for (const row of movementRows) {
    const delta = round(row.combinedCashBankDelta);
    if (delta > 0) receipts = round(receipts + delta);
    if (delta < 0) payments = round(payments + Math.abs(delta));
  }

  return {
    cash: round(cashRow?.calculatedBalance),
    bank: round(bankRow?.calculatedBalance),
    receipts,
    payments,
    activitySemantics: "net_external_cash_activity",
    mirrorDifferences: {
      cash: round(cashRow?.difference),
      bank: round(bankRow?.difference),
    },
  };
}

async function reconciliationReport(args = {}) {
  const rows = await calculateBalances(args);
  const divergent = rows.filter((row) => !row.inSync);
  return {
    items: rows,
    totalAccounts: rows.length,
    divergentAccounts: divergent.length,
    totalAbsoluteDifference: round(divergent.reduce((sum, row) => sum + Math.abs(row.difference), 0))
  };
}

async function calculateMovementSince({ companyId, branchId, accountCode, since, transaction = null }) {
  if (!companyId || !branchId || !accountCode || !since) return 0;
  await assertReportableLedgerIntegrity({ companyId, branchId, transaction });
  const reportableLedgerPredicate = buildReportableLedgerPredicate("je");
  const rows = await sequelize.query(`
    SELECT
      COALESCE(SUM(jl.debit::numeric), 0) AS debit,
      COALESCE(SUM(jl.credit::numeric), 0) AS credit,
      MAX(a.nature) AS nature
    FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.company_id = :companyId
      AND je.branch_id = :branchId
      AND ${reportableLedgerPredicate}
      AND je.created_at >= :since
      AND a.code = :accountCode
  `, {
    replacements: reportableLedgerReplacements({ companyId, branchId, accountCode, since }),
    type: QueryTypes.SELECT,
    transaction
  });
  const row = rows[0] || {};
  const debit = round(row.debit);
  const credit = round(row.credit);
  return row.nature === "credit" ? round(credit - debit) : round(debit - credit);
}

module.exports = {
  TREASURY_ACCOUNT_CODES,
  calculateBalances,
  calculateAccountBalance,
  calculateTreasuryLedgerSummary,
  calculateMovementSince,
  reconciliationReport,
};
