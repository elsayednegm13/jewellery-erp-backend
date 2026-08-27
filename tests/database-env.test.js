"use strict";
const assert = require("node:assert/strict");
const { resolveDatabaseEnv } = require("../src/config/database-env");
const dev = resolveDatabaseEnv({ NODE_ENV: "development", DB_HOST: "::1", DB_PORT: "5432", DB_NAME: "darfus_erp", DB_USER: "postgres", DB_PASSWORD: "safe", DB_SSL: "false" });
assert.equal(dev.host, "::1"); assert.equal(dev.port, 5432); assert.equal(dev.ssl, false);
assert.equal(resolveDatabaseEnv({ NODE_ENV: "development" }).database, "darfus_erp");
for (const env of [
  { NODE_ENV: "production" },
  { NODE_ENV: "staging", DB_HOST: "db", DB_PORT: "x", DB_NAME: "db", DB_USER: "u", DB_PASSWORD: "secret", DB_SSL: "true" },
  { NODE_ENV: "production", DATABASE_URL: "mysql://db/example" },
  { NODE_ENV: "production", DATABASE_URL: "postgres://u:secret@db:5432/a", DB_HOST: "other", DB_PORT: "5432", DB_NAME: "a", DB_USER: "u", DB_PASSWORD: "secret", DB_SSL: "true" },
]) assert.throws(() => resolveDatabaseEnv(env), (error) => error.code === "CONFIG_ERROR" && !error.message.includes("secret"));
const url = resolveDatabaseEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://u:secret@db.example:5432/app", DB_SSL: "require" });
assert.equal(url.host, "db.example"); assert.equal(url.database, "app"); assert.equal(url.ssl, true);
console.log("DATABASE ENV CONTRACT PASSED");
