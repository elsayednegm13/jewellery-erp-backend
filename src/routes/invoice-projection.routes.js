"use strict";

const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const { requireBusinessPermission } = require("../middleware/business-permission.middleware");
const models = require("../models");
const projection = require("../services/invoice-projection.service");
const auditService = require("../services/audit.service");
const commandActorContext = require("../services/command-actor-context.service");
const salesOperatorPolicy = require("../services/sales-operator-policy.service");

const router = express.Router();

function readContext(req) {
  return {
    companyId: req.companyId,
    // The authenticated middleware/operator context is the only branch
    // authority. Query-string/body branch values are intentionally ignored.
    branchId: req.branchId || null,
  };
}

router.get("/sources", authMiddleware, requireBusinessPermission("sales.view"), (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      sources: projection.registryForResponse(),
      activeSourceTypes: projection.ACTIVE_PROJECTION_SOURCE_TYPES,
      futureExtensionPoints: {
        cgpAdapter: null,
        d2Search: true,
        d2Print: true,
      },
      readOnly: true,
    },
  });
});

router.get("/summaries", authMiddleware, requireBusinessPermission("sales.view"), async (req, res, next) => {
  try {
    const filters = { ...req.query };
    if (filters.sourceType === "all") delete filters.sourceType;
    if (filters.sourceTypes === "all") delete filters.sourceTypes;
    const data = await projection.listSummaries({ ...readContext(req), filters });
    await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
      action: "invoice_projection.search",
      description: "Invoice Search & Print projection search executed.",
      sourceDocument: "INVOICE_SEARCH_PROJECTION",
      requiredPermission: "sales.view",
      requestedOperation: "invoice.search",
      authorizationResult: "allowed",
      after: JSON.stringify({ filters, resultCount: data.total }),
    }));
    return res.status(200).json({ success: true, data, readOnly: true });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/:sourceType/:sourceId/print-events",
  authMiddleware,
  salesOperatorPolicy.requireSalesCommandAccess("sales.official_print", {
    resolveBranchId: (req) => req.headers["x-branch-id"] || req.branchId,
  }),
  async (req, res, next) => {
    try {
      const sourceType = String(req.params.sourceType || "").trim().toLowerCase();
      const entry = projection.assertActiveSourceType(sourceType);
      if (!entry.canPrint) throw new Error("The projection source is not printable.");
      if (entry.adapter !== "customer_gold_purchase") {
        const error = new Error("Invoice sources must use the canonical invoice print-event route.");
        error.statusCode = 409;
        error.errorCode = "PROJECTION_PRINT_ROUTE_REQUIRED";
        throw error;
      }
      const requestedType = String(req.body?.type || "").trim();
      if (!["official", "reprint"].includes(requestedType)) {
        const error = new Error("Print event type must be official or reprint.");
        error.statusCode = 422;
        error.errorCode = "PROJECTION_PRINT_EVENT_TYPE_INVALID";
        throw error;
      }
      const reason = String(req.body?.reason || "").trim();
      if (requestedType === "reprint" && !reason) {
        const error = new Error("Reprint reason is required.");
        error.statusCode = 422;
        error.errorCode = "PROJECTION_REPRINT_REASON_REQUIRED";
        throw error;
      }
      const detail = await projection.getDetail({
        ...readContext(req),
        sourceType,
        sourceId: req.params.sourceId,
      });
      const sourceDocument = detail.summary.projectionReference;
      const prior = await models.AuditLog.findAll({
        where: { companyId: req.companyId, action: "invoice_projection.print", sourceDocument },
        order: [["createdAt", "DESC"]],
      });
      const hasOfficial = prior.some((row) => {
        try { return JSON.parse(row.after || "{}").eventType === "official"; } catch { return false; }
      });
      if (requestedType === "official" && hasOfficial) {
        const error = new Error("Official print has already been authorized for this source document.");
        error.statusCode = 409;
        error.errorCode = "PROJECTION_OFFICIAL_PRINT_ALREADY_AUTHORIZED";
        throw error;
      }
      if (requestedType === "reprint" && !hasOfficial) {
        const error = new Error("Official print must be authorized before reprint.");
        error.statusCode = 409;
        error.errorCode = "PROJECTION_OFFICIAL_PRINT_REQUIRED";
        throw error;
      }
      const copyNumber = prior.length + 1;
      const event = await auditService.record(req.companyId, commandActorContext.attachAuditActor(req, {
        action: "invoice_projection.print",
        description: `Projection print authorized for ${detail.summary.displayNumber}.`,
        sourceDocument,
        branch: detail.summary.branchName || detail.summary.branchId,
        requiredPermission: "sales.print",
        requestedOperation: requestedType === "reprint" ? "sales.reprint" : "sales.official_print",
        authorizationResult: "allowed",
        operatorReason: requestedType === "reprint" ? reason : null,
        after: JSON.stringify({
          sourceType,
          sourceId: detail.summary.sourceId,
          displayNumber: detail.summary.displayNumber,
          eventType: requestedType,
          copyNumber,
        }),
      }));
      return res.status(201).json({ success: true, data: event.toJSON(), readOnlySource: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/:sourceType/:sourceId", authMiddleware, requireBusinessPermission("sales.view"), async (req, res, next) => {
  try {
    const data = await projection.getDetail({
      ...readContext(req),
      sourceType: req.params.sourceType,
      sourceId: req.params.sourceId,
    });
    return res.status(200).json({ success: true, data, readOnly: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
