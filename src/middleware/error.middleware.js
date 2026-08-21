const logger = require("../utils/logger");
const { canonicalErrorPayload, normalizeFields } = require("../utils/error-contract");

function safeValidationFields(error) {
  if (!Array.isArray(error.errors)) return null;
  const raw = {};
  for (const item of error.errors) {
    const field = /^[A-Za-z0-9_.\[\]-]{1,128}$/.test(String(item.path || "body")) ? String(item.path || "body") : "body";
    (raw[field] ||= []).push("Invalid value.");
  }
  return normalizeFields(raw);
}

function isDatabaseFailure(error) {
  return [
    "SequelizeDatabaseError",
    "SequelizeConnectionError",
    "SequelizeConnectionRefusedError",
    "SequelizeHostNotFoundError",
    "SequelizeHostNotReachableError",
    "SequelizeTimeoutError",
  ].includes(error?.name);
}

const errorMiddleware = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const requestId = req.requestId || "ERR-NO-REQUEST-ID";
  
  let statusCode = err.statusCode || 500;
  let errorCode = err.errorCode || "INTERNAL_SERVER_ERROR";
  let message = err.isOperational ? err.message : "An unexpected server error occurred.";
  let fieldErrors = err.fieldErrors || null;

  if (err?.type === "entity.parse.failed") {
    statusCode = 400;
    errorCode = "INVALID_JSON";
    message = "The request body must contain valid JSON.";
    fieldErrors = null;
  } else if (err?.name === "SequelizeUniqueConstraintError") {
    statusCode = 409;
    errorCode = err.errorCode || "STATE_CONFLICT";
    message = "The requested value conflicts with an existing record.";
    fieldErrors = safeValidationFields(err);
  } else if (err?.name === "SequelizeValidationError") {
    statusCode = 422;
    errorCode = err.errorCode || "VALIDATION_FAILED";
    message = "Please correct the highlighted fields.";
    fieldErrors = safeValidationFields(err);
  } else if (err?.name === "SequelizeForeignKeyConstraintError") {
    statusCode = 409;
    errorCode = err.errorCode || "REFERENCE_CONFLICT";
    message = "The requested change conflicts with related records.";
    fieldErrors = null;
  } else if (isDatabaseFailure(err)) {
    statusCode = 500;
    errorCode = "INTERNAL_SERVER_ERROR";
    message = "An unexpected server error occurred.";
    fieldErrors = {};
  }

  logger.error(`[Request Error] code=${errorCode} message=${message} fields=${JSON.stringify(fieldErrors || {})}`, {
    requestId,
    method: req.method,
    path: req.path,
    statusCode,
    errorCode,
    errorName: err?.name || "Error",
    errorMessage: message,
    stack: err?.stack || null,
    fieldErrors,
  });

  res.status(statusCode).json(canonicalErrorPayload({
    status: statusCode,
    code: errorCode,
    message,
    fields: fieldErrors,
    details: err.details || err.linked,
    requestId,
  }));
};

module.exports = errorMiddleware;
