"use strict";

const logger = require("./logger");

function queryMetadata(message, durationMs) {
  const sql = String(message || "").replace(/^Executing\s*\([^)]*\):\s*/i, "");
  const operation = (sql.match(/^\s*(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|CREATE|ALTER|DROP)\b/i)?.[1] || "QUERY").toUpperCase();
  const target = sql.match(/\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+"?([A-Za-z_][A-Za-z0-9_$]*)"?/i)?.[1] || "unknown";
  return {
    operation,
    target,
    durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.round(Number(durationMs))) : null
  };
}

function createSafeQueryLogger(environment = process.env) {
  if (String(environment.LOG_SAFE_SQL_SHAPES || "").toLowerCase() !== "true") return false;
  return (message, durationMs) => {
    const metadata = queryMetadata(message, durationMs);
    logger.debug(`[DB] operation=${metadata.operation} target=${metadata.target} duration_ms=${metadata.durationMs ?? "unknown"}`);
  };
}

module.exports = { queryMetadata, createSafeQueryLogger };
