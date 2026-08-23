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

  // Check barcode_inventory_codes for gold-piece
  const [codes] = await sequelize.query(`
    SELECT i.code AS inv_code, i.asset_type, m.code AS item_code, m.allowed_inventory_codes
    FROM barcode_inventory_codes i
    JOIN barcode_item_codes m ON m.is_active=true
      AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
    WHERE i.asset_type = 'gold-piece' AND i.is_active = true
    LIMIT 5
  `);
  console.log("Gold-piece barcode codes:", JSON.stringify(codes));

  // Check existing GOLD_BY_PIECE asset origins
  const [origins] = await sequelize.query(`
    SELECT a.id, a.status, apcr.total_purchase_cost, acv.total_value AS current_val,
      app.markup_percent, app.maximum_discount_percent, app.strategy_code
    FROM assets a
    JOIN asset_purchase_cost_revisions apcr ON apcr.asset_id = a.id AND apcr.is_current = true
    JOIN asset_current_valuations acv ON acv.asset_id = a.id
    JOIN asset_pricing_policies app ON app.asset_id = a.id
    WHERE a.inventory_profile = 'GOLD_BY_PIECE'
    AND a.status = 'available'
    LIMIT 3
  `);
  console.log("Existing GBP assets with full evidence:", JSON.stringify(origins, null, 2));

  // Check a company setup
  const [companies] = await sequelize.query(`
    SELECT c.id, c.name, b.id AS branch_id, b.name AS branch_name,
      s.id AS supplier_id, cust.id AS customer_id
    FROM companies c
    JOIN branches b ON b.company_id = c.id
    JOIN suppliers s ON s.company_id = c.id
    JOIN customers cust ON cust.company_id = c.id
    LIMIT 1
  `);
  console.log("Company setup:", JSON.stringify(companies[0], null, 2));
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; }).finally(() => sequelize.close());
