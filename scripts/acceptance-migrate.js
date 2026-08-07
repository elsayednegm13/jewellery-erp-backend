"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { runAcceptanceMigrationCommand } = require("./acceptance-migration-guard");

const execute = process.argv.slice(2).includes("--execute");

runAcceptanceMigrationCommand({ dryRun: !execute })
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error) => {
    // Guard errors are stable codes only: never expose configuration or URLs.
    console.error(error?.code || "ACCEPTANCE_MIGRATION_GUARD_FAILED");
    process.exitCode = 1;
  });
