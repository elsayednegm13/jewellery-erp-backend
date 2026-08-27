"use strict";

const crypto = require("crypto");
const { DEFAULT_BARCODE_INVENTORY_CODES, DEFAULT_BARCODE_ITEM_CODES } = require("../config/barcode-defaults");
const pearlSizeMasterData = require("./pearl-size-master-data.service");
const profileMasterDataService = require("./profile-master-data.service");
const { V1_PROFILE_MASTER_DATA_ROWS } = require("./inventory-master-data-baseline");

const CANONICAL_DATASET_VERSION = 3;
const DATASET_ID = "INVENTORY_REFERENCE_MASTER_DATA";
const FINAL_PROFILES = Object.freeze([
  "GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K", "GOLD_BY_PIECE",
  "DIAMOND_JEWELLERY", "LOOSE_DIAMOND", "GEMSTONE_JEWELLERY",
  "LOOSE_GEMSTONE", "PEARL_JEWELLERY", "LOOSE_PEARL",
]);
const DIAMOND_PROFILES = Object.freeze(["DIAMOND_JEWELLERY", "LOOSE_DIAMOND"]);
const DIAMOND_JEWELLERY_ONLY = Object.freeze(["DIAMOND_JEWELLERY"]);
const GEM_JEWELLERY_ONLY = Object.freeze(["GEMSTONE_JEWELLERY"]);
const CERTIFICATE_ALIASES = Object.freeze({ Gubelin: "Gübelin" });

const CERTIFICATE_AUTHORITIES = Object.freeze([
  "AGS", "AIGS", "Bellerophon", "DCLA", "EGL", "GCAL", "GIA", "GIT",
  "GRS", "Gübelin", "HRD", "ICA", "IGI", "IIDGR", "Lotus Gemology", "SSEF",
]);
const DIAMOND_TONES = Object.freeze(["Bright", "Cool", "Deep", "Earthy", "Iridescent", "Metallic", "Neutral", "Neon", "Pastel", "Rich", "Smoky", "Soft", "Warm", "Other"]);
const DIAMOND_TONE_LEVELS = Object.freeze(["Extremely Light", "Very Light", "Light", "Medium Light", "Medium", "Medium Dark", "Dark", "Very Dark", "Extremely Dark"]);
const DIAMOND_SATURATIONS = Object.freeze(["Brownish", "Exceptional Vivid", "Faint", "Grayish", "Moderate", "Moderately Strong", "Strong", "Very Strong", "Vivid", "Weak"]);
const STONE_POSITIONS = Object.freeze(["Accent Stone", "Center Stone", "Halo Stone", "Hidden Stone", "Melee Stone", "Other", "Side Stone"]);
const STONE_SETTINGS = Object.freeze([
  "Antique", "Bar", "Basket", "Bead", "Bead & Bright", "Box Bezel", "Bright Cut", "Burnish", "Cathedral", "Channel", "Claw", "Cluster", "Double Halo", "Double Prong", "Eight Prong", "Fishtail", "Five Prong", "Flush", "Four Prong", "French Pavé", "Full Bezel", "Grain", "Gypsy", "Halo Setting", "Half Bezel", "Hidden Halo", "Illusion", "Invisible", "Micro Pavé", "Other Setting", "Partial Bezel", "Pavé", "Peg Head", "Petal Prong", "Rub Over Bezel", "Scallop", "Semi Tension", "Shared Bead", "Shared Prong", "Six Prong", "Star", "Tension", "Three Prong", "Tiffany", "Trellis", "Two Prong", "V-Prong",
]);

function normalizeCertificateAuthority(value) {
  const label = String(value || "").trim();
  return CERTIFICATE_ALIASES[label] || label;
}

function canonicalKey(category, value) {
  return `${String(category).trim().toUpperCase()}:${String(value).trim().toLocaleLowerCase("en-US")}`;
}

function rows(category, values, applicableProfiles, authoritySource, aliases = {}) {
  return values.map((value, index) => ({
    datasetId: DATASET_ID,
    version: CANONICAL_DATASET_VERSION,
    category,
    canonicalKey: canonicalKey(category, value),
    canonicalValue: value.toLocaleLowerCase("en-US"),
    displayLabel: value,
    applicableProfiles,
    activeInitialState: true,
    authoritySource,
    aliases,
    ownership: "SYSTEM_CANONICAL_OWNER_EDITABLE_METADATA",
    sortOrder: (index + 1) * 10,
  }));
}

const R1_PROFILE_MASTER_DATA_ROWS = Object.freeze([
  ...rows("CERTIFICATE_AUTHORITY", CERTIFICATE_AUTHORITIES, FINAL_PROFILES, "FINAL_OWNER_AUTHORITY + Diamond reference", { Gubelin: "Gübelin" }),
  ...rows("DIAMOND_TONE", DIAMOND_TONES, DIAMOND_PROFILES, "Diamond reference"),
  ...rows("DIAMOND_TONE_LEVEL", DIAMOND_TONE_LEVELS, DIAMOND_PROFILES, "Diamond reference"),
  ...rows("DIAMOND_SATURATION", DIAMOND_SATURATIONS, DIAMOND_PROFILES, "Diamond reference"),
  ...rows("DIAMOND_POSITION", STONE_POSITIONS, DIAMOND_JEWELLERY_ONLY, "Diamond reference"),
  ...rows("DIAMOND_SETTING", STONE_SETTINGS, DIAMOND_JEWELLERY_ONLY, "Diamond reference"),
  ...rows("GEMSTONE_POSITION", STONE_POSITIONS, GEM_JEWELLERY_ONLY, "Gem reference"),
  ...rows("GEMSTONE_SETTING", STONE_SETTINGS, GEM_JEWELLERY_ONLY, "Gem reference"),
]);

const R2_PROFILE_MASTER_DATA_ROWS = Object.freeze([
  ...rows("DIAMOND_NAME", ["Diamond"], ["LOOSE_DIAMOND"], "Loose Diamond client authority + FINAL_OWNER_AUTHORITY"),
]);

const CURRENT_PROFILE_MASTER_DATA_ROWS = Object.freeze([
  ...R1_PROFILE_MASTER_DATA_ROWS,
  ...R2_PROFILE_MASTER_DATA_ROWS,
]);

const V1_PROFILE_MASTER_DATA_MANIFEST_ROWS = Object.freeze(V1_PROFILE_MASTER_DATA_ROWS.map((row) => ({
  datasetId: DATASET_ID,
  version: 1,
  category: row.category,
  canonicalKey: canonicalKey(row.category, row.displayLabel),
  canonicalValue: row.canonicalValue,
  displayLabel: row.displayLabel,
  applicableProfiles: FINAL_PROFILES.filter((profile) => profileMasterDataService.categoriesForProfile(profile).includes(row.category)),
  activeInitialState: Boolean(row.isActive),
  authoritySource: "PHASE_03A_POST_03A_OFFICIAL_BASELINE",
  aliases: {},
  ownership: "SYSTEM_CANONICAL_OWNER_EDITABLE_METADATA",
  sortOrder: row.sortOrder,
})));

const DATASET_MANIFEST = Object.freeze({
  datasetId: DATASET_ID,
  version: CANONICAL_DATASET_VERSION,
  authoritySource: "PHASE_03A_FINAL_OWNER_AUTHORITY + PHASE_03A_R1/R1A",
  baseline: Object.freeze({ profileMasterData: 502, pearlSizes: 39, barcodeInventoryCodes: 5, barcodeItemCodes: 20 }),
  profileMasterDataBaselineRows: V1_PROFILE_MASTER_DATA_MANIFEST_ROWS,
  barcodeInventoryCodes: DEFAULT_BARCODE_INVENTORY_CODES,
  barcodeItemCodes: DEFAULT_BARCODE_ITEM_CODES,
  pearlSizes: pearlSizeMasterData.INITIAL_VALUES.map((value) => value.toFixed(1)),
  profileMasterDataRows: CURRENT_PROFILE_MASTER_DATA_ROWS,
  gemstoneTreatmentInitialValues: Object.freeze([]),
});

function manifestHash(manifest = DATASET_MANIFEST) {
  const stable = JSON.stringify({
    datasetId: manifest.datasetId,
    version: manifest.version,
    baseline: manifest.baseline,
    profileMasterDataRows: manifest.profileMasterDataRows,
    pearlSizes: manifest.pearlSizes,
    barcodeInventoryCodes: manifest.barcodeInventoryCodes.map(({ code, assetType, sortOrder }) => ({ code, assetType, sortOrder })),
    barcodeItemCodes: manifest.barcodeItemCodes.map(({ code, allowedInventoryCodes, sortOrder }) => ({ code, allowedInventoryCodes, sortOrder })),
    gemstoneTreatmentInitialValues: manifest.gemstoneTreatmentInitialValues,
  });
  return crypto.createHash("sha256").update(stable).digest("hex");
}

module.exports = {
  DATASET_ID,
  CANONICAL_DATASET_VERSION,
  FINAL_PROFILES,
  CERTIFICATE_ALIASES,
  CERTIFICATE_AUTHORITIES,
  DIAMOND_TONES,
  DIAMOND_TONE_LEVELS,
  DIAMOND_SATURATIONS,
  STONE_POSITIONS,
  STONE_SETTINGS,
  R1_PROFILE_MASTER_DATA_ROWS,
  R2_PROFILE_MASTER_DATA_ROWS,
  CURRENT_PROFILE_MASTER_DATA_ROWS,
  V1_PROFILE_MASTER_DATA_ROWS,
  V1_PROFILE_MASTER_DATA_MANIFEST_ROWS,
  DATASET_MANIFEST,
  canonicalKey,
  normalizeCertificateAuthority,
  manifestHash,
};
