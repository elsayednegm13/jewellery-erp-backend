const { Sequelize } = require("sequelize");
require("dotenv").config();

// Postgres returns NUMERIC/DECIMAL as strings and Sequelize's postgres dialect
// preserves that (its DECIMAL.parse returns the raw string), which makes money
// and weight fields arrive as strings — breaking client arithmetic (string
// concatenation → NaN, .toFixed() crashes). Override the dialect's DECIMAL
// parser to return a JS number. Must run BEFORE `new Sequelize()` so the
// connection manager bakes it into its OID parser map. Values here are well
// within the JS safe-number range.
try {
  const pgTypes = require("sequelize/lib/data-types").postgres;
  if (pgTypes && pgTypes.DECIMAL) {
    pgTypes.DECIMAL.parse = (value) => (value === null || value === undefined ? value : parseFloat(value));
  }
} catch {
  /* dialect internals unavailable — frontend Number() coercion is the fallback */
}

const dbName = process.env.DB_NAME || "darfus_erp";
const dbUser = process.env.DB_USER || "postgres";
// Accept either DB_PASS (app convention) or DB_PASSWORD (docker-compose convention).
const dbPass = process.env.DB_PASS || process.env.DB_PASSWORD || "postgres";
const dbHost = process.env.DB_HOST || "localhost";
const dbPort = process.env.DB_PORT || 5432;

const sequelize = new Sequelize(dbName, dbUser, dbPass, {
  host: dbHost,
  port: dbPort,
  dialect: "postgres",
  logging: process.env.NODE_ENV === "development" ? (msg) => console.log(`[Sequelize] ${msg}`) : false,
  define: {
    timestamps: true,
    underscored: true,
    freezeTableName: true
  }
});

module.exports = sequelize;
