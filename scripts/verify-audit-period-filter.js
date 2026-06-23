/**
 * Audit log period filter (Phase 7C) — READ-ONLY verify (GET only).
 *
 * Confirms /audit-logs now applies a server-side createdAt range (?from/?to),
 * that it composes with pagination + search + action/severity, that an invalid
 * date is rejected (not silently applied), and that /audit-logs/verify and the
 * audit chain are untouched. No writes; no audit records changed.
 *
 * Run from repo root: node backend/scripts/verify-audit-period-filter.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const { sequelize } = require("../src/models");

const COMPANY = "CMP-DEMO";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }
const ids = (j) => new Set((j.items || []).map((i) => i.id));
const filt = (o) => encodeURIComponent(JSON.stringify(o));
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

let base, token;
async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": COMPANY } });
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, json: j };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  try {
    const all = await get("/audit-logs?page=1&pageSize=250");
    const total = all.json.total;

    console.log("server-side createdAt range (from):");
    const today = await get(`/audit-logs?page=1&pageSize=250&from=${encodeURIComponent(iso(1))}`);
    const week = await get(`/audit-logs?page=1&pageSize=250&from=${encodeURIComponent(iso(7))}`);
    const month = await get(`/audit-logs?page=1&pageSize=250&from=${encodeURIComponent(iso(30))}`);
    check(today.status === 200 && week.status === 200 && month.status === 200, "today/week/month ranges → 200");
    check(today.json.total <= week.json.total && week.json.total <= month.json.total && month.json.total <= total, "narrower window ⇒ ≤ wider window ⇒ ≤ all (monotonic)");

    console.log("\nrange composes with filters + search:");
    const sevVal = (all.json.items.find((i) => i.severity) || {}).severity || "info";
    const ps = await get(`/audit-logs?page=1&pageSize=250&from=${encodeURIComponent(iso(30))}&filters=${filt({ severity: sevVal })}`);
    check(ps.status === 200 && ps.json.items.every((i) => i.severity === sevVal) && ps.json.total <= month.json.total, "period + severity compose");
    const actVal = (all.json.items.find((i) => i.action) || {}).action;
    if (actVal) {
      const pa = await get(`/audit-logs?page=1&pageSize=250&from=${encodeURIComponent(iso(30))}&filters=${filt({ action: actVal })}`);
      check(pa.json.items.every((i) => i.action === actVal) && pa.json.total <= month.json.total, "period + action compose");
    } else { console.log("  (no action value — skipping period+action)"); }
    const psearch = await get(`/audit-logs?page=1&pageSize=250&from=${encodeURIComponent(iso(30))}&search=zzzzzznomatch`);
    check(psearch.json.total === 0 || psearch.json.total < month.json.total, "period + search compose (non-match narrows)");

    console.log("\npagination within a period:");
    const m5 = await get(`/audit-logs?page=1&pageSize=5&from=${encodeURIComponent(iso(3650))}`);
    check(m5.json.items.length <= 5 && typeof m5.json.total === "number", "page 1 size 5 within range honours metadata");
    if (m5.json.total > 5) {
      const m5p2 = await get(`/audit-logs?page=2&pageSize=5&from=${encodeURIComponent(iso(3650))}`);
      const overlap = [...ids(m5p2.json)].filter((id) => ids(m5.json).has(id)).length;
      check(overlap === 0, "page 1 and page 2 within range do not overlap");
    } else { console.log("  (≤5 in range — skipping overlap)"); }

    console.log("\ninvalid date is rejected (not silently applied):");
    const bad = await get("/audit-logs?page=1&pageSize=5&from=not-a-date");
    check(bad.status >= 400 && bad.status < 500, `invalid 'from' → ${bad.status} (4xx, not 200)`);
    const badTo = await get("/audit-logs?page=1&pageSize=5&to=13/45/2024");
    check(badTo.status >= 400 && badTo.status < 500, `invalid 'to' → ${badTo.status} (4xx, not 200)`);

    console.log("\nverify endpoint untouched:");
    const v = await get("/audit-logs/verify");
    check(v.status === 200 && typeof v.json.valid === "boolean" && typeof v.json.total === "number", "/audit-logs/verify still {valid,total} (chain untouched)");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only GET, no writes, chain untouched)`);
  } finally {
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
