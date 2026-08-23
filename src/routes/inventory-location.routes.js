const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const { requireBusinessPermission } = require("../middleware/business-permission.middleware");
const locationService = require("../services/inventory-location.service");

const router = express.Router();

router.use(authMiddleware);

router.get("/", requireBusinessPermission("inventory.view"), async (req, res, next) => {
  try {
    const includeDisabled = ["true", "1", "yes"].includes(String(req.query.includeDisabled || "").toLowerCase());
    const items = await locationService.list({ companyId: req.companyId, branchId: req.branchId, includeDisabled });
    return res.status(200).json({ success: true, data: { items, includeDisabled, branchId: req.branchId } });
  } catch (error) { return next(error); }
});

router.post("/", requireBusinessPermission("inventory.adjust", { touch: true, operation: "inventory.locations.create" }), async (req, res, next) => {
  try {
    const item = await locationService.create({ companyId: req.companyId, branchId: req.branchId, payload: req.body || {}, user: req.user, requestId: req.requestId });
    return res.status(201).json({ success: true, data: item });
  } catch (error) { return next(error); }
});

router.patch("/:id", requireBusinessPermission("inventory.adjust", { touch: true, operation: "inventory.locations.update" }), async (req, res, next) => {
  try {
    const item = await locationService.update({ companyId: req.companyId, branchId: req.branchId, id: req.params.id, payload: req.body || {}, user: req.user, requestId: req.requestId });
    return res.status(200).json({ success: true, data: item });
  } catch (error) { return next(error); }
});

router.post("/:id/disable", requireBusinessPermission("inventory.adjust", { touch: true, operation: "inventory.locations.disable" }), async (req, res, next) => {
  try {
    const item = await locationService.disable({ companyId: req.companyId, branchId: req.branchId, id: req.params.id, user: req.user, requestId: req.requestId });
    return res.status(200).json({ success: true, data: item });
  } catch (error) { return next(error); }
});

module.exports = router;
