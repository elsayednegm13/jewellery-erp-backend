require("dotenv").config();
const app = require("./app");
const sequelize = require("./config/database");
const logger = require("./utils/logger");
const ensureAdmin = require("./bootstrap/ensureAdmin");
const reservationExpiryScheduler = require("./services/reservation-expiry-scheduler");
const goldMarketRuntime = require("./services/gold-market-runtime.service");
const cgpRuntimeDispatcher = require("./services/cgp-runtime-dispatcher.service");

const PORT = process.env.PORT || 8000;
let httpServer = null;

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

    // Gold Market Live refresh is a Redis/BullMQ-backed integration. It is
    // deliberately fail-closed: without REDIS_URL the API remains available,
    // but no recurring quote work is started and Live CGP freshness continues
    // to be enforced by the canonical currentState path.
    try {
      await goldMarketRuntime.start();
    } catch (runtimeErr) {
      logger.error(`[Bootstrap] Gold Market runtime failed to start: ${runtimeErr.message}`);
    }

    // CGP runtime delivery is explicitly disabled unless an Owner-approved
    // activation flag and stable creation watermark are supplied. The service
    // is scoped to CustomerGoldPurchasePostedEvent and never scans the global
    // historical Outbox backlog.
    try {
      await cgpRuntimeDispatcher.start();
    } catch (dispatcherErr) {
      logger.error(`[CGP Runtime] dispatcher failed to start: ${dispatcherErr.message}`);
    }

    // Start Express Server
    httpServer = app.listen(PORT, () => {
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

async function shutdown(signal) {
  logger.info(`[Shutdown] received ${signal}`);
  reservationExpiryScheduler.stop();
  try { await cgpRuntimeDispatcher.stop(); } catch (error) { logger.error(`[Shutdown] CGP runtime dispatcher close failed: ${error.message}`); }
  try { await goldMarketRuntime.stop(); } catch (error) { logger.error(`[Shutdown] Gold Market runtime close failed: ${error.message}`); }
  await new Promise((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(() => resolve());
  });
  try { await sequelize.close(); } catch (error) { logger.error(`[Shutdown] database close failed: ${error.message}`); }
}

process.once("SIGTERM", () => { shutdown("SIGTERM").finally(() => process.exit(0)); });
process.once("SIGINT", () => { shutdown("SIGINT").finally(() => process.exit(0)); });

startServer();
