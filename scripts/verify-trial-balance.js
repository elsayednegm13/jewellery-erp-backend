/**
 * Trial balance — Phase 9D verify (READ-ONLY endpoint).
 *
 * GET /reports/trial-balance is read-only, so the only DB rows here are
 * throwaway fixtures (accounts + journal entries/lines created directly via the
 * models, NOT through any posting service — so no balances move and no audit
 * rows are written). All fixtures are removed in `finally`, leaving no residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-trial-balance.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Account, JournalEntry, JournalLine } = models;

const COMPANY = "CMP-DEMO";
const stamp = Date.now();

// Accounts: one debit-nature, one credit-nature, plus two all-zero accounts to
// exercise the includeZero filter. The numeric suffix keeps them isolated.
const ACC_D = `ACC-VTB-D-${stamp}`;   // nature debit
const ACC_C = `ACC-VTB-C-${stamp}`;   // nature credit
const ACC_Z1 = `ACC-VTB-Z1-${stamp}`; // all-zero
const ACC_Z2 = `ACC-VTB-Z2-${stamp}`; // all-zero
const ALL_ACCOUNTS = [ACC_D, ACC_C, ACC_Z1, ACC_Z2];

// Entries.
const E_D1 = `JE-VTB-D1-${stamp}`;    // posted, debit-nature +100
const E_D2 = `JE-VTB-D2-${stamp}`;    // posted, debit-nature -30 (credit)
const E_D3 = `JE-VTB-D3-${stamp}`;    // posted, debit-nature +50  (AFTER asOf → excluded by asOf)
const E_DRAFT = `JE-VTB-DRAFT-${stamp}`; // draft → excluded
const E_ORIG = `JE-VTB-ORIG-${stamp}`;   // reversed original → excluded
const E_REV = `JE-VTB-REV-${stamp}`;     // posted reversal → included (correct effect)
const E_C1 = `JE-VTB-C1-${stamp}`;       // posted, credit-nature +100
const E_C2 = `JE-VTB-C2-${stamp}`;       // posted, credit-nature -40 (debit)
const ALL_ENTRIES = [E_D1, E_D2, E_D3, E_DRAFT, E_ORIG, E_REV, E_C1, E_C2];

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
    headers: { Authorization: `Bearer ${token}`, "X-Company-ID": COMPANY },
  });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}

async function makeAccount(id, nature, balance, type) {
  return Account.create({
    id, companyId: COMPANY, code: id, name: `Verify ${id}`, nameAr: `تحقق ${id}`,
    type: type || (nature === "debit" ? "asset" : "liability"), nature, balance, isActive: true, level: 3,
  });
}
async function makeEntry(id, date, status, sourceType, reversalOf = null) {
  return JournalEntry.create({
    id, companyId: COMPANY, description: `Verify ${id}`, date,
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
function approxEqual(a, b) { return Math.abs(a - b) <= 0.01; }

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    // ── Baseline BEFORE fixtures (tenant already has live data) ──────────
    const before = (await get(`/reports/trial-balance`)).json.data;
    const beforeZero = (await get(`/reports/trial-balance?includeZero=true`)).json.data;

    // ── Fixtures ─────────────────────────────────────────────────────────
    // Debit-nature account: balance set to the POSTED-UP-TO-asOf expected calc.
    //   posted up to asOf (2026-02-28): +100, -30, reversal -200 included.
    //     E_D1 debit 100 credit 0   → D 100, C 0
    //     E_D2 debit 0   credit 30  → D 0,  C 30
    //     E_REV debit 0 credit 200  → D 0,  C 200   (reversal of E_ORIG)
    //   debitTotal=100, creditTotal=230 → calc(debit nature)=100-230=-130
    // With asOf out of the picture (no asOf), E_D3 (+50) also counts:
    //   debitTotal=150, creditTotal=230 → calc=-80 → set balance=-80.
    await makeAccount(ACC_D, "debit", -80);
    await makeAccount(ACC_C, "credit", 60); // posted: credit 100, debit 40 → calc 60 → diff 0
    await makeAccount(ACC_Z1, "debit", 0);
    await makeAccount(ACC_Z2, "credit", 0);

    await makeEntry(E_D1, "2026-01-10", "posted", "manual");      await makeLine(E_D1, ACC_D, 100, 0); // +100
    await makeEntry(E_D2, "2026-02-10", "posted", "manual");      await makeLine(E_D2, ACC_D, 0, 30);  // -30
    await makeEntry(E_D3, "2026-03-10", "posted", "manual");      await makeLine(E_D3, ACC_D, 50, 0);  // +50 (after asOf)
    await makeEntry(E_DRAFT, "2026-02-15", "draft", "manual");    await makeLine(E_DRAFT, ACC_D, 999, 0); // excluded (draft)
    await makeEntry(E_ORIG, "2026-02-20", "reversed", "manual");  await makeLine(E_ORIG, ACC_D, 200, 0);  // excluded (reversed)
    await makeEntry(E_REV, "2026-02-21", "posted", "manual_reversal", E_ORIG); await makeLine(E_REV, ACC_D, 0, 200); // included
    // Credit-nature account history.
    await makeEntry(E_C1, "2026-01-05", "posted", "manual");      await makeLine(E_C1, ACC_C, 0, 100); // credit-nature → +100
    await makeEntry(E_C2, "2026-01-06", "posted", "manual");      await makeLine(E_C2, ACC_C, 40, 0);  // credit-nature → -40

    // ── 1) basic + validation ────────────────────────────────────────────
    console.log("1) basic + validation:");
    const baseOk = await get(`/reports/trial-balance`);
    check(baseOk.status === 200, "endpoint → 200");
    const invalid = await get(`/reports/trial-balance?asOf=2026-13-99`);
    check(invalid.status === 422, "invalid asOf date → 422");

    // ── 2) exclude drafts & reversed originals, include reversal entry ────
    console.log("\n2) status filtering (posted only):");
    const data = baseOk.json.data;
    const d = data.items.find((i) => i.accountId === ACC_D);
    check(!!d, "debit-nature account present");
    check(d.debitTotal === 150, "debitTotal = Σ posted debit (150; draft 999 & reversed 200 excluded)");
    check(d.creditTotal === 230, "creditTotal = Σ posted credit (230; reversal 200 included)");
    check(d.calculatedBalance === -80, "debit-nature calculatedBalance = debitTotal - creditTotal (-80)");

    // ── 3) debit/credit nature + presentation ─────────────────────────────
    console.log("\n3) nature + netDebit/netCredit presentation:");
    // debit-nature calc -80 (negative) → flips to credit column as +80.
    check(d.netDebit === 0 && d.netCredit === 80, "debit-nature negative balance → netCredit 80, netDebit 0");
    const c = data.items.find((i) => i.accountId === ACC_C);
    check(c.calculatedBalance === 60, "credit-nature calculatedBalance = creditTotal - debitTotal (60)");
    check(c.netDebit === 0 && c.netCredit === 60, "credit-nature positive balance → netCredit 60, netDebit 0");

    // ── 4) totals + balanced (delta vs baseline) ──────────────────────────
    console.log("\n4) totals + isBalanced:");
    // Our two non-zero fixtures contribute netCredit 80 + 60 = 140, netDebit 0.
    check(approxEqual(data.totalDebit - before.totalDebit, 0), "totalDebit grew by fixture netDebit (0)");
    check(approxEqual(data.totalCredit - before.totalCredit, 140), "totalCredit grew by fixture netCredit (140)");
    check(data.isBalanced === (Math.abs(data.totalDebit - data.totalCredit) <= 0.01), "isBalanced matches tolerance rule");

    // ── 5) includeZero filter (delta vs baseline) ─────────────────────────
    console.log("\n5) includeZero filter:");
    check(!data.items.some((i) => i.accountId === ACC_Z1 || i.accountId === ACC_Z2), "includeZero=false → zero accounts excluded");
    check(data.accountCount - before.accountCount === 2, "accountCount grew by 2 (only the non-zero fixtures)");
    const incZero = (await get(`/reports/trial-balance?includeZero=true`)).json.data;
    check(incZero.items.some((i) => i.accountId === ACC_Z1), "includeZero=true → zero account #1 shown");
    check(incZero.items.some((i) => i.accountId === ACC_Z2), "includeZero=true → zero account #2 shown");
    check(incZero.accountCount - beforeZero.accountCount === 4, "includeZero=true → accountCount grew by 4");
    const z = incZero.items.find((i) => i.accountId === ACC_Z1);
    check(z.debitTotal === 0 && z.creditTotal === 0 && z.calculatedBalance === 0 && z.netDebit === 0 && z.netCredit === 0, "zero account: every metric 0");

    // ── 6) asOf windowing ─────────────────────────────────────────────────
    console.log("\n6) asOf windowing:");
    const asOf = (await get(`/reports/trial-balance?asOf=2026-02-28`)).json.data;
    const dAsOf = asOf.items.find((i) => i.accountId === ACC_D);
    check(dAsOf.debitTotal === 100, "asOf excludes E_D3 (after cutoff) → debitTotal 100");
    check(dAsOf.creditTotal === 230, "asOf still includes reversal (200) + E_D2 (30) → creditTotal 230");
    check(dAsOf.calculatedBalance === -130, "asOf calculatedBalance = 100 - 230 = -130");
    check(asOf.asOf === "2026-02-28", "asOf echoed back");

    // ── 7) currentBalance reference + difference (no write) ───────────────
    console.log("\n7) currentBalance reference + difference:");
    check(d.currentBalance === -80, "currentBalance = Account.balance (-80), reference only");
    check(d.difference === 0, "difference = currentBalance - calculatedBalance (0 here)");
    check(dAsOf.difference === 50, "asOf difference = -80 - (-130) = 50 (computed, never written)");
    check(asOf.totalDifference >= Math.abs(dAsOf.difference), "totalDifference summarizes |differences| (>= this account's |difference|)");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only endpoint; fixtures cleaned up)`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("fixture lines", () => JournalLine.destroy({ where: { journalEntryId: ALL_ENTRIES } }));
    await safe("fixture entries", () => JournalEntry.destroy({ where: { id: ALL_ENTRIES } }));
    await safe("fixture accounts", () => Account.destroy({ where: { id: ALL_ACCOUNTS } }));
    console.log("cleanup done — throwaway fixtures removed; endpoint made no writes");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
