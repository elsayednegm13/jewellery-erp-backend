/**
 * Ledger reconciliation — Phase 9F verify (READ-ONLY endpoint).
 *
 * GET /reports/ledger-reconciliation is read-only. To make the global counts
 * deterministic, all fixtures live under a throwaway company and the endpoint is
 * queried with that X-Company-ID. Fixtures (accounts + journal entries/lines,
 * with Account.balance set directly to create controlled drift) are created via
 * the models — no posting service, so no real balances move and no audit rows
 * are written. Everything is removed in `finally`, leaving no residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-ledger-reconciliation.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Account, JournalEntry, JournalLine, Company } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-REC-${stamp}`;

const ACC_MATCH = `ACC-REC-MATCH-${stamp}`;   // debit,  balance 100, calc 100  → matched
const ACC_DRIFT = `ACC-REC-DRIFT-${stamp}`;   // debit,  balance 130, calc 100  → diff +30
const ACC_CREDIT = `ACC-REC-CREDIT-${stamp}`; // credit, balance 150, calc 150  → matched
const ACC_ZERO = `ACC-REC-ZERO-${stamp}`;     // debit,  balance 0,   no lines  → zero
const ACC_STATUS = `ACC-REC-STATUS-${stamp}`; // debit,  balance 50,  calc 50   → matched (status filtering)
const ACC_DATE = `ACC-REC-DATE-${stamp}`;     // debit,  balance 100, asOf-sensitive

const E = (n) => `JE-REC-${n}-${stamp}`;
const ALL_ENTRIES = [
  E("MATCH"), E("DRIFT"), E("CREDITa"), E("CREDITb"), E("ZERO"),
  E("ST_POST"), E("ST_DRAFT"), E("ST_ORIG"), E("ST_REV"), E("DATE_PAST"), E("DATE_FUT"),
];

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let token;
async function get(pathname) {
  const response = await fetch(`${base}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO },
  });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}
const itemOf = (data, id) => (data.items || []).find((r) => r.accountId === id);

async function makeAccount(id, nature, balance) {
  return Account.create({
    id, companyId: CO, code: id, name: `Verify ${id}`, nameAr: `تحقق ${id}`,
    type: nature === "debit" ? "asset" : "liability", nature, balance, isActive: true, level: 3,
  });
}
async function makeEntry(id, date, status, sourceType = "manual", reversalOf = null) {
  return JournalEntry.create({
    id, companyId: CO, description: `Verify ${id}`, date,
    status, amount: 0, totalDebit: 0, totalCredit: 0, sourceType, reversalOf,
    postedBy: status === "posted" ? "Fixture" : null,
    postedAt: status === "posted" ? new Date().toISOString() : null,
  });
}
async function makeLine(entryId, accountId, debit, credit) {
  return JournalLine.create({
    id: `${entryId}-L1`, journalEntryId: entryId, accountId, accountCode: accountId,
    accountName: accountId, debit, credit, description: `line ${entryId}`,
  });
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify Rec Co", workspace: `verify-rec-${stamp}` });

    await makeAccount(ACC_MATCH, "debit", 100);
    await makeAccount(ACC_DRIFT, "debit", 130);
    await makeAccount(ACC_CREDIT, "credit", 150);
    await makeAccount(ACC_ZERO, "debit", 0);
    await makeAccount(ACC_STATUS, "debit", 50);
    await makeAccount(ACC_DATE, "debit", 100);

    // matched debit: posted debit 100 → calc 100
    await makeEntry(E("MATCH"), "2026-01-10", "posted");   await makeLine(E("MATCH"), ACC_MATCH, 100, 0);
    // drift debit: posted debit 100 → calc 100, balance 130 → diff +30
    await makeEntry(E("DRIFT"), "2026-01-10", "posted");   await makeLine(E("DRIFT"), ACC_DRIFT, 100, 0);
    // credit nature: posted credit 200 + debit 50 → calc 150
    await makeEntry(E("CREDITa"), "2026-01-10", "posted"); await makeLine(E("CREDITa"), ACC_CREDIT, 0, 200);
    await makeEntry(E("CREDITb"), "2026-01-11", "posted"); await makeLine(E("CREDITb"), ACC_CREDIT, 50, 0);
    // status filtering: posted 100, draft 999 (excl), reversed-orig 50 (excl), reversal posted credit 50 → calc 100-50=50
    await makeEntry(E("ST_POST"), "2026-01-10", "posted");                     await makeLine(E("ST_POST"), ACC_STATUS, 100, 0);
    await makeEntry(E("ST_DRAFT"), "2026-01-10", "draft");                     await makeLine(E("ST_DRAFT"), ACC_STATUS, 999, 0);
    await makeEntry(E("ST_ORIG"), "2026-01-10", "reversed");                   await makeLine(E("ST_ORIG"), ACC_STATUS, 50, 0);
    await makeEntry(E("ST_REV"), "2026-01-11", "posted", "manual_reversal", E("ST_ORIG")); await makeLine(E("ST_REV"), ACC_STATUS, 0, 50);
    // asOf sensitivity: past posted 100 + future posted 500
    await makeEntry(E("DATE_PAST"), "2026-01-01", "posted"); await makeLine(E("DATE_PAST"), ACC_DATE, 100, 0);
    await makeEntry(E("DATE_FUT"), "2026-05-01", "posted");  await makeLine(E("DATE_FUT"), ACC_DATE, 500, 0);

    console.log("1) basic + validation:");
    check((await get(`/reports/ledger-reconciliation`)).status === 200, "endpoint returns 200");
    check((await get(`/reports/ledger-reconciliation?asOf=2026-13-40`)).status === 422, "invalid asOf → 422");

    console.log("\n2) full view (includeZero=true, onlyDifferences=false):");
    const all = (await get(`/reports/ledger-reconciliation?includeZero=true&onlyDifferences=false`)).json.data;
    check(itemOf(all, ACC_MATCH).calculatedBalance === 100 && itemOf(all, ACC_MATCH).status === "matched", "debit-nature calc 100 → matched");
    check(itemOf(all, ACC_CREDIT).calculatedBalance === 150 && itemOf(all, ACC_CREDIT).status === "matched", "credit-nature calc (200-50)=150 → matched");
    check(itemOf(all, ACC_DRIFT).difference === 30 && itemOf(all, ACC_DRIFT).status === "difference", "drift difference = 130-100 = 30");
    check(itemOf(all, ACC_STATUS).calculatedBalance === 50 && itemOf(all, ACC_STATUS).status === "matched", "status filtering: draft+reversed excluded, reversal included → calc 50");
    check(Boolean(itemOf(all, ACC_ZERO)), "includeZero=true shows the zero account");

    console.log("\n3) status-filter proof on ACC_STATUS:");
    const st = itemOf(all, ACC_STATUS);
    check(st.debitTotal === 100, "debitTotal = 100 (999 draft and 50 reversed-original NOT counted)");
    check(st.creditTotal === 50, "creditTotal = 50 (reversal posted entry IS counted)");

    console.log("\n4) includeZero=false hides zero accounts:");
    const noZero = (await get(`/reports/ledger-reconciliation?includeZero=false&onlyDifferences=false`)).json.data;
    check(!itemOf(noZero, ACC_ZERO), "includeZero=false hides the zero account");

    console.log("\n5) onlyDifferences filter:");
    const diffs = (await get(`/reports/ledger-reconciliation?onlyDifferences=true&includeZero=true`)).json.data;
    check(Boolean(itemOf(diffs, ACC_DRIFT)), "onlyDifferences=true shows the drift account");
    check(!itemOf(diffs, ACC_MATCH), "onlyDifferences=true hides the matched account");

    console.log("\n6) global counts (no asOf → ACC_DRIFT +30, ACC_DATE -500):");
    check(all.differenceCount === 2, "differenceCount = 2");
    check(all.totalAbsoluteDifference === 530, "totalAbsoluteDifference = 30 + 500 = 530");
    check(all.hasDifferences === true, "hasDifferences = true");
    check(itemOf(all, ACC_DATE).calculatedBalance === 600 && itemOf(all, ACC_DATE).difference === -500, "no asOf: ACC_DATE calc 600, diff -500");

    console.log("\n7) asOf excludes future posted entries:");
    const asof = (await get(`/reports/ledger-reconciliation?asOf=2026-02-01&includeZero=true&onlyDifferences=false`)).json.data;
    check(itemOf(asof, ACC_DATE).calculatedBalance === 100 && itemOf(asof, ACC_DATE).status === "matched", "asOf=2026-02-01: future 500 excluded → calc 100 → matched");
    check(asof.differenceCount === 1 && asof.totalAbsoluteDifference === 30, "asOf: only ACC_DRIFT differs (count 1, total 30)");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only endpoint; fixtures cleaned up)`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("fixture lines", () => JournalLine.destroy({ where: { journalEntryId: ALL_ENTRIES } }));
    await safe("fixture entries", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("fixture accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("fixture company", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company/accounts/entries removed; endpoint made no writes");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
