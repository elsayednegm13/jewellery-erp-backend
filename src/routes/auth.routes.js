const express = require("express");
const authController = require("../controllers/auth.controller");
const { authMiddleware } = require("../middleware/auth.middleware");
const { createRateLimiter } = require("../middleware/rateLimit.middleware");

const router = express.Router();
const authRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: 10 });

router.post("/login", authRateLimit, authController.login);
router.post("/refresh", authRateLimit, authController.refresh);
router.post("/logout", authMiddleware, authController.logout);
router.get("/me", authMiddleware, authController.me);
router.post("/change-password", authMiddleware, authController.changePassword);
router.post("/forgot-password", authRateLimit, authController.forgotPassword);
router.post("/validate-reset-token", authRateLimit, authController.validateResetToken);
router.post("/reset-password", authRateLimit, authController.resetPassword);
router.post("/change-email", authMiddleware, authController.changeEmail);
router.post("/confirm-email-change", authRateLimit, authController.confirmEmailChange);
// Public self-registration is disabled. Account creation is admin-only via
// /api/v1/users. Keep a hard stop here so old clients fail safely.
router.post("/register", (req, res) => {
  res.status(410).json({
    success: false,
    message: "Public signup is disabled. Users must be created by an administrator."
  });
});

module.exports = router;
