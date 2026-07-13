"use strict";

const { ValidationError, ConflictError } = require("../utils/errors");

const CODE_PATTERN = /^[A-Z0-9]{2,6}$/;
const KARAT_PATTERN = /^\d{2}$/;
const MAX_SERIAL = 999999;

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

async function generateBarcodeForAsset({
  companyId,
  assetType,
  inventoryCode,
  itemCode,
  karat,
  inventorySubtype,
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

  const effectiveItemCode = validateItemCode(itemCode || inventory.defaultItemCode || "");
  const item = settings.itemCodes.find((row) => row.code === effectiveItemCode);
  if (!item || !item.isActive) throw new ValidationError("The selected item barcode code is missing or inactive.");
  const allowed = Array.isArray(item.allowedInventoryCodes) ? item.allowedInventoryCodes : [];
  if (allowed.length && !allowed.includes(inventory.code)) {
    throw new ValidationError(`Item code ${item.code} is not allowed for inventory code ${inventory.code}.`);
  }

  const isLoose = /loose/i.test(String(inventorySubtype || ""));
  const hasKarat = karat !== undefined && karat !== null && String(karat).trim() !== "";
  if (inventory.requiresKarat && !hasKarat && !inventory.defaultKaratCode) {
    const qualifier = isLoose ? "Loose inventory" : "This inventory type";
    throw new ValidationError(`${qualifier} requires a karat or a configured default karat code before barcode generation.`);
  }
  const karatCode = normalizeKaratCode(karat, inventory.defaultKaratCode);

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
    const collision = await models.Asset.count({ where: { companyId, barcode }, paranoid: false, transaction });
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

module.exports = {
  formatBarcode,
  validateInventoryCode,
  validateItemCode,
  normalizeKaratCode,
  getEffectiveBarcodeSettings,
  allocateBarcodeSerial,
  generateBarcodeForAsset,
  isCodeUsed,
  getCodeUsageSummary,
};
