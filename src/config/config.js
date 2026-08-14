// Sequelize CLI configuration — reads from environment so the same code works
// locally, in Docker, and on a real server. No secrets are committed here.
require("dotenv").config();
const { resolveDatabaseEnv } = require("./database-env");

const resolved = resolveDatabaseEnv();
const base = {
  username: resolved.username,
  password: resolved.password,
  database: resolved.database,
  host: resolved.host,
  port: resolved.port,
  dialect: "postgres",
  logging: false,
};

const sslOptions =
  resolved.ssl
    ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } }
    : {};

module.exports = {
  development: { ...base },
  test: { ...base, database: process.env.DB_NAME_TEST || `${base.database}_test` },
  production: { ...base, ...sslOptions },
};
