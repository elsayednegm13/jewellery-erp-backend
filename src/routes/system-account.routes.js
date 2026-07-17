const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const systemAccounts = require("../services/system-account.service");

const router = express.Router();

router.get("/", authMiddleware, async (req, res, next) => {
  try {
    const items = await systemAccounts.listAccounts(req);
    res.status(200).json({ success: true, data: { items }, items });
  } catch (error) {
    next(error);
  }
});

router.post("/", authMiddleware, async (req, res, next) => {
  try {
    const result = await systemAccounts.createAccount(req);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/branch-accounts", authMiddleware, async (req, res, next) => {
  try {
    const result = await systemAccounts.createBranchAccount(req);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", authMiddleware, async (req, res, next) => {
  try {
    const account = await systemAccounts.patchAccount(req);
    res.status(200).json({ success: true, data: { account } });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/change-email", authMiddleware, async (req, res, next) => {
  try {
    const account = await systemAccounts.changeEmail(req);
    res.status(200).json({ success: true, data: { account } });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/reset-password", authMiddleware, async (req, res, next) => {
  try {
    const result = await systemAccounts.resetPassword(req);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/unlock", authMiddleware, async (req, res, next) => {
  try {
    const account = await systemAccounts.unlockAccount(req);
    res.status(200).json({ success: true, data: { account } });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/activate", authMiddleware, async (req, res, next) => {
  try {
    const account = await systemAccounts.setActive(req, true);
    res.status(200).json({ success: true, data: { account } });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/deactivate", authMiddleware, async (req, res, next) => {
  try {
    const account = await systemAccounts.setActive(req, false);
    res.status(200).json({ success: true, data: { account } });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/revoke-sessions", authMiddleware, async (req, res, next) => {
  try {
    const result = await systemAccounts.revokeSessions(req);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/convert-account-type", authMiddleware, async (req, res, next) => {
  try {
    const account = await systemAccounts.convertAccountType(req);
    res.status(200).json({ success: true, data: { account } });
  } catch (error) {
    next(error);
  }
});

router.get("/readiness", authMiddleware, async (req, res, next) => {
  try {
    const data = await systemAccounts.readiness(req);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
