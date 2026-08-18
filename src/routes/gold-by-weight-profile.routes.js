"use strict";

const express = require("express");
const router = express.Router();
const models = require("../models");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const { ValidationError } = require("../utils/errors");
const permissionService = require("../services/permission.service");
const settingsService = require("../services/settings.service");
const companyTaxPolicyService = require("../services/company-tax-policy.service");
const profileMasterDataService = require("../services/profile-master-data.service");
const goldByWeight = require("../services/gold-by-weight-profile.service");
const goldSalePricingService = require("../services/gold-sale-pricing.service");
const barcodeIdentityService = require("../services/barcode-identity.service");
const { readCanonicalGoldHealth } = require("../services/gold-market-health-endpoint.service");

const readGuard = [authMiddleware, requirePermission("inventory.view")];

async function effectiveRate({ companyId, currency, karat }) {
  return goldSalePricingService.resolveCanonicalSellingGoldRate({
    models, companyId, currency, karat,
    cache: { rates: new Map(), snapshots: new Map() },
  });
}

async function resolveRates(input, settings, companyId) {
  const currentRate = input.currentGoldRate || await effectiveRate({ companyId, currency: settings.currency, karat: input.karat });
  const purchaseRate = input.purchaseGoldRate || currentRate;
  return { purchaseRate, currentRate };
}

router.get("/contract", ...readGuard, async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const taxPolicy = await companyTaxPolicyService.getCompanyTaxPolicy(req.companyId);
    const categories = [profileMasterDataService.CATEGORIES.GOLD_ITEM_DESCRIPTION, profileMasterDataService.CATEGORIES.GOLD_COLOR];
    const masters = await profileMasterDataService.list({ models, companyId: req.companyId, categories, activeOnly: true });
    const branchId = req.headers["x-branch-id"] || req.branchId;
    const locations = branchId ? await models.sequelize.query(`SELECT id,code,name,location_type AS "locationType",is_active AS "isActive"
      FROM inventory_locations WHERE company_id=:companyId AND branch_id=:branchId AND is_active=true ORDER BY name,id`, { replacements: { companyId: req.companyId, branchId }, type: models.sequelize.QueryTypes.SELECT }) : [];
    const suppliers = await models.Supplier.findAll({ where: { companyId: req.companyId }, attributes: ["id", "name", "status", "taxNumber"], order: [["name", "ASC"]] });
    const barcode = await barcodeIdentityService.getEffectiveBarcodeSettings(req.companyId);
    const health = await readCanonicalGoldHealth();
    const explicitOverrideConfig = Object.prototype.hasOwnProperty.call(settings._raw || {}, "allowGoldCostOverride") && Object.prototype.hasOwnProperty.call(settings._raw || {}, "goldCostOverridePermission");
    const overridePermission = explicitOverrideConfig ? await permissionService.userHasPermission(req.user, settings.goldCostOverridePermission) : false;
    return res.status(200).json({ success: true, data: {
      profile: { jewellery: goldByWeight.PROFILE_JEWELLERY, bar: goldByWeight.PROFILE_BAR },
      karats: goldByWeight.KARATS,
      jewelleryKarats: goldByWeight.JEWELLERY_KARATS,
      masters,
      suppliers: suppliers.filter((supplier) => String(supplier.status || "").toLowerCase() !== "inactive").map((supplier) => supplier.toJSON()),
      locations,
      statuses: goldByWeight.STATUS,
      conditions: ["NEW", "USED"],
      tagStates: ["PENDING", "PRINTED"],
      currency: settings.currency,
      vat: { enabled: settings.vatEnabled !== false, rate: settings.vatRate, purchaseRate: settings.purchaseVatRate },
      taxPolicy,
      gold: { health, provider: health.provider, mode: health.mode, currency: health.currency, source: "GOLD_CENTER" },
      barcode: { inventoryCodes: barcode.inventoryCodes || [], itemCodes: barcode.itemCodes || [], source: barcode.source || "SERVER" },
      settings: { goldCostSource: settings.goldCostSource, goldCostWeightBasis: settings.goldCostWeightBasis, manualOverride: { available: explicitOverrideConfig && settings.allowGoldCostOverride === true && overridePermission, permission: settings.goldCostOverridePermission, reasonRequired: true } },
      authority: { physicalInventory: "ASSET", quantityAuthority: "NOT_ALLOWED", barcode: "ASSET_BARCODE", currentValuation: "ASSET_CURRENT_VALUATIONS", purchase: "SUPPLIER_V2_RECEIVE" },
      configurationState: { mastersConfigured: masters.length > 0, locationsConfigured: locations.length > 0, settingsRowsConfigured: Object.keys(settings._raw || {}).length > 0 },
    } });
  } catch (error) { return next(error); }
});

router.post("/preview", ...readGuard, async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const input = req.body?.item || req.body || {};
    const rates = await resolveRates(input, settings, req.companyId);
    const result = goldByWeight.calculate({ input, configuredVatRate: settings.vatRate, purchaseGoldRate: rates.purchaseRate, currentGoldRate: rates.currentRate });
    return res.status(200).json({ success: true, readOnly: true, data: { ...result, gold: { purchaseRate: rates.purchaseRate, currentRate: rates.currentRate, purchaseRateSource: input.purchaseGoldRate ? "MANUAL_OR_APPROVED" : "GOLD_CENTER", currentRateSource: "GOLD_CENTER", currency: settings.currency } } });
  } catch (error) { return next(error instanceof Error && error.statusCode ? error : new ValidationError(error.message || "Gold By Weight preview failed.")); }
});

router.post("/sale-preview", ...readGuard, async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const input = req.body?.item || req.body || {};
    const rates = await resolveRates(input, settings, req.companyId);
    const sale = req.body?.sale || {};
    const result = goldByWeight.calculate({ input, configuredVatRate: settings.vatRate, purchaseGoldRate: rates.purchaseRate, currentGoldRate: rates.currentRate, sale: { ...sale, sellingGoldRate: sale.sellingGoldRate || rates.currentRate, makingPerGram: sale.makingPerGram ?? input.makingPerGram } });
    return res.status(200).json({ success: true, readOnly: true, data: { sale: result.sale, currency: settings.currency, source: "GOLD_CENTER" } });
  } catch (error) { return next(error instanceof Error && error.statusCode ? error : new ValidationError(error.message || "Gold By Weight sale preview failed.")); }
});

module.exports = router;
