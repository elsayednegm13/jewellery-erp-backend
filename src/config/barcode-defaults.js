"use strict";

// Phase 32.1-Fix — bootstrap/fallback taxonomy only. Runtime barcode identity
// always resolves the company-scoped database rows first.
const CLIENT_INVENTORY_CODES = ["GW", "GP", "DD", "GS", "PL"];

const DEFAULT_BARCODE_INVENTORY_CODES = Object.freeze([
  { code: "GW", displayName: "Gold By Weight", assetType: "gold-weight", description: "Client-approved Gold By Weight inventory code", isActive: true, isClientApproved: true, isProvisional: false, requiresKarat: true, defaultKaratCode: null, defaultItemCode: null, sortOrder: 10 },
  { code: "GP", displayName: "Gold By Piece", assetType: "gold-piece", description: "Client-approved Gold By Piece inventory code", isActive: true, isClientApproved: true, isProvisional: false, requiresKarat: true, defaultKaratCode: null, defaultItemCode: null, sortOrder: 20 },
  { code: "DD", displayName: "Diamond", assetType: "diamond", description: "Client-approved Diamond inventory code", isActive: true, isClientApproved: true, isProvisional: false, requiresKarat: true, defaultKaratCode: null, defaultItemCode: null, sortOrder: 30 },
  { code: "GS", displayName: "Gem Stone", assetType: "gemstone", description: "Client-approved Gem Stone inventory code", isActive: true, isClientApproved: true, isProvisional: false, requiresKarat: true, defaultKaratCode: null, defaultItemCode: null, sortOrder: 40 },
  { code: "PL", displayName: "Pearl", assetType: "pearl", description: "Client-approved Pearl inventory code", isActive: true, isClientApproved: true, isProvisional: false, requiresKarat: true, defaultKaratCode: null, defaultItemCode: null, sortOrder: 50 },
  { code: "WT", displayName: "Watch", assetType: "watch", description: "Owner-approved provisional system extension pending client confirmation", isActive: true, isClientApproved: false, isProvisional: true, requiresKarat: false, defaultKaratCode: "00", defaultItemCode: "WCH", sortOrder: 60 },
]);

const CLIENT_ITEM_CODES = Object.freeze([
  ["ANK", "Anklet"], ["BGL", "Bangle"], ["BAR", "Bar"],
  ["BRC", "Bracelet"], ["BRH", "Brooch"], ["CHN", "Chain"],
  ["CHK", "Choker"], ["CON", "Coin"], ["CRW", "Crown"],
  ["ERG", "Earrings"], ["FST", "Full Set"], ["LOS", "Loose Stone"],
  ["NCK", "Necklace"], ["PND", "Pendant"], ["PCH", "Pendant Chain"],
  ["RNG", "Ring"], ["TRN", "Twins Ring"], ["WRN", "Wedding Band"],
]);

const DEFAULT_BARCODE_ITEM_CODES = Object.freeze([
  ...CLIENT_ITEM_CODES.map(([code, displayName], index) => ({
    code,
    displayName,
    description: `Client-approved ${displayName} item code`,
    isActive: true,
    isClientApproved: true,
    isProvisional: false,
    allowedInventoryCodes: CLIENT_INVENTORY_CODES,
    sortOrder: (index + 1) * 10,
  })),
  {
    code: "WCH",
    displayName: "Watch",
    description: "Owner-approved provisional system extension pending client confirmation",
    isActive: true,
    isClientApproved: false,
    isProvisional: true,
    allowedInventoryCodes: ["WT"],
    sortOrder: 190,
  },
]);

module.exports = {
  DEFAULT_BARCODE_INVENTORY_CODES,
  DEFAULT_BARCODE_ITEM_CODES,
};
