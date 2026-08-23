/**
 * Manual balanced journal draft — Phase 8D3 verify.
 *
 * Financial-safety verification for POST /journal-entries/manual-draft.
 *
 * The ONE success case is exercised through journal.service.createManualDraft
 * inside a transaction that is ROLLED BACK, so NOTHING persists — not even the
 * append-only audit row (which the system, by design, refuses to delete). All
 * rejection cases are exercised over real HTTP and perform no writes. The only
 * committed rows are throwaway fixture accounts/company, removed in `finally`.
 *
 * Run from repo root:
 *   node backend/scripts/verify-accounting-manual-draft.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const journalService = require("../src/services/journal.service");

const { sequelize, Account, JournalEntry, AuditLog, Company } = models;

const COMPANY = "CMP-DEMO";
const stamp = Date.now();
const OTHER_COMPANY = `CMP-VERIFY-OTHER-${stamp}`;
const ACC_A = `ACC-VERIFY-A-${stamp}`;
const ACC_B = `ACC-VERIFY-B-${stamp}`;
const ACC_INACTIVE = `ACC-VERIFY-INACTIVE-${stamp}`;
const ACC_OTHER = `ACC-VERIFY-OTHER-${stamp}`;

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

async function makeAccount(id, companyId, isActive) {
  return Account.create({
    id,
    companyId,
    code: id,
    name: `Verify ${id}`,
    nameAr: `تحقق ${id}`,
    type: "asset",
    nature: "debit",
    balance: 0,
    isActive,
    level: 3,
  });
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    // Throwaway fixtures: two active accounts (same company), one inactive, and
    // one in a separate temp company. Removed in `finally`.
    await Company.create({ id: OTHER_COMPANY, businessName: "Verify Other Co", workspace: `verify-other-${stamp}` });
    await makeAccount(ACC_A, COMPANY, true);
    await makeAccount(ACC_B, COMPANY, true);
    await makeAccount(ACC_INACTIVE, COMPANY, false);
    await makeAccount(ACC_OTHER, OTHER_COMPANY, true);

    const balA0 = Number((await Account.findByPk(ACC_A)).balance);
    const balB0 = Number((await Account.findByPk(ACC_B)).balance);
    const auditBefore = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.draft_create" } });

    console.log("1) successful balanced draft — isolated transaction, ROLLED BACK (no residue):");
    let txnEntryId = null;
    const t = await sequelize.transaction();
    try {
      const entry = await journalService.createManualDraft({
        companyId: COMPANY,
        actor: "Verify Admin",
        actorId: "USR-ADMIN",
        branchId: null,
        input: {
          date: "2026-06-24",
          description: "Verify manual balanced draft",
          reference: "VERIFY-REF",
          lines: [
            { accountId: ACC_A, debit: 100.5, credit: 0, memo: "debit side" },
            { accountId: ACC_B, debit: 0, credit: 100.5, memo: "credit side" },
          ],
        },
        transaction: t,
      });
      txnEntryId = entry.id;
      check(entry.status === "draft", "created entry status === draft");
      check(entry.sourceType === "manual", "sourceType === manual");
      check(entry.sourceId === "VERIFY-REF", "reference stored as sourceId");
      check(!entry.postedAt && !entry.postedBy, "postedAt/postedBy are null (not posted)");
      check(Array.isArray(entry.lines) && entry.lines.length === 2, "two journal lines created");
      check(
        Number(entry.totalDebit) === 100.5 && Number(entry.totalCredit) === 100.5,
        "totalDebit === totalCredit === 100.5",
      );
      check(
        entry.lines.every((l) => l.accountCode && l.accountName),
        "lines carry server-resolved accountCode/accountName",
      );

      const dbEntry = await JournalEntry.findByPk(entry.id, { transaction: t });
      check(Boolean(dbEntry) && dbEntry.status === "draft", "entry visible as draft inside the transaction");

      const balAtxn = Number((await Account.findByPk(ACC_A, { transaction: t })).balance);
      const balBtxn = Number((await Account.findByPk(ACC_B, { transaction: t })).balance);
      check(balAtxn === balA0 && balBtxn === balB0, "Account.balance UNCHANGED for both accounts");

      const auditInTxn = await AuditLog.count({
        where: { companyId: COMPANY, action: "accounting.journal.draft_create" },
        transaction: t,
      });
      check(auditInTxn === auditBefore + 1, "draft_create audit event recorded inside the transaction");
    } finally {
      await t.rollback();
    }

    // After rollback, the success case leaves absolutely nothing behind.
    check((await JournalEntry.findByPk(txnEntryId)) === null, "entry NOT persisted after rollback (no residue)");
    const auditAfter = await AuditLog.count({ where: { companyId: COMPANY, action: "accounting.journal.draft_create" } });
    check(auditAfter === auditBefore, "audit count unchanged after rollback (no residue)");

    console.log("\n2) HTTP rejection cases (no writes):");
    const unbalanced = await request("/journal-entries/manual-draft", {
      method: "POST",
      body: JSON.stringify({
        date: "2026-06-24",
        description: "Unbalanced",
        lines: [
          { accountId: ACC_A, debit: 100, credit: 0 },
          { accountId: ACC_B, debit: 0, credit: 90 },
        ],
      }),
    });
    check(unbalanced.status === 422, "unbalanced entry → 422");

    const bothSides = await request("/journal-entries/manual-draft", {
      method: "POST",
      body: JSON.stringify({
        date: "2026-06-24",
        description: "Both sides",
        lines: [
          { accountId: ACC_A, debit: 100, credit: 100 },
          { accountId: ACC_B, debit: 0, credit: 100 },
        ],
      }),
    });
    check(bothSides.status === 422, "line with both debit and credit → 422");

    const noAccount = await request("/journal-entries/manual-draft", {
      method: "POST",
      body: JSON.stringify({
        date: "2026-06-24",
        description: "No account",
        lines: [
          { accountId: "", debit: 100, credit: 0 },
          { accountId: ACC_B, debit: 0, credit: 100 },
        ],
      }),
    });
    check(noAccount.status === 422, "line without accountId → 422");

    const inactive = await request("/journal-entries/manual-draft", {
      method: "POST",
      body: JSON.stringify({
        date: "2026-06-24",
        description: "Inactive account",
        lines: [
          { accountId: ACC_INACTIVE, debit: 100, credit: 0 },
          { accountId: ACC_B, debit: 0, credit: 100 },
        ],
      }),
    });
    check(inactive.status === 422, "inactive account → 422");

    const crossCompany = await request("/journal-entries/manual-draft", {
      method: "POST",
      body: JSON.stringify({
        date: "2026-06-24",
        description: "Cross-company account",
        lines: [
          { accountId: ACC_OTHER, debit: 100, credit: 0 },
          { accountId: ACC_B, debit: 0, credit: 100 },
        ],
      }),
    });
    check(crossCompany.status === 422, "account from another company → 422");

    const lifecycleInjection = await request("/journal-entries/manual-draft", {
      method: "POST",
      body: JSON.stringify({
        date: "2026-06-24",
        description: "Lifecycle injection",
        status: "posted",
        postedAt: new Date().toISOString(),
        lines: [
          { accountId: ACC_A, debit: 100, credit: 0 },
          { accountId: ACC_B, debit: 0, credit: 100 },
        ],
      }),
    });
    check(lifecycleInjection.status === 422, "lifecycle field injection (status/postedAt) → 422");

    console.log("\n3) generic POST still rejected + pagination intact:");
    const generic = await request("/journal-entries", {
      method: "POST",
      body: JSON.stringify({ description: "x", date: "2026-06-24", amount: 1, totalDebit: 1, totalCredit: 1 }),
    });
    check(generic.status === 422, "generic POST /journal-entries still rejected (Phase 8D1)");

    const paged = await request("/journal-entries?page=1&pageSize=10");
    check(
      paged.status === 200 &&
        paged.json.page === 1 &&
        paged.json.pageSize === 10 &&
        typeof paged.json.total === "number" &&
        typeof paged.json.totalPages === "number",
      "Phase 8B pagination metadata intact",
    );

    // Nothing the suite did moved any committed balance.
    const balAend = Number((await Account.findByPk(ACC_A)).balance);
    const balBend = Number((await Account.findByPk(ACC_B)).balance);
    check(balAend === balA0 && balBend === balB0, "committed balances unchanged after full suite");

    console.log(`\nRESULT: all ${passed} checks passed. (success path rolled back — no DB residue)`);
  } finally {
    // ── Cleanup throwaway fixtures only. The success path persisted nothing. ──
    const safe = async (label, fn) => {
      try {
        await fn();
      } catch (cleanupErr) {
        console.error(`CLEANUP WARNING (${label}):`, cleanupErr.message);
      }
    };
    await safe("temp accounts", () => Account.destroy({ where: { id: [ACC_A, ACC_B, ACC_INACTIVE, ACC_OTHER] } }));
    await safe("other-company accounts", () => Account.destroy({ where: { companyId: OTHER_COMPANY } }));
    await safe("temp company", () => Company.destroy({ where: { id: OTHER_COMPANY } }));
    console.log("cleanup done — throwaway fixture accounts/company removed; no journal/audit residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
