const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const { AppError } = require("../utils/errors");

// A reversed JournalEntry was posted previously. Its unchanged lines and the
// separately posted reversal are both financial history and must be reported.
const REPORTABLE_LEDGER_STATUSES = Object.freeze(["posted", "reversed"]);

function buildReportableLedgerPredicate(alias = "je", parameter = "reportableLedgerStatuses") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter)) {
    throw new Error("Invalid reportable-ledger SQL identifier");
  }
  return `${alias}.status IN (:${parameter})`;
}

function reportableLedgerReplacements(replacements = {}, parameter = "reportableLedgerStatuses") {
  return { ...replacements, [parameter]: REPORTABLE_LEDGER_STATUSES };
}

async function findReportableLedgerIntegrityIssues({ companyId, branchId = null, transaction = null } = {}) {
  if (!companyId) throw new Error("findReportableLedgerIntegrityIssues requires companyId");

  const replacements = { companyId };
  let branchFilter = "";
  if (branchId) {
    replacements.branchId = String(branchId);
    branchFilter = "AND original.branch_id = :branchId";
  }

  return sequelize.query(`
    SELECT
      original.id AS "originalId",
      COUNT(reversal.id)::integer AS "reversalCount",
      MAX(reversal.id) AS "reversalId"
    FROM journal_entries original
    LEFT JOIN journal_entries reversal ON reversal.reversal_of = original.id
    WHERE original.company_id = :companyId
      AND original.status = 'reversed'
      ${branchFilter}
    GROUP BY original.id, original.company_id, original.branch_id,
      original.source_type, original.source_id, original.reversal_of, original.posted_at
    HAVING original.reversal_of IS NOT NULL
      OR original.source_type <> 'manual'
      OR original.posted_at IS NULL
      OR COUNT(reversal.id) <> 1
      OR BOOL_OR(
        reversal.status <> 'posted'
        OR reversal.source_type <> 'manual_reversal'
        OR reversal.source_id IS DISTINCT FROM original.id
        OR reversal.company_id IS DISTINCT FROM original.company_id
        OR reversal.branch_id IS DISTINCT FROM original.branch_id
      )
    ORDER BY original.id
  `, {
    replacements,
    type: QueryTypes.SELECT,
    transaction,
  });
}

async function assertReportableLedgerIntegrity(args = {}) {
  const issues = await findReportableLedgerIntegrityIssues(args);
  if (issues.length) {
    const ids = issues.map((issue) => issue.originalId).join(", ");
    throw new AppError(
      `Ledger reversal integrity check failed for journal entries: ${ids}`,
      409,
      "LEDGER_REVERSAL_INTEGRITY_FAILED",
    );
  }
}

module.exports = {
  REPORTABLE_LEDGER_STATUSES,
  buildReportableLedgerPredicate,
  reportableLedgerReplacements,
  findReportableLedgerIntegrityIssues,
  assertReportableLedgerIntegrity,
};
