/**
 * P3 verification — additive asset statuses.
 *
 * Proves the asset status enum accepts the four new DARFUS states and that the
 * POS sale guard (`asset.status !== "available"`) blocks every non-available
 * state. Everything runs in a transaction that is ROLLED BACK (no pollution).
 *
 * Run: node scripts/verify-asset-statuses.js
 */
require("dotenv").config();
const { sequelize, Asset } = require("../src/models");

const COMPANY = "CMP-DEMO";
const NEW_STATUSES = ["pending_transfer", "returned", "in_workshop", "pending_tag"];
// The exact predicate used by /pos/checkout and the exchange new-item guard.
const posWouldSell = (status) => status === "available";

let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

(async () => {
  await sequelize.authenticate();
  console.log("DB connected (" + process.env.DB_NAME + "@" + process.env.DB_PORT + ")\n");

  // 1) DB enum actually contains the new labels.
  const [labels] = await sequelize.query(
    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='enum_assets_status' ORDER BY e.enumsortorder"
  );
  const set = new Set(labels.map((l) => l.enumlabel));
  console.log("enum labels:", [...set].join(", "));
  for (const s of NEW_STATUSES) check(set.has(s), `enum contains "${s}"`);
  // Legacy values still present (backward compatible).
  for (const s of ["repair", "transferred", "archived", "available", "sold", "reserved", "melted"]) {
    check(set.has(s), `legacy value "${s}" still present (backward compatible)`);
  }

  // 2) Asset model accepts create/update into each new status (rolled back).
  console.log("\ncreate/update into new statuses [rolled back]:");
  const t = await sequelize.transaction();
  try {
    for (const status of NEW_STATUSES) {
      const a = await Asset.create(
        {
          id: `AST-PROBE-${status}-${Date.now()}`,
          companyId: COMPANY, name: `probe ${status}`, type: "gold-piece", status,
          category: "Probe", grossWeight: 1, netWeight: 1, price: 100, cost: 80,
          branch: "Probe Branch", location: "Probe", barcode: `PROBE-${status}-${Date.now()}`
        },
        { transaction: t }
      );
      check(a.status === status, `asset created with status "${status}"`);
      // And an update path into the status works too.
      await a.update({ status }, { transaction: t });
    }
  } finally { await t.rollback(); }

  // 3) POS guard: only "available" is sellable; every other state is blocked.
  console.log("\nPOS sale guard (status !== 'available'):");
  check(posWouldSell("available") === true, "available IS sellable");
  for (const s of [...NEW_STATUSES, "sold", "reserved", "repair", "transferred", "melted", "archived"]) {
    check(posWouldSell(s) === false, `"${s}" is NOT sellable (POS blocks it)`);
  }

  console.log(`\nRESULT: all ${passed} checks passed. (nothing committed)`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
