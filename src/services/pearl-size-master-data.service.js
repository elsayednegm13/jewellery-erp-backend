"use strict";

const crypto = require("crypto");
const Decimal = require("decimal.js");
const { ValidationError } = require("../utils/errors");

const UNIT = "MM";
const INITIAL_VALUES = Object.freeze(Array.from({ length: 39 }, (_, index) => new Decimal(index + 2).div(2)));
const id = () => `PSMD-${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`;

function rawDecimal(value, field) {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new ValidationError(`${field} must be a positive plain decimal number.`);
  const parsed = new Decimal(text);
  if (!parsed.isFinite() || parsed.lte(0) || parsed.decimalPlaces() > 8) throw new ValidationError(`${field} must be a positive decimal with at most 8 places.`);
  return { parsed, text };
}

function normalizeValue(value, field = "pearlSize") {
  const { parsed, text } = rawDecimal(value, field);
  return Object.freeze({ value: parsed.toFixed(8), displayValue: text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text, numeric: parsed });
}

function serialize(row) {
  const value = new Decimal(String(row.value));
  return {
    id: row.id, value: value.toFixed(8), displayValue: row.displayValue,
    label: `${row.displayValue} mm`, unit: UNIT, isActive: row.isActive,
    sortOrder: row.sortOrder, isOwnerApprovedInitial: row.isOwnerApprovedInitial,
  };
}

async function list({ models, companyId, activeOnly = true, transaction = null }) {
  const where = { companyId };
  if (activeOnly) where.isActive = true;
  const rows = await models.PearlSizeMasterData.findAll({ where, order: [["sortOrder", "ASC"], ["value", "ASC"], ["id", "ASC"]], transaction });
  return rows.map((row) => serialize(row));
}

async function create({ models, companyId, value, actorId = null, transaction, initial = false }) {
  const normalized = normalizeValue(value);
  const sortOrder = initial ? Number(normalized.numeric.times(10)) : 100000 + Number(normalized.numeric.times(100));
  const candidateId = id();
  // INSERT .. ON CONFLICT provides the single concurrency boundary for master
  // data identity.  A concurrent create becomes a safe replay instead of a
  // duplicate active value or a route-local recovery path.
  const [inserted] = await models.sequelize.query(`INSERT INTO pearl_size_master_data
    (id,company_id,value,display_value,unit,is_active,sort_order,is_owner_approved_initial,created_by,updated_by,created_at,updated_at)
    VALUES (:id,:companyId,:value,:displayValue,:unit,true,:sortOrder,:initial,:actorId,:actorId,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT (company_id,value,unit) DO NOTHING RETURNING id`, {
    replacements: { id: candidateId, companyId, value: normalized.value, displayValue: initial ? normalized.numeric.toFixed(1) : normalized.displayValue, unit: UNIT, sortOrder, initial, actorId }, transaction,
  });
  const created = Boolean(inserted?.[0]?.id);
  const where = created ? { id: candidateId } : { companyId, value: normalized.value, unit: UNIT };
  const row = await models.PearlSizeMasterData.findOne({ where, transaction, lock: transaction?.LOCK?.UPDATE });
  if (!row) throw new Error("PEARL_SIZE_MASTER_DATA_CREATE_RESOLUTION_FAILED");
  if (initial && !row.isActive) await row.update({ isActive: true, updatedBy: actorId }, { transaction });
  return { row, created };
}

async function seedInitial({ models, companyId, actorId = null, transaction }) {
  const results = [];
  for (const value of INITIAL_VALUES) results.push(await create({ models, companyId, value: value.toFixed(1), actorId, transaction, initial: true }));
  return results;
}

async function requireActive({ models, companyId, pearlSizeId, pearlSize, transaction }) {
  let row = null;
  if (pearlSizeId) row = await models.PearlSizeMasterData.findOne({ where: { id: String(pearlSizeId), companyId, unit: UNIT, isActive: true }, transaction });
  else if (pearlSize !== undefined && pearlSize !== null && pearlSize !== "") {
    const normalized = normalizeValue(pearlSize);
    row = await models.PearlSizeMasterData.findOne({ where: { companyId, value: normalized.value, unit: UNIT, isActive: true }, transaction });
  }
  if (!row) throw new ValidationError("LOOSE_PEARL_SIZE_MASTER_DATA_ACTIVE_VALUE_REQUIRED");
  return serialize(row);
}

module.exports = { UNIT, INITIAL_VALUES, normalizeValue, serialize, list, create, seedInitial, requireActive };
