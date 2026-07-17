const { AccountingLock } = require("../models");
const auditService = require("./audit.service");
const { AppError, ValidationError } = require("../utils/errors");

const LOCK_ERROR = "ACCOUNTING_PERIOD_LOCKED";

function normalizeYmd(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(text).getTime())) {
    throw new ValidationError("Invalid accounting date (expected YYYY-MM-DD).");
  }
  return text;
}

async function getLock(companyId, options = {}) {
  if (!companyId) throw new Error("getLock requires companyId");
  return AccountingLock.findOne({
    where: { companyId },
    transaction: options.transaction || undefined,
  });
}

async function assertDateUnlocked(companyId, dateValue, options = {}) {
  const date = normalizeYmd(dateValue || new Date().toISOString().slice(0, 10));
  const row = await getLock(companyId, options);
  const lockedThroughDate = row?.lockedThroughDate ? String(row.lockedThroughDate).slice(0, 10) : null;
  if (lockedThroughDate && date <= lockedThroughDate) {
    throw new AppError(
      `Accounting date ${date} is locked through ${lockedThroughDate}.`,
      423,
      LOCK_ERROR
    );
  }
  return true;
}

async function setLock({ companyId, lockedThroughDate, reason = null, user = null, transaction = null }) {
  if (!companyId) throw new Error("setLock requires companyId");
  const normalized = normalizeYmd(lockedThroughDate);
  const actorName = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || user.id : "System";
  const actorId = user?.id || null;
  const existing = await getLock(companyId, { transaction });
  const before = existing ? existing.toJSON() : null;
  const [row] = await AccountingLock.findOrCreate({
    where: { companyId },
    defaults: {
      id: `ALOCK-${companyId}`,
      companyId,
      lockedThroughDate: normalized,
      reason,
      updatedByUserId: actorId,
      updatedByName: actorName,
    },
    transaction
  });
  if (existing) {
    await row.update({
      lockedThroughDate: normalized,
      reason,
      updatedByUserId: actorId,
      updatedByName: actorName,
    }, { transaction });
  }

  await auditService.record(companyId, {
    action: "accounting.lock.updated",
    description: normalized
      ? `Accounting locked through ${normalized}`
      : "Accounting date lock cleared",
    user: actorName,
    userId: actorId,
    place: "Accounting",
    sourceDocument: row.id,
    severity: "warning",
    before: before ? JSON.stringify(before) : null,
    after: JSON.stringify(row.toJSON())
  }, { transaction });

  return row;
}

module.exports = {
  LOCK_ERROR,
  normalizeYmd,
  getLock,
  assertDateUnlocked,
  setLock,
};
