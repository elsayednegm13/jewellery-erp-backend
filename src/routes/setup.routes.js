const express = require("express");
const setupController = require("../controllers/setup.controller");
const { createRateLimiter } = require("../middleware/rateLimit.middleware");

const router = express.Router();
// The token is deployment-controlled, but this additional bound prevents a
// network client from turning the bootstrap boundary into an online oracle.
const setupRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

router.get("/status", setupController.status);
router.post("/bootstrap", setupRateLimit, setupController.bootstrap);

module.exports = router;
