"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { runPersistentPromotionMigrationCommand } = require("./persistent-promotion-migration-guard");

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const targetIndex = args.indexOf("--target");
const target = targetIndex >= 0 ? args[targetIndex + 1] : null;

runPersistentPromotionMigrationCommand({ target, dryRun: !execute })
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => { console.error(error?.code || "PERSISTENT_PROMOTION_MIGRATION_GUARD_FAILED"); process.exitCode = 1; });
