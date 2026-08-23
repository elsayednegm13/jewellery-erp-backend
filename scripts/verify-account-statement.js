/**
 * GL account statement — Phase 9B verify (READ-ONLY endpoint).
 *
 * GET /accounts/:id/statement is read-only, so the only DB rows here are
 * throwaway fixtures (accounts + journal entries/lines created directly via the
 * models, NOT through any posting service — so no balances move and no audit
 * rows are written). All fixtures are removed in `finally`, leaving no residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-account-statement.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Account, JournalEntry, JournalLine } = models;

const COMPANY = "CMP-DEMO";
const stamp = Date.now();
const ACC_D = `ACC-VSTMT-D-${stamp}`; // nature debit
const ACC_C = `ACC-VSTMT-C-${stamp}`; // nature credit

const E1 = `JE-VSTMT-1-${stamp}`;
const E2 = `JE-VSTMT-2-${stamp}`;
const E3 = `JE-VSTMT-3-${stamp}`;
const E_DRAFT = `JE-VSTMT-DRAFT-${stamp}`;
const E_ORIG = `JE-VSTMT-ORIG-${stamp}`;
const E_REV = `JE-VSTMT-REV-${stamp}`;
const EC1 = `JE-VSTMT-C1-${stamp}`;
const EC2 = `JE-VSTMT-C2-${stamp}`;
const ALL_ENTRIES = [E1, E2, E3, E_DRAFT, E_ORIG, E_REV, EC1, EC2];

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

async function makeAccount(id, nature) {
  return Account.create({
    id, companyId: COMPANY, code: id, name: `Verify ${id}`, nameAr: `تحقق ${id}`,
    type: nature === "debit" ? "asset" : "liability", nature, balance: 0, isActive: true, level: 3,
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

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await makeAccount(ACC_D, "debit");
    await makeAccount(ACC_C, "credit");
    // Debit-nature account history.
    await makeEntry(E1, "2026-01-10", "posted", "manual");      await makeLine(E1, ACC_D, 100, 0); // +100 (before `from`)
    await makeEntry(E2, "2026-02-10", "posted", "manual");      await makeLine(E2, ACC_D, 0, 30);  // -30
    await makeEntry(E3, "2026-03-10", "posted", "manual");      await makeLine(E3, ACC_D, 50, 0);  // +50
    await makeEntry(E_DRAFT, "2026-02-15", "draft", "manual");  await makeLine(E_DRAFT, ACC_D, 999, 0); // excluded (draft)
    await makeEntry(E_ORIG, "2026-02-20", "reversed", "manual");await makeLine(E_ORIG, ACC_D, 200, 0);  // excluded (reversed)
    await makeEntry(E_REV, "2026-02-21", "posted", "manual_reversal", E_ORIG); await makeLine(E_REV, ACC_D, 0, 200); // -200 (included)
    // Credit-nature account history.
    await makeEntry(EC1, "2026-01-05", "posted", "manual");     await makeLine(EC1, ACC_C, 0, 100); // credit-nature → +100
    await makeEntry(EC2, "2026-01-06", "posted", "manual");     await makeLine(EC2, ACC_C, 40, 0);  // credit-nature → -40

    console.log("1) basic + validation:");
    check((await get(`/accounts/${ACC_D}/statement`)).status === 200, "existing account → 200");
    check((await get(`/accounts/JE-NOPE-${stamp}/statement`)).status === 404, "missing account → 404");
    check((await get(`/accounts/${ACC_D}/statement?from=2026-13-99`)).status === 422, "invalid from date → 422");
    check((await get(`/accounts/${ACC_D}/statement?from=2026-03-01&to=2026-01-01`)).status === 422, "from > to → 422");
    check((await get(`/accounts/${ACC_D}/statement?pageSize=5000`)).json.data.pageSize === 200, "pageSize capped at 200");

    console.log("\n2) debit-nature statement, windowed + paged:");
    const p1 = (await get(`/accounts/${ACC_D}/statement?from=2026-02-01&to=2026-03-31&page=1&pageSize=2`)).json.data;
    check(p1.openingBalance === 100, "openingBalance = full pre-`from` aggregate (100)");
    check(p1.total === 3, "total = 3 posted rows in range (draft & reversed excluded)");
    check(p1.totalPages === 2, "totalPages = 2");
    check(p1.closingBalance === -80, "closingBalance = opening + Σ range delta (-80), not page-based");
    check(p1.items.length === 2 && p1.items[0].delta === -30 && p1.items[0].runningBalance === 70, "row1 delta -30 → running 70");
    check(p1.items[1].journalEntryId === E_REV && p1.items[1].delta === -200 && p1.items[1].runningBalance === -130, "reversal entry included; delta -200 → running -130");
    const noBad1 = p1.items.every((r) => r.journalEntryId !== E_DRAFT && r.journalEntryId !== E_ORIG);
    check(noBad1, "draft and reversed-original NOT present on page 1");

    const p2 = (await get(`/accounts/${ACC_D}/statement?from=2026-02-01&to=2026-03-31&page=2&pageSize=2`)).json.data;
    check(p2.openingBalance === 100, "openingBalance identical on page 2 (not page-based)");
    check(p2.closingBalance === -80, "closingBalance identical on page 2 (not page-based)");
    check(p2.items.length === 1 && p2.items[0].journalEntryId === E3, "page 2 has the last row");
    check(p2.items[0].delta === 50 && p2.items[0].runningBalance === -80, "page 2 running continues (-130 + 50 = -80)");

    console.log("\n3) no-`from` opening = 0 + credit-nature delta sign:");
    const c = (await get(`/accounts/${ACC_C}/statement`)).json.data;
    check(c.openingBalance === 0, "no `from` → openingBalance 0");
    check(c.total === 2, "credit account has 2 rows");
    const ec1 = c.items.find((r) => r.journalEntryId === EC1);
    const ec2 = c.items.find((r) => r.journalEntryId === EC2);
    check(ec1.delta === 100, "credit-nature: credit line → +100");
    check(ec2.delta === -40, "credit-nature: debit line → -40");
    check(c.closingBalance === 60, "credit account closing = 60");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only endpoint; fixtures cleaned up)`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("fixture lines", () => JournalLine.destroy({ where: { journalEntryId: ALL_ENTRIES } }));
    await safe("fixture entries", () => JournalEntry.destroy({ where: { id: ALL_ENTRIES } }));
    await safe("fixture accounts", () => Account.destroy({ where: { id: [ACC_D, ACC_C] } }));
    console.log("cleanup done — throwaway fixtures removed; endpoint made no writes");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
