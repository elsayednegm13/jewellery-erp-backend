"use strict";

const express = require("express");
const router = express.Router();
const models = require("../models");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const { ValidationError } = require("../utils/errors");
const settingsService = require("../services/settings.service");
const companyTaxPolicyService = require("../services/company-tax-policy.service");
const profileMasterDataService = require("../services/profile-master-data.service");
const pearlSizeMasterDataService = require("../services/pearl-size-master-data.service");
const pearl = require("../services/pearl-jewellery-profile.service");
const barcodeIdentityService = require("../services/barcode-identity.service");
const { readCanonicalGoldHealth } = require("../services/gold-market-health-endpoint.service");

const readGuard = [authMiddleware, requirePermission("inventory.view")];

async function context(req) {
  const settings = await settingsService.getCompanySettings(req.companyId);
  const taxPolicy = await companyTaxPolicyService.getCompanyTaxPolicy(req.companyId);
  const categories = profileMasterDataService.categoriesForProfile(pearl.PROFILE);
  const masters = await profileMasterDataService.list({ models, companyId: req.companyId, categories, activeOnly: true });
  const pearlSizes = await pearlSizeMasterDataService.list({ models, companyId: req.companyId, activeOnly: true });
  const branchId = req.headers["x-branch-id"] || req.branchId;
  const locations = branchId ? await models.sequelize.query(`SELECT id,code,name,location_type AS "locationType",is_active AS "isActive" FROM inventory_locations WHERE company_id=:companyId AND branch_id=:branchId AND is_active=true ORDER BY name,id`, { replacements: { companyId: req.companyId, branchId }, type: models.sequelize.QueryTypes.SELECT }) : [];
  const suppliers = await models.Supplier.findAll({ where: { companyId: req.companyId }, attributes: ["id", "name", "status", "taxNumber"], order: [["name", "ASC"]], raw: true });
  const barcode = await barcodeIdentityService.getEffectiveBarcodeSettings(req.companyId);
  const health = await readCanonicalGoldHealth();
  return { settings, taxPolicy, masters, masterData: pearl.masterIndex(masters), pearlSizes, suppliers: suppliers.filter((row) => String(row.status || "").toLowerCase() !== "inactive"), locations, barcode, health };
}

router.get("/contract", ...readGuard, async (req, res, next) => {
  try {
    const ctx = await context(req);
    return res.status(200).json({ success: true, readOnly: true, data: { ...pearl.contract({ masters: ctx.masters, pearlSizes: ctx.pearlSizes, suppliers: ctx.suppliers, locations: ctx.locations, taxPolicy: ctx.taxPolicy, gold: { health: ctx.health, provider: ctx.health.provider, currency: pearl.CURRENCY, unit: pearl.GOLD_UNIT, rateSource: "GOLD_CENTER_GLOBAL_SPOT" }, barcode: { ...ctx.barcode, requiredInventoryCode: "PL", source: ctx.barcode.source || "SERVER" } }), settings: { vatEnabled: ctx.settings.vatEnabled !== false } } });
  } catch (error) { return next(error); }
});

router.post("/preview", ...readGuard, async (req, res, next) => {
  try {
    const ctx = await context(req);
    const result = await pearl.calculatePreview({ companyId: req.companyId, input: req.body?.item || req.body || {}, taxPolicy: ctx.taxPolicy, masterData: ctx.masterData, pearlSizes: ctx.pearlSizes });
    return res.status(200).json({ success: true, readOnly: true, data: result });
  } catch (error) {
    if (!error.statusCode) return next(Object.assign(new ValidationError(error.message || "Pearl Jewellery preview failed."), { errorCode: error.errorCode || error.message }));
    return next(error);
  }
});

module.exports = router;
