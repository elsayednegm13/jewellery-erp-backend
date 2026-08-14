"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { runPromotion } = require("./persistent-live-gold-promotion-guard");

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const targetIndex = args.indexOf("--target");
const target = targetIndex >= 0 ? args[targetIndex + 1] : null;

runPromotion({ target, dryRun: !execute })
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => { console.error(error?.code || "PERSISTENT_LIVE_GOLD_PROMOTION_GUARD_FAILED"); process.exitCode = 1; });
