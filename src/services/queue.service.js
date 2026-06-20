const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const logger = require("../utils/logger");

class QueueService {
  constructor() {
    this.queues = {};
    this.workers = {};
    this.redisClient = null;
    this.isRedisReady = false;
    this.redisConnectionErrorLogged = false;
    this.init();
  }

  maskRedisUrl(redisUrl) {
    try {
      const parsedUrl = new URL(redisUrl);
      return `${parsedUrl.protocol}//${parsedUrl.host}`;
    } catch (err) {
      return "[configured REDIS_URL]";
    }
  }

  init() {
    const redisUrl = process.env.REDIS_URL;
    const isProduction = process.env.NODE_ENV === "production";

    if (!redisUrl) {
      logger.warn("REDIS_URL is not configured. Queue service operating in-memory.");
      return;
    }

    if (
      isProduction &&
      (redisUrl.includes("localhost") || redisUrl.includes("127.0.0.1"))
    ) {
      logger.warn("Invalid production REDIS_URL points to localhost. Queue service operating in-memory.");
      return;
    }

    logger.info(
      `Attempting to initialize Redis connection from REDIS_URL (${this.maskRedisUrl(redisUrl)})`
    );

    // Create connection with offline queue disabled to fail fast if Redis isn't running
    this.redisClient = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      retryStrategy(times) {
        return Math.min(times * 1000, 10000);
      },
    });

    this.redisClient.on("connect", () => {
      logger.info("Redis socket connected.");
    });

    this.redisClient.on("ready", () => {
      this.isRedisReady = true;
      this.redisConnectionErrorLogged = false;
      logger.info("Successfully connected to Redis. Initializing BullMQ queues...");
      this.setupBullMQ();
    });

    this.redisClient.on("close", () => {
      this.isRedisReady = false;
    });

    this.redisClient.on("error", (err) => {
      this.isRedisReady = false;

      // Prevent log spam on Render
      if (!this.redisConnectionErrorLogged) {
        logger.warn(`Redis connection failed: ${err.message}. Queue service operating in-memory.`);
        this.redisConnectionErrorLogged = true;
      }
    });
  }

  setupBullMQ() {
    try {
      if (this.queues.default && this.workers.default) {
        return;
      }

      const connection = this.redisClient;

      this.queues.default = new Queue("default-queue", { connection });

      // Setup worker for background jobs
      this.workers.default = new Worker(
        "default-queue",
        async (job) => {
          logger.info(`[Worker] Starting job ${job.name} (ID: ${job.id})`);
          await this.processJob(job.name, job.data);
          logger.info(`[Worker] Completed job ${job.name}`);
        },
        { connection }
      );

      this.workers.default.on("failed", (job, err) => {
        logger.error(`[Worker] Job ${job?.id || "unknown"} failed: ${err.message}`);
      });
    } catch (err) {
      this.isRedisReady = false;
      logger.error("Failed to initialize BullMQ. Fallback mode enabled.", err);
    }
  }

  /**
   * Adds job to queue. If Redis is down, runs it instantly/async in-process.
   */
  async addJob(name, data = {}) {
    if (this.isRedisReady && this.queues.default) {
      try {
        const job = await this.queues.default.add(name, data);
        logger.info(`[Queue] Added job ${name} to Redis queue (ID: ${job.id})`);
        return { jobId: job.id, mode: "redis" };
      } catch (err) {
        logger.error(`[Queue] Failed to add job to Redis: ${err.message}. Running in fallback mode.`);
      }
    }

    // Fallback mode: Run asynchronous in-process
    logger.info(`[Queue-Fallback] Running job ${name} asynchronously in-process.`);

    setTimeout(async () => {
      try {
        await this.processJob(name, data);
      } catch (err) {
        logger.error(`[Queue-Fallback] Job ${name} in-process execution failed: ${err.message}`);
      }
    }, 100);

    return { jobId: `fallback-${Date.now()}`, mode: "in-process" };
  }

  /**
   * Job Router executing background task logic
   */
  async processJob(name, data) {
    logger.info(`[Job-Router] Executing task: ${name}`);

    switch (name) {
      case "gold-sync": {
        const goldService = require("./gold.service");
        await goldService.getLivePrice();
        break;
      }

      case "excel-export":
        logger.info("Simulating background Excel generation task...");
        await new Promise((res) => setTimeout(res, 2000));
        break;

      case "pdf-export":
        logger.info("Simulating background PDF generation task...");
        await new Promise((res) => setTimeout(res, 2500));
        break;

      case "daily-report":
        logger.info("Simulating daily report calculations...");
        await new Promise((res) => setTimeout(res, 3000));
        break;

      default:
        logger.warn(`Unknown job type: ${name}`);
    }
  }
}

module.exports = new QueueService();
