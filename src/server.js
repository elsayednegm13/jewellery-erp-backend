require("dotenv").config();
const app = require("./app");
const sequelize = require("./config/database");
const logger = require("./utils/logger");
const ensureAdmin = require("./bootstrap/ensureAdmin");

const PORT = process.env.PORT || 8000;

const startServer = async () => {
  try {
    logger.info("Connecting to PostgreSQL database...");
    await sequelize.authenticate();
    logger.info("Database connection established successfully.");

    // First-run admin bootstrap (no-op if an admin already exists).
    try {
      await ensureAdmin();
    } catch (bootErr) {
      logger.error(`[Bootstrap] ensureAdmin failed: ${bootErr.message}`);
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
