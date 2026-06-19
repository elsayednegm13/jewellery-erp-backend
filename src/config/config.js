// Sequelize CLI configuration — reads from environment so the same code works
// locally, in Docker, and on a real server. No secrets are committed here.
require("dotenv").config();

const base = {
  username: process.env.DB_USER || "postgres",
  // Accept either DB_PASS or DB_PASSWORD (docker-compose convention).
  password: process.env.DB_PASS || process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "darfus_erp",
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  dialect: "postgres",
  logging: false,
};

const sslOptions =
  process.env.DB_SSL === "true"
    ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } }
    : {};

module.exports = {
  development: { ...base },
  test: { ...base, database: process.env.DB_NAME_TEST || `${base.database}_test` },
  production: { ...base, ...sslOptions },
};
