const express = require("express");
const models = require("../models");
const draftService = require("../services/gold-purchase-draft.service");
const governanceService = require("../services/gold-purchase-governance.service");
const cgpPostingService = require("../services/cgp-posting.service");
const cgpReversalHoldService = require("../services/cgp-reversal-hold.service");
const cgpReversalCompensationService = require("../services/cgp-reversal-compensation.service");
const idempotencyService = require("../services/idempotency.service");
const permissionService = require("../services/permission.service");
const { authMiddleware } = require("../middleware/auth.middleware");
const { AppError, ForbiddenError } = require("../utils/errors");

const router = express.Router();
const LEGACY = {
  cgp: { read: "sales.view", create: "sales.create", update_draft: "sales.create", validate: "sales.create", void: "sales.create" },
  igp: { read: "suppliers.view", create: "suppliers.create", update_draft: "suppliers.update", validate: "suppliers.update", void: "suppliers.update" }
};

const context = (req) => ({ companyId: req.companyId, branchId: req.branchId, user: req.user });

function authorizeDraft(kind, action) {
  return async (req, _res, next) => {
    try {
      const names = new Set(await permissionService.getUserPermissionNames(req.user));
      const prefix = `gold_purchase.${kind}`;
      if (names.has(`${prefix}.view`)) {
        if (action !== "read" && !names.has(`${prefix}.${action}`)) throw new ForbiddenError(`${prefix}.${action} is required`);
        await draftService.accessProfile(kind, context(req));
        return next();
      }
      const fallback = LEGACY[kind][action];
      if (!fallback || !names.has(fallback)) throw new ForbiddenError("Gold Purchase permission is required");
      return next();
    } catch (error) { return next(error); }
  };
}

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

router.get("/approvals", authMiddleware, async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: await governanceService.listApprovals(context(req), req.query || {}) }); }
  catch (error) { return next(error); }
});

router.get("/approvals/:id", authMiddleware, async (req, res, next) => {
  try { return res.status(200).json({ success: true, data: await governanceService.getApproval(context(req), req.params.id) }); }
  catch (error) { return next(error); }
});

function bind(kind) {
  router.post(`/${kind}/drafts`, authMiddleware, authorizeDraft(kind, "create"), (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.create`, statusCode: 201, execute: (t) => draftService.create(kind, context(req), req.body || {}, t) }));

  router.get(`/${kind}/drafts`, authMiddleware, authorizeDraft(kind, "read"), async (req, res, next) => {
    try { return res.status(200).json({ success: true, data: await draftService.list(kind, context(req), req.query || {}, await historicalAllowed(req)) }); }
    catch (error) { return next(error); }
  });

  router.get(`/${kind}/drafts/:id`, authMiddleware, authorizeDraft(kind, "read"), async (req, res, next) => {
    try {
      const includeVoided = await historicalAllowed(req);
      const document = await draftService.findScoped(kind, context(req), req.params.id, null, { includeVoided });
      const data = draftService.serialize(document);
      data.approvalHistory = await governanceService.history(kind, context(req), req.params.id);
      return res.status(200).json({ success: true, data });
    } catch (error) { return next(error); }
  });

  router.patch(`/${kind}/drafts/:id`, authMiddleware, authorizeDraft(kind, "update_draft"), async (req, res, next) => {
    const transaction = await models.sequelize.transaction();
    try { const data = await draftService.update(kind, context(req), req.params.id, req.body || {}, transaction); await transaction.commit(); return res.status(200).json({ success: true, data }); }
    catch (error) { if (!transaction.finished) await transaction.rollback(); return next(error); }
  });

  router.post(`/${kind}/drafts/:id/validate`, authMiddleware, authorizeDraft(kind, "validate"), (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.validate`, statusCode: 200, execute: (t) => draftService.validate(kind, context(req), req.params.id, req.body?.version, t) }));

  if (kind === "cgp") {
    router.post("/cgp/drafts/:id/post", authMiddleware, (req, res, next) =>
      idempotent(req, res, next, {
        scope: "gold-purchase.cgp.post",
        statusCode: 200,
        execute: (t) => cgpPostingService.post({
          context: { ...context(req), causationId: req.headers["x-causation-id"] || null },
          id: req.params.id,
          expectedVersion: req.body?.version,
          correlationId: req.headers["x-correlation-id"] || null,
          transaction: t,
        }),
      }));

    // This is intentionally a request-only operation.  The explicit
    // Inventory consumer owns the later Asset hold; no HTTP handler can
    // directly mutate an Asset operational state.
    router.post("/cgp/drafts/:id/reversal-holds", authMiddleware, (req, res, next) =>
      idempotent(req, res, next, {
        scope: "gold-purchase.cgp.reverse-hold",
        statusCode: 202,
        execute: (t) => cgpReversalHoldService.requestHold({
          context: context(req), cgpDocumentId: req.params.id, reason: req.body?.reason,
          idempotencyKey: req.headers["idempotency-key"] || req.body?.idempotencyKey,
          correlationId: req.headers["x-correlation-id"] || null,
          causationId: req.headers["x-causation-id"] || null, transaction: t,
        }),
      }));

    // CGP-IMP-10 remains explicit-event controlled: this endpoint only
    // records durable compensation intent.  Accounting, Gold, and Inventory
    // retain their own canonical authorities and are never directly mutated
    // by this request.
    router.post("/cgp/drafts/:id/reversal-compensations", authMiddleware, (req, res, next) =>
      idempotent(req, res, next, {
        scope: "gold-purchase.cgp.reversal-compensation",
        statusCode: 202,
        execute: async (t) => {
          const request = await models.CgpReversalRequest.findOne({ where: { cgpDocumentId: req.params.id, companyId: req.companyId, branchId: req.branchId }, transaction: t, lock: t.LOCK.UPDATE });
          if (!request) throw new AppError("CGP reversal request was not found", 404, "CGP_REVERSAL_REQUEST_NOT_FOUND");
          return cgpReversalCompensationService.beginCompensation({ requestId: request.id, actorId: req.user.id, context: context(req), transaction: t });
        },
      }));

    // These commands process exactly the request's immutable compensation
    // event.  They are deliberately narrow endpoints, not a global outbox
    // dispatcher; each service independently enforces the CGP reverse
    // capability and idempotent durable evidence.
    router.post("/cgp/reversal-requests/:id/compensate-accounting", authMiddleware, async (req, res, next) => {
      try {
        const request = await models.CgpReversalRequest.findOne({ where: { id: req.params.id, companyId: req.companyId, branchId: req.branchId } });
        if (!request) throw new AppError("CGP reversal request was not found", 404, "CGP_REVERSAL_REQUEST_NOT_FOUND");
        return res.status(200).json({ success: true, data: await cgpReversalCompensationService.compensateAccounting({ eventId: request.compensationEventId, context: context(req) }) });
      } catch (error) { return next(error); }
    });
    router.post("/cgp/reversal-requests/:id/compensate-gold", authMiddleware, async (req, res, next) => {
      try {
        const request = await models.CgpReversalRequest.findOne({ where: { id: req.params.id, companyId: req.companyId, branchId: req.branchId } });
        if (!request) throw new AppError("CGP reversal request was not found", 404, "CGP_REVERSAL_REQUEST_NOT_FOUND");
        return res.status(200).json({ success: true, data: await cgpReversalCompensationService.compensateGold({ eventId: request.compensationEventId, context: context(req) }) });
      } catch (error) { return next(error); }
    });
    router.post("/cgp/reversal-requests/:id/finalize", authMiddleware, async (req, res, next) => {
      try { return res.status(200).json({ success: true, data: await cgpReversalCompensationService.finalize({ requestId: req.params.id, actorId: req.user.id, context: context(req) }) }); }
      catch (error) { return next(error); }
    });
  }

  router.post(`/${kind}/drafts/:id/void`, authMiddleware, authorizeDraft(kind, "void"), (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.void`, statusCode: 200, execute: (t) => draftService.voidDraft(kind, context(req), req.params.id, req.body || {}, t) }));

  router.post(`/${kind}/drafts/:id/submit`, authMiddleware, (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.submit`, statusCode: 200, execute: (t) => governanceService.submit(kind, context(req), req.params.id, req.body || {}, t) }));

  router.post(`/${kind}/drafts/:id/approve`, authMiddleware, (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.approve`, statusCode: 200, execute: (t) => governanceService.review(kind, context(req), req.params.id, req.body || {}, "approved", t) }));

  router.post(`/${kind}/drafts/:id/reject`, authMiddleware, (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.reject`, statusCode: 200, execute: (t) => governanceService.review(kind, context(req), req.params.id, req.body || {}, "rejected", t) }));

  router.post(`/${kind}/drafts/:id/revisions`, authMiddleware, (req, res, next) =>
    idempotent(req, res, next, { scope: `gold-purchase.${kind}.revision`, statusCode: 201, execute: (t) => governanceService.createRevision(kind, context(req), req.params.id, req.body || {}, t) }));
}

bind("cgp");
bind("igp");

module.exports = router;
