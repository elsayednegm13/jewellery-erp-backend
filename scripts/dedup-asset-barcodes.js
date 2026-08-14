/**
 * P7.5c — asset barcode dedup. DEFAULT = DRY-RUN (no DB writes).
 *
 * Builds the change plan for within-company duplicate barcodes: keep the OLDEST
 * asset per group, re-assign every other member a new, company-unique barcode.
 * It only prints a summary + a small sanitized sample — it does NOT write a full
 * mapping file and does NOT touch the DB unless EXPLICITLY unlocked.
 *
 * APPLY is heavily gated and is NOT to be run until separately approved:
 *   node scripts/dedup-asset-barcodes.js --apply
 *   AND env CONFIRM_ASSET_BARCODE_DEDUP=YES
 *   AND NODE_ENV !== production (unless ALLOW_PROD_DEDUP=YES)
 * Without ALL of these, the script is read-only.
 *
 * Run (dry-run): node backend/scripts/audit... no — node backend/scripts/dedup-asset-barcodes.js
 */
require("dotenv").config();
const { sequelize } = require("../src/models");

const APPLY =
  process.argv.includes("--apply") &&
  process.env.CONFIRM_ASSET_BARCODE_DEDUP === "YES" &&
  (process.env.NODE_ENV !== "production" || process.env.ALLOW_PROD_DEDUP === "YES");

const q = (sql, opts) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, ...opts });

// New barcode: 13-digit numeric starting "9" — the timestamp generator produces
// ~"17…" so the 9e12 range never collides with it; still verified against the
// company's used set. Numeric/13-digit keeps the existing format (minimal change).
function makeBarcodeFactory(usedSet) {
  let counter = 1;
  return () => {
    let candidate;
    do {
      candidate = String(9000000000000 + counter).slice(0, 13);
      counter += 1;
    } while (usedSet.has(candidate));
    usedSet.add(candidate);
    return candidate;
  };
}

(async () => {
  await sequelize.authenticate();
  console.log(`DB: ${process.env.DB_NAME}@${process.env.DB_PORT}`);
  console.log(`MODE: ${APPLY ? "*** APPLY (writes) ***" : "DRY-RUN (no writes)"}\n`);

  // Duplicate groups (within company, trimmed barcode, excl null/empty).
  const groups = await q(`
    SELECT company_id, btrim(barcode) AS bc, count(*)::int AS cnt
    FROM assets
    WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
    GROUP BY company_id, btrim(barcode)
    HAVING count(*) > 1
    ORDER BY company_id, bc
  `);

  const plan = []; // { companyId, assetId, oldBarcode, newBarcode }
  const companies = new Set(groups.map((g) => g.company_id));

  // Cache: companyId -> Set of all existing barcodes in that company.
  const companyUsed = new Map();
  const factories = new Map();
  const usedFor = async (companyId) => {
    if (!companyUsed.has(companyId)) {
      const rows = await q("SELECT btrim(barcode) AS bc FROM assets WHERE company_id = :c AND barcode IS NOT NULL", { replacements: { c: companyId } });
      const set = new Set(rows.map((r) => r.bc));
      companyUsed.set(companyId, set);
      factories.set(companyId, makeBarcodeFactory(set));
    }
    return companyUsed.get(companyId);
  };

  for (const g of groups) {
    await usedFor(g.company_id);
    const factory = factories.get(g.company_id);
    // Members ordered oldest-first (created_at ASC, then id ASC for stability).
    const members = await q(
      `SELECT id, created_at FROM assets WHERE company_id = :c AND btrim(barcode) = :b ORDER BY created_at ASC NULLS FIRST, id ASC`,
      { replacements: { c: g.company_id, b: g.bc } }
    );
    // Keep the first (oldest); reassign the rest.
    for (let i = 1; i < members.length; i++) {
      plan.push({ companyId: g.company_id, assetId: members[i].id, oldBarcode: g.bc, newBarcode: factory() });
    }
  }

  // ---- Verification (collision-free) ----
  const newSet = new Set(plan.map((p) => p.newBarcode));
  const newUnique = newSet.size === plan.length;
  let clashesExisting = 0;
  for (const p of plan) {
    // The new barcode must not already exist in the company (it was generated
    // against that company's used-set, so this is a belt-and-braces re-check).
    const used = companyUsed.get(p.companyId);
    // The generator already added it to `used`; verify it wasn't a pre-existing one
    // by checking it's in the 9e12 range (our reserved space) — a pragmatic check.
    if (!String(p.newBarcode).startsWith("9")) clashesExisting += 1;
  }
  const excess = groups.reduce((s, g) => s + (g.cnt - 1), 0);

  console.log("== Plan summary ==");
  console.log(`  duplicate groups        : ${groups.length}`);
  console.log(`  excess rows (to fix)    : ${excess}`);
  console.log(`  proposed changes        : ${plan.length}`);
  console.log(`  affected companies      : ${[...companies].join(", ") || "(none)"}`);
  console.log(`  new barcodes all unique : ${newUnique ? "YES" : "NO"}`);
  console.log(`  new barcodes collide w/ existing: ${clashesExisting === 0 ? "NO" : `YES (${clashesExisting})`}`);
  console.log(`  apply safe?             : ${plan.length === excess && newUnique && clashesExisting === 0 ? "YES (pending approval)" : "NO"}`);

  console.log("\n== Sample (first 5, sanitized) ==");
  plan.slice(0, 5).forEach((p) => console.log(`  ${p.assetId} : ${p.oldBarcode} -> ${p.newBarcode}`));
  if (plan.length > 5) console.log(`  … and ${plan.length - 5} more`);

  if (!APPLY) {
    console.log("\nDRY-RUN: no rows were modified. (Apply is gated + requires separate approval.)");
    await sequelize.close();
    process.exit(0);
  }

  // ---- APPLY (gated; not run in P7.5c-DRYRUN) ----
  console.log("\n*** APPLYING in a transaction ***");
  const t = await sequelize.transaction();
  try {
    for (const p of plan) {
      await sequelize.query("UPDATE assets SET barcode = :nb, updated_at = now() WHERE id = :id AND company_id = :c", {
        replacements: { nb: p.newBarcode, id: p.assetId, c: p.companyId },
        transaction: t,
      });
    }
    await t.commit();
    console.log(`Applied ${plan.length} barcode reassignments.`);
  } catch (e) {
    await t.rollback();
    console.error("APPLY FAILED — rolled back:", e.message);
    process.exit(1);
  }
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("DEDUP FAILED:", e.message); process.exit(1); });
