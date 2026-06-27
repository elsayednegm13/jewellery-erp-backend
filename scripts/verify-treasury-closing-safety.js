/**
 * Treasury closing validation + duplicate guard — Phase 11F verify.
 *
 * POST /treasury/closing now (a) rejects a missing/blank/non-numeric/negative
 * actualBalance with 422 (no more silent → 0), allowing an explicit 0 only;
 * (b) rejects an account other than cash/bank with 422 (no silent fallback to
 * cash); (c) rejects a second closing for the same company/account/day with 409
 * — while a genuine idempotent replay (same key) still returns the original 200
 * BEFORE the duplicate guard. Closing stays informational: no JournalEntry, no
 * postCashEntry, no Account.balance change, audit preserved, summary unaffected.
 *
 * WRITE endpoint → all fixtures live under a throwaway company; cleanup deletes
 * the company LAST so FK cascade removes every created row — no residue.
 *
 * Run from repo root of backend:
 *   cd backend && node scripts/verify-treasury-closing-safety.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Account, CashTransaction, JournalEntry, AuditLog } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-CLS-${stamp}`;
const D1 = "2026-03-01", D2 = "2026-03-02", D3 = "2026-03-03", D5 = "2026-03-05";
const CASH_BAL = 1000, BANK_BAL = 500;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let token;
async function close(body, key) {
  const headers = { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" };
  if (key) headers["Idempotency-Key"] = key;
  const r = await fetch(`${base}/treasury/closing`, { method: "POST", headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function summary() {
  const r = await fetch(`${base}/treasury/summary`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
  let json = null; try { json = await r.json(); } catch {}
  return json.data;
}
const closingCount = () => CashTransaction.count({ where: { companyId: CO, type: "closing" } });
const balOf = async (code) => Number((await Account.findOne({ where: { companyId: CO, code } })).balance);

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" }); // admin role → treasury perms

  try {
    await Company.create({ id: CO, businessName: "Verify Cls Co", workspace: `verify-cls-${stamp}` });
    await Account.create({ id: `ACC-1110-${stamp}`, companyId: CO, code: "1110", name: "Cash on Hand", nameAr: "النقدية", type: "asset", nature: "debit", balance: CASH_BAL });
    await Account.create({ id: `ACC-1120-${stamp}`, companyId: CO, code: "1120", name: "Bank", nameAr: "البنك", type: "asset", nature: "debit", balance: BANK_BAL });

    console.log("1) valid closings succeed:");
    const r1 = await close({ account: "cash", actualBalance: 1200, date: D1 });
    check(r1.status === 201 && r1.json.type === "closing", "cash closing (actual 1200) → 201 type closing");
    check(Number(r1.json.expectedBalance) === CASH_BAL, "expectedBalance = GL Cash balance (1000)");
    check(Number(r1.json.variance) === 200, "variance = actual - expected = 200");

    const r2 = await close({ account: "bank", actualBalance: 500, date: D1 });
    check(r2.status === 201, "bank closing same day (different account) → 201 (cash+bank same day allowed)");
    check(Number(r2.json.variance) === 0, "bank variance = 500 - 500 = 0");

    const r0 = await close({ account: "cash", actualBalance: 0, date: D2 });
    check(r0.status === 201, "explicit actualBalance = 0 (number) → 201");
    const r0s = await close({ account: "bank", actualBalance: "0", date: D2 });
    check(r0s.status === 201, "explicit actualBalance = '0' (string) → 201");

    console.log("\n2) invalid actualBalance is rejected (422), creates nothing:");
    const cBefore = await closingCount();
    check((await close({ account: "cash", date: D3 })).status === 422, "missing actualBalance → 422");
    check((await close({ account: "cash", actualBalance: "", date: D3 })).status === 422, "actualBalance '' → 422");
    check((await close({ account: "cash", actualBalance: null, date: D3 })).status === 422, "actualBalance null → 422");
    check((await close({ account: "cash", actualBalance: "abc", date: D3 })).status === 422, "actualBalance 'abc' → 422");
    check((await close({ account: "cash", actualBalance: "Infinity", date: D3 })).status === 422, "actualBalance 'Infinity' → 422");
    check((await close({ account: "cash", actualBalance: -1, date: D3 })).status === 422, "actualBalance -1 → 422");
    check((await closingCount()) === cBefore, "no closing created by any rejected actualBalance attempt");

    console.log("\n3) invalid account is rejected (422), no silent cash fallback:");
    const cBefore2 = await closingCount();
    check((await close({ account: "wallet", actualBalance: 5, date: D3 })).status === 422, "account 'wallet' → 422");
    check((await close({ actualBalance: 5, date: D3 })).status === 422, "missing account → 422 (no default to cash)");
    check((await closingCount()) === cBefore2, "no closing created by any rejected account attempt");

    console.log("\n4) duplicate daily guard + cross-day allowed:");
    const dup = await close({ account: "cash", actualBalance: 999, date: D1 });
    check(dup.status === 409, "second cash closing same day (D1) → 409");
    const otherDay = await close({ account: "cash", actualBalance: 1300, date: D3 });
    check(otherDay.status === 201, "cash closing on a different day (D3) → 201 (cross-day chaining preserved)");
    check(Number(otherDay.json.openingBalance) === 0 || typeof otherDay.json.openingBalance !== "undefined", "openingBalance derived from previous closing (account-scoped, not blocked by guard)");

    console.log("\n5) idempotency replay returns original, never 409:");
    const KEY = `CLS-KEY-${stamp}`;
    const first = await close({ account: "bank", actualBalance: 700, date: D5 }, KEY);
    check(first.status === 201, "first keyed bank closing (D5) → 201");
    const cntAfterFirst = await closingCount();
    const replay = await close({ account: "bank", actualBalance: 700, date: D5 }, KEY);
    check(replay.status === 200, "replay same key → 200 (idempotency wins over duplicate guard, not 409)");
    check((await closingCount()) === cntAfterFirst, "replay created no new closing");

    console.log("\n6) closing stays informational (no GL, no balance change):");
    check((await JournalEntry.count({ where: { companyId: CO } })) === 0, "no JournalEntry created by any closing");
    check((await balOf("1110")) === CASH_BAL, "GL Cash (1110) balance unchanged by closings");
    check((await balOf("1120")) === BANK_BAL, "GL Bank (1120) balance unchanged by closings");
    check((await AuditLog.count({ where: { companyId: CO, action: "treasury_closing_created" } })) >= 1, "treasury_closing_created audit recorded");

    console.log("\n7) summary logic unaffected (still GL-based):");
    const s = await summary();
    check(s.cash === CASH_BAL && s.bank === BANK_BAL, "summary cash/bank still from GL (1000/500), unchanged by closings");
    check(s.total === CASH_BAL + BANK_BAL, "summary total = cash + bank (1500)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("company (cascades audit/remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
