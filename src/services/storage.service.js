const { v2: cloudinary } = require("cloudinary");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

cloudinary.config({
  secure: true
});

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
    if (!file?.path) {
      throw new Error("Temporary uploaded file path is missing.");
    }

    const ext = path.extname(file.originalname || "").toLowerCase();

    const base =
      path
        .basename(file.originalname || "file", ext)
        .replace(/[^\w.\-ء-ي ]+/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 80) || "file";

    const filename =
      `${Date.now()}-` +
      `${Math.random().toString(36).slice(2, 8)}-` +
      `${base}${ext}`;

    const targetPath = path.join(this.uploadDir, filename);

    await fs.promises.copyFile(file.path, targetPath);
    await fs.promises.unlink(file.path);

    const relativeUrl = `/uploads/${filename}`;

    logger.info(`File uploaded locally: ${filename}`);

    return {
      id: `ATT-${Math.floor(Math.random() * 900000) + 100000}`,
      name: file.originalname,
      type: file.mimetype || "application/octet-stream",
      size: file.size,
      url: relativeUrl,
      uploadedAt: new Date().toISOString()
    };
  }
}

class CloudinaryStorageDriver {
  constructor() {
    if (!process.env.CLOUDINARY_URL) {
      throw new Error(
        "CLOUDINARY_URL is required when UPLOAD_DRIVER=cloudinary"
      );
    }

    this.folder =
      process.env.CLOUDINARY_FOLDER || "jewellery-erp";

    logger.info(
      `Cloudinary storage initialized. Folder: ${this.folder}`
    );
  }

  async upload(file) {
    if (!file?.path) {
      throw new Error("Temporary uploaded file path is missing.");
    }

    try {
      const result = await cloudinary.uploader.upload(file.path, {
        folder: this.folder,
        resource_type: "auto",
        overwrite: false,
        unique_filename: true
      });

      logger.info(
        `File uploaded to Cloudinary: ${result.public_id}`
      );

      return {
        id: result.asset_id,
        publicId: result.public_id,
        resourceType: result.resource_type,
        name: file.originalname,
        type: file.mimetype || "application/octet-stream",
        size: result.bytes || file.size,
        url: result.secure_url,
        uploadedAt:
          result.created_at || new Date().toISOString()
      };
    } finally {
      try {
        await fs.promises.unlink(file.path);
      } catch (error) {
        if (error.code !== "ENOENT") {
          logger.warn(
            `Could not delete temporary upload: ${error.message}`
          );
        }
      }
    }
  }
}

class S3StorageDriver {
  constructor() {
    logger.info(
      "AWS S3 Storage driver initialized (Stubbed)."
    );
  }

  async upload(file) {
    logger.warn(
      "AWS S3 upload called but stubbed. Falling back to LocalStorage."
    );

    const fallback = new LocalStorageDriver();
    return fallback.upload(file);
  }
}

class AzureStorageDriver {
  constructor() {
    logger.info(
      "Azure Blob Storage driver initialized (Stubbed)."
    );
  }

  async upload(file) {
    logger.warn(
      "Azure Blob upload called but stubbed. Falling back to LocalStorage."
    );

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
    const driverType =
      process.env.UPLOAD_DRIVER || "local";

    switch (driverType.toLowerCase()) {
      case "cloudinary":
        this.driver = new CloudinaryStorageDriver();
        break;

      case "s3":
        this.driver = new S3StorageDriver();
        break;

      case "azure":
        this.driver = new AzureStorageDriver();
        break;

      case "local":
        this.driver = new LocalStorageDriver();
        break;

      default:
        logger.warn(
          `Unknown upload driver "${driverType}". Using local storage.`
        );

        this.driver = new LocalStorageDriver();
        break;
    }
  }

  async uploadFile(file) {
    if (!file) {
      throw new Error("No file was provided.");
    }

    return this.driver.upload(file);
  }
}

module.exports = new StorageService();