"use strict";

const { ValidationError, ConflictError } = require("../utils/errors");

const CODE_PATTERN = /^[A-Z0-9]{2,6}$/;
const KARAT_PATTERN = /^\d{2}$/;
const MAX_SERIAL = 999999;

const BARCODE_HISTORY_STATE = Object.freeze({ ACTIVE: "ACTIVE", RETIRED: "RETIRED" });
const BARCODE_HISTORY_ACTION = Object.freeze({ INITIAL: "INITIAL", REPLACEMENT: "REPLACEMENT" });

function normalizeCode(value, label) {
  const code = String(value || "").trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new ValidationError(`${label} must contain 2-6 uppercase letters or digits.`);
  }
  return code;
}

function validateInventoryCode(code) {
  return normalizeCode(code, "Inventory code");
}

function validateItemCode(code) {
  return normalizeCode(code, "Item code");
}

function normalizeKaratCode(karat, configuredFallback = null) {
  if (karat === undefined || karat === null || String(karat).trim() === "") {
    if (configuredFallback === undefined || configuredFallback === null || String(configuredFallback).trim() === "") {
      throw new ValidationError("A karat code is required. Configure a default karat code for non-karat inventory before generating a barcode.");
    }
    const fallback = String(configuredFallback).trim();
    if (!KARAT_PATTERN.test(fallback)) throw new ValidationError("Configured default karat code must be exactly two digits.");
    return fallback;
  }

  const raw = String(karat).trim().toUpperCase().replace(/K$/, "");
  if (!/^\d{1,2}$/.test(raw)) throw new ValidationError("Karat code must be one or two digits.");
  const numeric = Number(raw);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 99) throw new ValidationError("Karat code must be between 00 and 99.");
  return String(numeric).padStart(2, "0");
}

function formatBarcode({ inventoryCode, itemCode, karatCode, serial }) {
  const inventory = validateInventoryCode(inventoryCode);
  const item = validateItemCode(itemCode);
  const normalizedKarat = normalizeKaratCode(karatCode);
  const serialNumber = Number(serial);
  if (!Number.isInteger(serialNumber) || serialNumber < 1 || serialNumber > MAX_SERIAL) {
    throw new ValidationError("Barcode serial must be an integer between 000001 and 999999.");
  }
  return `${inventory}${item}${normalizedKarat}${String(serialNumber).padStart(6, "0")}`;
}

async function getEffectiveBarcodeSettings(companyId, options = {}) {
  const models = require("../models");
  const [inventoryCodes, itemCodes] = await Promise.all([
    models.BarcodeInventoryCode.findAll({
      where: { companyId },
      order: [["sortOrder", "ASC"], ["code", "ASC"]],
      transaction: options.transaction,
    }),
    models.BarcodeItemCode.findAll({
      where: { companyId },
      order: [["sortOrder", "ASC"], ["code", "ASC"]],
      transaction: options.transaction,
    }),
  ]);
  return { inventoryCodes, itemCodes, source: "database" };
}

async function allocateBarcodeSerial({ companyId, inventoryCode, itemCode, karatCode, transaction = null }) {
  const models = require("../models");
  const inventory = validateInventoryCode(inventoryCode);
  const item = validateItemCode(itemCode);
  const karat = normalizeKaratCode(karatCode);
  const ownTransaction = !transaction;
  const t = transaction || await models.sequelize.transaction();

  try {
    // PostgreSQL UPSERT is the concurrency boundary: the unique sequence scope
    // serializes concurrent allocators without a MAX()+1 race.
    const [rows] = await models.sequelize.query(`
      INSERT INTO barcode_sequences
        (company_id, inventory_code, item_code, karat_code, last_serial, created_at, updated_at)
      VALUES
        (:companyId, :inventoryCode, :itemCode, :karatCode, 1, NOW(), NOW())
      ON CONFLICT (company_id, inventory_code, item_code, karat_code)
      DO UPDATE SET last_serial = barcode_sequences.last_serial + 1, updated_at = NOW()
      RETURNING last_serial
    `, {
      replacements: { companyId, inventoryCode: inventory, itemCode: item, karatCode: karat },
      transaction: t,
    });
    const serial = Number(rows[0]?.last_serial);
    if (!Number.isInteger(serial) || serial < 1 || serial > MAX_SERIAL) {
      throw new ConflictError(`Barcode serial scope ${inventory}/${item}/${karat} is exhausted.`);
    }
    if (ownTransaction) await t.commit();
    return serial;
  } catch (error) {
    if (ownTransaction) await t.rollback();
    throw error;
  }
}

async function isCodeUsed({ companyId, type, code, transaction = null }) {
  const models = require("../models");
  const normalized = type === "inventory" ? validateInventoryCode(code) : validateItemCode(code);
  const assetWhere = type === "inventory"
    ? { companyId, inventoryCode: normalized }
    : { companyId, itemCode: normalized };
  const sequenceWhere = type === "inventory"
    ? { companyId, inventoryCode: normalized }
    : { companyId, itemCode: normalized };
  const [assetCount, sequenceCount] = await Promise.all([
    models.Asset.count({ where: assetWhere, paranoid: false, transaction }),
    models.BarcodeSequence.count({ where: sequenceWhere, transaction }),
  ]);
  return { used: assetCount > 0 || sequenceCount > 0, assetCount, sequenceCount };
}

async function getCodeUsageSummary(companyId, options = {}) {
  const models = require("../models");
  const [rows] = await models.sequelize.query(`
    SELECT kind, code,
      SUM(asset_count)::int AS asset_count,
      SUM(sequence_count)::int AS sequence_count
    FROM (
      SELECT 'inventory' AS kind, inventory_code AS code, COUNT(*)::int AS asset_count, 0::int AS sequence_count
      FROM assets WHERE company_id = :companyId AND inventory_code IS NOT NULL
      GROUP BY inventory_code
      UNION ALL
      SELECT 'item' AS kind, item_code AS code, COUNT(*)::int AS asset_count, 0::int AS sequence_count
      FROM assets WHERE company_id = :companyId AND item_code IS NOT NULL
      GROUP BY item_code
      UNION ALL
      SELECT 'inventory' AS kind, inventory_code AS code, 0::int AS asset_count, COUNT(*)::int AS sequence_count
      FROM barcode_sequences WHERE company_id = :companyId GROUP BY inventory_code
      UNION ALL
      SELECT 'item' AS kind, item_code AS code, 0::int AS asset_count, COUNT(*)::int AS sequence_count
      FROM barcode_sequences WHERE company_id = :companyId GROUP BY item_code
    ) usage_rows
    GROUP BY kind, code
  `, { replacements: { companyId }, transaction: options.transaction });
  const summary = { inventory: {}, item: {} };
  for (const row of rows) {
    const assetCount = Number(row.asset_count) || 0;
    const sequenceCount = Number(row.sequence_count) || 0;
    summary[row.kind][row.code] = { used: assetCount > 0 || sequenceCount > 0, assetCount, sequenceCount };
  }
  return summary;
}

function resolveKaratCodeForProfile({ profile, karat, defaultKaratCode = null }) {
  const normalizedProfile = String(profile || "").trim().toUpperCase();
  const isLooseProfile = ["LOOSE_DIAMOND", "LOOSE_GEMSTONE", "LOOSE_PEARL"].includes(normalizedProfile);
  if (isLooseProfile) {
    const supplied = karat === undefined || karat === null || String(karat).trim() === ""
      ? null
      : normalizeKaratCode(karat, null);
    if (supplied && supplied !== "00") throw new ValidationError("LOOSE_PROFILE_KARAT_MUST_BE_00");
    return "00";
  }
  return normalizeKaratCode(karat, defaultKaratCode);
}

async function generateBarcodeForAsset({
  companyId,
  assetType,
  inventoryCode,
  itemCode,
  karat,
  inventorySubtype,
  inventoryProfile,
  transaction = null,
}) {
  const models = require("../models");
  const settings = await getEffectiveBarcodeSettings(companyId, { transaction });
  const requestedInventory = inventoryCode ? validateInventoryCode(inventoryCode) : null;
  const inventory = settings.inventoryCodes.find((row) =>
    requestedInventory ? row.code === requestedInventory : row.assetType === assetType
  );
  if (!inventory || !inventory.isActive) throw new ValidationError("No active inventory barcode code is configured for this asset type.");
  if (inventory.assetType !== assetType) throw new ValidationError("Inventory code does not match the selected asset type.");

  // A configured inventory code can intentionally omit a default item code.
  // In that case select the first active compatible item code from the same
  // Company configuration; never invent a code in a workflow adapter.
  const normalizedProfile = String(inventoryProfile || "").trim().toUpperCase();
  const isLooseDiamond = normalizedProfile === "LOOSE_DIAMOND";
  const isLooseGemstone = normalizedProfile === "LOOSE_GEMSTONE";
  const configuredFallbackItem = settings.itemCodes.find((row) => {
    const allowed = Array.isArray(row.allowedInventoryCodes) ? row.allowedInventoryCodes : [];
    return row.isActive && (!allowed.length || allowed.includes(inventory.code));
  });
  const requestedLooseItem = itemCode ? validateItemCode(itemCode) : null;
  if (isLooseDiamond && requestedInventory && requestedInventory !== "DD") throw new ValidationError("LOOSE_DIAMOND_INVENTORY_CODE_MUST_BE_DD");
  if (isLooseDiamond && requestedLooseItem && requestedLooseItem !== "LOS") throw new ValidationError("LOOSE_DIAMOND_ITEM_CODE_MUST_BE_LOS");
  if (isLooseGemstone && requestedInventory && requestedInventory !== "GS") throw new ValidationError("LOOSE_GEMSTONE_INVENTORY_CODE_MUST_BE_GS");
  if (isLooseGemstone && requestedLooseItem && requestedLooseItem !== "LOS") throw new ValidationError("LOOSE_GEMSTONE_ITEM_CODE_MUST_BE_LOS");
  const effectiveItemCode = validateItemCode(isLooseDiamond || isLooseGemstone ? "LOS" : (itemCode || inventory.defaultItemCode || configuredFallbackItem?.code || ""));
  const item = settings.itemCodes.find((row) => row.code === effectiveItemCode);
  if (!item || !item.isActive) throw new ValidationError("The selected item barcode code is missing or inactive.");
  const allowed = Array.isArray(item.allowedInventoryCodes) ? item.allowedInventoryCodes : [];
  if (allowed.length && !allowed.includes(inventory.code)) {
    throw new ValidationError(`Item code ${item.code} is not allowed for inventory code ${inventory.code}.`);
  }

  const isLoose = /loose/i.test(String(inventorySubtype || "")) || ["LOOSE_DIAMOND", "LOOSE_GEMSTONE", "LOOSE_PEARL"].includes(normalizedProfile);
  const karatCode = resolveKaratCodeForProfile({ profile: inventoryProfile, karat, defaultKaratCode: inventory.defaultKaratCode });
  const hasKarat = Boolean(karatCode);
  if (inventory.requiresKarat && !hasKarat && !inventory.defaultKaratCode) {
    const qualifier = isLoose ? "Loose inventory" : "This inventory type";
    throw new ValidationError(`${qualifier} requires a karat or a configured default karat code before barcode generation.`);
  }

  // Skip a historical collision without rewriting it. Sequence gaps are valid;
  // barcode reuse is not.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const serial = await allocateBarcodeSerial({
      companyId,
      inventoryCode: inventory.code,
      itemCode: item.code,
      karatCode,
      transaction,
    });
    const barcode = formatBarcode({ inventoryCode: inventory.code, itemCode: item.code, karatCode, serial });
    // Inventory Master V2 reserves Barcode identity globally, including rows
    // outside the caller's Company and soft-deleted/terminal Assets.
    let collision = await models.Asset.count({ where: { barcode }, paranoid: false, transaction });
    try {
      const [historyRows] = await models.sequelize.query(
        "SELECT 1 FROM asset_barcode_history WHERE barcode=:barcode LIMIT 1",
        { replacements: { barcode }, transaction }
      );
      collision += historyRows.length;
    } catch (error) {
      // Staged deployments may start the application before the forward-only
      // migration is applied. Once present, permanent history is mandatory.
      const code = error?.original?.code || error?.parent?.code || error?.code;
      if (code !== "42P01") throw error;
    }
    if (!collision) {
      return {
        barcode,
        inventoryCode: inventory.code,
        itemCode: item.code,
        karatCode,
        barcodeSerial: serial,
        barcodeGeneratedAt: new Date(),
        barcodeRevision: 1,
      };
    }
  }
  throw new ConflictError("Could not allocate a non-reused barcode after 20 attempts.");
}

async function replaceAssetBarcode({ asset, companyId, context = {}, reason, transaction }) {
  const models = require("../models");
  const normalizedReason = String(reason || "").trim();
  if (!normalizedReason) throw new ValidationError("Barcode replacement reason is required.");
  if (!transaction) throw new ValidationError("Barcode replacement transaction is required.");
  if (!asset?.id || asset.companyId !== companyId) throw new ValidationError("Barcode replacement company scope is invalid.");

  const currentHistory = await models.sequelize.query(`
    SELECT id,barcode,barcode_revision AS "barcodeRevision"
    FROM asset_barcode_history
    WHERE asset_id=:assetId AND state='ACTIVE'
    FOR UPDATE
  `, { replacements: { assetId: asset.id }, transaction, type: models.sequelize.QueryTypes.SELECT });
  if (currentHistory.length !== 1 || currentHistory[0].barcode !== asset.barcode) {
    throw new ConflictError("Barcode history does not match the current Asset identity.");
  }

  const identity = await generateBarcodeForAsset({
    companyId,
    assetType: asset.type,
    inventoryCode: asset.inventoryCode,
    itemCode: asset.itemCode,
    karat: asset.karat,
    inventorySubtype: asset.inventorySubtype,
    inventoryProfile: asset.inventoryProfile || asset.profile,
    transaction,
  });
  const now = context.occurredAt || new Date();
  const actorId = context.actorId || null;
  const nextRevision = Number(currentHistory[0].barcodeRevision || asset.barcodeRevision || 1) + 1;

  await models.sequelize.query("SELECT set_config('darfus.inventory_barcode_replacement','approved',true)", { transaction });
  await models.sequelize.query(`
    UPDATE asset_barcode_history
    SET state='RETIRED',retired_at=:retiredAt,retired_by=:retiredBy,retirement_reason=:reason,updated_at=CURRENT_TIMESTAMP
    WHERE id=:id AND state='ACTIVE'
  `, { replacements: { id: currentHistory[0].id, retiredAt: now, retiredBy: actorId, reason: normalizedReason }, transaction });
  await asset.update({ ...identity, barcodeRevision: nextRevision, updatedBy: actorId }, { transaction });
  await models.sequelize.query(`
    INSERT INTO asset_barcode_history
      (id,asset_id,company_id,barcode,barcode_revision,state,action,issued_at,issued_by,source_type,source_id,created_at,updated_at)
    VALUES (:id,:assetId,:companyId,:barcode,:barcodeRevision,'ACTIVE','REPLACEMENT',:issuedAt,:issuedBy,'BARCODE_REPLACEMENT',:sourceId,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `, {
    replacements: {
      id: `ABH-REPL-${asset.id}-${nextRevision}`,
      assetId: asset.id,
      companyId,
      barcode: identity.barcode,
      barcodeRevision: nextRevision,
      issuedAt: now,
      issuedBy: actorId,
      sourceId: asset.id,
    },
    transaction,
  });
  return { assetId: asset.id, oldBarcode: currentHistory[0].barcode, barcode: identity.barcode, barcodeRevision: nextRevision, reason: normalizedReason };
}

module.exports = {
  formatBarcode,
  validateInventoryCode,
  validateItemCode,
  normalizeKaratCode,
  resolveKaratCodeForProfile,
  getEffectiveBarcodeSettings,
  allocateBarcodeSerial,
  generateBarcodeForAsset,
  replaceAssetBarcode,
  BARCODE_HISTORY_STATE,
  BARCODE_HISTORY_ACTION,
  isCodeUsed,
  getCodeUsageSummary,
};
