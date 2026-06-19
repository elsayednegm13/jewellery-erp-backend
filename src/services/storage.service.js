const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

class LocalStorageDriver {
  constructor() {
    this.uploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, "../../../uploads");
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async upload(file) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const base = path
      .basename(file.originalname || "file", ext)
      .replace(/[^\w.\-ء-ي ]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "file";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}${ext}`;
    const targetPath = path.join(this.uploadDir, filename);
    
    // Copy temporary file to uploads directory
    fs.copyFileSync(file.path, targetPath);
    // Remove temp file
    fs.unlinkSync(file.path);

    const relativeUrl = `/uploads/${filename}`;
    logger.info(`File uploaded locally: ${filename}`);

    return {
      id: `ATT-${Math.floor(Math.random() * 900000) + 100000}`,
      name: file.originalname,
      type: file.mimetype.split("/")[1].toUpperCase(),
      size: file.size,
      url: relativeUrl,
      uploadedAt: new Date().toISOString()
    };
  }
}

class S3StorageDriver {
  constructor() {
    // AWS S3 client would be initialized here
    // const { S3Client } = require("@aws-sdk/client-s3");
    logger.info("AWS S3 Storage driver initialized (Stubbed).");
  }

  async upload(file) {
    logger.warn("AWS S3 upload called but stubbed. Falling back to LocalStorage.");
    // Fallback logic for ease of deployment
    const fallback = new LocalStorageDriver();
    return fallback.upload(file);
  }
}

class AzureStorageDriver {
  constructor() {
    // Azure Blob storage client would be initialized here
    logger.info("Azure Blob Storage driver initialized (Stubbed).");
  }

  async upload(file) {
    logger.warn("Azure Blob upload called but stubbed. Falling back to LocalStorage.");
    const fallback = new LocalStorageDriver();
    return fallback.upload(file);
  }
}

class StorageService {
  constructor() {
    this.driver = null;
    this.initDriver();
  }

  initDriver() {
    const driverType = process.env.UPLOAD_DRIVER || "local";
    switch (driverType.toLowerCase()) {
      case "s3":
        this.driver = new S3StorageDriver();
        break;
      case "azure":
        this.driver = new AzureStorageDriver();
        break;
      case "local":
      default:
        this.driver = new LocalStorageDriver();
        break;
    }
  }

  async uploadFile(file) {
    return this.driver.upload(file);
  }
}

module.exports = new StorageService();
