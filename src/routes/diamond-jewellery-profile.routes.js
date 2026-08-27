"use strict";

const express = require("express");
const router = express.Router();
const models = require("../models");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const { ValidationError } = require("../utils/errors");
const settingsService = require("../services/settings.service");
const companyTaxPolicyService = require("../services/company-tax-policy.service");
const profileMasterDataService = require("../services/profile-master-data.service");
const diamond = require("../services/diamond-jewellery-profile.service");
const barcodeIdentityService = require("../services/barcode-identity.service");
const { readCanonicalGoldHealth } = require("../services/gold-market-health-endpoint.service");

const readGuard = [authMiddleware, requirePermission("inventory.view")];

router.get("/contract", ...readGuard, async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const taxPolicy = await companyTaxPolicyService.getCompanyTaxPolicy(req.companyId);
    const categories = ["GOLD_ITEM_DESCRIPTION", ...profileMasterDataService.categoriesForProfile(diamond.PROFILE)];
    const masters = await profileMasterDataService.list({ models, companyId: req.companyId, categories, activeOnly: true });
    const branchId = req.headers["x-branch-id"] || req.branchId;
    const locations = branchId ? await models.sequelize.query(`SELECT id,code,name,location_type AS "locationType",is_active AS "isActive" FROM inventory_locations WHERE company_id=:companyId AND branch_id=:branchId AND is_active=true ORDER BY name,id`, { replacements: { companyId: req.companyId, branchId }, type: models.sequelize.QueryTypes.SELECT }) : [];
    const suppliers = await models.Supplier.findAll({ where: { companyId: req.companyId }, attributes: ["id", "name", "status", "taxNumber"], order: [["name", "ASC"]], raw: true });
    const barcode = await barcodeIdentityService.getEffectiveBarcodeSettings(req.companyId);
    const health = await readCanonicalGoldHealth();
    return res.status(200).json({ success: true, readOnly: true, data: diamond.contract({
      masters, suppliers: suppliers.filter((row) => String(row.status || "").toLowerCase() !== "inactive"), locations, taxPolicy,
      gold: { health, provider: health.provider, currency: diamond.CURRENCY, unit: diamond.GOLD_UNIT, rateSource: "GOLD_CENTER_GLOBAL_SPOT" },
      barcode: { ...barcode, requiredInventoryCode: "DD", source: barcode.source || "SERVER" },
      settings: { vatEnabled: settings.vatEnabled !== false },
    }) });
  } catch (error) { return next(error); }
});

router.post("/preview", ...readGuard, async (req, res, next) => {
  try {
    const settings = await settingsService.getCompanySettings(req.companyId);
    const taxPolicy = await companyTaxPolicyService.getCompanyTaxPolicy(req.companyId);
    const categories = ["GOLD_ITEM_DESCRIPTION", ...profileMasterDataService.categoriesForProfile(diamond.PROFILE)];
    const masters = await profileMasterDataService.list({ models, companyId: req.companyId, categories, activeOnly: true });
    const input = req.body?.item || req.body || {};
    const result = await diamond.calculatePreview({ companyId: req.companyId, input, settings, taxPolicy, masterData: diamond.masterIndex(masters) });
    return res.status(200).json({ success: true, readOnly: true, data: result });
  } catch (error) {
    if (!error.statusCode) { const wrapped = diamond.toValidationError(error) || new ValidationError(error.message || "Diamond Jewellery preview failed."); wrapped.errorCode = wrapped.errorCode || error.code || error.message; return next(wrapped); }
    return next(error);
  }
});

module.exports = router;
