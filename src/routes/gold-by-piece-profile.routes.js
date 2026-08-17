"use strict";

const express = require("express");
const router = express.Router();
const models = require("../models");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const { ValidationError } = require("../utils/errors");
const settingsService = require("../services/settings.service");
const permissionService = require("../services/permission.service");
const profileMasterDataService = require("../services/profile-master-data.service");
const goldByPiece = require("../services/gold-by-piece-profile.service");
const barcodeIdentityService = require("../services/barcode-identity.service");
const { readCanonicalGoldHealth } = require("../services/gold-market-health-endpoint.service");

const readGuard = [authMiddleware, requirePermission("inventory.view")];

router.get("/contract", ...readGuard, async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const categories = [profileMasterDataService.CATEGORIES.GOLD_ITEM_DESCRIPTION, profileMasterDataService.CATEGORIES.GOLD_COLOR];
    const masters = await profileMasterDataService.list({ models, companyId: req.companyId, categories, activeOnly: true });
    const branchId = req.headers["x-branch-id"] || req.branchId;
    const locations = branchId ? await models.sequelize.query(`SELECT id,code,name,location_type AS "locationType",is_active AS "isActive"
      FROM inventory_locations WHERE company_id=:companyId AND branch_id=:branchId AND is_active=true ORDER BY name,id`, { replacements: { companyId: req.companyId, branchId }, type: models.sequelize.QueryTypes.SELECT }) : [];
    const suppliers = await models.Supplier.findAll({ where: { companyId: req.companyId }, attributes: ["id", "name", "status"], order: [["name", "ASC"]] });
    const barcode = await barcodeIdentityService.getEffectiveBarcodeSettings(req.companyId);
    const health = await readCanonicalGoldHealth();
    const explicitOverrideConfig = Object.prototype.hasOwnProperty.call(settings._raw || {}, "allowGoldCostOverride") && Object.prototype.hasOwnProperty.call(settings._raw || {}, "goldCostOverridePermission");
    const overridePermission = explicitOverrideConfig ? await permissionService.userHasPermission(req.user, settings.goldCostOverridePermission) : false;
    const currentRateMode = goldByPiece.resolveCurrentRateMode(settings);
    const retailConfigured = false;
    return res.status(200).json({ success: true, data: {
      profile: goldByPiece.PROFILE,
      karats: goldByPiece.KARATS,
      masters,
      suppliers: suppliers.filter((supplier) => String(supplier.status || "").toLowerCase() !== "inactive").map((supplier) => supplier.toJSON()),
      locations,
      conditions: ["NEW", "USED"],
      tagStates: ["PENDING", "PRINTED"],
      currency: goldByPiece.CURRENCY,
      vat: { enabled: settings.vatEnabled !== false, rate: settings.vatRate, purchaseRate: settings.purchaseVatRate },
      gold: { health, provider: health.provider, mode: health.mode, currency: goldByPiece.CURRENCY, source: "GOLD_CENTER", rateTypes: ["GLOBAL", "RETAIL"], retailAvailable: retailConfigured },
      currentCost: { rateMode: currentRateMode, allowedRateModes: ["GLOBAL", "RETAIL"], retailAvailable: retailConfigured, retailStatus: "NOT_CONFIGURED_FAIL_CLOSED" },
      settings: { manualOverride: { available: explicitOverrideConfig && settings.allowGoldCostOverride === true && overridePermission, permission: settings.goldCostOverridePermission, reasonRequired: true } },
      barcode: { inventoryCodes: barcode.inventoryCodes || [], itemCodes: barcode.itemCodes || [], source: barcode.source || "SERVER" },
      authority: { physicalInventory: "ASSET", quantityAuthority: "NOT_ALLOWED", barcode: "ASSET_BARCODE", currentValuation: "ASSET_CURRENT_VALUATIONS", purchase: "SUPPLIER_V2_RECEIVE", rate: "GOLD_CENTER_GLOBAL_SPOT" },
      configurationState: { mastersConfigured: masters.length > 0, locationsConfigured: locations.length > 0, settingsRowsConfigured: Object.keys(settings._raw || {}).length > 0 },
    } });
  } catch (error) { return next(error); }
});

async function runPreview(req) {
  const settings = await settingsService.getCompanySettings(req.companyId);
  const input = req.body?.item || req.body || {};
  return goldByPiece.calculateWithLiveRates({ companyId: req.companyId, settings, input });
}

router.post("/preview", ...readGuard, async (req, res, next) => {
  try {
    const result = await runPreview(req);
    return res.status(200).json({ success: true, readOnly: true, data: result });
  } catch (error) { return next(error instanceof Error && error.statusCode ? error : new ValidationError(error.message || "Gold By Piece preview failed.")); }
});

router.post("/sale-preview", ...readGuard, async (req, res, next) => {
  try {
    const result = await runPreview(req);
    return res.status(200).json({ success: true, readOnly: true, data: { sale: result.sale, current: result.current, gold: result.gold, currency: goldByPiece.CURRENCY } });
  } catch (error) { return next(error instanceof Error && error.statusCode ? error : new ValidationError(error.message || "Gold By Piece sale preview failed.")); }
});

module.exports = router;
