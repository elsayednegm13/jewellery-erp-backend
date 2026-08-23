/**
 * Treasury permissions + atomic posting + audit — Phase 11B verify.
 *
 * WRITE endpoints → all fixtures live under a throwaway company; cleanup deletes
 * the company LAST so FK cascade removes every created row (cash transactions,
 * journal, accounts, audit, users) — no residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-treasury-safety.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, User, CashTransaction, JournalEntry, Account, AuditLog } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-TRES-${stamp}`;
const NOPERM = `USR-NOPERM-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let adminToken;
let noPermToken;
async function call(method, pathname, body, token) {
  const headers = { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" };
  const r = await fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  adminToken = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" }); // role admin → all perms
  noPermToken = jwt.sign({ userId: NOPERM }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify Tres Co", workspace: `verify-tres-${stamp}` });
    // A non-admin user with NO roles in this company → no treasury permissions.
    await User.create({
      id: NOPERM, companyId: CO, firstName: "No", lastName: "Perm",
      email: `noperm-${stamp}@verify.local`, password: "x", role: "sales",
    });

    console.log("1) permission guards:");
    check((await call("GET", "/treasury/summary", undefined, noPermToken)).status === 403, "no treasury.view → GET /treasury/summary 403");
    check((await call("GET", "/treasury/summary", undefined, adminToken)).status === 200, "admin → GET /treasury/summary 200");
    check((await call("POST", "/treasury/transactions", { amount: 1, account: "cash" }, noPermToken)).status === 403, "no treasury.update → POST /treasury/transactions 403");
    check((await call("GET", "/treasury/closings", undefined, noPermToken)).status === 403, "no treasury.view → GET /treasury/closings 403");

    console.log("\n2) atomic cash_in + posting + audit:");
    const acctBefore = await Account.findOne({ where: { companyId: CO, code: "1110" } });
    const balBefore = acctBefore ? Number(acctBefore.balance) : 0;
    const auditBefore = await AuditLog.count({ where: { companyId: CO, action: "treasury_transaction_created" } });

    const r1 = await call("POST", "/treasury/transactions", { amount: 500, account: "cash", category: "test in" }, adminToken);
    check(r1.status === 201 && r1.json.success, "admin POST cash_in 500 → 201");
    const txId = r1.json.data.id;
    check(Boolean(r1.json.data.journalEntryId), "CashTransaction.journalEntryId is set (not null)");
    const je = await JournalEntry.findByPk(r1.json.data.journalEntryId);
    check(Boolean(je) && je.status === "posted", "linked JournalEntry exists and is posted");
    const acctAfter = await Account.findOne({ where: { companyId: CO, code: "1110" } });
    check(acctAfter && Number(acctAfter.balance) === balBefore + 500, "Cash (1110) balance increased by 500 via posting engine");
    check((await AuditLog.count({ where: { companyId: CO, action: "treasury_transaction_created" } })) === auditBefore + 1, "treasury_transaction_created audit recorded");
    check((await AuditLog.findOne({ where: { companyId: CO, sourceDocument: txId } })) !== null, "audit linked to the cash transaction");

    console.log("\n3) idempotency:");
    const key = `TRES-KEY-${stamp}`;
    const a = await call("POST", "/treasury/transactions", { amount: 250, account: "bank", idempotencyKey: key }, adminToken);
    check(a.status === 201, "first keyed cash_in → 201");
    const ctCountAfterFirst = await CashTransaction.count({ where: { companyId: CO, idempotencyKey: key } });
    const jeCountAfterFirst = await JournalEntry.count({ where: { companyId: CO, sourceType: "cash_transaction" } });
    const replay = await call("POST", "/treasury/transactions", { amount: 250, account: "bank", idempotencyKey: key }, adminToken);
    check(replay.status === 200 && replay.json.meta?.idempotentReplay === true, "replay with same key → 200 replay");
    check((await CashTransaction.count({ where: { companyId: CO, idempotencyKey: key } })) === ctCountAfterFirst, "replay created no new CashTransaction");
    check((await JournalEntry.count({ where: { companyId: CO, sourceType: "cash_transaction" } })) === jeCountAfterFirst, "replay created no new JournalEntry");

    console.log("\n4) atomicity — posting failure leaves no orphan:");
    // counterAccountCode 9999 is not in the canonical chart → ensureAccount throws
    // inside the transaction → everything rolls back (no orphan CashTransaction).
    const ctBeforeBad = await CashTransaction.count({ where: { companyId: CO } });
    const bad = await call("POST", "/treasury/transactions", { amount: 77, account: "cash", counterAccountCode: "9999", reference: `BAD-${stamp}` }, adminToken);
    check(bad.status >= 400, "posting failure (bad counter account) → error status, not 201");
    check((await CashTransaction.count({ where: { companyId: CO } })) === ctBeforeBad, "no orphan CashTransaction created on posting failure");
    check((await CashTransaction.findOne({ where: { companyId: CO, reference: `BAD-${stamp}` } })) === null, "the failed transaction was rolled back");

    console.log("\n5) closing guard + audit:");
    check((await call("POST", "/treasury/closing", { account: "cash", actualBalance: 500 }, noPermToken)).status === 403, "no treasury.update → POST /treasury/closing 403");
    const cAuditBefore = await AuditLog.count({ where: { companyId: CO, action: "treasury_closing_created" } });
    const cl = await call("POST", "/treasury/closing", { account: "cash", actualBalance: 500 }, adminToken);
    check(cl.status === 201 && cl.json.type === "closing", "admin closing → 201 (type closing)");
    check((await AuditLog.count({ where: { companyId: CO, action: "treasury_closing_created" } })) === cAuditBefore + 1, "treasury_closing_created audit recorded");
    check((await call("GET", "/treasury/closings", undefined, adminToken)).status === 200, "admin → GET /treasury/closings 200");

    console.log("\n6) summary still works (server-side):");
    const sum = await call("GET", "/treasury/summary", undefined, adminToken);
    check(sum.status === 200 && typeof sum.json.data.cash === "number" && typeof sum.json.data.total === "number", "summary returns server-side cash/bank/total");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("journal entries (+lines cascade)", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("users", () => User.destroy({ where: { companyId: CO }, force: true }));
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
