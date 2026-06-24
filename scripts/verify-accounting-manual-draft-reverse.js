/**
 * Reverse manual posted journal entry — Phase 8D7 verify.
 *
 * Financial-safety verification for POST /journal-entries/:id/reverse.
 *
 * The success case (create draft → post → reverse) runs through journal.service
 * inside a transaction that is ROLLED BACK, so NOTHING persists — not balances,
 * not the reversal entry, not the append-only audit row. Rejection cases run
 * over real HTTP against committed fixture rows; every rejection fails before any
 * balance/status/audit write. The only committed rows are throwaway fixtures,
 * all removed in `finally`.
 *
 * Run from repo root:
 *   node backend/scripts/verify-accounting-manual-draft-reverse.js
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
const ACC_A = `ACC-VREV-A-${stamp}`; // nature debit
const ACC_B = `ACC-VREV-B-${stamp}`; // nature credit

const E_DRAFT = `JE-VREV-DRAFT-${stamp}`;
const E_REVERSED = `JE-VREV-REVERSED-${stamp}`;
const E_NONMANUAL = `JE-VREV-NONMANUAL-${stamp}`;
const E_REVENTRY = `JE-VREV-REVENTRY-${stamp}`;       // sourceType manual_reversal
const E_MANUAL_REVOF = `JE-VREV-MANREVOF-${stamp}`;   // manual + reversalOf set
const E_HASREV = `JE-VREV-HASREV-${stamp}`;           // posted manual already having a reversal
const E_HASREV_REV = `JE-VREV-HASREV-R-${stamp}`;     // the existing reversal of E_HASREV
const E_OTHER = `JE-VREV-OTHER-${stamp}`;             // under another company
const ALL_ENTRIES = [E_DRAFT, E_REVERSED, E_NONMANUAL, E_REVENTRY, E_MANUAL_REVOF, E_HASREV, E_HASREV_REV, E_OTHER];

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
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}

async function makeAccount(id, companyId, nature) {
  return Account.create({
    id, companyId, code: id, name: `Verify ${id}`, nameAr: `تحقق ${id}`,
    type: nature === "debit" ? "asset" : "liability", nature, balance: 0, isActive: true, level: 3,
  });
}
async function makeEntry(id, { status, sourceType, reversalOf = null, companyId = COMPANY }) {
  return JournalEntry.create({
    id, companyId, description: `Verify ${id}`, date: "2026-06-24",
    status, amount: 0, totalDebit: 0, totalCredit: 0, sourceType, reversalOf,
    postedBy: status === "posted" || status === "reversed" ? "Fixture" : null,
    postedAt: status === "posted" || status === "reversed" ? new Date().toISOString() : null,
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
    await makeAccount(ACC_A, COMPANY, "debit");
    await makeAccount(ACC_B, COMPANY, "credit");

    await makeEntry(E_DRAFT, { status: "draft", sourceType: "manual" });
    await makeEntry(E_REVERSED, { status: "reversed", sourceType: "manual" });
    await makeEntry(E_NONMANUAL, { status: "posted", sourceType: "invoice" });
    await makeEntry(E_REVENTRY, { status: "posted", sourceType: "manual_reversal", reversalOf: "SOME-ORIGINAL" });
    await makeEntry(E_MANUAL_REVOF, { status: "posted", sourceType: "manual", reversalOf: "SOME-ORIGINAL" });
    await makeEntry(E_HASREV, { status: "posted", sourceType: "manual" });
    await makeEntry(E_HASREV_REV, { status: "posted", sourceType: "manual_reversal", reversalOf: E_HASREV });
    await makeEntry(E_OTHER, { status: "posted", sourceType: "manual", companyId: OTHER_COMPANY });

    const balA0 = Number((await Account.findByPk(ACC_A)).balance);
    const balB0 = Number((await Account.findByPk(ACC_B)).balance);
    const auditBefore = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.reverse" } });

    console.log("1) success path — create + post + reverse in ROLLED-BACK transaction (no residue):");
    let originalId = null;
    let reversalId = null;
    const t = await sequelize.transaction();
    try {
      const draft = await journalService.createManualDraft({
        companyId: COMPANY, actor: "Verify Admin", actorId: "USR-ADMIN", branchId: null,
        input: {
          date: "2026-06-24", description: "Verify reverse", reference: "VR",
          lines: [
            { accountId: ACC_A, debit: 100.5, credit: 0 },
            { accountId: ACC_B, debit: 0, credit: 100.5 },
          ],
        },
        transaction: t,
      });
      originalId = draft.id;
      await journalService.postManualDraft({ id: draft.id, companyId: COMPANY, actor: "Verify Admin", actorId: "USR-ADMIN", transaction: t });

      // Balances moved by posting (sanity).
      check(Number((await Account.findByPk(ACC_A, { transaction: t })).balance) === balA0 + 100.5, "post moved debit-account balance +100.5");

      const reversal = await journalService.reverseManualEntry({
        id: draft.id, companyId: COMPANY, actor: "Verify Admin", actorId: "USR-ADMIN", transaction: t,
      });
      reversalId = reversal.id;
      check(reversal.status === "posted", "reversal entry status === posted");
      check(reversal.id !== draft.id, "reversal is a NEW entry (different id)");
      check(reversal.reversalOf === draft.id && reversal.sourceId === draft.id, "reversal linked to original via reversalOf + sourceId");
      check(reversal.sourceType === "manual_reversal", "reversal sourceType === manual_reversal");
      check(Boolean(reversal.postedAt) && reversal.postedBy === "Verify Admin", "reversal postedAt/postedBy stamped by server");

      // Reversal lines are debit/credit SWAPPED.
      const revA = reversal.lines.find((l) => l.accountId === ACC_A);
      const revB = reversal.lines.find((l) => l.accountId === ACC_B);
      check(Number(revA.credit) === 100.5 && Number(revA.debit) === 0, "original debit line → reversal credit line");
      check(Number(revB.debit) === 100.5 && Number(revB.credit) === 0, "original credit line → reversal debit line");

      // Original flipped to reversed; its own lines untouched (still 2).
      const orig = await JournalEntry.findByPk(draft.id, { transaction: t });
      check(orig.status === "reversed", "original entry status === reversed (within transaction)");
      const origLines = await JournalLine.findAll({ where: { journalEntryId: draft.id }, transaction: t });
      check(origLines.length === 2 && Number(origLines[0].debit) + Number(origLines[1].debit) === 100.5, "original lines unchanged (not edited/deleted)");

      // Net balance effect undone — back to the pre-post values.
      const balAtxn = Number((await Account.findByPk(ACC_A, { transaction: t })).balance);
      const balBtxn = Number((await Account.findByPk(ACC_B, { transaction: t })).balance);
      check(balAtxn === balA0 && balBtxn === balB0, "Account.balance restored to pre-post values");

      const auditInTxn = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.reverse" }, transaction: t });
      check(auditInTxn === auditBefore + 1, "accounting.journal.reverse audit recorded inside the transaction");

      // Double-reversal inside same txn → ConflictError (existing reversal).
      let dErr = null;
      try {
        await journalService.reverseManualEntry({ id: draft.id, companyId: COMPANY, actor: "x", transaction: t });
      } catch (e) { dErr = e; }
      check(dErr && dErr.statusCode === 409, "re-reversing same entry → 409 (double-reversal guard)");
    } finally {
      await t.rollback();
    }

    check((await JournalEntry.findByPk(originalId)) === null, "original NOT persisted after rollback");
    check((await JournalEntry.findByPk(reversalId)) === null, "reversal NOT persisted after rollback");
    const balAend = Number((await Account.findByPk(ACC_A)).balance);
    const balBend = Number((await Account.findByPk(ACC_B)).balance);
    check(balAend === balA0 && balBend === balB0, "balances unchanged after rollback (no residue)");
    const auditAfter = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.reverse" } });
    check(auditAfter === auditBefore, "audit count unchanged after rollback (no residue)");

    console.log("\n2) HTTP rejection cases (no balance/status/audit writes):");
    check((await request(`/journal-entries/JE-NOPE-${stamp}/reverse`, { method: "POST" })).status === 404, "reverse non-existing → 404");
    check((await request(`/journal-entries/${E_DRAFT}/reverse`, { method: "POST" })).status === 409, "reverse draft → 409");
    check((await request(`/journal-entries/${E_REVERSED}/reverse`, { method: "POST" })).status === 409, "reverse already reversed → 409");
    check((await request(`/journal-entries/${E_NONMANUAL}/reverse`, { method: "POST" })).status === 422, "reverse non-manual posted → 422");
    check((await request(`/journal-entries/${E_REVENTRY}/reverse`, { method: "POST" })).status === 422, "reverse a reversal entry itself → 422");
    check((await request(`/journal-entries/${E_MANUAL_REVOF}/reverse`, { method: "POST" })).status === 422, "reverse manual entry with reversalOf set → 422");
    check((await request(`/journal-entries/${E_HASREV}/reverse`, { method: "POST" })).status === 409, "double-reversal: entry with existing reversal → 409");
    check((await request(`/journal-entries/${E_OTHER}/reverse`, { method: "POST" })).status === 404, "cross-company entry → 404");

    // Rejected reversals moved nothing.
    check(
      Number((await Account.findByPk(ACC_A)).balance) === balA0 &&
        Number((await Account.findByPk(ACC_B)).balance) === balB0,
      "rejected reversals moved NO balances",
    );
    check((await JournalEntry.findByPk(E_HASREV)).status === "posted", "entry with existing reversal stayed posted (no re-apply)");

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
    await safe("temp accounts", () => Account.destroy({ where: { id: [ACC_A, ACC_B] } }));
    await safe("other-company accounts", () => Account.destroy({ where: { companyId: OTHER_COMPANY } }));
    await safe("other-company entries", () => JournalEntry.destroy({ where: { companyId: OTHER_COMPANY } }));
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
