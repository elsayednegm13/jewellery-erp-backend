/**
 * Accounting create containment Phase 8D1 — rejection-only verify.
 *
 * Confirms the generic POST /journal-entries endpoint rejects an unsafe manual
 * header before journal or audit writes, while the Phase 8B list endpoint
 * remains available. No successful writes are performed.
 *
 * Run from repo root:
 *   node backend/scripts/verify-accounting-create-containment.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const { sequelize } = require("../src/models");

const COMPANY = "CMP-DEMO";
let passed = 0;

function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let token;

async function request(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Company-ID": COMPANY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  let json = null;
  try {
    json = await response.json();
  } catch {}
  return { status: response.status, json };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    console.log("frontend containment contract (Phase 8D3 safe form):");
    const pageSource = fs.readFileSync(
      path.resolve(__dirname, "../../app/[locale]/(dashboard)/accounting/page.tsx"),
      "utf8",
    );
    check(pageSource.includes("const { postJournalEntries } = usePermissions()"), "create UI uses accounting.post permission gate");
    check(pageSource.includes("postJournalEntries ? ("), "users without permission receive no create actions");
    check(
      pageSource.includes("createManualJournalDraft") &&
        pageSource.includes("onClick={isApi ? openModal : undefined}") &&
        pageSource.includes("disabled={!isApi}"),
      "API mode opens the balanced manual-draft form; mock/local is disabled",
    );
    check(
      !pageSource.includes("darfus-journals-v1"),
      "legacy darfus-journals-v1 localStorage path is removed",
    );

    console.log("\nbackend rejection before writes:");
    const journalsBefore = await request("/journal-entries?page=1&pageSize=1");
    const auditsBefore = await request("/audit-logs?page=1&pageSize=1");
    check(journalsBefore.status === 200, "journal list remains available");
    check(auditsBefore.status === 200, "audit list available for no-write comparison");

    const attemptedId = `JE-CONTAINMENT-${Date.now()}`;
    const rejected = await request("/journal-entries", {
      method: "POST",
      body: JSON.stringify({
        id: attemptedId,
        description: "Unsafe manual header must be rejected",
        date: new Date().toISOString().slice(0, 10),
        status: "posted",
        amount: 100,
        totalDebit: 100,
        totalCredit: 100,
      }),
    });
    check(rejected.status === 422, "generic POST /journal-entries is rejected");
    check(
      String(rejected.json?.message || "").includes("dedicated balanced draft endpoint"),
      "rejection explains that a dedicated balanced draft endpoint is required",
    );

    const journalsAfter = await request("/journal-entries?page=1&pageSize=1");
    const auditsAfter = await request("/audit-logs?page=1&pageSize=1");
    const lookup = await request(`/journal-entries/${encodeURIComponent(attemptedId)}`);
    check(journalsAfter.json.total === journalsBefore.json.total, "journal total is unchanged after rejected POST");
    check(auditsAfter.json.total === auditsBefore.json.total, "audit total is unchanged after rejected POST");
    check(lookup.status === 404, "rejected journal ID was not persisted");

    console.log("\nPhase 8B preservation:");
    const paged = await request("/journal-entries?page=1&pageSize=10&search=zzzzzznomatch");
    check(
      paged.status === 200 &&
        paged.json.page === 1 &&
        paged.json.pageSize === 10 &&
        typeof paged.json.total === "number" &&
        typeof paged.json.totalPages === "number",
      "pagination/search metadata remains intact",
    );

    console.log(`\nRESULT: all ${passed} checks passed. (rejection-only, no DB writes)`);
  } finally {
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
