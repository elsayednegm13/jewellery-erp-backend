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

  // Check company
  const [co] = await sequelize.query(`
    SELECT id FROM companies LIMIT 1
  `);
  console.log("Company:", JSON.stringify(co[0]));

  // Batch 2B scope query (working)
  const [scope] = await sequelize.query(`
    SELECT c.id AS "companyId", b.id AS "branchId", s.id AS "supplierId",
      i.code AS "inventoryCode", m.code AS "itemCode", cust.id AS "customerId"
    FROM companies c
    JOIN branches b ON b.company_id=c.id AND b.name='Main Branch'
    JOIN suppliers s ON s.company_id=c.id
    JOIN customers cust ON cust.company_id=c.id
    JOIN barcode_inventory_codes i ON i.asset_type='gold-weight' AND i.is_active=true
    JOIN barcode_item_codes m ON m.is_active=true
      AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
    ORDER BY s.id,m.code LIMIT 1
  `);
  console.log("Batch 2B scope:", JSON.stringify(scope[0]));

  // Gold-piece scope query
  const [gbpScope] = await sequelize.query(`
    SELECT c.id AS "companyId", b.id AS "branchId", s.id AS "supplierId",
      i.code AS "inventoryCode", m.code AS "itemCode", cust.id AS "customerId"
    FROM companies c
    JOIN branches b ON b.company_id=c.id AND b.name='Main Branch'
    JOIN suppliers s ON s.company_id=c.id
    JOIN customers cust ON cust.company_id=c.id
    JOIN barcode_inventory_codes i ON i.asset_type='gold-piece' AND i.is_active=true
    JOIN barcode_item_codes m ON m.is_active=true
      AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
    ORDER BY s.id,m.code LIMIT 1
  `);
  console.log("Gold-piece scope:", JSON.stringify(gbpScope[0]));
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; }).finally(() => sequelize.close());
