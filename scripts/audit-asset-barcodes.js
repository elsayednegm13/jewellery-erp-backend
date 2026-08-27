/**
 * P7.5b preflight — asset barcode uniqueness audit. READ-ONLY (SELECT only).
 * No UPDATE / INSERT / DELETE, no migration, no data change.
 *
 * Reports: totals, null/empty barcodes, within-company duplicate groups,
 * cross-company duplicates, barcode==id fallback artifacts, and generator
 * format distribution — to decide whether a (company_id, barcode) unique
 * partial index can be created now.
 *
 * Run: node backend/scripts/audit-asset-barcodes.js
 */
require("dotenv").config();
const { sequelize } = require("../src/models");

const q = (sql) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });

(async () => {
  await sequelize.authenticate();
  console.log(`DB: ${process.env.DB_NAME}@${process.env.DB_PORT} (READ-ONLY audit)\n`);

  const [{ total }] = await q("SELECT count(*)::int AS total FROM assets");
  const [{ nullc }] = await q("SELECT count(*)::int AS nullc FROM assets WHERE barcode IS NULL");
  const [{ emptyc }] = await q("SELECT count(*)::int AS emptyc FROM assets WHERE barcode IS NOT NULL AND btrim(barcode) = ''");
  const [{ withc }] = await q("SELECT count(*)::int AS withc FROM assets WHERE barcode IS NOT NULL AND btrim(barcode) <> ''");
  const [{ eqid }] = await q("SELECT count(*)::int AS eqid FROM assets WHERE barcode = id");

  console.log("== Totals ==");
  console.log(`  total assets            : ${total}`);
  console.log(`  barcode NULL            : ${nullc}`);
  console.log(`  barcode empty/whitespace: ${emptyc}`);
  console.log(`  barcode present (trimmed): ${withc}`);
  console.log(`  barcode == id (fallback) : ${eqid}`);

  // Within-company duplicate groups (on trimmed barcode, excluding null/empty).
  const dupGroups = await q(`
    SELECT company_id, btrim(barcode) AS bc, count(*)::int AS cnt
    FROM assets
    WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
    GROUP BY company_id, btrim(barcode)
    HAVING count(*) > 1
    ORDER BY cnt DESC, company_id
  `);
  const dupRows = dupGroups.reduce((s, g) => s + g.cnt, 0);
  console.log("\n== Within-company duplicates ==");
  console.log(`  duplicate groups        : ${dupGroups.length}`);
  console.log(`  rows in those groups    : ${dupRows} (excess to fix: ${dupRows - dupGroups.length})`);
  dupGroups.slice(0, 10).forEach((g) => console.log(`    - company ${g.company_id} · barcode "${g.bc}" × ${g.cnt}`));
  if (dupGroups.length > 10) console.log(`    … and ${dupGroups.length - 10} more groups`);

  // Cross-company: same barcode value used by >1 company (acceptable for a
  // company-scoped unique index; documented only).
  const crossGroups = await q(`
    SELECT btrim(barcode) AS bc, count(DISTINCT company_id)::int AS companies
    FROM assets
    WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
    GROUP BY btrim(barcode)
    HAVING count(DISTINCT company_id) > 1
  `);
  console.log("\n== Cross-company (same barcode in different companies) ==");
  console.log(`  cross-company barcodes  : ${crossGroups.length} (OK for a company-scoped unique index)`);

  // Generator format distribution (current generator = 13-digit numeric).
  const [{ numeric13 }] = await q("SELECT count(*)::int AS numeric13 FROM assets WHERE barcode ~ '^[0-9]{13}$'");
  const [{ ast_like }] = await q("SELECT count(*)::int AS ast_like FROM assets WHERE barcode LIKE 'AST-%'");
  const [{ other_fmt }] = await q("SELECT count(*)::int AS other_fmt FROM assets WHERE barcode !~ '^[0-9]{13}$' AND barcode NOT LIKE 'AST-%' AND barcode IS NOT NULL");
  console.log("\n== Format distribution ==");
  console.log(`  13-digit numeric (generator): ${numeric13}`);
  console.log(`  'AST-%' (id-like)           : ${ast_like}`);
  console.log(`  other format                : ${other_fmt}`);

  const canIndexNow = dupGroups.length === 0;
  console.log("\n== Verdict ==");
  console.log(`  Can create (company_id, barcode) partial unique index NOW (WHERE barcode IS NOT NULL AND trim<>'')? ${canIndexNow ? "YES" : "NO — dedup required first"}`);

  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("AUDIT FAILED:", e.message); process.exit(1); });
