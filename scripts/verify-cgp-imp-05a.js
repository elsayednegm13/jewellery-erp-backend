"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { QueryTypes } = require("sequelize");

const ACCEPTANCE_DATABASE = "darfus_erp_inventory_rehearsal_20260804_160500z";
const MIGRATION = "20260809090000-customer-creditor-account-foundation.js";
const ROLE = "CUSTOMER_CREDITOR";

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
delete process.env.DATABASE_URL;
process.env.DB_NAME = ACCEPTANCE_DATABASE;

const models = require("../src/models");
const { resolveRequiredSemanticAccount } = require("../src/services/financial-account-resolver.service");

async function main() {
  try {
    const db = (await models.sequelize.query("SELECT current_database() AS db", { type: QueryTypes.SELECT }))[0]?.db;
    assert.equal(db, ACCEPTANCE_DATABASE, "CGP-IMP-05A verifier refuses a non-acceptance database");

    const before = (await models.sequelize.query(`SELECT
      (SELECT count(*)::int FROM journal_entries) AS journals,
      (SELECT count(*)::int FROM journal_lines) AS journal_lines,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM processed_events WHERE consumer_name='ACCOUNTING') AS accounting_receipts,
      (SELECT count(*)::int FROM integration_statuses WHERE consumer_name='ACCOUNTING') AS accounting_integrations,
      (SELECT count(*)::int FROM outbox_events WHERE event_type='CustomerGoldPurchasePostedEvent' AND status<>'PENDING') AS dispatched_cgp_events`, { type: QueryTypes.SELECT }))[0];
    const migrations = await models.sequelize.query(
      "SELECT name FROM \"SequelizeMeta\" WHERE name=:migration",
      { replacements: { migration: MIGRATION }, type: QueryTypes.SELECT },
    );
    assert.equal(migrations.length, 1, "CGP-IMP-05A migration must exist exactly once");

    const accounts = await models.sequelize.query(`SELECT a.*, p.code AS parent_code, p.name AS parent_name
      FROM accounts a JOIN accounts p ON p.id=a.parent_id
      WHERE a.code='2500' AND a.name='Customer Creditors'`, { type: QueryTypes.SELECT });
    assert.equal(accounts.length, 1, "Customer Creditor account must exist exactly once");
    const account = accounts[0];
    assert.equal(account.parent_code, "2000");
    assert.equal(account.parent_name, "Liabilities");
    assert.equal(account.type, "liability");
    assert.equal(account.nature, "credit");
    assert.equal(account.statement_classification, "liability");
    assert.equal(account.is_active, true);
    assert.equal(account.is_posting, true);

    const branches = await models.Branch.findAll({ where: { companyId: account.company_id, isActive: true }, order: [["id", "ASC"]] });
    assert.ok(branches.length > 0, "Customer Creditor requires an active operational branch context");
    for (const branch of branches) {
      const roleRows = await models.SystemAccountRole.findAll({ where: { companyId: account.company_id, branchId: branch.id, roleCode: ROLE } });
      assert.equal(roleRows.length, 1, "Customer Creditor role mapping must be unambiguous per branch context");
      assert.equal(roleRows[0].accountId, account.id);
      const resolved = await resolveRequiredSemanticAccount({ companyId: account.company_id, branchId: branch.id, roleCode: ROLE });
      assert.equal(resolved.id, account.id);
    }

    for (const roleCode of ["INVENTORY_ASSET", "SUPPLIER_PAYABLE", "CUSTOMER_DEPOSIT_LIABILITY"]) {
      const rows = await models.SystemAccountRole.findAll({ where: { companyId: account.company_id, roleCode } });
      assert.ok(rows.length >= 1, `${roleCode} must retain its existing canonical mapping`);
      assert.ok(rows.every((row) => row.accountId !== account.id), `${roleCode} must not share Customer Creditor authority`);
    }

    const after = (await models.sequelize.query(`SELECT
      (SELECT count(*)::int FROM journal_entries) AS journals,
      (SELECT count(*)::int FROM journal_lines) AS journal_lines,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM processed_events WHERE consumer_name='ACCOUNTING') AS accounting_receipts,
      (SELECT count(*)::int FROM integration_statuses WHERE consumer_name='ACCOUNTING') AS accounting_integrations,
      (SELECT count(*)::int FROM outbox_events WHERE event_type='CustomerGoldPurchasePostedEvent' AND status<>'PENDING') AS dispatched_cgp_events`, { type: QueryTypes.SELECT }))[0];
    assert.deepEqual(after, before, "CGP-IMP-05A verifier must not create financial, asset, receipt, or event effects");

    console.log("CGP_IMP_05A_CONFIG_VERIFIER: PASS");
    console.log("CUSTOMER_CREDITOR_RESOLVER: PASS");
    console.log("CGP_IMP_05A_NO_FINANCIAL_SIDE_EFFECTS: PASS");
  } finally {
    await models.sequelize.close();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
