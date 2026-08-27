"use strict";

const models = require("../src/models");
const { reconcilePermissionCatalog } = require("../src/bootstrap/permission-catalog-reconciler");

const execute = process.argv.includes("--execute");
const json = process.argv.includes("--json");
const targetMode = process.env.DARFUS_PERMISSION_TARGET_MODE;
const targetDb = process.env.DARFUS_PERMISSION_TARGET_DB;
const officialApproval = process.env.DARFUS_OFFICIAL_PERMISSION_RECONCILE_APPROVED || "NO";

function print(value) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else {
    console.log(`PERMISSION_RECONCILE_MODE=${execute ? "EXECUTE" : "DRY_RUN"}`);
    console.log(`PERMISSION_TARGET_MODE=${targetMode || "MISSING"}`);
    console.log(`PERMISSION_TARGET_DB=${targetDb || "MISSING"}`);
    console.log(`SOURCE_PERMISSION_COUNT=${value.sourcePermissionCount ?? "UNKNOWN"}`);
    console.log(`DB_PERMISSION_COUNT=${value.dbPermissionCount ?? "UNKNOWN"}`);
    console.log(`MISSING_PERMISSION_COUNT=${value.missing?.length ?? "UNKNOWN"}`);
    console.log(`MISSING_PERMISSION_NAMES=${(value.missing || []).join(",")}`);
    console.log(`EXTRA_PERMISSION_COUNT=${value.extra?.length ?? "UNKNOWN"}`);
    console.log(`METADATA_MISMATCH_COUNT=${value.metadataMismatch?.length ?? "UNKNOWN"}`);
    console.log(`ROLE_BINDING_GAP_COUNT=${value.roleBindingGaps?.length ?? 0}`);
    console.log(`PERMISSION_WRITES=${value.writes ?? 0}`);
  }
}

async function main() {
  await models.sequelize.authenticate();
  const result = await reconcilePermissionCatalog({ sequelize: models.sequelize, targetMode, targetDb, officialApproval, execute });
  print(result);
}

main().catch((error) => {
  const payload = { ok: false, code: error.code || "PERMISSION_RECONCILE_FAILED", message: error.message, details: error.details || null };
  if (json) console.error(JSON.stringify(payload, null, 2));
  else console.error(`${payload.code}: ${payload.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await models.sequelize.close();
});
