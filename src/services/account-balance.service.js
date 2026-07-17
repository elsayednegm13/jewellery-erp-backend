const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");

const round = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

async function calculateBalances({ companyId, branchId = null, accountCode = null, transaction = null } = {}) {
  if (!companyId) throw new Error("calculateBalances requires companyId");
  const replacements = { companyId };
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
     AND je.status = 'posted'
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
      AND je.status = 'posted'
      AND je.created_at >= :since
      AND a.code = :accountCode
  `, {
    replacements: { companyId, branchId, accountCode, since },
    type: QueryTypes.SELECT,
    transaction
  });
  const row = rows[0] || {};
  const debit = round(row.debit);
  const credit = round(row.credit);
  return row.nature === "credit" ? round(credit - debit) : round(debit - credit);
}

module.exports = {
  calculateBalances,
  calculateAccountBalance,
  calculateMovementSince,
  reconciliationReport,
};
