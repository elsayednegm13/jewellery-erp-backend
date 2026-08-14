const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

let cloudinary;

const storageError = (message, statusCode, errorCode) =>
  new AppError(message, statusCode, errorCode);

const cleanupTemporaryFile = async (filePath) => {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      logger.warn("Could not delete temporary upload file.");
    }
  }
};

const getCloudinary = () => {
  try {
    cloudinary ||= require("cloudinary").v2;
    cloudinary.config({ secure: true });
    return cloudinary;
  } catch (error) {
    logger.error("Cloudinary storage configuration is invalid.");
    throw storageError(
      "Cloud storage is not configured.",
      500,
      "STORAGE_CONFIGURATION_MISSING"
    );
  }
};

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
    const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
    if (!cloudinaryUrl) {
      throw storageError(
        "Cloud storage is not configured.",
        500,
        "STORAGE_CONFIGURATION_MISSING"
      );
    }

    try {
      const parsedUrl = new URL(cloudinaryUrl);
      if (parsedUrl.protocol !== "cloudinary:") {
        throw new Error("Invalid Cloudinary URL");
      }
    } catch (error) {
      logger.error("Cloudinary storage configuration is invalid.");
      throw storageError(
        "Cloud storage is not configured.",
        500,
        "STORAGE_CONFIGURATION_MISSING"
      );
    }

    this.client = getCloudinary();

    this.folder =
      process.env.CLOUDINARY_FOLDER || "jewellery-erp";

    logger.info("Cloudinary storage initialized.");
  }

  async upload(file) {
    if (!file?.path) {
      throw new Error("Temporary uploaded file path is missing.");
    }

    try {
      const result = await this.client.uploader.upload(file.path, {
        folder: this.folder,
        resource_type: "auto",
        overwrite: false,
        unique_filename: true
      });

      logger.info("File uploaded to Cloudinary.");

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
    } catch (error) {
      logger.error("Cloudinary file upload failed.");
      throw storageError(
        "File upload failed. Please try again.",
        502,
        "STORAGE_UPLOAD_FAILED"
      );
    } finally {
      await cleanupTemporaryFile(file.path);
    }
  }
}

class StorageService {
  constructor() {
    this.driver = null;
    this.initDriver();
  }

  initDriver() {
    const driverType =
      String(process.env.UPLOAD_DRIVER || "").trim().toLowerCase() || "local";

    switch (driverType.toLowerCase()) {
      case "cloudinary":
        this.driver = new CloudinaryStorageDriver();
        break;

      case "local":
        this.driver = new LocalStorageDriver();
        break;

      default:
        logger.warn("Storage provider configuration is invalid.");
        throw storageError(
          "Storage provider configuration is invalid.",
          500,
          "STORAGE_PROVIDER_INVALID"
        );
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
