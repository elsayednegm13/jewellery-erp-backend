/**
 * Post manual journal draft — Phase 8D5 verify.
 *
 * Financial-safety verification for POST /journal-entries/:id/post.
 *
 * The success case (create draft + post it) runs through journal.service inside
 * a transaction that is ROLLED BACK, so NOTHING persists — not even balances or
 * the append-only audit row. Rejection cases run over real HTTP against
 * committed fixture rows; every rejection fails validation BEFORE any balance
 * update, status change or audit write, so they leave no residue either. The
 * only committed rows are throwaway fixtures, all removed in `finally`.
 *
 * Run from repo root:
 *   node backend/scripts/verify-accounting-manual-draft-post.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const journalService = require("../src/services/journal.service");

const { sequelize, Account, JournalEntry, JournalLine, AuditLog, Company } = models;

const COMPANY = "CMP-DEMO";
const stamp = Date.now();
const OTHER_COMPANY = `CMP-VERIFY-OTHER-${stamp}`;
const ACC_A = `ACC-VPOST-A-${stamp}`;     // nature debit
const ACC_B = `ACC-VPOST-B-${stamp}`;     // nature credit
const ACC_INACTIVE = `ACC-VPOST-INACTIVE-${stamp}`;
const ACC_OTHER = `ACC-VPOST-OTHER-${stamp}`;

// Committed fixture entries for the HTTP rejection cases.
const E_POSTED = `JE-VPOST-POSTED-${stamp}`;
const E_NONMANUAL = `JE-VPOST-NONMANUAL-${stamp}`;
const E_UNBALANCED = `JE-VPOST-UNBAL-${stamp}`;
const E_NOLINES = `JE-VPOST-NOLINES-${stamp}`;
const E_INACTIVE = `JE-VPOST-INACTIVE-${stamp}`;
const E_CROSS = `JE-VPOST-CROSS-${stamp}`;
const ALL_ENTRIES = [E_POSTED, E_NONMANUAL, E_UNBALANCED, E_NOLINES, E_INACTIVE, E_CROSS];

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

async function makeAccount(id, companyId, nature, isActive) {
  return Account.create({
    id, companyId, code: id, name: `Verify ${id}`, nameAr: `تحقق ${id}`,
    type: nature === "debit" ? "asset" : "liability", nature, balance: 0, isActive, level: 3,
  });
}
async function makeEntry(id, status, sourceType) {
  return JournalEntry.create({
    id, companyId: COMPANY, description: `Verify ${id}`, date: "2026-06-24",
    status, amount: 0, totalDebit: 0, totalCredit: 0, sourceType,
    postedBy: status === "posted" ? "Fixture" : null,
    postedAt: status === "posted" ? new Date().toISOString() : null,
  });
}
async function makeLine(entryId, n, accountId, accountCode, debit, credit) {
  return JournalLine.create({
    id: `${entryId}-L${n}`, journalEntryId: entryId, accountId, accountCode,
    accountName: accountCode, debit, credit, description: null,
  });
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    // ── Throwaway fixtures (committed). All removed in finally. ───────────────
    await Company.create({ id: OTHER_COMPANY, businessName: "Verify Other Co", workspace: `verify-other-${stamp}` });
    await makeAccount(ACC_A, COMPANY, "debit", true);
    await makeAccount(ACC_B, COMPANY, "credit", true);
    await makeAccount(ACC_INACTIVE, COMPANY, "debit", false);
    await makeAccount(ACC_OTHER, OTHER_COMPANY, "debit", true);

    // posted entry (for non-draft / double-post rejection)
    await makeEntry(E_POSTED, "posted", "manual");
    await makeLine(E_POSTED, 1, ACC_A, ACC_A, 100, 0);
    await makeLine(E_POSTED, 2, ACC_B, ACC_B, 0, 100);
    // draft but non-manual sourceType
    await makeEntry(E_NONMANUAL, "draft", "invoice");
    // draft manual but unbalanced stored lines
    await makeEntry(E_UNBALANCED, "draft", "manual");
    await makeLine(E_UNBALANCED, 1, ACC_A, ACC_A, 100, 0);
    await makeLine(E_UNBALANCED, 2, ACC_B, ACC_B, 0, 90);
    // draft manual without lines
    await makeEntry(E_NOLINES, "draft", "manual");
    // draft manual referencing an inactive account
    await makeEntry(E_INACTIVE, "draft", "manual");
    await makeLine(E_INACTIVE, 1, ACC_INACTIVE, ACC_INACTIVE, 100, 0);
    await makeLine(E_INACTIVE, 2, ACC_B, ACC_B, 0, 100);
    // draft manual referencing an account from another company
    await makeEntry(E_CROSS, "draft", "manual");
    await makeLine(E_CROSS, 1, ACC_OTHER, ACC_OTHER, 100, 0);
    await makeLine(E_CROSS, 2, ACC_B, ACC_B, 0, 100);

    const balA0 = Number((await Account.findByPk(ACC_A)).balance);
    const balB0 = Number((await Account.findByPk(ACC_B)).balance);
    const auditBefore = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.post" } });

    console.log("1) success path — create + post in ROLLED-BACK transaction (no residue):");
    let txnEntryId = null;
    const t = await sequelize.transaction();
    try {
      const draft = await journalService.createManualDraft({
        companyId: COMPANY, actor: "Verify Admin", actorId: "USR-ADMIN", branchId: null,
        input: {
          date: "2026-06-24", description: "Verify post", reference: "VP",
          lines: [
            { accountId: ACC_A, debit: 100.5, credit: 0 },
            { accountId: ACC_B, debit: 0, credit: 100.5 },
          ],
        },
        transaction: t,
      });
      check(draft.status === "draft", "8D3 create still yields a draft");
      txnEntryId = draft.id;

      const posted = await journalService.postManualDraft({
        id: draft.id, companyId: COMPANY, actor: "Verify Admin", actorId: "USR-ADMIN", transaction: t,
      });
      check(posted.status === "posted", "status draft → posted");
      check(Boolean(posted.postedAt) && posted.postedBy === "Verify Admin", "postedAt/postedBy stamped by server");
      check(posted.id === draft.id, "no new JournalEntry created (same id posted)");
      check(Number(posted.totalDebit) === 100.5 && Number(posted.totalCredit) === 100.5, "totals recalculated 100.5 = 100.5");

      // Balance deltas applied on each account's natural side (both +100.5).
      const balAtxn = Number((await Account.findByPk(ACC_A, { transaction: t })).balance);
      const balBtxn = Number((await Account.findByPk(ACC_B, { transaction: t })).balance);
      check(balAtxn === balA0 + 100.5, "debit-nature account balance +100.5");
      check(balBtxn === balB0 + 100.5, "credit-nature account balance +100.5");

      const auditInTxn = await AuditLog.count({
        where: { companyId: COMPANY, action: "accounting.journal.post" }, transaction: t,
      });
      check(auditInTxn === auditBefore + 1, "accounting.journal.post audit recorded inside the transaction");

      // double-post inside same txn → ConflictError (status already posted)
      let doublePostErr = null;
      try {
        await journalService.postManualDraft({ id: draft.id, companyId: COMPANY, actor: "x", transaction: t });
      } catch (e) {
        doublePostErr = e;
      }
      check(doublePostErr && doublePostErr.statusCode === 409, "re-posting same entry → 409 (double-post guard)");
    } finally {
      await t.rollback();
    }

    // After rollback the success path leaves absolutely nothing.
    check((await JournalEntry.findByPk(txnEntryId)) === null, "posted entry NOT persisted after rollback");
    const balAend = Number((await Account.findByPk(ACC_A)).balance);
    const balBend = Number((await Account.findByPk(ACC_B)).balance);
    check(balAend === balA0 && balBend === balB0, "balances reverted after rollback (no residue)");
    const auditAfter = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.post" } });
    check(auditAfter === auditBefore, "audit count unchanged after rollback (no residue)");

    console.log("\n2) HTTP rejection cases (no balance/status/audit writes):");
    const nonExisting = await request(`/journal-entries/JE-DOES-NOT-EXIST-${stamp}/post`, { method: "POST" });
    check(nonExisting.status === 404, "post non-existing entry → 404");

    const nonDraft = await request(`/journal-entries/${E_POSTED}/post`, { method: "POST" });
    check(nonDraft.status === 409, "post non-draft (already posted) → 409");

    const nonManual = await request(`/journal-entries/${E_NONMANUAL}/post`, { method: "POST" });
    check(nonManual.status === 422, "post non-manual entry → 422");

    const unbalanced = await request(`/journal-entries/${E_UNBALANCED}/post`, { method: "POST" });
    check(unbalanced.status === 422, "post unbalanced stored lines → 422");

    const noLines = await request(`/journal-entries/${E_NOLINES}/post`, { method: "POST" });
    check(noLines.status === 422, "post entry without lines → 422");

    const inactive = await request(`/journal-entries/${E_INACTIVE}/post`, { method: "POST" });
    check(inactive.status === 422, "post with inactive account → 422");

    const cross = await request(`/journal-entries/${E_CROSS}/post`, { method: "POST" });
    check(cross.status === 422, "post with cross-company account → 422");

    // Double-post protection over HTTP: the already-posted fixture stays posted
    // and its accounts' balances are untouched by the rejected attempt.
    const balAposted = Number((await Account.findByPk(ACC_A)).balance);
    const balBposted = Number((await Account.findByPk(ACC_B)).balance);
    check(balAposted === balA0 && balBposted === balB0, "rejected posts moved NO balances");
    const stillPosted = await JournalEntry.findByPk(E_POSTED);
    check(stillPosted.status === "posted", "double-post attempt left status posted (no re-apply)");

    console.log("\n3) Phase 8D1/8B preservation:");
    const generic = await request("/journal-entries", {
      method: "POST",
      body: JSON.stringify({ description: "x", date: "2026-06-24", amount: 1, totalDebit: 1, totalCredit: 1 }),
    });
    check(generic.status === 422, "generic POST /journal-entries still rejected (Phase 8D1)");

    const paged = await request("/journal-entries?page=1&pageSize=10");
    check(
      paged.status === 200 && paged.json.page === 1 && paged.json.pageSize === 10 &&
        typeof paged.json.total === "number" && typeof paged.json.totalPages === "number",
      "Phase 8B pagination metadata intact",
    );

    console.log(`\nRESULT: all ${passed} checks passed. (success path rolled back — no DB residue)`);
  } finally {
    const safe = async (label, fn) => {
      try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); }
    };
    await safe("fixture lines", () => JournalLine.destroy({ where: { journalEntryId: ALL_ENTRIES } }));
    await safe("fixture entries", () => JournalEntry.destroy({ where: { id: ALL_ENTRIES } }));
    await safe("temp accounts", () => Account.destroy({ where: { id: [ACC_A, ACC_B, ACC_INACTIVE, ACC_OTHER] } }));
    await safe("other-company accounts", () => Account.destroy({ where: { companyId: OTHER_COMPANY } }));
    await safe("temp company", () => Company.destroy({ where: { id: OTHER_COMPANY } }));
    console.log("cleanup done — fixtures removed; no journal/balance/audit residue from the success path");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
