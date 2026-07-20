require("dotenv").config();
const app = require("./app");
const sequelize = require("./config/database");
const logger = require("./utils/logger");
const ensureAdmin = require("./bootstrap/ensureAdmin");
const reservationExpiryScheduler = require("./services/reservation-expiry-scheduler");

const PORT = process.env.PORT || 8000;

const startServer = async () => {
  try {
    logger.info("Connecting to PostgreSQL database...");
    await sequelize.authenticate();
    logger.info("Database connection established successfully.");

    // RESET-1: startup must not be a hidden data-bootstrap/seed channel. An
    // operator may opt in for a local first-run workflow, but normal startup
    // (including Production) performs no company/admin/demo mutation.
    if (process.env.ALLOW_RUNTIME_ADMIN_BOOTSTRAP === "true" && process.env.NODE_ENV !== "production") {
      try {
        await ensureAdmin();
      } catch (bootErr) {
        logger.error(`[Bootstrap] ensureAdmin failed: ${bootErr.message}`);
      }
    } else {
      logger.info("[Bootstrap] Runtime admin bootstrap skipped; use an explicit local setup command.");
    }

    // Phase 32.6-Fix C — start the reservation automatic-expiry scheduler
    // (no-op in test/verifier mode).
    try {
      reservationExpiryScheduler.start();
    } catch (schedErr) {
      logger.error(`[Bootstrap] reservation expiry scheduler failed to start: ${schedErr.message}`);
    }

    // Start Express Server
    app.listen(PORT, () => {
      logger.info(`==================================================`);
      logger.info(`  DARFUS Jewellery ERP Backend Service Active     `);
      logger.info(`  Environment: ${process.env.NODE_ENV || "development"}`);
      logger.info(`  Listening on Port: http://localhost:${PORT}      `);
      logger.info(`  API Documentation: http://localhost:${PORT}/api-docs`);
      logger.info(`==================================================`);
    });
  } catch (error) {
    logger.error("Unable to start server. Database connection failed:", error);
    process.exit(1);
  }
};

// Graceful shut down hook
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled Promise Rejection:", err);
});

startServer();
