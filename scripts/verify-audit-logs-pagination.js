/**
 * Audit logs pagination (Phase 7B) — READ-ONLY verify (GET only).
 *
 * Phase 7B is frontend-only; this confirms the EXISTING /audit-logs endpoint
 * (ErpController.list) supports everything the re-wired hook now relies on:
 * page/pageSize, total/totalPages, server-side search + action/severity
 * filters, companyId scope, and that /audit-logs/verify is unaffected.
 * No writes; the audit chain is never touched.
 *
 * Run from repo root: node backend/scripts/verify-audit-logs-pagination.js
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

let base, token;
async function get(path, company = COMPANY) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": company } });
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
    console.log("pagination metadata + page-size:");
    const p1 = await get("/audit-logs?page=1&pageSize=5&sortBy=createdAt&sortDirection=desc");
    check(p1.status === 200, "GET /audit-logs?page=1&pageSize=5 → 200");
    check(typeof p1.json.total === "number" && typeof p1.json.totalPages === "number" && p1.json.page === 1 && p1.json.pageSize === 5, "metadata {page,pageSize,total,totalPages}");
    check(Array.isArray(p1.json.items) && p1.json.items.length <= 5, "page honours pageSize (≤5)");
    check(p1.json.totalPages === Math.max(1, Math.ceil(p1.json.total / 5)), "totalPages = ceil(total/pageSize)");

    if (p1.json.total > 5) {
      const p2 = await get("/audit-logs?page=2&pageSize=5&sortBy=createdAt&sortDirection=desc");
      check(p2.json.page === 2, "page 2 echoes page=2");
      const overlap = [...ids(p2.json)].filter((id) => ids(p1.json).has(id)).length;
      check(overlap === 0, "page 1 and page 2 do not overlap");
    } else {
      console.log("  (≤5 audit logs — skipping multi-page overlap check)");
    }

    console.log("\nserver-side search + filters:");
    const all = await get("/audit-logs?page=1&pageSize=250");
    const total = all.json.total;
    const actionVal = (all.json.items.find((i) => i.action) || {}).action;
    if (actionVal) {
      const af = await get(`/audit-logs?page=1&pageSize=250&filters=${filt({ action: actionVal })}`);
      check(af.status === 200 && af.json.items.every((i) => i.action === actionVal) && af.json.total <= total, "action filter is server-side (narrows + all match)");
    } else { console.log("  (no action value — skipping action filter)"); }
    const sev = await get(`/audit-logs?page=1&pageSize=250&filters=${filt({ severity: "critical" })}`);
    check(sev.status === 200 && sev.json.items.every((i) => i.severity === "critical"), "severity filter is server-side");
    const search = await get("/audit-logs?page=1&pageSize=250&search=zzzzzznomatch");
    check(search.json.total === 0 || search.json.total < total, "server-side search narrows (non-match → fewer/zero)");

    console.log("\ncompany scope + integrity endpoint:");
    const other = await get("/audit-logs?page=1&pageSize=5", "CMP-DOES-NOT-EXIST");
    check(other.status === 200 && other.json.total === 0, "different company → 0 (companyId scoped)");
    const verify = await get("/audit-logs/verify");
    check(verify.status === 200 && typeof verify.json.valid === "boolean" && typeof verify.json.total === "number", "/audit-logs/verify still returns {valid,total} (chain untouched)");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only GET, no writes, chain untouched)`);
  } finally {
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
