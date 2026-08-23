"use strict";
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });
delete process.env.DATABASE_URL;
process.env.DB_NAME = "darfus_erp_inventory_rehearsal_20260804_160500z";
const sequelize = require("../src/config/database");

async function main() {
  await sequelize.authenticate();
  
  // Check invoice_items columns
  const [cols] = await sequelize.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'invoice_items' ORDER BY ordinal_position LIMIT 20
  `);
  console.log("invoice_items columns:", cols.map(c => c.column_name).join(", "));
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; }).finally(() => sequelize.close());
