"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { CGP_IMP_01_MIGRATIONS, CGP_IMP_02_MIGRATIONS, CGP_IMP_11_MIGRATIONS, CGP_IMP_03_MIGRATIONS, CGP_PRICE_AUTHORITY_CLOSURE_MIGRATIONS, CGP_IMP_04_MIGRATIONS, CGP_IMP_05A_MIGRATIONS, CGP_IMP_05_MIGRATIONS, CGP_IMP_06_MIGRATIONS, CGP_IMP_08_MIGRATIONS, CGP_IMP_09A_MIGRATIONS, CGP_IMP_09_MIGRATIONS, CGP_IMP_10A_MIGRATIONS, CGP_IMP_10_MIGRATIONS, GOLD_LIVE_FEED_01_MIGRATIONS, GOLD_LIVE_FEED_03_MIGRATIONS, runAcceptanceMigrationCommand } = require("./acceptance-migration-guard");

const execute = process.argv.slice(2).includes("--execute");
const cgpImp01 = process.argv.slice(2).includes("--cgp-imp-01");
const cgpImp02 = process.argv.slice(2).includes("--cgp-imp-02");
const cgpImp11 = process.argv.slice(2).includes("--cgp-imp-11");
const cgpImp03 = process.argv.slice(2).includes("--cgp-imp-03");
const cgpPriceAuthorityClosure = process.argv.slice(2).includes("--cgp-price-authority-closure");
const cgpImp04 = process.argv.slice(2).includes("--cgp-imp-04");
const cgpImp05a = process.argv.slice(2).includes("--cgp-imp-05a");
const cgpImp05 = process.argv.slice(2).includes("--cgp-imp-05");
const cgpImp06 = process.argv.slice(2).includes("--cgp-imp-06");
const cgpImp08 = process.argv.slice(2).includes("--cgp-imp-08");
const cgpImp09a = process.argv.slice(2).includes("--cgp-imp-09a");
const cgpImp09 = process.argv.slice(2).includes("--cgp-imp-09");
const cgpImp10a = process.argv.slice(2).includes("--cgp-imp-10a");
const cgpImp10 = process.argv.slice(2).includes("--cgp-imp-10");
const goldLiveFeed01 = process.argv.slice(2).includes("--gold-live-feed-01");
const goldLiveFeed03 = process.argv.slice(2).includes("--gold-live-feed-03");

if ([cgpImp01, cgpImp02, cgpImp11, cgpImp03, cgpPriceAuthorityClosure, cgpImp04, cgpImp05a, cgpImp05, cgpImp06, cgpImp08, cgpImp09a, cgpImp09, cgpImp10a, cgpImp10, goldLiveFeed01, goldLiveFeed03].filter(Boolean).length > 1) {
  console.error("ACCEPTANCE_MIGRATION_MODE_CONFLICT");
  process.exitCode = 1;
} else runAcceptanceMigrationCommand({
  dryRun: !execute,
  ...(cgpImp01 ? { expectedMigrations: CGP_IMP_01_MIGRATIONS } : {}),
  ...(cgpImp02 ? { expectedMigrations: CGP_IMP_02_MIGRATIONS } : {}),
  ...(cgpImp11 ? { expectedMigrations: CGP_IMP_11_MIGRATIONS } : {}),
  ...(cgpImp03 ? { expectedMigrations: CGP_IMP_03_MIGRATIONS } : {}),
  ...(cgpPriceAuthorityClosure ? { expectedMigrations: CGP_PRICE_AUTHORITY_CLOSURE_MIGRATIONS } : {}),
  ...(cgpImp04 ? { expectedMigrations: CGP_IMP_04_MIGRATIONS } : {}),
  ...(cgpImp05a ? { expectedMigrations: CGP_IMP_05A_MIGRATIONS } : {}),
  ...(cgpImp05 ? { expectedMigrations: CGP_IMP_05_MIGRATIONS } : {}),
  ...(cgpImp06 ? { expectedMigrations: CGP_IMP_06_MIGRATIONS } : {}),
  ...(cgpImp08 ? { expectedMigrations: CGP_IMP_08_MIGRATIONS } : {}),
  ...(cgpImp09a ? { expectedMigrations: CGP_IMP_09A_MIGRATIONS } : {}),
  ...(cgpImp09 ? { expectedMigrations: CGP_IMP_09_MIGRATIONS } : {}),
  ...(cgpImp10a ? { expectedMigrations: CGP_IMP_10A_MIGRATIONS } : {}),
  ...(cgpImp10 ? { expectedMigrations: CGP_IMP_10_MIGRATIONS } : {}),
  ...(goldLiveFeed01 ? { expectedMigrations: GOLD_LIVE_FEED_01_MIGRATIONS } : {}),
  ...(goldLiveFeed03 ? { expectedMigrations: GOLD_LIVE_FEED_03_MIGRATIONS } : {}),
})
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error) => {
    // Guard errors are stable codes only: never expose configuration or URLs.
    console.error(error?.code || "ACCEPTANCE_MIGRATION_GUARD_FAILED");
    process.exitCode = 1;
  });
