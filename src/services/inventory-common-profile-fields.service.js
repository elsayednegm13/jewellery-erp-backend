"use strict";

// C3 is a contract boundary, not a second persistence or mutation authority.
// Every field below points at an existing Asset, receive-envelope, lifecycle,
// identity, or financial owner. Keep this registry additive and read-only.

const TOP_LEVEL_PROFILES = Object.freeze([
  "GBW",
  "GBP",
  "DIAMOND",
  "GEM_STONE",
  "PEARL",
]);

const INTERNAL_STRATEGIES = Object.freeze({
  GBW: Object.freeze(["GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K"]),
  GBP: Object.freeze(["GOLD_BY_PIECE"]),
  DIAMOND: Object.freeze(["DIAMOND_JEWELLERY", "LOOSE_DIAMOND"]),
  GEM_STONE: Object.freeze(["GEMSTONE_JEWELLERY", "LOOSE_GEMSTONE"]),
  PEARL: Object.freeze(["PEARL_JEWELLERY", "LOOSE_PEARL"]),
});

const COMMON_FIELD_CONTRACT = Object.freeze([
  Object.freeze({
    key: "description",
    clientRequired: true,
    kind: "DESCRIPTIVE",
    receivePath: "items[].perPiece[].description",
    dbAuthority: "assets.description (assets.name remains the technical NOT NULL display alias)",
    readPaths: ["Asset list", "Asset detail", "profile intake"],
    mutationAuthority: "Supplier Receive V2 at intake; Asset metadata/revision allowlist for descriptive edits",
    editability: "EDITABLE_BY_EXISTING_AUTHORITY",
  }),
  Object.freeze({
    key: "brand",
    clientRequired: true,
    kind: "DESCRIPTIVE",
    receivePath: "items[].perPiece[].brand",
    dbAuthority: "assets.brand",
    readPaths: ["Asset list", "Asset detail", "profile intake where supplied"],
    mutationAuthority: "Asset metadata/revision allowlist",
    editability: "EDITABLE_BY_EXISTING_AUTHORITY",
  }),
  Object.freeze({
    key: "supplierId",
    clientRequired: true,
    kind: "RELATION",
    receivePath: "body.supplierId (piece context is server-resolved)",
    dbAuthority: "suppliers.id + assets.supplier_id + purchase/order origin links",
    readPaths: ["Asset list", "Asset detail", "supplier history"],
    mutationAuthority: "Supplier Receive V2 / supplier master; not generic Asset metadata",
    editability: "RECEIVE_ONLY_FOR_ASSET_LINK",
  }),
  Object.freeze({
    key: "locationId",
    clientRequired: true,
    kind: "SCOPE",
    receivePath: "items[].perPiece[].locationId",
    dbAuthority: "inventory_locations.id + assets.location_id",
    readPaths: ["Asset list", "Asset detail", "movement projections"],
    mutationAuthority: "Supplier Receive V2 and canonical movement/transfer/workshop/count routes",
    editability: "DEDICATED_OPERATION_ONLY",
  }),
  Object.freeze({
    key: "purchaseDate",
    clientRequired: true,
    kind: "SOURCE_DATE",
    receivePath: "body.purchaseDate",
    dbAuthority: "purchase_orders.date + assets.purchase_date + purchase-cost/origin snapshots",
    readPaths: ["Asset list", "Asset detail", "purchase history"],
    mutationAuthority: "Supplier Receive V2 / purchase source",
    editability: "RECEIVE_SOURCE_ONLY",
  }),
  Object.freeze({
    key: "taxTreatment",
    clientRequired: true,
    kind: "TAX_CONTEXT",
    receivePath: "body.taxTreatment",
    dbAuthority: "purchase_orders.tax_treatment + immutable tax_snapshot",
    readPaths: ["receive preview", "purchase order", "tax projections"],
    mutationAuthority: "Company Tax Policy + Tax Engine + Supplier Receive V2",
    editability: "TRANSACTION_ONLY",
  }),
  Object.freeze({
    key: "notes",
    clientRequired: false,
    kind: "DESCRIPTIVE",
    receivePath: "body.notes / items[].perPiece[].notes",
    dbAuthority: "assets.notes plus purchase/event/audit note projections",
    readPaths: ["Asset detail", "audit/timeline", "purchase source"],
    mutationAuthority: "Asset metadata/revision for Asset notes; source/audit owners for transaction notes",
    editability: "EDITABLE_BY_EXISTING_AUTHORITY",
  }),
  Object.freeze({
    key: "barcode",
    clientRequired: true,
    kind: "DEDICATED_IDENTITY",
    receivePath: "server-generated; never a common-field client authority",
    dbAuthority: "assets.barcode + asset_barcode_history",
    readPaths: ["Asset list", "Asset detail", "POS", "tags"],
    mutationAuthority: "Barcode identity service and dedicated replacement route",
    editability: "DEDICATED_OPERATION_ONLY",
  }),
  Object.freeze({
    key: "rfid",
    clientRequired: false,
    kind: "DEDICATED_IDENTITY",
    receivePath: "dedicated RFID assignment; receive value is not a generic metadata write",
    dbAuthority: "asset_rfid_assignments",
    readPaths: ["Asset list", "Asset detail", "RFID scan/history"],
    mutationAuthority: "Dedicated RFID assignment/replacement/unassign routes",
    editability: "DEDICATED_OPERATION_ONLY",
  }),
  Object.freeze({
    key: "inventoryProfile",
    clientRequired: true,
    kind: "DEDICATED_IDENTITY",
    receivePath: "items[].perPiece[].profile",
    dbAuthority: "PROFILE_REGISTRY + assets.inventory_profile/type/item-code identity",
    readPaths: ["profile registry", "Asset list", "Asset detail"],
    mutationAuthority: "Profile registry and canonical Supplier Receive V2",
    editability: "IMMUTABLE_IDENTITY",
  }),
  Object.freeze({
    key: "branchId",
    clientRequired: true,
    kind: "DEDICATED_SCOPE",
    receivePath: "server-authoritative request context",
    dbAuthority: "assets.branch_id + company/branch context",
    readPaths: ["Asset list", "Asset detail", "all scoped projections"],
    mutationAuthority: "Company/Branch authorization and lifecycle routes",
    editability: "SERVER_AUTHORITY_ONLY",
  }),
  Object.freeze({
    key: "operationalStatus",
    clientRequired: true,
    kind: "DEDICATED_LIFECYCLE",
    receivePath: "server-created initial state; no client status input",
    dbAuthority: "assets.operational_status + Asset Events",
    readPaths: ["Asset list", "Asset detail", "POS", "count", "lifecycle projections"],
    mutationAuthority: "Canonical lifecycle transition routes",
    editability: "DEDICATED_OPERATION_ONLY",
  }),
  Object.freeze({
    key: "createdBy",
    clientRequired: true,
    kind: "AUDIT_SYSTEM",
    receivePath: "server actor context",
    dbAuthority: "assets.created_by + Asset Events/Audit Log",
    readPaths: ["Asset detail", "audit/timeline"],
    mutationAuthority: "Server actor/audit context",
    editability: "SERVER_DERIVED",
  }),
  Object.freeze({
    key: "createdAt",
    clientRequired: true,
    kind: "AUDIT_SYSTEM",
    receivePath: "server timestamp",
    dbAuthority: "assets.created_at + Asset Events/Audit Log",
    readPaths: ["Asset list", "Asset detail", "audit/timeline"],
    mutationAuthority: "Server timestamp/audit context",
    editability: "SERVER_DERIVED",
  }),
  Object.freeze({
    key: "auditLog",
    clientRequired: true,
    kind: "AUDIT_SYSTEM",
    receivePath: "server event/audit emission",
    dbAuthority: "asset_events + audit logs + source links",
    readPaths: ["Asset detail timeline", "audit projections"],
    mutationAuthority: "Audit/Event authority",
    editability: "SERVER_DERIVED",
  }),
]);

const DEDICATED_AUTHORITY_FIELDS = Object.freeze([
  "assetId", "barcode", "rfid", "inventoryCode", "itemCode", "karat", "grossWeight", "netWeight",
  "quantity", "operationalStatus", "status", "branchId", "locationId", "movement", "purchaseCost",
  "sellingPrice", "valuation", "tax", "journal", "invoiceId", "inventoryProfile",
]);

const FIELD_KEYS = new Set(COMMON_FIELD_CONTRACT.map((field) => field.key));
const DEDICATED_FIELD_SET = new Set(DEDICATED_AUTHORITY_FIELDS);

function topLevelProfileForStrategy(strategy) {
  const normalized = String(strategy || "").trim().toUpperCase();
  return TOP_LEVEL_PROFILES.find((profile) => INTERNAL_STRATEGIES[profile].includes(normalized)) || null;
}

function classifyField(fieldKey) {
  const key = String(fieldKey || "").trim();
  if (FIELD_KEYS.has(key)) return COMMON_FIELD_CONTRACT.find((field) => field.key === key);
  if (DEDICATED_FIELD_SET.has(key)) return Object.freeze({ key, kind: "DEDICATED_AUTHORITY", status: "DEDICATED_AUTHORITY" });
  return null;
}

function assertCommonField(fieldKey) {
  const field = classifyField(fieldKey);
  if (!field) {
    const error = new Error("COMMON_PROFILE_FIELD_NOT_ALLOWED");
    error.code = "COMMON_PROFILE_FIELD_NOT_ALLOWED";
    throw error;
  }
  if (field.kind === "DEDICATED_AUTHORITY" || field.kind.startsWith("DEDICATED_") || field.editability === "DEDICATED_OPERATION_ONLY" || field.editability === "IMMUTABLE_IDENTITY" || field.editability === "SERVER_AUTHORITY_ONLY") {
    const error = new Error("COMMON_PROFILE_DEDICATED_AUTHORITY_REQUIRED");
    error.code = "COMMON_PROFILE_DEDICATED_AUTHORITY_REQUIRED";
    throw error;
  }
  return field;
}

function getPublicContract() {
  return Object.freeze({
    version: 1,
    topLevelProfiles: TOP_LEVEL_PROFILES,
    internalStrategies: INTERNAL_STRATEGIES,
    fields: COMMON_FIELD_CONTRACT,
    invariants: Object.freeze({
      stableAssetId: "assets.id",
      duplicateAuthority: false,
      profileSpecificExtension: true,
      backwardCompatibility: true,
      serverAuthoritativeScope: true,
      supplierReceiveV2Canonical: true,
      physicalQuantityAuthority: false,
    }),
  });
}

module.exports = {
  TOP_LEVEL_PROFILES,
  INTERNAL_STRATEGIES,
  COMMON_FIELD_CONTRACT,
  DEDICATED_AUTHORITY_FIELDS,
  topLevelProfileForStrategy,
  classifyField,
  assertCommonField,
  getPublicContract,
};
