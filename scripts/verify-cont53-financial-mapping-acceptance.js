"use strict";

// CONT53: verifies current-vs-historical mapping semantics using the real
// acceptance configuration.  All intentional writes are inside one rolled
// back transaction, so no acceptance business or master data persists.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });
const expectedDatabase = "darfus_erp_inventory_rehearsal_20260804_160500z";
delete process.env.DATABASE_URL;
process.env.DB_NAME = expectedDatabase;

const sequelize = require("../src/config/database");
const models = require("../src/models");
const financialBootstrap = require("../src/services/financial-bootstrap.service");

class IntentionalRollback extends Error {}
const marker = () => `CONT53-${crypto.randomUUID()}`;
const one = async (sql, replacements = {}, transaction = null) =>
  (await sequelize.query(sql, { replacements, transaction }))[0][0];

async function integrity(transaction = null) {
  return one(`SELECT
    (SELECT COUNT(*)::int FROM journal_entries je WHERE je.status IN ('posted','reversed') AND COALESCE((SELECT SUM(jl.debit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id),0) <> COALESCE((SELECT SUM(jl.credit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id),0)) AS unbalanced,
    (SELECT COUNT(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_lines,
    (SELECT COUNT(*)::int FROM cash_transactions ct LEFT JOIN journal_entries je ON je.id=ct.journal_entry_id WHERE ct.status='posted' AND ct.journal_entry_id IS NOT NULL AND je.id IS NULL) AS unlinked_treasury,
    (SELECT COUNT(*)::int FROM journal_entries) AS journals,
    (SELECT COUNT(*)::int FROM cash_transactions) AS treasury`, {}, transaction);
}

async function main() {
  await sequelize.authenticate();
  assert.equal((await one("SELECT current_database() AS db")).db, expectedDatabase, "STOP — acceptance DB required");
  const scope = await one(`SELECT c.id AS "companyId", b.id AS "branchId"
    FROM companies c JOIN branches b ON b.company_id=c.id AND b.is_active=true
    ORDER BY b.created_at LIMIT 1`);
  assert.ok(scope?.companyId && scope?.branchId, "active acceptance company/branch required");
  const before = await integrity();
  let rolledBack = false;

  try {
    await sequelize.transaction(async (transaction) => {
      // The target is proven again on the transaction that performs the test writes.
      assert.equal((await one("SELECT current_database() AS db", {}, transaction)).db, expectedDatabase, "STOP — acceptance DB required before mutation");
      const active = await models.BranchFinancialMapping.findOne({
        where: { companyId: scope.companyId, branchId: scope.branchId, mappingType: "CASH_TREASURY", channel: null, isActive: true },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      assert.ok(active, "one active CASH_TREASURY mapping required");
      const beforeMappings = await models.BranchFinancialMapping.findAll({
        where: { companyId: scope.companyId, branchId: scope.branchId, mappingType: "CASH_TREASURY", channel: null },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      assert.equal(beforeMappings.filter((row) => row.isActive).length, 1, "fixture requires one current active mapping");

      await models.BranchFinancialMapping.create({
        id: marker(), companyId: scope.companyId, branchId: scope.branchId,
        mappingType: "CASH_TREASURY", channel: null, accountId: active.accountId,
        isActive: false, createdBy: "CONT53-acceptance", updatedBy: "CONT53-acceptance",
      }, { transaction });

      const readiness = await financialBootstrap.evaluateReadiness({ models, companyId: scope.companyId, branchId: scope.branchId, transaction });
      assert.equal(readiness.status, "READY", JSON.stringify(readiness));
      const reconcile = await financialBootstrap.reconcile({
        models, companyId: scope.companyId, branchId: scope.branchId,
        actorId: "CONT53-acceptance", transaction, dryRun: false,
      });
      assert.equal(reconcile.status, "READY", JSON.stringify(reconcile));

      const afterHistorical = await models.BranchFinancialMapping.findAll({
        where: { companyId: scope.companyId, branchId: scope.branchId, mappingType: "CASH_TREASURY", channel: null }, transaction,
      });
      assert.equal(afterHistorical.filter((row) => row.isActive).length, 1, "inactive history must not become current authority");
      assert.equal(afterHistorical.filter((row) => !row.isActive).length, beforeMappings.filter((row) => !row.isActive).length + 1, "inactive historical mapping must remain preserved");

      assert.deepEqual(await integrity(transaction), before, "reconcile must not post journals or treasury movements");
      throw new IntentionalRollback();
    });
  } catch (error) {
    if (error instanceof IntentionalRollback) rolledBack = true;
    else throw error;
  }

  assert.equal(rolledBack, true, "acceptance mutations must be rolled back");
  assert.deepEqual(await integrity(), before, "no financial persistence is allowed from CONT53 mapping acceptance");
  const durableFixtures = await one("SELECT COUNT(*)::int AS count FROM branch_financial_mappings WHERE created_by='CONT53-acceptance'");
  assert.equal(durableFixtures.count, 0, "transactional acceptance fixtures must not persist");

  // The database itself has the canonical partial unique index for a true
  // active conflict. It rejects the second authority before reconcile can run;
  // currentMappingAuthority has separate unit coverage for legacy data that
  // could predate that constraint.
  assert.equal((await one("SELECT current_database() AS db")).db, expectedDatabase, "STOP — acceptance DB required before conflict attempt");
  const active = await models.BranchFinancialMapping.findOne({
    where: { companyId: scope.companyId, branchId: scope.branchId, mappingType: "CASH_TREASURY", channel: null, isActive: true },
  });
  await assert.rejects(
    () => models.BranchFinancialMapping.create({
      id: marker(), companyId: scope.companyId, branchId: scope.branchId,
      mappingType: "CASH_TREASURY", channel: null, accountId: active.accountId,
      isActive: true, createdBy: "CONT53-acceptance", updatedBy: "CONT53-acceptance",
    }),
    (error) => error?.name === "SequelizeUniqueConstraintError",
  );
  assert.equal((await one("SELECT COUNT(*)::int AS count FROM branch_financial_mappings WHERE created_by='CONT53-acceptance'")).count, 0, "failed active-conflict attempt must not persist");
  console.log("D01_RECONCILE_WITH_HISTORICAL_INACTIVE_ROWS: PASS");
  console.log("D01_TRUE_ACTIVE_CONFLICT_FAIL_CLOSED: PASS");
  console.log("D01_FINANCIAL_REGRESSION: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => sequelize.close());
