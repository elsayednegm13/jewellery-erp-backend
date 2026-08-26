"use strict";

const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const { requireBusinessPermission } = require("../middleware/business-permission.middleware");
const projection = require("../services/invoice-projection.service");

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
      activeSourceTypes: projection.ACTIVE_INVOICE_TYPES,
      futureExtensionPoints: {
        cgpAdapter: "customer_gold_purchase",
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
    return res.status(200).json({ success: true, data, readOnly: true });
  } catch (error) {
    return next(error);
  }
});

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

