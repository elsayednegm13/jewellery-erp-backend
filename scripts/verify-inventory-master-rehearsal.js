"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const { QueryTypes } = require("sequelize");
const sequelize = require("../src/config/database");
const policy = require("../src/services/inventory-master-policy.service");
const treasury = require("../src/services/account-balance.service");

const EXPECTED_DB = process.env.INVENTORY_REHEARSAL_DB;
const passes = [];
const pass = (name) => passes.push(name);
const q = (sql, options = {}) => sequelize.query(sql, { type: QueryTypes.SELECT, ...options });
const one = async (sql, options = {}) => (await q(sql, options))[0];

async function expectDatabaseReject(name, sql, replacements = {}) {
  const transaction = await sequelize.transaction();
  let rejected = false;
  try {
    await sequelize.query(sql, { replacements, transaction });
  } catch {
    rejected = true;
  } finally {
    await transaction.rollback();
  }
  assert.equal(rejected, true, `${name} was accepted unexpectedly`);
  pass(name);
}

async function expectTransactionReject(name, operation) {
  const transaction = await sequelize.transaction();
  let rejected = false;
  try {
    await operation(transaction);
  } catch {
    rejected = true;
  } finally {
    await transaction.rollback();
  }
  assert.equal(rejected, true, `${name} was accepted unexpectedly`);
  pass(name);
}

async function financialSnapshot() {
  return one(`SELECT
    (SELECT COUNT(*)::int FROM journal_entries) AS journals,
    (SELECT COUNT(*)::int FROM journal_lines) AS journal_lines,
    (SELECT COALESCE(SUM(debit::numeric),0)::text FROM journal_lines) AS debit,
    (SELECT COALESCE(SUM(credit::numeric),0)::text FROM journal_lines) AS credit,
    (SELECT COUNT(*)::int FROM cash_transactions) AS cash_transactions,
    (SELECT COUNT(*)::int FROM cash_register_sessions WHERE status='OPEN') AS open_sessions`);
}

async function main() {
  assert.ok(EXPECTED_DB && EXPECTED_DB.startsWith("darfus_erp_inventory_rehearsal_"), "INVENTORY_REHEARSAL_DB must be an explicit disposable name");
  assert.notEqual(EXPECTED_DB, "darfus_erp");
  await sequelize.authenticate();
  const identity = await one("SELECT current_database() AS database, current_schema() AS schema");
  assert.deepEqual(identity, { database: EXPECTED_DB, schema: "public" });
  pass("DISPOSABLE_DB_IDENTITY");

  const migrations = await one(`SELECT
    (SELECT COUNT(*)::int FROM "SequelizeMeta") AS total,
    (SELECT COUNT(*)::int FROM "SequelizeMeta" WHERE name LIKE '20260804%inventory%') AS inventory`);
  assert.deepEqual(migrations, { total: 57, inventory: 5 });
  pass("MIGRATION_SEQUENCE_57_57_0");

  const requiredTables = [
    "inventory_locations", "asset_origins", "asset_gold_details", "asset_components",
    "asset_diamond_component_details", "asset_gemstone_component_details", "asset_pearl_component_details",
    "asset_purchase_cost_revisions", "asset_current_valuations", "asset_pricing_policies",
    "asset_rfid_assignments", "rfid_scan_events", "asset_tag_print_events",
    "purchase_order_item_asset_links", "invoice_item_asset_links", "transfer_items",
    "inventory_workshop_orders", "inventory_workshop_items", "manufacturing_order_inputs",
    "manufacturing_order_outputs", "asset_lineage_links", "asset_missing_cases",
    "inventory_adjustments", "inventory_adjustment_items", "inventory_asset_movements",
    "cgp_item_dispositions", "legacy_product_asset_map", "inventory_saved_views",
  ];
  const tables = await q("SELECT table_name,table_schema FROM information_schema.tables WHERE table_schema='public'");
  const tableSet = new Set(tables.map((row) => row.table_name));
  assert.deepEqual(requiredTables.filter((table) => !tableSet.has(table)), []);
  pass("REQUIRED_SCHEMA_FOUNDATION");

  const profiles = await q("SELECT inventory_profile,COUNT(*)::int AS count FROM assets GROUP BY inventory_profile ORDER BY inventory_profile");
  assert.deepEqual(profiles, [{ inventory_profile: "GOLD_BY_WEIGHT_JEWELLERY", count: 50 }]);
  const backfill = await one(`SELECT
    COUNT(*)::int AS assets,
    COUNT(branch_id)::int AS branch_mapped,
    COUNT(location_id)::int AS location_mapped,
    COUNT(*) FILTER(WHERE condition IS NULL)::int AS condition_unknown,
    COUNT(*) FILTER(WHERE condition IS NOT NULL)::int AS condition_known,
    (SELECT COUNT(*)::int FROM asset_gold_details) AS gold_details,
    (SELECT COUNT(*)::int FROM asset_components) AS components,
    (SELECT COUNT(*)::int FROM asset_purchase_cost_revisions) AS cost_revisions,
    (SELECT COUNT(*)::int FROM asset_origins) AS origins,
    (SELECT COUNT(*)::int FROM asset_rfid_assignments WHERE is_current) AS current_rfid,
    (SELECT COUNT(*)::int FROM purchase_order_item_asset_links) AS po_links,
    (SELECT COUNT(*)::int FROM invoice_item_asset_links) AS invoice_links
    FROM assets`);
  assert.deepEqual(backfill, { assets: 50, branch_mapped: 50, location_mapped: 50, condition_unknown: 50, condition_known: 0, gold_details: 50, components: 0, cost_revisions: 50, origins: 50, current_rfid: 0, po_links: 50, invoice_links: 6 });
  pass("DETERMINISTIC_BACKFILL_COUNTS");

  const products = await q("SELECT classification,mapping_status,COUNT(*)::int AS count FROM legacy_product_asset_map GROUP BY classification,mapping_status");
  assert.deepEqual(products, [{ classification: "D", mapping_status: "PRESERVED_UNMAPPED", count: 3 }]);
  const linkedProducts = await one("SELECT COUNT(*)::int AS count FROM legacy_product_asset_map WHERE asset_id IS NOT NULL");
  assert.equal(linkedProducts.count, 0);
  pass("LEGACY_PRODUCTS_D_PRESERVED_UNMAPPED");

  const sourceLinks = await q("SELECT classification,COUNT(*)::int AS count FROM inventory_source_link_classifications WHERE source_table='invoice_items' GROUP BY classification ORDER BY classification");
  assert.deepEqual(sourceLinks, [
    { classification: "ASSET_LINK_PROVEN", count: 6 },
    { classification: "PRODUCT_LINK_LEGACY", count: 6 },
  ]);
  pass("INVOICE_ASSET_PRODUCT_IDENTITY_PRESERVED");

  const integrity = await one(`SELECT
    (SELECT COUNT(*)::int FROM (SELECT barcode FROM assets GROUP BY barcode HAVING COUNT(*)>1)d) AS duplicate_barcode,
    (SELECT COUNT(*)::int FROM (SELECT rfid_number FROM asset_rfid_assignments GROUP BY rfid_number HAVING COUNT(*)>1)d) AS duplicate_rfid,
    (SELECT COUNT(*)::int FROM (SELECT asset_id FROM asset_rfid_assignments WHERE is_current GROUP BY asset_id HAVING COUNT(*)>1)d) AS duplicate_current_rfid,
    (SELECT COUNT(*)::int FROM assets WHERE branch_id IS NULL) AS branch_missing,
    (SELECT COUNT(*)::int FROM assets WHERE inventory_profile IS NULL) AS profile_missing,
    (SELECT COUNT(*)::int FROM assets WHERE operational_status IS NULL) AS status_missing,
    (SELECT COUNT(*)::int FROM asset_components WHERE component_count<1) AS bad_component,
    (SELECT COUNT(*)::int FROM (SELECT asset_id FROM asset_purchase_cost_revisions WHERE is_current GROUP BY asset_id HAVING COUNT(*)>1)d) AS multiple_current_cost,
    (SELECT COUNT(*)::int FROM inventory_asset_movements m LEFT JOIN assets a ON a.id=m.asset_id WHERE a.id IS NULL) AS movement_orphan,
    (SELECT COUNT(*)::int FROM purchase_order_item_asset_links l LEFT JOIN assets a ON a.id=l.asset_id LEFT JOIN purchase_order_items p ON p.id=l.purchase_order_item_id WHERE a.id IS NULL OR p.id IS NULL) AS po_link_orphan,
    (SELECT COUNT(*)::int FROM invoice_item_asset_links l LEFT JOIN assets a ON a.id=l.asset_id LEFT JOIN invoice_items i ON i.id=l.invoice_item_id WHERE a.id IS NULL OR i.id IS NULL) AS invoice_link_orphan,
    (SELECT COUNT(*)::int FROM journal_entries je JOIN (SELECT journal_entry_id,SUM(debit::numeric) d,SUM(credit::numeric)c FROM journal_lines GROUP BY journal_entry_id)x ON x.journal_entry_id=je.id WHERE je.status='posted' AND x.d<>x.c) AS unbalanced_journals`);
  assert.ok(Object.values(integrity).every((value) => value === 0), JSON.stringify(integrity));
  pass("ORPHAN_CONSTRAINT_FINANCIAL_INTEGRITY_ZERO");

  const quantityLeak = await one(`SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('assets','asset_components','inventory_asset_movements','transfer_items','inventory_adjustment_items') AND column_name ILIKE '%quantity%'`);
  assert.equal(quantityLeak.count, 0);
  pass("NO_TARGET_INVENTORY_QUANTITY_COLUMNS");

  policy.assertPieceBasedPayload({ assetId: "A", documentQuantity: 10 });
  assert.throws(() => policy.assertPieceBasedPayload({ assetId: "A", quantity: 10 }), /INVENTORY_STOCK_QUANTITY_FORBIDDEN/);
  assert.throws(() => policy.assertPieceBasedPayload({ assetId: "A", quantityOnHand: 10 }), /INVENTORY_STOCK_QUANTITY_FORBIDDEN/);
  assert.equal(policy.validateComponent({ role: "EMBEDDED", componentCount: 20 }), 20);
  assert.throws(() => policy.validateComponent({ role: "EMBEDDED", componentCount: 0 }), /INVALID/);
  assert.throws(() => policy.validateComponent({ role: "EMBEDDED", componentCount: "1.5" }), /INVALID/);
  assert.throws(() => policy.validateComponent({ role: "PRIMARY_SUBJECT", componentCount: 2 }), /MULTI_PIECE/);
  pass("PIECE_AND_COMPONENT_POLICY_NEGATIVES");

  assert.equal(policy.validateCondition("GOLD_BAR_24K", null), null);
  assert.throws(() => policy.validateCondition("GOLD_BAR_24K", "NEW"), /NOT_APPLICABLE/);
  assert.throws(() => policy.validateCondition("GOLD_BY_PIECE", null), /REQUIRED/);
  assert.equal(policy.validateCondition("GOLD_BY_PIECE", "used"), "USED");
  pass("PROFILE_CONTROLLED_CONDITION_POLICY");

  assert.deepEqual(policy.calculateGoldWeights({ grossWeight: "10.25000000", stoneWeight: "1.52500000", karat: "21" }), {
    grossWeight: "10.25000000", stoneWeight: "1.52500000", netGoldWeight: "8.72500000",
    karat: "21.000000", purityRatio: "0.87500000", pureGold9999: "7.63437500",
  });
  const bar = policy.priceAsset("BAR_CERTIFICATE_STRATEGY", { goldValue: "100000", certificateCharge: "1000", minimumCertificateCharge: "1200", vatRate: "15" });
  assert.deepEqual(bar, { vatBase: "1000.00000000", vatRate: "15.000000", vatAmount: "150.00000000", goldVatBaseContribution: "0.00000000", total: "101150.00000000", approvalRequired: true });
  assert.equal(policy.priceAsset("WEIGHT_BASED_MAKING_STRATEGY", { goldValue: 1000, netGoldWeight: 5, makingPerGram: 8, minimumMakingPerGram: 10 }).approvalRequired, true);
  assert.equal(policy.priceAsset("PIECE_MARKUP_STRATEGY", { purchaseCost: 1000, markupPercent: 20, discountPercent: 15, maximumDiscountPercent: 10, minimumSellingPrice: 1000 }).approvalRequired, true);
  assert.throws(() => policy.priceAsset("GENERIC_FALLBACK", {}), /UNSUPPORTED/);
  pass("DECIMAL_WEIGHT_VAT_PRICING_STRATEGIES");

  const sample = await one("SELECT id,company_id,branch_id,location_id,barcode FROM assets ORDER BY id LIMIT 1");
  const second = await one("SELECT id FROM assets WHERE id<>:id ORDER BY id LIMIT 1", { replacements: { id: sample.id } });
  await expectDatabaseReject("GLOBAL_BARCODE_DUPLICATE_REJECTED", `INSERT INTO assets SELECT (jsonb_populate_record(NULL::assets,to_jsonb(a)||jsonb_build_object('id','REH-BARCODE-DUP','created_at',now(),'updated_at',now()))).* FROM assets a WHERE id=:id`, { id: sample.id });
  await expectDatabaseReject("BARCODE_UPDATE_REJECTED", "UPDATE assets SET barcode='REH-BARCODE-CHANGED' WHERE id=:id", { id: sample.id });
  await expectDatabaseReject("ASSET_HARD_DELETE_REJECTED", "DELETE FROM assets WHERE id=:id", { id: sample.id });
  await expectDatabaseReject("COMPONENT_ZERO_REJECTED", "INSERT INTO asset_components(id,asset_id,company_id,role,component_kind,sequence,component_count,mapping_classification) VALUES('REH-COMP-0',:asset,:company,'EMBEDDED','PEARL',901,0,'TEST')", { asset: sample.id, company: sample.company_id });
  await expectDatabaseReject("LOOSE_PRIMARY_MULTI_PIECE_REJECTED", "INSERT INTO asset_components(id,asset_id,company_id,role,component_kind,sequence,component_count,mapping_classification) VALUES('REH-COMP-P',:asset,:company,'PRIMARY_SUBJECT','DIAMOND',903,2,'TEST')", { asset: sample.id, company: sample.company_id });
  await expectDatabaseReject("CONDITION_REQUIRED_REJECTED", "UPDATE assets SET inventory_profile='GOLD_BY_PIECE',condition=NULL WHERE id=:id", { id: sample.id });
  await expectDatabaseReject("CONDITION_NOT_APPLICABLE_REJECTED", "UPDATE assets SET inventory_profile='GOLD_BAR_24K',condition='NEW' WHERE id=:id", { id: sample.id });
  await expectDatabaseReject("ASSET_HISTORY_UPDATE_REJECTED", "UPDATE asset_events SET note=coalesce(note,'')||'x' WHERE id=(SELECT id FROM asset_events LIMIT 1)");

  await expectTransactionReject("RFID_GLOBAL_REUSE_REJECTED", async (transaction) => {
    await sequelize.query("INSERT INTO asset_rfid_assignments(id,asset_id,company_id,branch_id,rfid_number,status,is_current,assigned_at,mapping_classification) VALUES('REH-RFID-1',:a,:c,:b,'REH-RFID-GLOBAL','ACTIVE',true,now(),'TEST')", { replacements: { a: sample.id, c: sample.company_id, b: sample.branch_id }, transaction });
    await sequelize.query("INSERT INTO asset_rfid_assignments(id,asset_id,company_id,branch_id,rfid_number,status,is_current,assigned_at,mapping_classification) VALUES('REH-RFID-2',:a,:c,:b,'REH-RFID-GLOBAL','ACTIVE',true,now(),'TEST')", { replacements: { a: second.id, c: sample.company_id, b: sample.branch_id }, transaction });
  });
  await expectTransactionReject("RFID_ONE_CURRENT_REJECTED", async (transaction) => {
    await sequelize.query("INSERT INTO asset_rfid_assignments(id,asset_id,company_id,branch_id,rfid_number,status,is_current,assigned_at,mapping_classification) VALUES('REH-RFID-3',:a,:c,:b,'REH-RFID-ONE','ACTIVE',true,now(),'TEST')", { replacements: { a: sample.id, c: sample.company_id, b: sample.branch_id }, transaction });
    await sequelize.query("INSERT INTO asset_rfid_assignments(id,asset_id,company_id,branch_id,rfid_number,status,is_current,assigned_at,mapping_classification) VALUES('REH-RFID-4',:a,:c,:b,'REH-RFID-TWO','ACTIVE',true,now(),'TEST')", { replacements: { a: sample.id, c: sample.company_id, b: sample.branch_id }, transaction });
  });

  const compatibilityTransaction = await sequelize.transaction();
  try {
    await sequelize.query(`INSERT INTO assets SELECT (jsonb_populate_record(NULL::assets,to_jsonb(a)||jsonb_build_object('id','REH-COMPAT-ASSET','barcode','REHCOMPAT000001','barcode_serial',NULL,'inventory_profile',NULL,'operational_status',NULL,'condition',NULL,'tag_state',NULL,'created_at',now(),'updated_at',now()))).* FROM assets a WHERE id=:id`, { replacements: { id: sample.id }, transaction: compatibilityTransaction });
    const compatible = await one("SELECT inventory_profile,operational_status,condition,tag_state,location_id FROM assets WHERE id='REH-COMPAT-ASSET'", { transaction: compatibilityTransaction });
    assert.deepEqual(compatible, { inventory_profile: "GOLD_BY_WEIGHT_JEWELLERY", operational_status: "AVAILABLE", condition: null, tag_state: "PENDING", location_id: sample.location_id || null });
    pass("LEGACY_ASSET_INSERT_COMPATIBILITY");
  } finally { await compatibilityTransaction.rollback(); }

  const list = await one("SELECT COUNT(*)::int AS pieces FROM assets WHERE company_id=:company AND branch_id=:branch AND inventory_profile='GOLD_BY_WEIGHT_JEWELLERY'", { replacements: { company: sample.company_id, branch: sample.branch_id } });
  assert.equal(list.pieces, 50);
  pass("ALL_ITEMS_COUNTS_ASSET_ROWS");

  const beforeFinancial = await financialSnapshot();
  const scopes = await q("SELECT DISTINCT company_id AS \"companyId\",branch_id AS \"branchId\" FROM branch_financial_mappings WHERE mapping_type IN ('CASH_TREASURY','BANK_ACCOUNT') AND is_active=true");
  assert.equal(scopes.length, 1);
  const financial = await treasury.calculateTreasuryLedgerSummary(scopes[0]);
  assert.equal(financial.cash, 13184.773);
  assert.equal(financial.bank, -28.865);
  assert.deepEqual(financial.mirrorDifferences, { cash: 0, bank: 0 });
  const afterFinancial = await financialSnapshot();
  assert.deepEqual(afterFinancial, beforeFinancial);
  assert.equal(afterFinancial.open_sessions, 1);
  pass("FINANCIAL_BASELINE_AND_OPEN_SESSION_PRESERVED");

  console.log(JSON.stringify({ result: "PASS", database: identity.database, passes: passes.length, checks: passes, backfill, profiles, products, sourceLinks, integrity, financial }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ result: "FAIL", passes: passes.length, lastPass: passes.at(-1) || null, error: error.stack || error.message }, null, 2));
  process.exitCode = 1;
}).finally(async () => { await sequelize.close(); });
