"use strict";

const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const permissionService = require("../services/permission.service");
const models = require("../models");
const revisionService = require("../services/asset-revision.service");
const { AppError } = require("../utils/errors");

const router = express.Router();

function requireRevisionPermission(permissionName) {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new AppError("Revision permission denied.", 403, "REVISION_PERMISSION_DENIED");
      // Revision permissions are catalog entries, not an administrative
      // bypass. Technical/admin accounts must resolve the named catalog
      // permission in the current DB/source baseline.
      const names = await permissionService.getUserPermissionNames(req.user);
      if (!names.includes(permissionName)) throw new AppError("Revision permission denied.", 403, "REVISION_PERMISSION_DENIED");
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

router.post("/assets/:assetId/revisions", authMiddleware, requireRevisionPermission("inventory.revision.create"), async (req, res, next) => {
  try {
    const result = await revisionService.createAssetRevision({ models, req, assetId: req.params.assetId, body: req.body || {} });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return next(error);
  }
});

router.get("/assets/:assetId/revisions", authMiddleware, requireRevisionPermission("inventory.revision.view"), async (req, res, next) => {
  try {
    const data = await revisionService.listAssetRevisions({ models, req, assetId: req.params.assetId, page: req.query.page, limit: req.query.limit });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get("/assets/:assetId/revisions/:revisionId", authMiddleware, requireRevisionPermission("inventory.revision.view"), async (req, res, next) => {
  try {
    const data = await revisionService.getAssetRevision({ models, req, assetId: req.params.assetId, revisionId: req.params.revisionId });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
