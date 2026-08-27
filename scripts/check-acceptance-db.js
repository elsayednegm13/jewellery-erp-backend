"use strict";
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });
delete process.env.DATABASE_URL;
process.env.DB_NAME = "darfus_erp_inventory_rehearsal_20260804_160500z";
const sequelize = require("../src/config/database");

async function main() {
  await sequelize.authenticate();
  const [[row]] = await sequelize.query("SELECT current_database() AS db");
  console.log("Connected DB:", row.db);
  if (row.db !== "darfus_erp_inventory_rehearsal_20260804_160500z") {
    throw new Error("WRONG DB: " + row.db);
  }
  const [[counts]] = await sequelize.query(`SELECT
    (SELECT COUNT(*)::int FROM assets) AS assets,
    (SELECT COUNT(*)::int FROM products) AS products,
    (SELECT ROUND(SUM(amount)::numeric, 4) FROM cash_transactions WHERE account='cash' AND status='posted' AND type!='closing') AS cash,
    (SELECT ROUND(SUM(amount)::numeric, 4) FROM cash_transactions WHERE account='bank' AND status='posted' AND type!='closing') AS bank,
    (SELECT COUNT(*)::int FROM journal_entries WHERE status='draft') AS open_journals`);
  console.log(JSON.stringify(counts, null, 2));
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => sequelize.close());
