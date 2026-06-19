const crypto = require("crypto");
const { AuditLog } = require("../models");
const logger = require("../utils/logger");

/**
 * Audit service — append-only, tamper-evident log.
 *
 * Each entry stores hash = sha256(prevHash + canonicalPayload). Because every
 * hash depends on the previous one, altering or deleting any historical row
 * breaks the chain from that point onward, which verifyChain() detects.
 */

// Deterministic serialization of the fields that make a log meaningful.
function canonical(row) {
  return [
    row.id,
    row.companyId,
    row.action,
    row.description,
    row.user,
    row.userId || "",
    row.place || "",
    row.branch || "",
    row.date,
    row.before || "",
    row.after || "",
    row.severity || "info"
  ].join("|");
}

function computeHash(prevHash, row) {
  return crypto.createHash("sha256").update(`${prevHash || ""}|${canonical(row)}`).digest("hex");
}

const auditService = {
  computeHash,
  canonical,

  /**
   * Append a new audit entry, linking it to the chain head for its company.
   */
  async record(companyId, data, opts = {}) {
    const last = await AuditLog.findOne({
      where: { companyId },
      order: [["created_at", "DESC"]],
      transaction: opts.transaction
    });
    const prevHash = last ? last.hash : null;
    const id = data.id || `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const row = {
      id,
      companyId,
      action: data.action,
      description: data.description,
      user: data.user || "System",
      userId: data.userId || null,
      place: data.place || data.branch || "System",
      branch: data.branch || null,
      date: data.date || new Date().toISOString().slice(0, 19).replace("T", " "),
      before: data.before || null,
      after: data.after || null,
      device: data.device || null,
      correlationId: data.correlationId || null,
      sourceDocument: data.sourceDocument || null,
      severity: data.severity || "info"
    };
    row.prevHash = prevHash;
    row.hash = computeHash(prevHash, row);
    return AuditLog.create(row, { transaction: opts.transaction });
  },

  /**
   * Walk the chain for a company and report the first broken link, if any.
   */
  async verifyChain(companyId) {
    const rows = await AuditLog.findAll({
      where: { companyId },
      order: [["created_at", "ASC"]]
    });
    let prevHash = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const expected = computeHash(prevHash, r);
      if (r.prevHash !== prevHash || r.hash !== expected) {
        logger.warn(`[Audit] Chain broken at row ${r.id} (index ${i}) for company ${companyId}`);
        return { valid: false, total: rows.length, brokenAt: r.id, index: i };
      }
      prevHash = r.hash;
    }
    return { valid: true, total: rows.length };
  }
};

module.exports = auditService;
