const sequelize = require("../src/config/database");
const logger = require("../src/utils/logger");

// Use supertest if installed, otherwise a simple request validator
// To ensure it runs even if supertest is not configured yet, we will write
// a clean programmatic validator.
const runSelfTest = async () => {
  logger.info("Starting Programmatic API Self-Verification Test...");
  let passed = 0;
  let failed = 0;

  const assert = (condition, message) => {
    if (condition) {
      logger.info(`[PASS] ${message}`);
      passed++;
    } else {
      logger.error(`[FAIL] ${message}`);
      failed++;
    }
  };

  try {
    // Test 1: Database Connection
    try {
      await sequelize.authenticate();
      assert(true, "Database Authenticate Connection");
    } catch (err) {
      assert(false, `Database Authenticate Connection: ${err.message}`);
    }

    // Test 2: Live Gold price structure
    const goldService = require("../src/services/gold.service");
    const goldRates = await goldService.getLivePrice();
    assert(goldRates && goldRates.gold_24k, "Gold prices returned");
    assert(
      goldRates.gold_24k.USD && goldRates.gold_24k.AED && goldRates.gold_24k.EGP,
      "Gold currencies parsed (USD, AED, EGP)"
    );
    assert(typeof goldRates.gold_24k.USD === "number", "Gold price values are numbers");
    assert(goldRates.last_update, "Gold rate last_update timestamp exists");

    // Test 3: Gold price service cache validation
    const firstUpdate = goldRates.last_update;
    const cacheRates = await goldService.getLivePrice();
    assert(firstUpdate === cacheRates.last_update, "Gold Price cache HIT (same timestamp)");

    // Test 4: Queue Service fallback
    const queueService = require("../src/services/queue.service");
    const jobResult = await queueService.addJob("gold-sync");
    assert(jobResult.jobId && jobResult.mode, "Queue Service Job added successfully");

    // Test 5: Storage Service file copy fallback
    const storageService = require("../src/services/storage.service");
    assert(storageService.driver !== null, "Storage Service driver initialized");

    logger.info(`Verification Completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    logger.error("Verification crashed with exception:", error);
    process.exit(1);
  }
};

if (require.main === module) {
  runSelfTest().then(() => {
    sequelize.close();
  });
}
