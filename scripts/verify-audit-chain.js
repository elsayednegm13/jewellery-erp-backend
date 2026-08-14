/**
 * P1 verification — Audit hash-chain integrity.
 *
 * Proves that records written through auditService.record() form a valid,
 * tamper-evident chain, and that any mutation is detectable.
 *
 * SAFE BY DESIGN: everything runs inside a transaction that is ROLLED BACK,
 * so no audit rows are committed (the immutability hooks block deleting them,
 * so we must never commit test rows). It also runs a READ-ONLY verifyChain()
 * against every real company so we can report whether a backfill is needed.
 *
 * Run: node scripts/verify-audit-chain.js
 */
require("dotenv").config();
const { sequelize, AuditLog, Company } = require("../src/models");
const auditService = require("../src/services/audit.service");

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

// Verify a contiguous run of rows: each row's hash must equal
// computeHash(its own prevHash, row), and each prevHash must equal the
// previous row's hash. This proves internal consistency + linkage without
// assuming the run starts at the chain head (prevHash === null).
function walk(rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const expected = auditService.computeHash(r.prevHash, r);
    if (r.hash !== expected) return { valid: false, index: i, id: r.id, reason: "hash" };
    if (i > 0 && r.prevHash !== rows[i - 1].hash) {
      return { valid: false, index: i, id: r.id, reason: "link" };
    }
  }
  return { valid: true };
}

(async () => {
  await sequelize.authenticate();
  console.log("DB connected (" + process.env.DB_NAME + "@" + process.env.DB_PORT + ")\n");

  // ---- Part A: new-logging chain is valid (rollback probe, no pollution) ----
  console.log("Part A — fresh chain via auditService.record() [rolled back]:");
  const company = await Company.findOne({ raw: true });
  assert(!!company, "found a real company to scope the probe");
  const companyId = company.id;
  const t = await sequelize.transaction();
  const probeIds = [];
  try {
    for (let i = 1; i <= 4; i++) {
      const created = await auditService.record(
        companyId,
        {
          action: i % 2 ? "CREATE" : "UPDATE",
          description: `probe event ${i}`,
          user: "ProbeRunner",
          userId: "USR-PROBE",
          branch: "Head Office",
          before: i > 1 ? JSON.stringify({ v: i - 1 }) : null,
          after: JSON.stringify({ v: i }),
          sourceDocument: `DOC-${i}`
        },
        { transaction: t }
      );
      probeIds.push(created.id);
    }

    // Read back ONLY the rows we just created, in insertion order.
    const rows = await AuditLog.findAll({
      where: { id: probeIds },
      order: [["created_at", "ASC"]],
      transaction: t
    });
    assert(rows.length === 4, "4 probe rows written");
    assert(rows.every((r) => r.hash && r.prevHash !== undefined && r.prevHash !== null),
      "every new row has hash + non-null prevHash (chained onto real head)");

    const res = walk(rows);
    assert(res.valid, "the 4 new rows verify VALID and correctly linked");

    // Tamper detection: mutate a field in memory and recompute.
    const tampered = rows.map((r) => r.get({ plain: true }));
    tampered[2].description = "TAMPERED";
    const tamperRes = walk(tampered);
    assert(!tamperRes.valid && tamperRes.index === 2, "tampering row #3 is detected at index 2");
  } finally {
    await t.rollback();
    console.log("  (transaction rolled back — nothing committed)\n");
  }

  // ---- Part B: read-only state of every real company's chain ----
  console.log("Part B — current state of real companies (read-only):");
  const companies = await AuditLog.findAll({
    attributes: [[sequelize.fn("DISTINCT", sequelize.col("company_id")), "companyId"]],
    raw: true
  });
  if (!companies.length) {
    console.log("  (no audit rows yet)");
  }
  for (const c of companies) {
    const cid = c.companyId;
    const v = await auditService.verifyChain(cid);
    console.log(
      `  ${cid}: valid=${v.valid} total=${v.total}` +
        (v.valid ? "" : ` brokenAt=${v.brokenAt} index=${v.index} -> BACKFILL NEEDED`)
    );
  }

  console.log("\nRESULT: new-logging chain logic is VALID and tamper-evident.");
  await sequelize.close();
  process.exit(0);
})().catch((e) => {
  console.error("VERIFY FAILED:", e.message);
  process.exit(1);
});
