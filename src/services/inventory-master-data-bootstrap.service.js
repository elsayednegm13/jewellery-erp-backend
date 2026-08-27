"use strict";

const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { AppError, ConflictError } = require("../utils/errors");
const manifest = require("./inventory-master-data-manifest");
const pearlSizeMasterData = require("./pearl-size-master-data.service");
const profileMasterData = require("./profile-master-data.service");
const { DEFAULT_BARCODE_INVENTORY_CODES, DEFAULT_BARCODE_ITEM_CODES } = require("../config/barcode-defaults");
const auditService = require("./audit.service");

const STATES = Object.freeze({ IN_PROGRESS: "IN_PROGRESS", READY: "READY" });
const BASELINE_PROFILE_COUNT = manifest.DATASET_MANIFEST.baseline.profileMasterData;
const BASELINE_PEARL_COUNT = manifest.DATASET_MANIFEST.baseline.pearlSizes;
const BASELINE_INVENTORY_CODE_COUNT = manifest.DATASET_MANIFEST.baseline.barcodeInventoryCodes;
const BASELINE_ITEM_CODE_COUNT = manifest.DATASET_MANIFEST.baseline.barcodeItemCodes;

function stableId(category, canonicalValue) {
  const digest = crypto.createHash("sha256").update(`${manifest.DATASET_ID}|${manifest.CANONICAL_DATASET_VERSION}|${category}|${canonicalValue}`).digest("hex");
  return `PMD-R${manifest.CANONICAL_DATASET_VERSION}-${digest.slice(0, 26)}`;
}

const CURRENT_PROFILE_MASTER_DATA_ROWS = manifest.CURRENT_PROFILE_MASTER_DATA_ROWS || manifest.R1_PROFILE_MASTER_DATA_ROWS;

function stableStateId(companyId) {
  return `IMDBS-${String(companyId)}-${manifest.DATASET_ID}`;
}

function countByCategory(rows) {
  return rows.reduce((result, row) => {
    result[row.category] = (result[row.category] || 0) + 1;
    return result;
  }, {});
}

function validateManifest() {
  const seen = new Set();
  for (const row of CURRENT_PROFILE_MASTER_DATA_ROWS) {
    const key = `${row.category}|${row.canonicalValue}`;
    if (seen.has(key)) throw new ConflictError(`INVENTORY_MASTER_DATA_MANIFEST_DUPLICATE:${key}`);
    seen.add(key);
  }
  const inventoryCodes = manifest.DATASET_MANIFEST.barcodeInventoryCodes.map((row) => row.code);
  const itemCodes = manifest.DATASET_MANIFEST.barcodeItemCodes.map((row) => row.code);
  if (inventoryCodes.includes("WT") || itemCodes.includes("WCH")) throw new ConflictError("INVENTORY_MASTER_DATA_NONCANONICAL_BARCODE_CODE");
  if (manifest.DATASET_MANIFEST.gemstoneTreatmentInitialValues.length !== 0) throw new ConflictError("INVENTORY_MASTER_DATA_UNAPPROVED_TREATMENT_VALUES");
  if (manifest.V1_PROFILE_MASTER_DATA_ROWS.length !== BASELINE_PROFILE_COUNT) throw new ConflictError("INVENTORY_MASTER_DATA_BASELINE_MANIFEST_COUNT_MISMATCH");
  return { rowCount: CURRENT_PROFILE_MASTER_DATA_ROWS.length, categoryCounts: countByCategory(CURRENT_PROFILE_MASTER_DATA_ROWS) };
}

async function readBaseline({ models, companyId, transaction }) {
  const [profile, pearl, inventory, item, sequences] = await Promise.all([
    models.sequelize.query("SELECT COUNT(*)::int AS count FROM profile_master_data WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
    models.sequelize.query("SELECT COUNT(*)::int AS count FROM pearl_size_master_data WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
    models.sequelize.query("SELECT COUNT(*)::int AS count FROM barcode_inventory_codes WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
    models.sequelize.query("SELECT COUNT(*)::int AS count FROM barcode_item_codes WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
    models.sequelize.query("SELECT COUNT(*)::int AS count FROM barcode_sequences WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
  ]);
  return {
    profileMasterData: Number(profile[0]?.count || 0),
    pearlSizes: Number(pearl[0]?.count || 0),
    barcodeInventoryCodes: Number(inventory[0]?.count || 0),
    barcodeItemCodes: Number(item[0]?.count || 0),
    barcodeSequences: Number(sequences[0]?.count || 0),
  };
}

function baselineMatches(baseline) {
  return baseline.profileMasterData === BASELINE_PROFILE_COUNT
    && baseline.pearlSizes === BASELINE_PEARL_COUNT
    && baseline.barcodeInventoryCodes === BASELINE_INVENTORY_CODE_COUNT
    && baseline.barcodeItemCodes === BASELINE_ITEM_CODE_COUNT
    && baseline.barcodeSequences === 0;
}

function baselineIsEmpty(baseline) {
  return baseline.profileMasterData === 0
    && baseline.pearlSizes === 0
    && baseline.barcodeInventoryCodes === 0
    && baseline.barcodeItemCodes === 0
    && baseline.barcodeSequences === 0;
}

async function verifyV1BaselineIdentity({ models, companyId, transaction }) {
  const actual = await models.sequelize.query("SELECT category_key AS category,canonical_value AS \"canonicalValue\" FROM profile_master_data WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT });
  const expectedKeys = new Set(manifest.V1_PROFILE_MASTER_DATA_ROWS.map((row) => `${row.category}|${row.canonicalValue}`));
  const actualKeys = new Set(actual.map((row) => `${row.category}|${row.canonicalValue}`));
  if (actual.length !== expectedKeys.size || actualKeys.size !== actual.length || expectedKeys.size !== actualKeys.size) throw new ConflictError("INVENTORY_MASTER_DATA_BASELINE_KEY_DRIFT");
  for (const key of expectedKeys) if (!actualKeys.has(key)) throw new ConflictError(`INVENTORY_MASTER_DATA_BASELINE_KEY_DRIFT:${key}`);
  return { expected: expectedKeys.size, actual: actualKeys.size, displayMetadataCompared: false };
}

async function ensureCompany({ models, companyId, transaction }) {
  const rows = await models.sequelize.query("SELECT id FROM companies WHERE id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT });
  if (!rows[0]) throw new AppError("Inventory master-data bootstrap company was not found.", 404, "INVENTORY_MASTER_DATA_COMPANY_NOT_FOUND");
}

function aliasesFor(row) {
  return Object.entries(row.aliases || {}).filter(([, target]) => String(target).trim() === String(row.displayLabel).trim()).map(([alias]) => alias.toLocaleLowerCase("en-US"));
}

async function reconcileProfileRows({ models, companyId, actorId, transaction, dryRun }) {
  const created = [];
  const existing = [];
  const aliasMatched = [];
  for (const row of CURRENT_PROFILE_MASTER_DATA_ROWS) {
    const candidates = [row.canonicalValue, ...aliasesFor(row)];
    const found = await models.sequelize.query(`SELECT id,category_key,canonical_value,display_label,is_active,sort_order
      FROM profile_master_data
      WHERE company_id=:companyId AND category_key=:category AND canonical_value IN (:values)
      ORDER BY CASE WHEN canonical_value=:canonicalValue THEN 0 ELSE 1 END, id
      FOR UPDATE`, {
      replacements: { companyId, category: row.category, values: candidates, canonicalValue: row.canonicalValue }, transaction, type: QueryTypes.SELECT,
    });
    if (found.length > 1) throw new ConflictError(`INVENTORY_MASTER_DATA_DUPLICATE:${row.category}:${row.displayLabel}`);
    if (found[0]) {
      existing.push(row.canonicalKey);
      if (found[0].canonical_value !== row.canonicalValue) aliasMatched.push({ category: row.category, alias: found[0].display_label, canonical: row.displayLabel });
      continue;
    }
    created.push(row.canonicalKey);
    if (dryRun) continue;
    await models.sequelize.query(`INSERT INTO profile_master_data
      (id,company_id,category_key,canonical_value,display_label,is_active,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES (:id,:companyId,:category,:canonicalValue,:displayLabel,true,:sortOrder,:actorId,:actorId,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, {
      replacements: {
        id: stableId(row.category, row.canonicalValue), companyId, category: row.category,
        canonicalValue: row.canonicalValue, displayLabel: row.displayLabel, sortOrder: row.sortOrder, actorId: actorId || null,
      }, transaction,
    });
  }
  return { created, existing, aliasMatched };
}

async function verifyCanonicalBaseline({ models, companyId, transaction }) {
  const [pearl, inventoryCodes, itemCodes, sequenceRows] = await Promise.all([
    models.sequelize.query("SELECT value,unit,is_active FROM pearl_size_master_data WHERE company_id=:companyId ORDER BY value", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
    models.sequelize.query("SELECT code FROM barcode_inventory_codes WHERE company_id=:companyId ORDER BY code", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
    models.sequelize.query("SELECT code FROM barcode_item_codes WHERE company_id=:companyId ORDER BY code", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
    models.sequelize.query("SELECT COUNT(*)::int AS count FROM barcode_sequences WHERE company_id=:companyId", { replacements: { companyId }, transaction, type: QueryTypes.SELECT }),
  ]);
  const expectedPearl = pearlSizeMasterData.INITIAL_VALUES.map((value) => value.toFixed(8));
  const actualPearl = pearl.map((row) => String(row.value)).sort((a, b) => Number(a) - Number(b));
  const expectedInventory = DEFAULT_BARCODE_INVENTORY_CODES.map((row) => row.code).sort();
  const expectedItems = DEFAULT_BARCODE_ITEM_CODES.map((row) => row.code).sort();
  if (actualPearl.map(Number).join(",") !== expectedPearl.map(Number).sort((a, b) => a - b).join(",")) throw new ConflictError("INVENTORY_MASTER_DATA_PEARL_BASELINE_MISMATCH");
  if (JSON.stringify(inventoryCodes.map((row) => row.code).sort()) !== JSON.stringify(expectedInventory)) throw new ConflictError("INVENTORY_MASTER_DATA_BARCODE_INVENTORY_BASELINE_MISMATCH");
  if (JSON.stringify(itemCodes.map((row) => row.code).sort()) !== JSON.stringify(expectedItems)) throw new ConflictError("INVENTORY_MASTER_DATA_BARCODE_ITEM_BASELINE_MISMATCH");
  if (Number(sequenceRows[0]?.count || 0) !== 0) throw new ConflictError("INVENTORY_MASTER_DATA_BARCODE_SEQUENCE_NOT_EMPTY");
}

async function insertV1BarcodeRows({ models, companyId, actorId, transaction }) {
  for (const row of DEFAULT_BARCODE_INVENTORY_CODES) {
    await models.sequelize.query(`INSERT INTO barcode_inventory_codes
      (id,company_id,code,display_name,asset_type,description,is_active,is_client_approved,is_provisional,requires_karat,default_karat_code,default_item_code,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES (:id,:companyId,:code,:displayName,:assetType,:description,:isActive,:isClientApproved,:isProvisional,:requiresKarat,:defaultKaratCode,:defaultItemCode,:sortOrder,:actorId,:actorId,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT (company_id,code) DO NOTHING`, {
      replacements: {
        id: `${companyId}:INV:${row.code}`, companyId, code: row.code,
        displayName: row.displayName, assetType: row.assetType, description: row.description,
        isActive: row.isActive, isClientApproved: row.isClientApproved, isProvisional: row.isProvisional,
        requiresKarat: row.requiresKarat, defaultKaratCode: row.defaultKaratCode || null,
        defaultItemCode: row.defaultItemCode || null, sortOrder: row.sortOrder, actorId: actorId || null,
      },
      transaction,
    });
  }
  for (const row of DEFAULT_BARCODE_ITEM_CODES) {
    await models.sequelize.query(`INSERT INTO barcode_item_codes
      (id,company_id,code,display_name,description,is_active,is_client_approved,is_provisional,allowed_inventory_codes,sort_order,created_by,updated_by,created_at,updated_at)
      VALUES (:id,:companyId,:code,:displayName,:description,:isActive,:isClientApproved,:isProvisional,CAST(:allowedInventoryCodes AS jsonb),:sortOrder,:actorId,:actorId,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT (company_id,code) DO NOTHING`, {
      replacements: {
        id: `${companyId}:ITEM:${row.code}`, companyId, code: row.code,
        displayName: row.displayName, description: row.description,
        isActive: row.isActive, isClientApproved: row.isClientApproved, isProvisional: row.isProvisional,
        allowedInventoryCodes: JSON.stringify(row.allowedInventoryCodes), sortOrder: row.sortOrder,
        actorId: actorId || null,
      },
      transaction,
    });
  }
}

async function initializeV1Foundation({ models, companyId, actorId, transaction, dryRun = false }) {
  const before = await readBaseline({ models, companyId, transaction });
  if (baselineMatches(before)) {
    const baselineIdentity = await verifyV1BaselineIdentity({ models, companyId, transaction });
    await verifyCanonicalBaseline({ models, companyId, transaction });
    return { mode: "EXISTING_V1", before, after: before, baselineIdentity };
  }
  if (!baselineIsEmpty(before)) throw new ConflictError("INVENTORY_MASTER_DATA_BASELINE_DRIFT");
  if (dryRun) return { mode: "ZERO_V1_FOUNDATION_REQUIRED", before, after: before, baselineIdentity: null };

  for (const row of manifest.V1_PROFILE_MASTER_DATA_ROWS) {
    await profileMasterData.create({ models, companyId, category: row.category, value: row.displayLabel, actorId, transaction });
  }
  await pearlSizeMasterData.seedInitial({ models, companyId, actorId, transaction });
  await insertV1BarcodeRows({ models, companyId, actorId, transaction });

  const after = await readBaseline({ models, companyId, transaction });
  if (!baselineMatches(after)) throw new ConflictError("INVENTORY_MASTER_DATA_V1_FOUNDATION_RESULT_MISMATCH");
  const baselineIdentity = await verifyV1BaselineIdentity({ models, companyId, transaction });
  await verifyCanonicalBaseline({ models, companyId, transaction });
  return { mode: "INITIALIZED_V1", before, after, baselineIdentity };
}

async function verifyR2Result({ models, companyId, transaction }) {
  const rows = await models.sequelize.query("SELECT category_key AS category, COUNT(*)::int AS count FROM profile_master_data WHERE company_id=:companyId GROUP BY category_key", { replacements: { companyId }, transaction, type: QueryTypes.SELECT });
  const counts = Object.fromEntries(rows.map((row) => [row.category, Number(row.count)]));
  const expected = countByCategory(CURRENT_PROFILE_MASTER_DATA_ROWS);
  for (const [category, count] of Object.entries(expected)) if (counts[category] !== count) throw new ConflictError(`INVENTORY_MASTER_DATA_RESULT_MISMATCH:${category}:${counts[category] || 0}`);
  if (counts.GEMSTONE_TREATMENT) throw new ConflictError("INVENTORY_MASTER_DATA_GEMSTONE_TREATMENT_NOT_EMPTY");
  const baseline = await readBaseline({ models, companyId, transaction });
  if (baseline.profileMasterData !== BASELINE_PROFILE_COUNT + CURRENT_PROFILE_MASTER_DATA_ROWS.length) throw new ConflictError("INVENTORY_MASTER_DATA_PROFILE_TOTAL_MISMATCH");
  return { categoryCounts: counts, totals: baseline };
}

async function runBootstrap({ models, companyId, actorId, transaction, dryRun, targetVersion }) {
  if (targetVersion !== manifest.CANONICAL_DATASET_VERSION) throw new ConflictError("INVENTORY_MASTER_DATA_VERSION_UNSUPPORTED");
  const manifestInfo = validateManifest();
  await ensureCompany({ models, companyId, transaction });
  const state = await models.InventoryMasterDataBootstrapState.findOne({ where: { companyId, datasetId: manifest.DATASET_ID }, transaction, lock: transaction.LOCK.UPDATE });
  const hash = manifest.manifestHash();
  if (state?.state === STATES.READY) {
    if (state.currentVersion !== targetVersion || state.manifestHash !== hash) throw new ConflictError("INVENTORY_MASTER_DATA_BOOTSTRAP_VERSION_CONFLICT");
    const result = await verifyR2Result({ models, companyId, transaction });
    return { success: true, state: STATES.READY, replayed: true, manifestHash: hash, ...result, changes: { inserted: 0, updated: 0, deleted: 0 } };
  }
  if (state) throw new ConflictError("INVENTORY_MASTER_DATA_BOOTSTRAP_IN_PROGRESS");
  const foundation = await initializeV1Foundation({ models, companyId, actorId, transaction, dryRun });
  const preview = {
    expectedInsertions: manifestInfo.rowCount,
    categoryCounts: manifestInfo.categoryCounts,
    baselineIdentity: foundation.baselineIdentity,
    v1Foundation: foundation.mode,
  };
  if (dryRun) return { success: true, state: "PREVIEW", replayed: false, manifestHash: hash, before: foundation.before, preview, changes: { inserted: 0, updated: 0, deleted: 0 } };
  await models.InventoryMasterDataBootstrapState.create({
    id: stableStateId(companyId), companyId, datasetId: manifest.DATASET_ID, currentVersion: targetVersion,
    manifestHash: hash, state: STATES.IN_PROGRESS, startedAt: new Date(), lastReport: preview,
  }, { transaction });
  const reconciliation = await reconcileProfileRows({ models, companyId, actorId, transaction, dryRun: false });
  const result = await verifyR2Result({ models, companyId, transaction });
  const report = {
    datasetId: manifest.DATASET_ID, version: targetVersion, manifestHash: hash, before: foundation.before,
    expectedInsertionCount: manifestInfo.rowCount, insertedCount: reconciliation.created.length,
    existingCount: reconciliation.existing.length, aliasMatchedCount: reconciliation.aliasMatched.length,
    insertedByCategory: countByCategory(CURRENT_PROFILE_MASTER_DATA_ROWS.filter((row) => reconciliation.created.includes(row.canonicalKey))),
    ...result, changes: { inserted: reconciliation.created.length, updated: 0, deleted: 0 },
  };
  if (reconciliation.created.length !== manifestInfo.rowCount) throw new ConflictError("INVENTORY_MASTER_DATA_DELTA_NOT_EXACT");
  await auditService.record(companyId, {
    action: "inventory_master_data_bootstrap.completed",
    description: `Inventory reference master-data dataset ${manifest.DATASET_ID} version ${targetVersion} applied.`,
    user: "Inventory Master Data Bootstrap", userId: actorId || null, severity: "info", after: JSON.stringify(report), sourceDocument: manifest.DATASET_ID,
  }, { transaction });
  await models.InventoryMasterDataBootstrapState.update({ state: STATES.READY, lastReport: report, lastErrorCode: null, completedAt: new Date() }, { where: { companyId, datasetId: manifest.DATASET_ID }, transaction });
  return { success: true, state: STATES.READY, replayed: false, ...report };
}

async function bootstrapInventoryMasterData({ models, companyId, actorId = null, transaction = null, dryRun = false, targetVersion = manifest.CANONICAL_DATASET_VERSION }) {
  if (!models?.sequelize) throw new AppError("Inventory master-data bootstrap models are required.", 500, "INVENTORY_MASTER_DATA_MODELS_REQUIRED");
  if (!companyId) throw new AppError("Inventory master-data bootstrap company is required.", 400, "INVENTORY_MASTER_DATA_COMPANY_REQUIRED");
  if (transaction) return runBootstrap({ models, companyId, actorId, transaction, dryRun, targetVersion });
  return models.sequelize.transaction(async (ownedTransaction) => runBootstrap({ models, companyId, actorId, transaction: ownedTransaction, dryRun, targetVersion }));
}

module.exports = {
  STATES,
  validateManifest,
  countByCategory,
  readBaseline,
  baselineIsEmpty,
  initializeV1Foundation,
  bootstrapInventoryMasterData,
};
