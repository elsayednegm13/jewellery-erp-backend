const express = require("express");
const authRoutes = require("./auth.routes");
const goldRoutes = require("./gold.routes");
const eventsRoutes = require("./events.routes");
const erpRoutes = require("./erp.routes");
const goldPurchaseRoutes = require("./gold-purchase.routes");
const employeeAuthorizationRoutes = require("./employee-authorization.routes");
const uploadMiddleware = require("../middleware/upload.middleware");
const uploadController = require("../controllers/upload.controller");
const sequelize = require("../config/database");
const goldService = require("../services/gold.service");
const queueService = require("../services/queue.service");
const { authMiddleware, requirePermission } = require("../middleware/auth.middleware");
const { emitEntityChanged } = require("../services/realtime-helper.service");

const router = express.Router();

// 1. Module Routes
router.use("/auth", authRoutes);
router.use("/gold", goldRoutes);
router.use("/events", eventsRoutes);
router.use("/gold-purchases", goldPurchaseRoutes);
router.use("/", employeeAuthorizationRoutes);

// 2. Attachment Upload Endpoint
router.post("/attachments/upload", uploadMiddleware.single("file"), uploadController.upload);

router.post(
  "/uploads/logo",
  authMiddleware,
  requirePermission("settings.update"),
  uploadMiddleware.single("logo"),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          message: "No logo file uploaded."
        });
      }

      const storageService = require("../services/storage.service");
      const uploadResult = await storageService.uploadFile(file);
      const models = require("../models");

      await models.Company.update(
        { logo: uploadResult.url },
        { where: { id: req.companyId } }
      );

      const company = await models.Company.findByPk(req.companyId);

      emitEntityChanged(req.companyId, {
        entity: "Settings",
        action: "update",
        id: "logo",
        related: { companyId: req.companyId }
      });

      return res.status(201).json({
        success: true,
        url: uploadResult.url,
        data: {
          logo: uploadResult.url,
          company
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// 3. ERP CRUD Core Endpoints
router.use("/", erpRoutes);

// 4. Enterprise Health Checkpoints
router.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      status: "UP",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  });
});

router.get("/health/db", async (req, res) => {
  try {
    await sequelize.authenticate();
    return res.status(200).json({
      success: true,
      data: {
        status: "UP",
        database: "PostgreSQL connected successfully"
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: `Database connection failed: ${err.message}`
      }
    });
  }
});

router.get("/health/gold", async (req, res) => {
  try {
    const livePrice = await goldService.getLivePrice();
    return res.status(200).json({
      success: true,
      data: {
        status: "UP",
        provider: process.env.GOLD_API_PROVIDER || "goldapi",
        isMockFallback: !process.env.GOLD_API_KEY,
        sampleRates: livePrice.gold_24k
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: "GOLD_PROVIDER_OFFLINE",
        message: `Gold API provider check failed: ${err.message}`
      }
    });
  }
});

router.get("/health/redis", (req, res) => {
  const isRedisUp = queueService.isRedisReady;
  return res.status(isRedisUp ? 200 : 503).json({
    success: isRedisUp,
    data: {
      status: isRedisUp ? "UP" : "DOWN",
      redis: isRedisUp ? "Redis connected" : "Redis connection failed. Background queues working in-process fallback mode."
    }
  });
});

module.exports = router;
