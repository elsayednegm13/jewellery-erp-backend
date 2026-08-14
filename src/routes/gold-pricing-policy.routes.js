"use strict";

const express = require("express");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const policyService = require("../services/gold-pricing-policy.service");
const marketAdminService = require("../services/gold-market-admin.service");
const { ValidationError } = require("../utils/errors");

const router = express.Router();
const context = (req) => ({ companyId: req.companyId, branchId: req.branchId, user: req.user });

router.get("/policies/current", authMiddleware, requirePermission(policyService.READ_PERMISSION), async (req, res, next) => {
  try {
    const karat = Number(req.query.karat);
    if (!Number.isInteger(karat)) throw new ValidationError("karat is required", { karat: ["required"] });
    const result = await policyService.resolvePolicy({ companyId: req.companyId, karat, businessContext: req.query.businessContext || "CGP", now: new Date() });
    return res.status(200).json({ success: true, data: { policy: result.policy, policyScope: result.policyScope, resolution: result.resolution } });
  } catch (error) { return next(error); }
});

router.get("/policies/history", authMiddleware, requirePermission(policyService.READ_PERMISSION), async (req, res, next) => {
  try {
    const karat = req.query.karat === undefined ? null : Number(req.query.karat);
    if (karat !== null && !Number.isInteger(karat)) throw new ValidationError("karat is invalid", { karat: ["invalid"] });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 25));
    const data = await policyService.listPolicyHistory({ companyId: req.companyId, businessContext: req.query.businessContext || "CGP", karat, scopeType: req.query.scopeType || null, page, pageSize, paginate: true });
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.get("/market/settings", authMiddleware, requirePermission(marketAdminService.READ_PERMISSION), async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: await marketAdminService.currentState(req.companyId) }); } catch (error) { return next(error); }
});

router.put("/market/settings", authMiddleware, requirePermission(marketAdminService.MANAGE_PERMISSION), async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: await marketAdminService.updateSettings({ context: context(req), input: req.body || {} }) }); } catch (error) { return next(error); }
});

router.post("/market/test-connection", authMiddleware, requirePermission(marketAdminService.MANAGE_PERMISSION), async (req, res, next) => {
  try {
    const body = req.body || {};
    const settings = await marketAdminService.currentState(req.companyId);
    const providerId = body.providerId || settings.settings.activeProvider;
    const currency = body.currency || settings.settings.marketCurrency;
    const { testConnection } = require("../services/gold-market-test-connection.service");
    const result = await testConnection({ providerId, currency, staleAfterSeconds: body.staleAfterSeconds || settings.settings.staleAfterSeconds });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
});

router.get("/market/quotes/history", authMiddleware, requirePermission(marketAdminService.READ_PERMISSION), async (req, res, next) => {
  try {
    const data = await marketAdminService.listQuoteHistory({ companyId: req.companyId, provider: req.query.provider || null, currency: req.query.currency || null, page: req.query.page, pageSize: req.query.pageSize });
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.post("/policies/versions", authMiddleware, requirePermission(policyService.PRICING_POLICY_PERMISSION), async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = await policyService.createPolicyVersion({
      context: context(req),
      input: body,
      activate: body.activate === true,
      supersedesPolicyId: body.supersedesPolicyId || null,
      reason: body.reason || null,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.post("/policies/:id/activate", authMiddleware, requirePermission(policyService.PRICING_POLICY_PERMISSION), async (req, res, next) => {
  try {
    const data = await policyService.activatePolicyVersion({ context: context(req), policyId: req.params.id, reason: req.body?.reason || null });
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

module.exports = router;
