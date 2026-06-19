const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const logger = require("../utils/logger");

class QueueService {
  constructor() {
    this.queues = {};
    this.workers = {};
    this.redisClient = null;
    this.isRedisReady = false;
    this.init();
  }

  init() {
    const host = process.env.REDIS_HOST || "localhost";
    const port = process.env.REDIS_PORT || 6379;

    logger.info(`Attempting to initialize Redis connection at redis://${host}:${port}`);
    
    // Create connection with offline queue disabled to fail fast if Redis isn't running
    this.redisClient = new IORedis({
      host,
      port,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false
    });

    this.redisClient.on("connect", () => {
      this.isRedisReady = true;
      logger.info("Successfully connected to Redis. Initializing BullMQ queues...");
      this.setupBullMQ();
    });

    this.redisClient.on("error", (err) => {
      this.isRedisReady = false;
      logger.warn(`Redis connection failed: ${err.message}. Queue service operating in-memory.`);
    });
  }

  setupBullMQ() {
    try {
      const connection = this.redisClient;
      this.queues.default = new Queue("default-queue", { connection });
      
      // Setup worker for background jobs
      this.workers.default = new Worker("default-queue", async (job) => {
        logger.info(`[Worker] Starting job ${job.name} (ID: ${job.id})`);
        await this.processJob(job.name, job.data);
        logger.info(`[Worker] Completed job ${job.name}`);
      }, { connection });

      this.workers.default.on("failed", (job, err) => {
        logger.error(`[Worker] Job ${job.id} failed: ${err.message}`);
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
      case "gold-sync":
        const goldService = require("./gold.service");
        await goldService.getLivePrice();
        break;
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
