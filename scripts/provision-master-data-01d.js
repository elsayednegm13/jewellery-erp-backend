"use strict";

require("dotenv").config();
const { QueryTypes } = require("sequelize");
const models = require("../src/models");
const profileMasterData = require("../src/services/profile-master-data.service");
const pearlSizes = require("../src/services/pearl-size-master-data.service");
const masterPolicy = require("../src/services/inventory-master-data-policy.service");
const { DEFAULT_BARCODE_INVENTORY_CODES, DEFAULT_BARCODE_ITEM_CODES } = require("../src/config/barcode-defaults");

const CLONE_PREFIX = "darfus_erp_master_data_01d_";
const EXECUTE = process.argv.includes("--execute");

function refusal(message) {
  const error = new Error(`MASTER_DATA_01D_PROVISIONING_REFUSED: ${message}`);
  error.code = "MASTER_DATA_01D_PROVISIONING_REFUSED";
  throw error;
}

function assertSafeTargetName(database = process.env.DB_NAME) {
  const name = String(database || "").trim();
  if (!name || name === "darfus_erp") refusal("official persistent database is never a provisioning target");
  if (!name.startsWith(CLONE_PREFIX)) refusal(`DB_NAME must start with ${CLONE_PREFIX}`);
  if (!/^[a-z0-9_]+$/.test(name)) refusal("DB_NAME contains unsupported characters");
  return name;
}

async function currentDatabase() {
  const [row] = await models.sequelize.query("SELECT current_database() AS database", { type: QueryTypes.SELECT });
  return row?.database || null;
}

async function assertRuntimeTarget() {
  const expected = assertSafeTargetName();
  const actual = await currentDatabase();
  if (actual !== expected) refusal(`same-process database is ${actual || "unknown"}, expected ${expected}`);
  return actual;
}

async function planCompany(companyId, transaction = null) {
  const profileCount = Number((await models.sequelize.query("SELECT COUNT(*)::int AS count FROM profile_master_data WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }))[0].count);
  const pearlCount = Number((await models.sequelize.query("SELECT COUNT(*)::int AS count FROM pearl_size_master_data WHERE company_id=:companyId AND unit='MM'", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }))[0].count);
  const inventoryCount = Number((await models.sequelize.query("SELECT COUNT(*)::int AS count FROM barcode_inventory_codes WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }))[0].count);
  const itemCount = Number((await models.sequelize.query("SELECT COUNT(*)::int AS count FROM barcode_item_codes WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }))[0].count);
  return { companyId, existing: { profileMasterData: profileCount, pearlSizes: pearlCount, barcodeInventoryCodes: inventoryCount, barcodeItemCodes: itemCount }, planned: { profileRows: masterPolicy.initialRows().length, pearlSizes: pearlSizes.INITIAL_VALUES.length, barcodeInventoryCodes: DEFAULT_BARCODE_INVENTORY_CODES.length, barcodeItemCodes: DEFAULT_BARCODE_ITEM_CODES.length }, locations: "OWNER_CONFIG_REQUIRED_NOT_SEEDED", settings: "OWNER_CONFIG_REQUIRED_NOT_SEEDED" };
}

async function ensureBarcodeRows(companyId, transaction) {
  let inventoryCreated = 0;
  for (const row of DEFAULT_BARCODE_INVENTORY_CODES) {
    const [inserted] = await models.sequelize.query(`INSERT INTO barcode_inventory_codes
      (id,company_id,code,display_name,asset_type,description,is_active,is_client_approved,is_provisional,requires_karat,default_karat_code,default_item_code,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES (:id,:companyId,:code,:displayName,:assetType,:description,:isActive,:isClientApproved,:isProvisional,:requiresKarat,:defaultKaratCode,:defaultItemCode,:sortOrder,'01D_CLONE_PROVISIONER','01D_CLONE_PROVISIONER',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT (company_id,code) DO NOTHING RETURNING id`, { replacements: { id: `${companyId}:INV:${row.code}`, companyId, ...row, defaultKaratCode: row.defaultKaratCode || null, defaultItemCode: row.defaultItemCode || null }, transaction });
    inventoryCreated += inserted.length;
  }
  let itemCreated = 0;
  for (const row of DEFAULT_BARCODE_ITEM_CODES) {
    const [inserted] = await models.sequelize.query(`INSERT INTO barcode_item_codes
      (id,company_id,code,display_name,description,is_active,is_client_approved,is_provisional,allowed_inventory_codes,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES (:id,:companyId,:code,:displayName,:description,:isActive,:isClientApproved,:isProvisional,CAST(:allowedInventoryCodes AS jsonb),:sortOrder,'01D_CLONE_PROVISIONER','01D_CLONE_PROVISIONER',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT (company_id,code) DO NOTHING RETURNING id`, { replacements: { id: `${companyId}:ITEM:${row.code}`, companyId, ...row, allowedInventoryCodes: JSON.stringify(row.allowedInventoryCodes) }, transaction });
    itemCreated += inserted.length;
  }
  return { inventoryCreated, itemCreated };
}

async function provisionCompany(companyId, transaction) {
  let profileCreated = 0;
  for (const row of masterPolicy.initialRows()) {
    const result = await profileMasterData.create({ models, companyId, category: row.category, value: row.value, actorId: "01D_CLONE_PROVISIONER", transaction });
    if (result.created) profileCreated += 1;
  }
  let pearlCreated = 0;
  for (const value of pearlSizes.INITIAL_VALUES) {
    const result = await pearlSizes.create({ models, companyId, value: value.toFixed(1), actorId: "01D_CLONE_PROVISIONER", transaction, initial: true });
    if (result.created) pearlCreated += 1;
  }
  const barcode = await ensureBarcodeRows(companyId, transaction);
  return { companyId, profileCreated, pearlCreated, ...barcode, sequencesCreated: 0, locationsCreated: 0, settingsCreated: 0 };
}

async function main() {
  const database = await assertRuntimeTarget();
  if (EXECUTE && String(process.env.ALLOW_01D_MASTER_DATA_PROVISIONING || "") !== "YES") refusal("--execute requires ALLOW_01D_MASTER_DATA_PROVISIONING=YES");
  const companies = await models.sequelize.query("SELECT id FROM companies ORDER BY id", { type: QueryTypes.SELECT });
  if (!companies.length) refusal("clone has no company scope");
  if (!EXECUTE) {
    console.log(JSON.stringify({ batch: "01D", mode: "DRY_RUN", database, companies: await Promise.all(companies.map((company) => planCompany(company.id))) }));
    return;
  }
  const result = await models.sequelize.transaction(async (transaction) => {
    await assertRuntimeTarget();
    const applied = [];
    for (const company of companies) applied.push(await provisionCompany(company.id, transaction));
    return { applied };
  });
  console.log(JSON.stringify({ batch: "01D", mode: "EXECUTE", database, ...result }));
}

module.exports = { CLONE_PREFIX, assertSafeTargetName, planCompany, provisionCompany };

if (require.main === module) {
  main().catch((error) => { console.error(JSON.stringify({ result: "FAIL", code: error.code || "UNEXPECTED", message: error.message })); process.exitCode = 1; }).finally(() => models.sequelize.close());
}
