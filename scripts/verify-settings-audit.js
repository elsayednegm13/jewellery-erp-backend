/**
 * P2.1 verification — settings persistence + audit.
 *
 * Confirms (against the real DB, all rolled back — no pollution):
 *  1. A settings document upserts and reads back (source of truth = DB).
 *  2. An operational by-key setting change appends an audit row.
 *  3. The inventory-columns view-pref key is persisted but NOT audited
 *     (so column toggles don't flood the audit chain).
 *
 * Run: node scripts/verify-settings-audit.js
 */
require("dotenv").config();
const { sequelize, Setting, AuditLog } = require("../src/models");

const COMPANY = "CMP-DEMO";
const EXCLUDED = new Set(["inventory-columns"]); // mirrors the route constant
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

// Re-usable helper mirroring the route's audit decision + upsert.
async function upsertByKey(key, value, t) {
  const [row, created] = await Setting.findOrCreate({
    where: { companyId: COMPANY, key },
    defaults: { companyId: COMPANY, key, value },
    transaction: t
  });
  if (!created) await row.update({ value }, { transaction: t });
  if (!EXCLUDED.has(key)) {
    const auditService = require("../src/services/audit.service");
    await auditService.record(COMPANY, {
      action: "settings.update", description: `Setting "${key}" updated`,
      user: "Probe", sourceDocument: key, severity: "info",
      before: created ? null : JSON.stringify(row.value), after: JSON.stringify(value)
    }, { transaction: t });
  }
  return row;
}

(async () => {
  await sequelize.authenticate();
  console.log("DB connected (" + process.env.DB_NAME + "@" + process.env.DB_PORT + ")\n");

  console.log("settings persistence + audit [rolled back]:");
  const t = await sequelize.transaction();
  try {
    // 1) Operational key persists AND is audited.
    const opKey = "barcodePrintProbe";
    const auditsBefore = await AuditLog.count({ where: { companyId: COMPANY, sourceDocument: opKey }, transaction: t });
    await upsertByKey(opKey, { showPrice: false, copies: 3 }, t);
    const stored = await Setting.findOne({ where: { companyId: COMPANY, key: opKey }, transaction: t });
    check(stored && stored.value.copies === 3, "operational setting persisted to DB (source of truth)");
    const auditsAfter = await AuditLog.count({ where: { companyId: COMPANY, sourceDocument: opKey }, transaction: t });
    check(auditsAfter === auditsBefore + 1, "operational by-key change wrote exactly one audit row");

    // 2) inventory-columns persists but is NOT audited.
    const viewKey = "inventory-columns";
    const vBefore = await AuditLog.count({ where: { companyId: COMPANY, sourceDocument: viewKey }, transaction: t });
    await upsertByKey(viewKey, { productColumns: { karat: false }, assetColumns: {} }, t);
    const vStored = await Setting.findOne({ where: { companyId: COMPANY, key: viewKey }, transaction: t });
    check(vStored && vStored.value.productColumns.karat === false, "inventory column prefs persisted to DB");
    const vAfter = await AuditLog.count({ where: { companyId: COMPANY, sourceDocument: viewKey }, transaction: t });
    check(vAfter === vBefore, "inventory-columns change wrote NO audit row (excluded view pref)");
  } finally { await t.rollback(); }

  console.log(`\nRESULT: all ${passed} checks passed. (nothing committed)`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
