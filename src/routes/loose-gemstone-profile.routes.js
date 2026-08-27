"use strict";

const express = require("express");
const router = express.Router();
const models = require("../models");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const settingsService = require("../services/settings.service");
const companyTaxPolicyService = require("../services/company-tax-policy.service");
const profileMasterDataService = require("../services/profile-master-data.service");
const barcodeIdentityService = require("../services/barcode-identity.service");
const profile = require("../services/loose-gemstone-profile.service");
const { ValidationError } = require("../utils/errors");

const readGuard = [authMiddleware, requirePermission("inventory.view")];

async function context(req) {
  const settings = await settingsService.getCompanySettings(req.companyId);
  const taxPolicy = await companyTaxPolicyService.getCompanyTaxPolicy(req.companyId);
  const categories = profileMasterDataService.categoriesForProfile(profile.PROFILE);
  const masters = await profileMasterDataService.list({ models, companyId: req.companyId, categories, activeOnly: true });
  const branchId = req.headers["x-branch-id"] || req.branchId;
  const locations = branchId ? await models.sequelize.query(`
    SELECT id,code,name,location_type AS "locationType",is_active AS "isActive"
      FROM inventory_locations
     WHERE company_id=:companyId AND branch_id=:branchId AND is_active=true
     ORDER BY name,id`, { replacements: { companyId: req.companyId, branchId }, type: models.sequelize.QueryTypes.SELECT }) : [];
  const suppliers = await models.Supplier.findAll({ where: { companyId: req.companyId }, attributes: ["id", "name", "status", "taxNumber"], order: [["name", "ASC"]], raw: true });
  const barcode = await barcodeIdentityService.getEffectiveBarcodeSettings(req.companyId);
  return { settings, taxPolicy, masters, locations, suppliers: suppliers.filter((row) => String(row.status || "").toLowerCase() !== "inactive"), barcode };
}

router.get("/contract", ...readGuard, async (req, res, next) => {
  try { const data = await context(req); return res.status(200).json({ success: true, readOnly: true, data: profile.contract(data) }); }
  catch (error) { return next(error); }
});

router.post("/preview", ...readGuard, async (req, res, next) => {
  try {
    const data = await context(req);
    const input = req.body?.item || req.body || {};
    return res.status(200).json({ success: true, readOnly: true, data: profile.calculatePreview({ input, taxPolicy: data.taxPolicy, masters: data.masters }) });
  } catch (error) {
    if (!error.statusCode) { const wrapped = new ValidationError(error.message || "Loose Gemstone preview failed."); wrapped.errorCode = error.errorCode || error.code || error.message; return next(wrapped); }
    return next(error);
  }
});

module.exports = router;
