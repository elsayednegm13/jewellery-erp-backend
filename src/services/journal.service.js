const { Account, JournalEntry, JournalLine, sequelize } = require("../models");
const auditService = require("./audit.service");
const { ValidationError, NotFoundError, ConflictError } = require("../utils/errors");
const logger = require("../utils/logger");

/**
 * Journal service — Manual Balanced Journal Draft (Phase 8D3).
 *
 * Creates a manual journal entry as a DRAFT ONLY, with balanced debit/credit
 * lines. It NEVER posts, NEVER stamps postedAt/postedBy, and NEVER touches
 * Account.balance — posting/approval/reversal are separate future phases. It
 * does NOT use postingService.postEntry (which posts AND moves balances).
 *
 * All work runs inside a caller-supplied transaction so the route can commit it
 * and a verification harness can roll it back (leaving zero residue, including
 * the append-only audit row).
 */

// Lifecycle / system / derived fields a client must never send (header-level).
const MANUAL_DRAFT_FORBIDDEN_FIELDS = [
  "id", "companyId", "company_id", "status",
  "postedAt", "posted_at", "postedBy", "posted_by",
  "reversedAt", "reversed_at", "reversedBy", "reversed_by",
  "reversalOf", "reversal_of",
  "amount", "totalDebit", "total_debit", "totalCredit", "total_credit",
  "sourceType", "source_type", "sourceId", "source_id",
];
// Fields a client must never send on a line — accountCode/accountName are copied
// server-side from the verified Account record, never trusted from input.
const MANUAL_DRAFT_LINE_FORBIDDEN_FIELDS = [
  "id", "journalEntryId", "journal_entry_id",
  "accountCode", "account_code", "accountName", "account_name",
];
// Sum DECIMAL(15,4) amounts as integer ten-thousandths to compare without float
// drift (decimal-safe — never compares floats directly).
const toTenThousandths = (v) => Math.round(Number(v) * 10000);

/**
 * Validate + normalize a manual-draft payload. Throws ValidationError (422) on
 * any rule violation. Returns { description, date, reference, lines:[{accountId,
 * debit, credit, memo}], totalDebit, totalCredit }.
 */
function validateManualDraft(body = {}) {
  // 1. Reject any lifecycle/system/derived field injection (header level).
  const injected = MANUAL_DRAFT_FORBIDDEN_FIELDS.filter((f) =>
    Object.prototype.hasOwnProperty.call(body, f)
  );
  if (injected.length > 0) {
    throw new ValidationError(
      `Forbidden fields not allowed for a manual draft: ${injected.join(", ")}. ` +
      "Status, posting stamps and totals are derived by the server."
    );
  }

  // 2. Header validation.
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) throw new ValidationError("Journal description is required.");

  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new ValidationError("A valid date (YYYY-MM-DD) is required.");
  }

  const reference =
    body.reference === undefined || body.reference === null
      ? null
      : String(body.reference).trim() || null;

  // 3. Lines validation — at least two, each one-sided and positive.
  const rawLines = Array.isArray(body.lines) ? body.lines : null;
  if (!rawLines || rawLines.length < 2) {
    throw new ValidationError("At least two journal lines are required.");
  }

  const lines = rawLines.map((line, i) => {
    const where = `Line ${i + 1}`;
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw new ValidationError(`${where}: invalid line object.`);
    }
    const lineInjected = MANUAL_DRAFT_LINE_FORBIDDEN_FIELDS.filter((f) =>
      Object.prototype.hasOwnProperty.call(line, f)
    );
    if (lineInjected.length > 0) {
      throw new ValidationError(`${where}: forbidden fields not allowed: ${lineInjected.join(", ")}.`);
    }

    const accountId = typeof line.accountId === "string" ? line.accountId.trim() : "";
    if (!accountId) throw new ValidationError(`${where}: accountId is required.`);

    const hasDebit = line.debit !== undefined && line.debit !== null && line.debit !== "";
    const hasCredit = line.credit !== undefined && line.credit !== null && line.credit !== "";
    const debit = hasDebit ? Number(line.debit) : 0;
    const credit = hasCredit ? Number(line.credit) : 0;
    if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
      throw new ValidationError(`${where}: debit/credit must be finite numbers.`);
    }
    if (debit < 0 || credit < 0) {
      throw new ValidationError(`${where}: amounts cannot be negative.`);
    }
    const debitPos = debit > 0;
    const creditPos = credit > 0;
    if (debitPos && creditPos) {
      throw new ValidationError(`${where}: a line cannot have both a debit and a credit.`);
    }
    if (!debitPos && !creditPos) {
      throw new ValidationError(`${where}: a line must have a debit OR a credit greater than zero.`);
    }

    const memo =
      line.memo === undefined || line.memo === null
        ? null
        : String(line.memo).trim() || null;

    return { accountId, debit, credit, memo };
  });

  // 4. Balanced check (decimal-safe via integer ten-thousandths).
  const totalDebitTtt = lines.reduce((s, l) => s + toTenThousandths(l.debit), 0);
  const totalCreditTtt = lines.reduce((s, l) => s + toTenThousandths(l.credit), 0);
  if (totalDebitTtt !== totalCreditTtt) {
    throw new ValidationError(
      `Unbalanced entry: total debit (${(totalDebitTtt / 10000).toFixed(4)}) ` +
      `must equal total credit (${(totalCreditTtt / 10000).toFixed(4)}).`
    );
  }

  return {
    description,
    date,
    reference,
    lines,
    totalDebit: totalDebitTtt / 10000,
    totalCredit: totalCreditTtt / 10000,
  };
}

/**
 * Create a balanced manual journal DRAFT inside the given transaction.
 *
 * @param {object} args
 * @param {string} args.companyId  ALWAYS from auth/request — never the body.
 * @param {string} [args.actor]    Display name for the audit actor.
 * @param {string} [args.actorId]  User id for the audit actor.
 * @param {string|null} [args.branchId]  Validated BR-* scope, or null.
 * @param {object} args.input      Raw request body (validated here).
 * @param {object} args.transaction  REQUIRED sequelize transaction.
 * @returns {object} entry JSON with `lines`.
 */
async function createManualDraft({ companyId, actor = "System", actorId = null, branchId = null, input, transaction }) {
  if (!transaction) throw new Error("createManualDraft requires a transaction.");
  if (!companyId) throw new Error("createManualDraft requires a companyId from the request.");

  const { description, date, reference, lines, totalDebit, totalCredit } = validateManualDraft(input);

  // Validate every distinct account: exists, same company, active.
  const accountById = new Map();
  for (let i = 0; i < lines.length; i++) {
    const { accountId } = lines[i];
    if (accountById.has(accountId)) continue;
    const account = await Account.findOne({ where: { id: accountId, companyId }, transaction });
    if (!account) {
      throw new ValidationError(`Line ${i + 1}: account "${accountId}" not found in this company.`);
    }
    if (!account.isActive) {
      throw new ValidationError(`Line ${i + 1}: account ${account.code} is inactive.`);
    }
    accountById.set(accountId, account);
  }

  const entryId = `JE-MAN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const entry = await JournalEntry.create(
    {
      id: entryId,
      companyId,
      branchId,
      description,
      date,
      status: "draft",          // draft ONLY — never posted here
      amount: totalDebit,
      totalDebit,
      totalCredit,
      sourceType: "manual",
      sourceId: reference,
      postedBy: null,
      postedAt: null,
      reversalOf: null,
    },
    { transaction }
  );

  let i = 0;
  for (const line of lines) {
    const account = accountById.get(line.accountId);
    await JournalLine.create(
      {
        id: `${entryId}-L${++i}`,
        journalEntryId: entryId,
        accountId: account.id,
        accountCode: account.code,          // from the verified Account record
        accountName: account.nameAr || account.name,
        debit: line.debit,
        credit: line.credit,
        description: line.memo,
      },
      { transaction }
    );
    // INTENTIONAL: no account.increment("balance"). Drafts never move balances —
    // that only happens when an entry is posted (a future phase).
  }

  await auditService.record(
    companyId,
    {
      action: "accounting.journal.draft_create",
      description: `Manual journal draft ${entryId} created — ${lines.length} lines, balanced ${totalDebit.toFixed(2)}`,
      user: actor,
      userId: actorId,
      place: branchId,
      branch: branchId,
      sourceDocument: entryId,
      severity: "info",
      after: JSON.stringify({
        id: entryId,
        status: "draft",
        sourceType: "manual",
        totalDebit,
        totalCredit,
        lineCount: lines.length,
      }),
    },
    { transaction }
  );

  const lineRows = await JournalLine.findAll({ where: { journalEntryId: entryId }, transaction });
  const json = entry.toJSON();
  json.lines = lineRows.map((r) => r.toJSON());
  logger.info(`[Accounting] Manual journal draft prepared: ${entryId} (status=draft, no balance change)`);
  return json;
}

/**
 * Post an existing manual journal DRAFT inside the given transaction.
 *
 * This NEVER creates a new JournalEntry and NEVER calls postingService.postEntry
 * (which would create a duplicate entry and resolve accounts by code). It loads
 * the existing draft + its stored lines, re-validates them, applies the
 * double-entry balance deltas on each account's natural side, and flips the SAME
 * entry to "posted" — all atomically.
 *
 * Double-posting is prevented by locking the entry row (FOR UPDATE) and
 * re-checking status === "draft" AFTER the lock, then flipping status within the
 * same transaction. A concurrent second post waits on the lock and then sees a
 * non-draft status and is rejected.
 *
 * @param {object} args
 * @param {string} args.id          JournalEntry id.
 * @param {string} args.companyId   ALWAYS from auth/request — never the body.
 * @param {string} [args.actor]     Display name stamped as postedBy + audit actor.
 * @param {string} [args.actorId]   User id for the audit actor.
 * @param {object} args.transaction REQUIRED sequelize transaction.
 * @returns {object} posted entry JSON with `lines`.
 */
async function postManualDraft({ id, companyId, actor = "System", actorId = null, transaction }) {
  if (!transaction) throw new Error("postManualDraft requires a transaction.");
  if (!companyId) throw new Error("postManualDraft requires a companyId from the request.");
  if (!id) throw new ValidationError("Journal entry id is required.");

  // 1. Lock the entry row (FOR UPDATE) — serializes concurrent post attempts.
  const entry = await JournalEntry.findOne({ where: { id, companyId }, lock: true, transaction });
  if (!entry) throw new NotFoundError(`Journal entry "${id}" not found.`);

  // 2. Re-check status AFTER the lock — only a manual draft may be posted. This
  //    is the core double-posting guard: a second concurrent call resumes here
  //    with status already "posted" and is rejected before any balance change.
  if (entry.status !== "draft") {
    throw new ConflictError(`Only draft entries can be posted; entry ${id} is already "${entry.status}".`);
  }
  if (entry.sourceType !== "manual") {
    throw new ValidationError(`Only manual entries can be posted here; entry ${id} sourceType is "${entry.sourceType}".`);
  }

  // 3. Load the STORED lines (the source of truth — never re-built from input).
  const lines = await JournalLine.findAll({ where: { journalEntryId: id }, transaction });
  if (!lines || lines.length < 2) {
    throw new ValidationError(`Entry ${id} must have at least two lines to post.`);
  }

  // 4. Validate + lock every distinct account (exists, in-company, active).
  const accountById = new Map();
  for (const line of lines) {
    if (!line.accountId) throw new ValidationError(`Entry ${id}: a line is missing its accountId.`);
    if (accountById.has(line.accountId)) continue;
    const account = await Account.findOne({
      where: { id: line.accountId, companyId },
      lock: true,
      transaction,
    });
    if (!account) throw new ValidationError(`Entry ${id}: account "${line.accountId}" not found in this company.`);
    if (!account.isActive) throw new ValidationError(`Entry ${id}: account ${account.code} is inactive.`);
    accountById.set(line.accountId, account);
  }

  // 5. Re-verify balance from the STORED lines (decimal-safe), not stored totals.
  const totalDebitTtt = lines.reduce((s, l) => s + toTenThousandths(l.debit), 0);
  const totalCreditTtt = lines.reduce((s, l) => s + toTenThousandths(l.credit), 0);
  if (totalDebitTtt !== totalCreditTtt) {
    throw new ValidationError(
      `Entry ${id} is unbalanced: debit (${(totalDebitTtt / 10000).toFixed(4)}) ` +
      `≠ credit (${(totalCreditTtt / 10000).toFixed(4)}).`
    );
  }
  if (totalDebitTtt === 0) {
    throw new ValidationError(`Entry ${id} has zero totals; nothing to post.`);
  }
  const totalDebit = totalDebitTtt / 10000;
  const totalCredit = totalCreditTtt / 10000;

  // 6. Apply the double-entry delta on each account's natural side. Same formula
  //    as the auto-posting engine, but operating on the existing stored lines.
  for (const line of lines) {
    const account = accountById.get(line.accountId);
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    const delta = account.nature === "debit" ? debit - credit : credit - debit;
    await account.increment("balance", { by: delta, transaction });
  }

  // 7. Flip the SAME entry to posted (server-stamped) AFTER balances succeed.
  const before = { status: entry.status, postedAt: entry.postedAt, postedBy: entry.postedBy };
  const postedAt = new Date().toISOString();
  await entry.update(
    {
      status: "posted",
      postedAt,
      postedBy: actor,
      totalDebit,
      totalCredit,
      amount: totalDebit,
    },
    { transaction }
  );

  // 8. Audit inside the same transaction.
  await auditService.record(
    companyId,
    {
      action: "accounting.journal.post",
      description: `Manual journal draft ${id} posted — ${lines.length} lines, balanced ${totalDebit.toFixed(2)}`,
      user: actor,
      userId: actorId,
      place: entry.branchId,
      branch: entry.branchId,
      sourceDocument: id,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify({
        id,
        status: "posted",
        postedAt,
        postedBy: actor,
        totalDebit,
        totalCredit,
        lineCount: lines.length,
      }),
    },
    { transaction }
  );

  const lineRows = await JournalLine.findAll({ where: { journalEntryId: id }, transaction });
  const json = entry.toJSON();
  json.lines = lineRows.map((r) => r.toJSON());
  logger.info(`[Accounting] Manual journal draft posted: ${id} (balances updated, status=posted)`);
  return json;
}

/**
 * Reverse an existing POSTED manual journal entry inside the given transaction.
 *
 * Accounting-correct reversal: the original entry is NEVER deleted or edited —
 * a NEW reversal JournalEntry (status posted) is created with debit/credit
 * SWAPPED on each line, its balance deltas undo the original's effect exactly,
 * and the original is flipped to "reversed". The reversal entry links back via
 * reversalOf = sourceId = original.id. This NEVER calls postingService.postEntry.
 *
 * Double-reversal is prevented by locking the original row, re-checking
 * status === "posted" AFTER the lock, rejecting if a reversal already exists,
 * and flipping the original to "reversed" within the same transaction.
 *
 * @param {object} args
 * @param {string} args.id          Original JournalEntry id.
 * @param {string} args.companyId   ALWAYS from auth/request — never the body.
 * @param {string} [args.actor]     Display name stamped as postedBy + audit actor.
 * @param {string} [args.actorId]   User id for the audit actor.
 * @param {object} args.transaction REQUIRED sequelize transaction.
 * @returns {object} reversal entry JSON with `lines` and `originalId`.
 */
async function reverseManualEntry({ id, companyId, actor = "System", actorId = null, transaction }) {
  if (!transaction) throw new Error("reverseManualEntry requires a transaction.");
  if (!companyId) throw new Error("reverseManualEntry requires a companyId from the request.");
  if (!id) throw new ValidationError("Journal entry id is required.");

  // 1. Lock the original entry row (serializes concurrent reversal attempts).
  const original = await JournalEntry.findOne({ where: { id, companyId }, lock: true, transaction });
  if (!original) throw new NotFoundError(`Journal entry "${id}" not found.`);

  // 2. Re-check AFTER the lock — only a posted manual entry may be reversed.
  if (original.status !== "posted") {
    throw new ConflictError(`Only posted entries can be reversed; entry ${id} is "${original.status}".`);
  }
  if (original.sourceType !== "manual") {
    throw new ValidationError(`Only manual entries can be reversed here; entry ${id} sourceType is "${original.sourceType}".`);
  }
  // 3. The entry must not itself be a reversal entry.
  if (original.reversalOf) {
    throw new ValidationError(`Entry ${id} is itself a reversal entry and cannot be reversed.`);
  }
  // 4. Reject if a reversal already exists for this entry (double-reversal guard).
  const existingReversal = await JournalEntry.findOne({
    where: { companyId, reversalOf: id },
    transaction,
  });
  if (existingReversal) {
    throw new ConflictError(`Entry ${id} has already been reversed by ${existingReversal.id}.`);
  }

  // 5. Load the original (immutable) lines.
  const lines = await JournalLine.findAll({ where: { journalEntryId: id }, transaction });
  if (!lines || lines.length < 2) {
    throw new ValidationError(`Entry ${id} must have at least two lines to reverse.`);
  }

  // 6. Validate + lock each account: exists + in-company. isActive is NOT
  //    required — a correction must not be blocked by a later-deactivated account.
  const accountById = new Map();
  for (const line of lines) {
    if (!line.accountId) throw new ValidationError(`Entry ${id}: a line is missing its accountId.`);
    if (accountById.has(line.accountId)) continue;
    const account = await Account.findOne({ where: { id: line.accountId, companyId }, lock: true, transaction });
    if (!account) throw new ValidationError(`Entry ${id}: account "${line.accountId}" not found in this company.`);
    accountById.set(line.accountId, account);
  }

  // 7. Re-verify balance from the STORED lines (decimal-safe).
  const totalDebitTtt = lines.reduce((s, l) => s + toTenThousandths(l.debit), 0);
  const totalCreditTtt = lines.reduce((s, l) => s + toTenThousandths(l.credit), 0);
  if (totalDebitTtt !== totalCreditTtt) {
    throw new ValidationError(`Entry ${id} is unbalanced and cannot be reversed.`);
  }
  const total = totalDebitTtt / 10000;

  // 8. Create the reversal entry (status posted, linked to the original).
  //    sourceType "manual_reversal" — the column is a plain STRING (no enum), so
  //    this is safe and lets the UI exclude reversal entries from re-reversal.
  const reversalId = `JE-REV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const postedAt = new Date().toISOString();
  const reversal = await JournalEntry.create(
    {
      id: reversalId,
      companyId,
      branchId: original.branchId,
      description: `Reversal of ${id} — ${original.description || ""}`.slice(0, 255),
      date: new Date().toISOString().slice(0, 10),
      status: "posted",
      amount: total,
      totalDebit: total,
      totalCredit: total,
      sourceType: "manual_reversal",
      sourceId: id,
      reversalOf: id,
      postedBy: actor,
      postedAt,
    },
    { transaction }
  );

  // 9. Create swapped reversal lines AND apply the reversing balance deltas.
  //    Because debit/credit are swapped, each delta is the negative of the
  //    original — the net effect on every account balance is exactly undone.
  let i = 0;
  for (const line of lines) {
    const account = accountById.get(line.accountId);
    const debit = Number(line.credit) || 0; // swapped
    const credit = Number(line.debit) || 0; // swapped
    await JournalLine.create(
      {
        id: `${reversalId}-L${++i}`,
        journalEntryId: reversalId,
        accountId: account.id,
        accountCode: account.code,
        accountName: account.nameAr || account.name,
        debit,
        credit,
        description: line.description ? `Reversal: ${line.description}`.slice(0, 255) : `Reversal of ${id}`,
      },
      { transaction }
    );
    const delta = account.nature === "debit" ? debit - credit : credit - debit;
    await account.increment("balance", { by: delta, transaction });
  }

  // 10. Flip the ORIGINAL to reversed — never delete or edit its lines.
  const before = { originalId: id, originalStatus: original.status };
  await original.update({ status: "reversed" }, { transaction });

  // 11. Audit inside the same transaction.
  await auditService.record(
    companyId,
    {
      action: "accounting.journal.reverse",
      description: `Manual journal ${id} reversed by ${reversalId} — ${lines.length} lines, ${total.toFixed(2)}`,
      user: actor,
      userId: actorId,
      place: original.branchId,
      branch: original.branchId,
      sourceDocument: reversalId,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify({
        originalId: id,
        originalStatus: "reversed",
        reversalEntryId: reversalId,
        total,
      }),
    },
    { transaction }
  );

  const lineRows = await JournalLine.findAll({ where: { journalEntryId: reversalId }, transaction });
  const json = reversal.toJSON();
  json.lines = lineRows.map((r) => r.toJSON());
  json.originalId = id;
  logger.info(`[Accounting] Manual journal ${id} reversed by ${reversalId} (balances restored, original=reversed)`);
  return json;
}

/**
 * Cancel (hard-delete) an existing manual journal DRAFT inside the given
 * transaction.
 *
 * Cancellation is a HARD DELETE (the JournalEntry table is not paranoid and the
 * status enum has no "cancelled" value — using one would need a migration). It
 * is financially safe because a DRAFT has never touched any Account.balance
 * (balances only move on post, Phase 8D5), so deleting it has zero ledger
 * impact. A full before-snapshot is written to the append-only audit log so the
 * cancellation remains traceable despite the row being removed. This NEVER
 * touches Account.balance and never posts/reverses.
 *
 * @param {object} args
 * @param {string} args.id          JournalEntry id.
 * @param {string} args.companyId   ALWAYS from auth/request — never the body.
 * @param {string} [args.actor]     Display name for the audit actor.
 * @param {string} [args.actorId]   User id for the audit actor.
 * @param {object} args.transaction REQUIRED sequelize transaction.
 * @returns {object} { id, deleted: true }.
 */
async function cancelManualDraft({ id, companyId, actor = "System", actorId = null, transaction }) {
  if (!transaction) throw new Error("cancelManualDraft requires a transaction.");
  if (!companyId) throw new Error("cancelManualDraft requires a companyId from the request.");
  if (!id) throw new ValidationError("Journal entry id is required.");

  // 1. Lock the entry row (serializes against a concurrent post/reverse).
  const entry = await JournalEntry.findOne({ where: { id, companyId }, lock: true, transaction });
  if (!entry) throw new NotFoundError(`Journal entry "${id}" not found.`);

  // 2. Re-check AFTER the lock — only a manual draft may be cancelled.
  if (entry.status !== "draft") {
    throw new ConflictError(`Only draft entries can be cancelled; entry ${id} is "${entry.status}".`);
  }
  if (entry.sourceType !== "manual") {
    throw new ValidationError(`Only manual entries can be cancelled here; entry ${id} sourceType is "${entry.sourceType}".`);
  }
  if (entry.reversalOf) {
    throw new ValidationError(`Entry ${id} is a reversal entry and cannot be cancelled.`);
  }

  // 3. Snapshot (entry + compact line summary) for the audit trail.
  const lines = await JournalLine.findAll({ where: { journalEntryId: id }, transaction });
  const before = {
    id: entry.id,
    status: entry.status,
    sourceType: entry.sourceType,
    date: entry.date,
    description: entry.description,
    totalDebit: Number(entry.totalDebit),
    totalCredit: Number(entry.totalCredit),
    lineCount: lines.length,
    lines: lines.map((l) => ({
      accountId: l.accountId,
      accountCode: l.accountCode,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
  };

  // 4. Delete the lines then the entry. No Account.balance change — a draft
  //    never moved any balance, so cancellation has zero ledger impact.
  await JournalLine.destroy({ where: { journalEntryId: id }, transaction });
  await entry.destroy({ transaction });

  // 5. Audit inside the same transaction.
  await auditService.record(
    companyId,
    {
      action: "accounting.journal.cancel",
      description: `Manual journal draft ${id} cancelled (deleted) — ${before.lineCount} lines, ${before.totalDebit.toFixed(2)}`,
      user: actor,
      userId: actorId,
      place: entry.branchId,
      branch: entry.branchId,
      sourceDocument: id,
      severity: "info",
      before: JSON.stringify(before),
      after: JSON.stringify({ id, deleted: true }),
    },
    { transaction }
  );

  logger.info(`[Accounting] Manual journal draft cancelled (deleted): ${id} (no balance change)`);
  return { id, deleted: true };
}

module.exports = {
  createManualDraft,
  postManualDraft,
  reverseManualEntry,
  cancelManualDraft,
  validateManualDraft,
  MANUAL_DRAFT_FORBIDDEN_FIELDS,
  MANUAL_DRAFT_LINE_FORBIDDEN_FIELDS,
};
