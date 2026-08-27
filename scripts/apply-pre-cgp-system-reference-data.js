"use strict";

// CONT47 controlled local apply.  This is intentionally narrower than a seed:
// it can add only the owner-approved initial Pearl Size master-data values to
// the explicitly selected persistent database.  It never reads acceptance,
// never runs migrations, and defaults to a read-only plan.
const { QueryTypes } = require("sequelize");

const PERSISTENT_DATABASE = "darfus_erp";
const EXECUTE = process.argv.includes("--execute");

function fail(message) {
  const error = new Error(`CONTROLLED_PRE_CGP_APPLY_REFUSED: ${message}`);
  error.code = "CONTROLLED_PRE_CGP_APPLY_REFUSED";
  throw error;
}

function assertExplicitPersistentTarget() {
  if (String(process.env.DB_NAME || "").trim() !== PERSISTENT_DATABASE) {
    fail("DB_NAME must explicitly equal the approved persistent database");
  }
  if (String(process.env.DATABASE_URL || "").trim()) {
    fail("DATABASE_URL is not allowed for this local controlled apply");
  }
  if (String(process.env.NODE_ENV || "development").trim().toLowerCase() !== "development") {
    fail("NODE_ENV must be development for this local controlled apply");
  }
}

async function requireCurrentDatabase(sequelize) {
  const row = (await sequelize.query("SELECT current_database() AS database", { type: QueryTypes.SELECT }))[0];
  if (row?.database !== PERSISTENT_DATABASE) fail(`same-process target is ${row?.database || "unknown"}`);
  return row.database;
}

async function planForCompany({ sequelize, pearlSizes, companyId, transaction = null }) {
  const expected = pearlSizes.INITIAL_VALUES.map((value) => pearlSizes.normalizeValue(value.toFixed(1)).value);
  const rows = await sequelize.query(`SELECT value::text AS value, is_active AS "isActive",
      is_owner_approved_initial AS "isOwnerApprovedInitial"
    FROM pearl_size_master_data
    WHERE company_id=:companyId AND unit='MM' AND value IN (:expected)
    ORDER BY value${transaction ? " FOR UPDATE" : ""}`, {
    replacements: { companyId, expected }, type: QueryTypes.SELECT, transaction,
  });
  const byValue = new Map(rows.map((row) => [row.value, row]));
  const invalid = rows.filter((row) => !row.isActive || !row.isOwnerApprovedInitial).map((row) => row.value);
  if (invalid.length) fail(`existing initial Pearl Size rows require an update: ${invalid.join(",")}`);
  return { expected, missing: expected.filter((value) => !byValue.has(value)), existing: rows.length };
}

async function main() {
  assertExplicitPersistentTarget();
  const models = require("../src/models");
  const pearlSizes = require("../src/services/pearl-size-master-data.service");
  try {
    await requireCurrentDatabase(models.sequelize);
    const companies = await models.sequelize.query("SELECT id FROM companies ORDER BY id", { type: QueryTypes.SELECT });
    if (!companies.length) fail("no company is available for system reference data");

    if (!EXECUTE) {
      const plan = [];
      for (const company of companies) plan.push({ companyId: company.id, ...(await planForCompany({ sequelize: models.sequelize, pearlSizes, companyId: company.id })) });
      console.log(JSON.stringify({ mode: "DRY_RUN", database: PERSISTENT_DATABASE, pearlInitialExpectedPerCompany: 39, plan }));
      return;
    }

    const result = await models.sequelize.transaction(async (transaction) => {
      await requireCurrentDatabase(models.sequelize);
      // This lock makes the following plan and insert-only execution one
      // controlled unit, rather than a stale plan followed by a different write.
      await models.sequelize.query("LOCK TABLE pearl_size_master_data IN SHARE ROW EXCLUSIVE MODE", { transaction });
      const applied = [];
      for (const company of companies) {
        const plan = await planForCompany({ sequelize: models.sequelize, pearlSizes, companyId: company.id, transaction });
        for (const value of plan.missing) {
          const created = await pearlSizes.create({ models, companyId: company.id, value, actorId: "system:controlled-pre-cgp-apply", transaction, initial: true });
          if (!created.created) fail(`expected insert did not occur for Pearl Size ${value}`);
          applied.push(created.row.id);
        }
      }
      const verification = [];
      for (const company of companies) {
        const after = await planForCompany({ sequelize: models.sequelize, pearlSizes, companyId: company.id, transaction });
        if (after.missing.length) fail(`post-insert verification still has ${after.missing.length} missing Pearl Size values`);
        verification.push({ companyId: company.id, initialRows: after.existing });
      }
      return { insertedPearlSizeRows: applied.length, verification };
    });
    console.log(JSON.stringify({ mode: "EXECUTE", database: PERSISTENT_DATABASE, ...result }));
  } finally {
    await models.sequelize.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ result: "FAIL", code: error.code || "UNEXPECTED", message: error.message }));
  process.exitCode = 1;
});
