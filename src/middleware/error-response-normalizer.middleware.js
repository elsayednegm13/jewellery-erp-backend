"use strict";

const { normalizeErrorResponse } = require("../utils/error-contract");

/**
 * Compatibility boundary for existing route handlers that call res.status(...).json
 * directly. It leaves successes untouched and serializes every JSON error through
 * the one canonical envelope without forcing a risky route-by-route migration.
 */
function errorResponseNormalizer(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === "object") {
      return originalJson(normalizeErrorResponse(body, res.statusCode, req.requestId));
    }
    return originalJson(body);
  };
  next();
}

module.exports = errorResponseNormalizer;
