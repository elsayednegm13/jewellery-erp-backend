/**
 * Cancel manual journal draft — Phase 8D9 verify.
 *
 * Financial-safety verification for POST /journal-entries/:id/cancel and the
 * generic-DELETE containment.
 *
 * The success case (create draft → cancel) runs through journal.service inside a
 * transaction that is ROLLED BACK, so NOTHING persists — not the entry/lines,
 * not the append-only audit row. Rejection cases run over real HTTP against
 * committed fixtures and perform no deletes. The only committed rows are
 * throwaway fixtures, all removed in `finally`.
 *
 * Run from repo root:
 *   node backend/scripts/verify-accounting-manual-draft-cancel.js
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
const ACC_A = `ACC-VCAN-A-${stamp}`; // debit
const ACC_B = `ACC-VCAN-B-${stamp}`; // credit

const E_POSTED = `JE-VCAN-POSTED-${stamp}`;
const E_REVERSED = `JE-VCAN-REVERSED-${stamp}`;
const E_NONMANUAL = `JE-VCAN-NONMANUAL-${stamp}`;
const E_OTHER = `JE-VCAN-OTHER-${stamp}`;
const ALL_ENTRIES = [E_POSTED, E_REVERSED, E_NONMANUAL, E_OTHER];

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
async function makeEntry(id, { status, sourceType, companyId = COMPANY }) {
  return JournalEntry.create({
    id, companyId, description: `Verify ${id}`, date: "2026-06-24",
    status, amount: 0, totalDebit: 0, totalCredit: 0, sourceType,
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
    await makeEntry(E_POSTED, { status: "posted", sourceType: "manual" });
    await makeEntry(E_REVERSED, { status: "reversed", sourceType: "manual" });
    await makeEntry(E_NONMANUAL, { status: "draft", sourceType: "invoice" });
    await makeEntry(E_OTHER, { status: "draft", sourceType: "manual", companyId: OTHER_COMPANY });

    const balA0 = Number((await Account.findByPk(ACC_A)).balance);
    const balB0 = Number((await Account.findByPk(ACC_B)).balance);
    const auditBefore = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.cancel" } });

    console.log("1) success path — create + cancel in ROLLED-BACK transaction (no residue):");
    let draftId = null;
    const t = await sequelize.transaction();
    try {
      const draft = await journalService.createManualDraft({
        companyId: COMPANY, actor: "Verify Admin", actorId: "USR-ADMIN", branchId: null,
        input: {
          date: "2026-06-24", description: "Verify cancel", reference: "VC",
          lines: [
            { accountId: ACC_A, debit: 100.5, credit: 0 },
            { accountId: ACC_B, debit: 0, credit: 100.5 },
          ],
        },
        transaction: t,
      });
      draftId = draft.id;
      check(draft.status === "draft", "draft created (status draft)");

      const res = await journalService.cancelManualDraft({
        id: draft.id, companyId: COMPANY, actor: "Verify Admin", actorId: "USR-ADMIN", transaction: t,
      });
      check(res.deleted === true && res.id === draft.id, "cancel returns { deleted: true }");

      check((await JournalEntry.findByPk(draft.id, { transaction: t })) === null, "entry deleted (within transaction)");
      check((await JournalLine.count({ where: { journalEntryId: draft.id }, transaction: t })) === 0, "lines deleted (within transaction)");

      const balAtxn = Number((await Account.findByPk(ACC_A, { transaction: t })).balance);
      const balBtxn = Number((await Account.findByPk(ACC_B, { transaction: t })).balance);
      check(balAtxn === balA0 && balBtxn === balB0, "Account.balance UNCHANGED by cancel");

      const auditInTxn = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.cancel" }, transaction: t });
      check(auditInTxn === auditBefore + 1, "accounting.journal.cancel audit recorded inside the transaction");
    } finally {
      await t.rollback();
    }

    const auditAfter = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.cancel" } });
    check(auditAfter === auditBefore, "audit count unchanged after rollback (no residue)");
    check(
      Number((await Account.findByPk(ACC_A)).balance) === balA0 &&
        Number((await Account.findByPk(ACC_B)).balance) === balB0,
      "balances unchanged after rollback (no residue)",
    );

    console.log("\n2) HTTP rejection cases (no deletes):");
    check((await request(`/journal-entries/JE-NOPE-${stamp}/cancel`, { method: "POST" })).status === 404, "cancel non-existing → 404");
    check((await request(`/journal-entries/${E_POSTED}/cancel`, { method: "POST" })).status === 409, "cancel posted → 409");
    check((await request(`/journal-entries/${E_REVERSED}/cancel`, { method: "POST" })).status === 409, "cancel reversed → 409");
    check((await request(`/journal-entries/${E_NONMANUAL}/cancel`, { method: "POST" })).status === 422, "cancel non-manual draft → 422");
    check((await request(`/journal-entries/${E_OTHER}/cancel`, { method: "POST" })).status === 404, "cancel cross-company → 404");

    // Rejected cancels deleted nothing.
    check((await JournalEntry.findByPk(E_POSTED)) !== null, "posted entry still present after rejected cancel");
    check((await JournalEntry.findByPk(E_REVERSED)) !== null, "reversed entry still present after rejected cancel");

    console.log("\n3) generic DELETE containment + Phase 8D1/8B preservation:");
    const genericDelete = await request(`/journal-entries/${E_POSTED}`, { method: "DELETE" });
    check(genericDelete.status === 422, "generic DELETE /journal-entries/:id rejected → 422");
    check((await JournalEntry.findByPk(E_POSTED)) !== null, "generic DELETE did NOT remove the posted entry");

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
