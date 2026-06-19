const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

const errorMiddleware = (err, req, res, next) => {
  const correlationId = req.headers["x-correlation-id"] || req.id || "ERR-NO-CORR";
  
  let statusCode = err.statusCode || 500;
  let errorCode = err.errorCode || "INTERNAL_SERVER_ERROR";
  let message = err.message || "حدث خطأ غير متوقع في الخادم";
  let fieldErrors = err.fieldErrors || null;

  // Handle Sequelize specific database errors
  if (
    err.name === "SequelizeValidationError" ||
    err.name === "SequelizeUniqueConstraintError" ||
    err.name === "SequelizeDatabaseError"
  ) {
    statusCode = 422;
    errorCode = "VALIDATION_FAILED";
    message = "خطأ في التحقق من البيانات. المدخلات غير صحيحة.";
    fieldErrors = {};
    if (Array.isArray(err.errors)) {
      err.errors.forEach((e) => {
        const field = e.path || "body";
        if (!fieldErrors[field]) {
          fieldErrors[field] = [];
        }
        fieldErrors[field].push(e.message);
      });
    } else {
      fieldErrors.body = [err.message];
    }
  }

  logger.error(`[Request Error] Path: ${req.path} | Status: ${statusCode} | Code: ${errorCode} | Message: ${message}`, {
    correlationId,
    stack: err.stack,
    fieldErrors
  });

  // Dual-envelope design: Satisfies both the api-client.ts parser AND backend contract requirements
  res.status(statusCode).json({
    success: false,
    message, // Read by frontend: payload?.message
    errors: fieldErrors, // Read by frontend: payload?.errors
    code: errorCode,
    linked: err.linked || undefined,
    error: {
      code: errorCode,
      message,
      fieldErrors,
      linked: err.linked || undefined,
      requestId: correlationId,
      status: statusCode
    }
  });
};

module.exports = errorMiddleware;
