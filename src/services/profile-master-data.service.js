"use strict";

// One company-scoped authority for source-backed selectable Loose Profile values.
// Pearl Size intentionally remains in pearl_size_master_data: it has a numeric
// MM identity and is not duplicated here.
const crypto = require("crypto");
const { ValidationError } = require("../utils/errors");

const CATEGORIES = Object.freeze({
  GOLD_ITEM_DESCRIPTION: "GOLD_ITEM_DESCRIPTION", GOLD_COLOR: "GOLD_COLOR",
  DIAMOND_NAME: "DIAMOND_NAME", DIAMOND_TYPE: "DIAMOND_TYPE", DIAMOND_COLOR: "DIAMOND_COLOR", DIAMOND_CLARITY: "DIAMOND_CLARITY",
  DIAMOND_CUT: "DIAMOND_CUT", DIAMOND_SHAPE: "DIAMOND_SHAPE", DIAMOND_TREATMENT: "DIAMOND_TREATMENT",
  DIAMOND_ORIGIN: "DIAMOND_ORIGIN", DIAMOND_TONE: "DIAMOND_TONE", DIAMOND_TONE_LEVEL: "DIAMOND_TONE_LEVEL",
  DIAMOND_SATURATION: "DIAMOND_SATURATION", DIAMOND_POSITION: "DIAMOND_POSITION", DIAMOND_SETTING: "DIAMOND_SETTING",
  PEARL_TYPE: "PEARL_TYPE", PEARL_COLOR: "PEARL_COLOR", PEARL_OVERTONE: "PEARL_OVERTONE",
  PEARL_ORIENT: "PEARL_ORIENT", PEARL_SHAPE: "PEARL_SHAPE", PEARL_LUSTER: "PEARL_LUSTER",
  PEARL_SURFACE_QUALITY: "PEARL_SURFACE_QUALITY", PEARL_NACRE_QUALITY: "PEARL_NACRE_QUALITY",
  PEARL_ORIGIN: "PEARL_ORIGIN", PEARL_ITEM_DESCRIPTION: "PEARL_ITEM_DESCRIPTION",
  GEMSTONE_NAME: "GEMSTONE_NAME", GEMSTONE_TYPE: "GEMSTONE_TYPE", GEMSTONE_TREATMENT: "GEMSTONE_TREATMENT",
  GEMSTONE_SHAPE: "GEMSTONE_SHAPE", GEMSTONE_COLOR: "GEMSTONE_COLOR", GEMSTONE_TONE: "GEMSTONE_TONE",
  GEMSTONE_TONE_LEVEL: "GEMSTONE_TONE_LEVEL", GEMSTONE_SATURATION: "GEMSTONE_SATURATION",
  GEMSTONE_OPTICAL_EFFECT: "GEMSTONE_OPTICAL_EFFECT", GEMSTONE_ORIGIN: "GEMSTONE_ORIGIN",
  GEMSTONE_POSITION: "GEMSTONE_POSITION", GEMSTONE_SETTING: "GEMSTONE_SETTING",
  CERTIFICATE_AUTHORITY: "CERTIFICATE_AUTHORITY",
});

const PROFILE_CATEGORIES = Object.freeze({
  GOLD_BY_WEIGHT_JEWELLERY: Object.freeze([CATEGORIES.GOLD_ITEM_DESCRIPTION, CATEGORIES.GOLD_COLOR]),
  GOLD_BAR_24K: Object.freeze([CATEGORIES.GOLD_ITEM_DESCRIPTION, CATEGORIES.GOLD_COLOR]),
  GOLD_BY_PIECE: Object.freeze([CATEGORIES.GOLD_ITEM_DESCRIPTION, CATEGORIES.GOLD_COLOR]),
  DIAMOND_JEWELLERY: Object.freeze([
    CATEGORIES.DIAMOND_NAME, CATEGORIES.DIAMOND_TYPE, CATEGORIES.DIAMOND_COLOR, CATEGORIES.DIAMOND_CLARITY,
    CATEGORIES.DIAMOND_CUT, CATEGORIES.DIAMOND_SHAPE, CATEGORIES.DIAMOND_TREATMENT,
    CATEGORIES.DIAMOND_ORIGIN, CATEGORIES.DIAMOND_TONE, CATEGORIES.DIAMOND_TONE_LEVEL,
    CATEGORIES.DIAMOND_SATURATION, CATEGORIES.DIAMOND_POSITION, CATEGORIES.DIAMOND_SETTING,
    CATEGORIES.CERTIFICATE_AUTHORITY,
  ]),
  LOOSE_DIAMOND: Object.freeze([
    CATEGORIES.DIAMOND_NAME, CATEGORIES.DIAMOND_TYPE, CATEGORIES.DIAMOND_COLOR, CATEGORIES.DIAMOND_CLARITY,
    CATEGORIES.DIAMOND_CUT, CATEGORIES.DIAMOND_SHAPE, CATEGORIES.DIAMOND_TREATMENT,
    CATEGORIES.DIAMOND_ORIGIN, CATEGORIES.DIAMOND_TONE, CATEGORIES.DIAMOND_TONE_LEVEL,
    CATEGORIES.DIAMOND_SATURATION, CATEGORIES.CERTIFICATE_AUTHORITY,
  ]),
  GEMSTONE_JEWELLERY: Object.freeze([
    CATEGORIES.GEMSTONE_NAME, CATEGORIES.GEMSTONE_TYPE, CATEGORIES.GEMSTONE_TREATMENT,
    CATEGORIES.GEMSTONE_SHAPE, CATEGORIES.GEMSTONE_COLOR, CATEGORIES.GEMSTONE_TONE,
    CATEGORIES.GEMSTONE_TONE_LEVEL, CATEGORIES.GEMSTONE_SATURATION,
    CATEGORIES.GEMSTONE_OPTICAL_EFFECT, CATEGORIES.GEMSTONE_ORIGIN, CATEGORIES.GEMSTONE_POSITION,
    CATEGORIES.GEMSTONE_SETTING, CATEGORIES.CERTIFICATE_AUTHORITY,
  ]),
  LOOSE_GEMSTONE: Object.freeze([
    CATEGORIES.GEMSTONE_NAME, CATEGORIES.GEMSTONE_TYPE, CATEGORIES.GEMSTONE_TREATMENT,
    CATEGORIES.GEMSTONE_SHAPE, CATEGORIES.GEMSTONE_COLOR, CATEGORIES.GEMSTONE_TONE,
    CATEGORIES.GEMSTONE_TONE_LEVEL, CATEGORIES.GEMSTONE_SATURATION,
    CATEGORIES.GEMSTONE_OPTICAL_EFFECT, CATEGORIES.GEMSTONE_ORIGIN, CATEGORIES.CERTIFICATE_AUTHORITY,
  ]),
  LOOSE_PEARL: Object.freeze([
    CATEGORIES.PEARL_TYPE, CATEGORIES.PEARL_COLOR, CATEGORIES.PEARL_OVERTONE,
    CATEGORIES.PEARL_ORIENT, CATEGORIES.PEARL_SHAPE, CATEGORIES.PEARL_LUSTER,
    CATEGORIES.PEARL_SURFACE_QUALITY, CATEGORIES.PEARL_NACRE_QUALITY,
    CATEGORIES.PEARL_ORIGIN, CATEGORIES.PEARL_ITEM_DESCRIPTION, CATEGORIES.CERTIFICATE_AUTHORITY,
  ]),
  PEARL_JEWELLERY: Object.freeze([
    CATEGORIES.PEARL_TYPE, CATEGORIES.PEARL_COLOR, CATEGORIES.PEARL_OVERTONE,
    CATEGORIES.PEARL_ORIENT, CATEGORIES.PEARL_SHAPE, CATEGORIES.PEARL_LUSTER,
    CATEGORIES.PEARL_SURFACE_QUALITY, CATEGORIES.PEARL_NACRE_QUALITY,
    CATEGORIES.PEARL_ORIGIN, CATEGORIES.PEARL_ITEM_DESCRIPTION, CATEGORIES.CERTIFICATE_AUTHORITY,
  ]),
});

const FIELD_CATEGORY = Object.freeze({
  diamondType: CATEGORIES.DIAMOND_TYPE, diamondColor: CATEGORIES.DIAMOND_COLOR,
  clarity: CATEGORIES.DIAMOND_CLARITY, diamondClarity: CATEGORIES.DIAMOND_CLARITY,
  cut: CATEGORIES.DIAMOND_CUT, diamondCut: CATEGORIES.DIAMOND_CUT,
  diamondShape: CATEGORIES.DIAMOND_SHAPE, diamondTreatment: CATEGORIES.DIAMOND_TREATMENT,
  diamondOrigin: CATEGORIES.DIAMOND_ORIGIN,
  diamondTone: CATEGORIES.DIAMOND_TONE, diamondToneLevel: CATEGORIES.DIAMOND_TONE_LEVEL,
  diamondSaturation: CATEGORIES.DIAMOND_SATURATION, diamondPosition: CATEGORIES.DIAMOND_POSITION,
  diamondSetting: CATEGORIES.DIAMOND_SETTING,
  stoneName: CATEGORIES.GEMSTONE_NAME, stoneType: CATEGORIES.GEMSTONE_TYPE,
  treatment: CATEGORIES.GEMSTONE_TREATMENT, shape: CATEGORIES.GEMSTONE_SHAPE,
  color: CATEGORIES.GEMSTONE_COLOR, tone: CATEGORIES.GEMSTONE_TONE,
  toneLevel: CATEGORIES.GEMSTONE_TONE_LEVEL, saturation: CATEGORIES.GEMSTONE_SATURATION,
  opticalEffect: CATEGORIES.GEMSTONE_OPTICAL_EFFECT, origin: CATEGORIES.GEMSTONE_ORIGIN,
  gemstonePosition: CATEGORIES.GEMSTONE_POSITION, gemstoneSetting: CATEGORIES.GEMSTONE_SETTING,
  pearlType: CATEGORIES.PEARL_TYPE, pearlColor: CATEGORIES.PEARL_COLOR,
  overtone: CATEGORIES.PEARL_OVERTONE, orient: CATEGORIES.PEARL_ORIENT,
  pearlShape: CATEGORIES.PEARL_SHAPE, luster: CATEGORIES.PEARL_LUSTER,
  surfaceQuality: CATEGORIES.PEARL_SURFACE_QUALITY, nacreQuality: CATEGORIES.PEARL_NACRE_QUALITY,
  pearlOrigin: CATEGORIES.PEARL_ORIGIN, description: CATEGORIES.PEARL_ITEM_DESCRIPTION,
  certificateAuthority: CATEGORIES.CERTIFICATE_AUTHORITY,
});

function id() { return `PMD-${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`; }
function normalizeCategory(category) {
  const value = String(category || "").trim().toUpperCase();
  if (!Object.values(CATEGORIES).includes(value)) throw new ValidationError("PROFILE_MASTER_DATA_CATEGORY_INVALID");
  return value;
}
function normalizeValue(value) {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  if (!label || label.length > 160) throw new ValidationError("PROFILE_MASTER_DATA_VALUE_INVALID");
  return { label, value: label.toLocaleLowerCase("en-US") };
}
function serialize(row) {
  return Object.freeze({ id: row.id, category: row.category_key || row.categoryKey, value: row.canonical_value || row.canonicalValue, label: row.display_label || row.displayLabel, isActive: row.is_active ?? row.isActive, sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0) });
}
function categoriesForProfile(profile) { return PROFILE_CATEGORIES[profile] || []; }
function categoryForField(profile, field) {
  const normalizedProfile = String(profile || "").trim().toUpperCase();
  const normalizedField = String(field || "").trim();
  if (normalizedProfile === "LOOSE_DIAMOND" && normalizedField === "stoneName") return CATEGORIES.DIAMOND_NAME;
  if (normalizedProfile === "LOOSE_DIAMOND" && normalizedField === "diamondColor") return CATEGORIES.DIAMOND_COLOR;
  if (normalizedProfile === "LOOSE_DIAMOND" && normalizedField === "diamondTreatment") return CATEGORIES.DIAMOND_TREATMENT;
  if (normalizedProfile === "LOOSE_DIAMOND" && normalizedField === "treatment") return CATEGORIES.DIAMOND_TREATMENT;
  if (normalizedProfile.includes("DIAMOND") && normalizedField === "tone") return CATEGORIES.DIAMOND_TONE;
  if (normalizedProfile.includes("DIAMOND") && normalizedField === "toneLevel") return CATEGORIES.DIAMOND_TONE_LEVEL;
  if (normalizedProfile.includes("DIAMOND") && normalizedField === "saturation") return CATEGORIES.DIAMOND_SATURATION;
  if (normalizedProfile.includes("DIAMOND") && normalizedField === "position") return CATEGORIES.DIAMOND_POSITION;
  if (normalizedProfile.includes("DIAMOND") && normalizedField === "setting") return CATEGORIES.DIAMOND_SETTING;
  if (normalizedProfile.includes("GEMSTONE") && normalizedField === "position") return CATEGORIES.GEMSTONE_POSITION;
  if (normalizedProfile.includes("GEMSTONE") && normalizedField === "setting") return CATEGORIES.GEMSTONE_SETTING;
  return FIELD_CATEGORY[normalizedField] || (Object.values(CATEGORIES).includes(normalizedField.toUpperCase()) ? normalizedField.toUpperCase() : null);
}

async function list({ models, companyId, categories = null, activeOnly = true, transaction = null }) {
  const values = Array.isArray(categories) && categories.length ? categories.map(normalizeCategory) : null;
  const rows = await models.sequelize.query(`SELECT id,category_key,canonical_value,display_label,is_active,sort_order
    FROM profile_master_data WHERE company_id=:companyId
    ${values ? "AND category_key IN (:categories)" : ""}
    ${activeOnly ? "AND is_active=true" : ""}
    ORDER BY category_key,sort_order,display_label,id`, {
    replacements: { companyId, categories: values || [] }, transaction, type: models.sequelize.QueryTypes.SELECT,
  });
  return rows.map(serialize);
}

async function create({ models, companyId, category, value, actorId = null, transaction }) {
  const categoryKey = normalizeCategory(category); const normalized = normalizeValue(value); const candidate = id();
  const [inserted] = await models.sequelize.query(`INSERT INTO profile_master_data
    (id,company_id,category_key,canonical_value,display_label,is_active,sort_order,created_by,updated_by,created_at,updated_at)
    VALUES (:id,:companyId,:categoryKey,:canonicalValue,:displayLabel,true,100000,:actorId,:actorId,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT (company_id,category_key,canonical_value) DO NOTHING RETURNING id`, {
    replacements: { id: candidate, companyId, categoryKey, canonicalValue: normalized.value, displayLabel: normalized.label, actorId }, transaction,
  });
  const rowId = inserted?.[0]?.id || null;
  const rows = await models.sequelize.query(`SELECT id,category_key,canonical_value,display_label,is_active,sort_order
    FROM profile_master_data WHERE ${rowId ? "id=:rowId" : "company_id=:companyId AND category_key=:categoryKey AND canonical_value=:canonicalValue"} FOR UPDATE`, {
    replacements: { rowId, companyId, categoryKey, canonicalValue: normalized.value }, transaction, type: models.sequelize.QueryTypes.SELECT,
  });
  if (!rows[0]) throw new Error("PROFILE_MASTER_DATA_CREATE_RESOLUTION_FAILED");
  return { created: Boolean(rowId), row: serialize(rows[0]) };
}

async function update({ models, companyId, id: rowId, value, isActive, actorId = null, transaction }) {
  const rows = await models.sequelize.query("SELECT * FROM profile_master_data WHERE id=:id AND company_id=:companyId FOR UPDATE", { replacements: { id: rowId, companyId }, transaction, type: models.sequelize.QueryTypes.SELECT });
  if (!rows[0]) throw new ValidationError("PROFILE_MASTER_DATA_NOT_FOUND");
  const current = rows[0];
  const normalized = value === undefined ? null : normalizeValue(value);
  // A referenced source value is historical evidence.  It may be deactivated
  // when retired, but changing its identity would rewrite the meaning of past
  // Assets.  Create a new approved value instead.
  if (normalized && normalized.value !== current.canonical_value) {
    const usage = await models.sequelize.query("SELECT COUNT(*)::int AS count FROM asset_profile_master_data_references WHERE master_data_id=:id", { replacements: { id: rowId }, transaction, type: models.sequelize.QueryTypes.SELECT });
    if (Number(usage[0]?.count || 0) > 0) throw new ValidationError("PROFILE_MASTER_DATA_USED_VALUE_EDIT_FORBIDDEN");
  }
  await models.sequelize.query(`UPDATE profile_master_data SET
    canonical_value=COALESCE(:canonicalValue,canonical_value),display_label=COALESCE(:displayLabel,display_label),
    is_active=COALESCE(:isActive,is_active),updated_by=:actorId,updated_at=CURRENT_TIMESTAMP WHERE id=:id`, {
    replacements: { id: rowId, canonicalValue: normalized?.value ?? null, displayLabel: normalized?.label ?? null, isActive: isActive === undefined ? null : Boolean(isActive), actorId }, transaction,
  });
  const latest = await models.sequelize.query("SELECT id,category_key,canonical_value,display_label,is_active,sort_order FROM profile_master_data WHERE id=:id", { replacements: { id: rowId }, transaction, type: models.sequelize.QueryTypes.SELECT });
  return { before: serialize(current), row: serialize(latest[0]) };
}

async function requireActive({ models, companyId, category, id: rowId, transaction }) {
  const categoryKey = normalizeCategory(category);
  if (!rowId) throw new ValidationError(`PROFILE_MASTER_DATA_${categoryKey}_REQUIRED`);
  const rows = await models.sequelize.query(`SELECT id,category_key,canonical_value,display_label,is_active,sort_order FROM profile_master_data
    WHERE id=:id AND company_id=:companyId AND category_key=:categoryKey AND is_active=true`, {
    replacements: { id: String(rowId), companyId, categoryKey }, transaction, type: models.sequelize.QueryTypes.SELECT,
  });
  if (!rows[0]) throw new ValidationError("PROFILE_MASTER_DATA_ACTIVE_VALUE_REQUIRED");
  return serialize(rows[0]);
}

async function resolveLooseReferences({ models, companyId, profile, looseDetails, transaction }) {
  if (!looseDetails) return { details: looseDetails, references: [] };
  const requested = looseDetails.masterData || looseDetails.masterDataIds || {};
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) throw new ValidationError("PROFILE_MASTER_DATA_REFERENCES_INVALID");
  const allowed = new Set(categoriesForProfile(profile));
  const refs = [];
  for (const [field, rowId] of Object.entries(requested)) {
    if (rowId === null || rowId === undefined || rowId === "") continue;
    const category = categoryForField(profile, field);
    if (!category || !allowed.has(category)) throw new ValidationError("PROFILE_MASTER_DATA_WRONG_CATEGORY");
    refs.push({ field, category, master: await requireActive({ models, companyId, category, id: rowId, transaction }) });
  }
  // Older compatibility callers may still send source labels.  Resolve an
  // exact active master row, never accept arbitrary text as a durable master
  // value.  The current UI always sends ids; this branch protects existing
  // accepted callers while keeping the server as the authority.
  const fallbackFields = profile === "LOOSE_DIAMOND"
    ? ["stoneName", "diamondType", "diamondColor", "clarity", "cut", "diamondShape", "diamondTreatment", "diamondOrigin", "diamondTone", "diamondToneLevel", "diamondSaturation"]
    : profile === "LOOSE_GEMSTONE"
    ? ["stoneName", "stoneType", "treatment", "shape", "color", "tone", "toneLevel", "saturation", "opticalEffect", "origin"]
    : profile === "LOOSE_PEARL"
      ? ["pearlType", "pearlColor", "overtone", "orient", "pearlShape", "luster", "surfaceQuality", "nacreQuality", "pearlOrigin", "description"]
      : [];
  for (const field of fallbackFields) {
    const category = categoryForField(profile, field);
    const text = String(looseDetails[field] ?? "").trim();
    if (!category || !text || refs.some((ref) => ref.category === category)) continue;
    const match = await models.sequelize.query(`SELECT id,category_key,canonical_value,display_label,is_active,sort_order
      FROM profile_master_data WHERE company_id=:companyId AND category_key=:category AND canonical_value=:value AND is_active=true`, {
      replacements: { companyId, category, value: normalizeValue(text).value }, transaction, type: models.sequelize.QueryTypes.SELECT,
    });
    if (!match[0]) throw new ValidationError("PROFILE_MASTER_DATA_ACTIVE_VALUE_REQUIRED");
    refs.push({ field, category, master: serialize(match[0]) });
  }
  const byCategory = new Map();
  for (const ref of refs) {
    const values = byCategory.get(ref.category) || [];
    values.push(ref.master);
    byCategory.set(ref.category, values);
  }
  const masterValue = (category, fallback) => {
    const values = byCategory.get(category) || [];
    return values.length > 1 ? values.map((row) => row.label).join(", ") : (values[0]?.label ?? fallback);
  };
  const masterValues = (category, fallback) => {
    const values = (byCategory.get(category) || []).map((row) => row.label).filter(Boolean);
    return values.length ? values : fallback;
  };
  const details = Object.freeze({ ...looseDetails,
    stoneName: masterValue(profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_NAME : CATEGORIES.GEMSTONE_NAME, looseDetails.stoneName),
    diamondType: masterValue(profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_TYPE : CATEGORIES.GEMSTONE_TYPE, looseDetails.diamondType),
    treatment: masterValue(profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_TREATMENT : CATEGORIES.GEMSTONE_TREATMENT, looseDetails.treatment),
    shape: masterValue(profile === "LOOSE_PEARL" ? CATEGORIES.PEARL_SHAPE : profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_SHAPE : CATEGORIES.GEMSTONE_SHAPE, looseDetails.shape),
    color: masterValue(profile === "LOOSE_PEARL" ? CATEGORIES.PEARL_COLOR : profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_COLOR : CATEGORIES.GEMSTONE_COLOR, looseDetails.color),
    colors: profile === "LOOSE_DIAMOND" ? masterValues(CATEGORIES.DIAMOND_COLOR, looseDetails.color || []) : looseDetails.colors,
    tone: masterValue(profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_TONE : CATEGORIES.GEMSTONE_TONE, looseDetails.tone),
    toneLevel: masterValue(profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_TONE_LEVEL : CATEGORIES.GEMSTONE_TONE_LEVEL, looseDetails.toneLevel),
    saturation: masterValue(profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_SATURATION : CATEGORIES.GEMSTONE_SATURATION, looseDetails.saturation),
    opticalEffect: masterValue(CATEGORIES.GEMSTONE_OPTICAL_EFFECT, looseDetails.opticalEffect), origin: masterValue(profile === "LOOSE_PEARL" ? CATEGORIES.PEARL_ORIGIN : profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_ORIGIN : CATEGORIES.GEMSTONE_ORIGIN, looseDetails.origin),
    position: masterValue(profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_POSITION : CATEGORIES.GEMSTONE_POSITION, looseDetails.position),
    setting: masterValue(profile === "LOOSE_DIAMOND" ? CATEGORIES.DIAMOND_SETTING : CATEGORIES.GEMSTONE_SETTING, looseDetails.setting),
    pearlType: masterValue(CATEGORIES.PEARL_TYPE, looseDetails.pearlType), pearlColor: masterValue(CATEGORIES.PEARL_COLOR, looseDetails.pearlColor), pearlShape: masterValue(CATEGORIES.PEARL_SHAPE, looseDetails.pearlShape), overtone: masterValue(CATEGORIES.PEARL_OVERTONE, looseDetails.overtone), orient: masterValue(CATEGORIES.PEARL_ORIENT, looseDetails.orient), luster: masterValue(CATEGORIES.PEARL_LUSTER, looseDetails.luster), surfaceQuality: masterValue(CATEGORIES.PEARL_SURFACE_QUALITY, looseDetails.surfaceQuality), nacreQuality: masterValue(CATEGORIES.PEARL_NACRE_QUALITY, looseDetails.nacreQuality), origin: masterValue(profile === "LOOSE_PEARL" ? CATEGORIES.PEARL_ORIGIN : CATEGORIES.GEMSTONE_ORIGIN, looseDetails.origin),
  });
  return { details, references: refs };
}

async function persistAssetReferences({ models, companyId, assetId, references, transaction }) {
  for (const ref of references) await models.sequelize.query(`INSERT INTO asset_profile_master_data_references
    (id,asset_id,company_id,category_key,master_data_id,value_snapshot,label_snapshot,created_at)
    VALUES (:id,:assetId,:companyId,:categoryKey,:masterDataId,:valueSnapshot,:labelSnapshot,CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING`, {
    replacements: { id: `APMR-${crypto.randomUUID().replaceAll("-", "").slice(0, 25)}`, assetId, companyId, categoryKey: ref.category, masterDataId: ref.master.id, valueSnapshot: ref.master.value, labelSnapshot: ref.master.label }, transaction,
  });
}

module.exports = { CATEGORIES, PROFILE_CATEGORIES, FIELD_CATEGORY, categoryForField, categoriesForProfile, list, create, update, requireActive, resolveLooseReferences, persistAssetReferences };
