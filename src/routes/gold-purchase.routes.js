const express = require("express");
const models = require("../models");
const draftService = require("../services/gold-purchase-draft.service");
const idempotencyService = require("../services/idempotency.service");
const permissionService = require("../services/permission.service");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const { AppError, ForbiddenError } = require("../utils/errors");

const router = express.Router();

const context = (req) => ({ companyId: req.companyId, branchId: req.branchId, user: req.user });

async function historicalAllowed(req) {
  const requested = String(req.query.includeVoided || "").toLowerCase() === "true";
  if (!requested) return false;
  if (!(await permissionService.userHasPermission(req.user, "audit.view"))) throw new ForbiddenError("Historical Gold Purchase drafts require audit access");
  return true;
}

async function idempotent(req, res, next, { scope, statusCode, execute }) {
  const key = req.headers["idempotency-key"] || req.body?.idempotencyKey;
  if (!key) return next(new AppError("Idempotency-Key header is required", 400, "IDEMPOTENCY_KEY_REQUIRED"));
  const requestHash = idempotencyService.hashRequest(scope, req.body, req.params);
  const transaction = await models.sequelize.transaction();
  try {
    const claim = await idempotencyService.claim({ models, companyId: req.companyId, scope, key, requestHash, transaction });
    if (!claim.claimed) {
      await transaction.rollback();
      const prior = await idempotencyService.resolveExisting({ models, companyId: req.companyId, scope, key, requestHash });
      if (prior.state === "replay") return res.status(prior.statusCode || statusCode).json(prior.responseBody);
      throw new AppError(prior.message, 409, "CONFLICT");
    }
    const data = await execute(transaction);
    const body = { success: true, data };
    await idempotencyService.succeed({ request: claim.request, statusCode, responseBody: body, transaction });
    await transaction.commit();
    return res.status(statusCode).json(body);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    return next(error);
  }
}

function bind(kind, readPermission, createPermission, updatePermission) {
  router.post(`/${kind}/drafts`, authMiddleware, requirePermission(createPermission), (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.create`, statusCode: 201, execute: (t) => draftService.create(kind, context(req), req.body || {}, t) }));

  router.get(`/${kind}/drafts`, authMiddleware, requirePermission(readPermission), async (req, res, next) => {
    try { return res.status(200).json({ success: true, data: await draftService.list(kind, context(req), req.query || {}, await historicalAllowed(req)) }); }
    catch (error) { return next(error); }
  });

  router.get(`/${kind}/drafts/:id`, authMiddleware, requirePermission(readPermission), async (req, res, next) => {
    try {
      const includeVoided = await historicalAllowed(req);
      const document = await draftService.findScoped(kind, context(req), req.params.id, null, { includeVoided });
      return res.status(200).json({ success: true, data: draftService.serialize(document) });
    } catch (error) { return next(error); }
  });

  router.patch(`/${kind}/drafts/:id`, authMiddleware, requirePermission(updatePermission), async (req, res, next) => {
    const t = await models.sequelize.transaction();
    try { const data = await draftService.update(kind, context(req), req.params.id, req.body || {}, t); await t.commit(); return res.status(200).json({ success: true, data }); }
    catch (error) { if (!t.finished) await t.rollback(); return next(error); }
  });

  router.post(`/${kind}/drafts/:id/validate`, authMiddleware, requirePermission(updatePermission), (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.validate`, statusCode: 200, execute: (t) => draftService.validate(kind, context(req), req.params.id, req.body?.version, t) }));

  router.post(`/${kind}/drafts/:id/void`, authMiddleware, requirePermission(updatePermission), (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.void`, statusCode: 200, execute: (t) => draftService.voidDraft(kind, context(req), req.params.id, req.body || {}, t) }));
}

bind("cgp", "sales.view", "sales.create", "sales.create");
bind("igp", "suppliers.view", "suppliers.create", "suppliers.update");

module.exports = router;
