"use strict";
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });
delete process.env.DATABASE_URL;
process.env.DB_NAME = "darfus_erp_inventory_rehearsal_20260804_160500z";
const sequelize = require("../src/config/database");

async function main() {
  await sequelize.authenticate();
  const [[dbRow]] = await sequelize.query("SELECT current_database() AS db");
  console.log("DB:", dbRow.db);
  if (dbRow.db !== "darfus_erp_inventory_rehearsal_20260804_160500z") throw new Error("WRONG DB");

  // Find GOLD_BY_PIECE available assets
  const [assets] = await sequelize.query(`
    SELECT a.id, a.inventory_profile, a.status, a.branch_id, a.company_id,
      pp.markup_percent, pp.maximum_discount_percent, pp.minimum_selling_price, pp.strategy_code,
      acv.total_value AS current_total_cost
    FROM assets a
    LEFT JOIN asset_pricing_policies pp ON pp.asset_id = a.id
    LEFT JOIN asset_current_valuations acv ON acv.asset_id = a.id
    WHERE a.inventory_profile = 'GOLD_BY_PIECE' AND a.status = 'available'
    LIMIT 5
  `);
  console.log("GOLD_BY_PIECE available assets:", assets.length);
  assets.forEach(a => console.log(JSON.stringify(a)));

  // Show all GOLD_BY_PIECE counts
  const [[counts]] = await sequelize.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='available')::int AS available,
      COUNT(*) FILTER (WHERE status='sold')::int AS sold
    FROM assets WHERE inventory_profile='GOLD_BY_PIECE'
  `);
  console.log("GOLD_BY_PIECE counts:", JSON.stringify(counts));
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; }).finally(() => sequelize.close());
