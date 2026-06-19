/**
 * Centralised security configuration.
 *
 * Resolves the JWT signing secrets and enforces — in production — that they
 * are explicitly set and are NOT the well-known development defaults. This
 * prevents shipping a build that signs tokens with a guessable key.
 */
const logger = require("../utils/logger");

// Well-known dev defaults — must never be used in production.
const DEV_ACCESS_DEFAULT = "darfus_super_secret_access_key_12345";
const DEV_REFRESH_DEFAULT = "darfus_super_secret_refresh_key_67890";

const isProd = process.env.NODE_ENV === "production";

function resolveSecret(name, devDefault) {
  const value = process.env[name];
  if (isProd) {
    if (!value || value === devDefault || value.length < 32) {
      // Fail fast: never run production on a weak/default/missing secret.
      const reason = !value ? "is not set" : value === devDefault ? "is the known default" : "is too short (<32 chars)";
      logger.error(`[Security] FATAL: ${name} ${reason}. Set a strong secret before starting in production.`);
      throw new Error(`Insecure ${name}: ${reason}`);
    }
  } else if (!value || value === devDefault) {
    logger.warn(`[Security] ${name} is using the insecure development default. Set a strong value before deploying.`);
  }
  return value || devDefault;
}

module.exports = {
  isProd,
  JWT_SECRET: resolveSecret("JWT_SECRET", DEV_ACCESS_DEFAULT),
  JWT_REFRESH_SECRET: resolveSecret("JWT_REFRESH_SECRET", DEV_REFRESH_DEFAULT),
  ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY || "15m",
  REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || "7d",
  DEV_ACCESS_DEFAULT,
  DEV_REFRESH_DEFAULT,
};
