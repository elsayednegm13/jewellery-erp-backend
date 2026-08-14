"use strict";

const VALID_ENVS = new Set(["development", "test", "staging", "production"]);
const LOCAL_DEFAULTS = Object.freeze({ host: "localhost", port: 5432, database: "darfus_erp", username: "postgres", password: "postgres", ssl: false });

function configError(message) {
  const error = new Error(`CONFIG_ERROR: ${message}`);
  error.code = "CONFIG_ERROR";
  return error;
}

function parsePort(value) {
  if (!/^\d+$/.test(String(value || ""))) throw configError("DB_PORT must be an integer between 1 and 65535");
  const port = Number(value);
  if (port < 1 || port > 65535) throw configError("DB_PORT must be an integer between 1 and 65535");
  return port;
}

function parseSsl(value, required) {
  if (value === undefined || value === "") {
    if (required) throw configError("Missing required environment variables: DB_SSL");
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "require"].includes(normalized)) return true;
  if (["false", "0", "no", "disable"].includes(normalized)) return false;
  throw configError("DB_SSL must be one of true, false, 1, 0, yes, no, require, disable");
}

function parseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw configError("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === "/") {
    throw configError("DATABASE_URL must identify a PostgreSQL host and database");
  }
  return {
    host: url.hostname,
    port: url.port ? parsePort(url.port) : 5432,
    database: decodeURIComponent(url.pathname.slice(1)),
    username: decodeURIComponent(url.username || ""),
    password: decodeURIComponent(url.password || ""),
  };
}

function resolveDatabaseEnv(env = process.env) {
  const environment = String(env.NODE_ENV || "development").trim().toLowerCase();
  if (!VALID_ENVS.has(environment)) throw configError("NODE_ENV must be development, test, staging, or production");
  const server = environment === "staging" || environment === "production";
  const urlValue = String(env.DATABASE_URL || "").trim();
  const suppliedTarget = [env.DB_HOST, env.DB_PORT, env.DB_NAME].some((value) => value !== undefined && value !== "");
  const missing = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"].filter((key) => !String(env[key] || (key === "DB_PASSWORD" ? env.DB_PASS || "" : "")).trim());
  if (server && !urlValue && missing.length) throw configError(`Missing required environment variables: ${missing.join(", ")}`);

  const db = urlValue ? parseUrl(urlValue) : {
    host: String(env.DB_HOST || (environment === "development" ? LOCAL_DEFAULTS.host : "")).trim(),
    port: parsePort(env.DB_PORT || (environment === "development" ? LOCAL_DEFAULTS.port : "")),
    database: String(env.DB_NAME || (environment === "development" ? LOCAL_DEFAULTS.database : "")).trim(),
  };
  if (!db.host || !db.database) throw configError("Missing required environment variables: DB_HOST, DB_NAME");
  if (urlValue && suppliedTarget) {
    const explicit = { host: String(env.DB_HOST || "").trim(), port: parsePort(env.DB_PORT), database: String(env.DB_NAME || "").trim() };
    if (explicit.host !== db.host || explicit.port !== db.port || explicit.database !== db.database) {
      throw configError("Conflicting database targets from DATABASE_URL and DB_*");
    }
  }
  const parsedUrl = urlValue ? parseUrl(urlValue) : null;
  const username = String(env.DB_USER || parsedUrl?.username || (environment === "development" ? LOCAL_DEFAULTS.username : "")).trim();
  const password = String(env.DB_PASSWORD || env.DB_PASS || parsedUrl?.password || (environment === "development" ? LOCAL_DEFAULTS.password : ""));
  if (server && (!username || !password)) throw configError("Missing required environment variables: DB_USER, DB_PASSWORD");
  return Object.freeze({ environment, connectionString: urlValue || null, host: db.host, port: db.port, database: db.database, username, password, ssl: parseSsl(env.DB_SSL, server) });
}

module.exports = { resolveDatabaseEnv, configError };
