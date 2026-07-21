const { Sequelize } = require("sequelize");
require("dotenv").config();
const { resolveDatabaseEnv } = require("./database-env");

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

const db = resolveDatabaseEnv();

const sequelize = db.connectionString ? new Sequelize(db.connectionString, {
  dialect: "postgres",
  logging: db.environment === "development" ? (msg) => console.log(`[Sequelize] ${msg}`) : false,
  ...(db.ssl ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } } : {}),
}) : new Sequelize(db.database, db.username, db.password, {
  host: db.host,
  port: db.port,
  dialect: "postgres",
  logging: db.environment === "development" ? (msg) => console.log(`[Sequelize] ${msg}`) : false,
  ...(db.ssl ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } } : {}),
  define: {
    timestamps: true,
    underscored: true,
    freezeTableName: true
  }
});

module.exports = sequelize;
