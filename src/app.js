const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const fs = require("fs");

const routes = require("./routes");
const errorMiddleware = require("./middleware/error.middleware");
const logger = require("./utils/logger");

const app = express();

// 1. Security & Logging Middlewares
app.use(helmet({
  crossOriginResourcePolicy: false // Allows loading static uploads in frontend
}));

// CORS — locked down by allow-list. Set CORS_ALLOWED_ORIGINS (comma-separated)
// in production. In non-production an empty list falls back to "*" for DX.
const allowedOrigins = [
  ...(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
  process.env.FRONTEND_URL || "",
]
  .map((o) => o.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === "production";

app.use(cors({
  origin(origin, callback) {
    // Allow non-browser clients (curl, server-to-server) that send no Origin header.
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) {
      if (isProduction) {
        logger.error("[CORS] CORS_ALLOWED_ORIGINS is empty in production — blocking cross-origin request.");
        return callback(null, false); // no ACAO header → browser blocks
      }
      return callback(null, true); // dev convenience
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);
    logger.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(null, false); // disallowed: omit ACAO so the browser blocks it
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Company-ID", "X-Branch-ID", "X-Correlation-ID", "X-Device-Session-ID", "Idempotency-Key"]
}));

const SENSITIVE_QUERY_KEYS = new Set(["token", "access_token", "accesstoken", "refreshtoken", "refresh_token", "authorization", "apikey", "key", "secret"]);
function sanitizedRequestUrl(originalUrl) {
  try {
    const url = new URL(originalUrl, "http://localhost");
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, "[REDACTED]");
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return String(originalUrl || "").split("?")[0];
  }
}

const morganFormat = (tokens, req, res) => [
  tokens.method(req, res),
  sanitizedRequestUrl(req.originalUrl || req.url),
  tokens.status(req, res),
  `${tokens["response-time"](req, res)}ms`,
  `corr=${req.headers["x-correlation-id"] || req.id || "-"}`,
].join(" ");
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Static File Access for Uploads
const uploadsDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

// 3. API Routes Mappings
app.use("/api/v1", routes);
app.use("/api", routes); // Backup mount for base router queries

// 4. Swagger Documentation Mounting
const swaggerPath = path.join(__dirname, "../swagger.json");
if (fs.existsSync(swaggerPath)) {
  const swaggerDocument = require(swaggerPath);
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  logger.info("Swagger documentation mounted at /api-docs");
} else {
  logger.warn("Swagger configuration swagger.json not found. Documentation not mounted.");
}

// 5. Root route mapping
app.get("/", (req, res) => {
  res.status(200).send("DARFUS Jewellery ERP API Service is active.");
});

// 6. 404 Route handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: "المورد غير موجود - Resource not found",
    error: {
      code: "RESOURCE_NOT_FOUND",
      message: "Resource not found",
      status: 404
    }
  });
});

// 7. Global Error Boundary Middleware
app.use(errorMiddleware);

module.exports = app;
