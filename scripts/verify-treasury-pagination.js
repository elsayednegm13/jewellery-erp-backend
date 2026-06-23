/**
 * Treasury transactions pagination (Phase 6B) — READ-ONLY verify (GET only).
 *
 * Confirms GET /treasury/transactions now paginates server-side (offset+total),
 * that filters compose with pagination, that the default call stays backward
 * compatible in shape, and that /treasury/summary is unchanged. No writes.
 *
 * Run from repo root: node backend/scripts/verify-treasury-pagination.js
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
    console.log("pagination metadata + page-size:");
    const p1 = await get("/treasury/transactions?page=1&pageSize=5");
    check(p1.status === 200 && p1.json.success, "GET ?page=1&pageSize=5 → 200 success");
    check(typeof p1.json.total === "number", "total present");
    check(p1.json.page === 1 && p1.json.pageSize === 5, "echoes page=1, pageSize=5");
    check(Array.isArray(p1.json.items) && p1.json.items.length <= 5, "page honours pageSize (≤5)");
    check(p1.json.totalPages === Math.max(1, Math.ceil(p1.json.total / 5)), "totalPages = ceil(total/pageSize)");
    check(Array.isArray(p1.json.data.items), "data.items present (backward-compatible shape)");

    if (p1.json.total > 5) {
      const p2 = await get("/treasury/transactions?page=2&pageSize=5");
      check(p2.json.page === 2, "page 2 echoes page=2");
      const overlap = [...ids(p2.json)].filter((id) => ids(p1.json).has(id)).length;
      check(overlap === 0, "page 1 and page 2 do not overlap");
    } else {
      console.log("  (≤5 transactions — skipping multi-page overlap check)");
    }

    console.log("\nbackward compatibility (no params):");
    const def = await get("/treasury/transactions");
    check(def.status === 200 && Array.isArray(def.json.items) && Array.isArray(def.json.data.items), "default call returns items + data.items");
    check(def.json.page === 1 && def.json.pageSize === 20, "default page=1, pageSize=20");

    console.log("\nfilters compose with pagination:");
    const all = await get("/treasury/transactions?page=1&pageSize=100");
    const typeVal = (all.json.items.find((i) => i.type) || {}).type;
    if (typeVal) {
      const tf = await get(`/treasury/transactions?page=1&pageSize=100&type=${encodeURIComponent(typeVal)}`);
      check(tf.status === 200 && tf.json.items.every((i) => i.type === typeVal) && tf.json.total <= all.json.total, "type filter composes with pagination");
    } else { console.log("  (no type value — skipping type filter)"); }
    const accVal = (all.json.items.find((i) => i.account) || {}).account;
    if (accVal) {
      const af = await get(`/treasury/transactions?page=1&pageSize=100&account=${encodeURIComponent(accVal)}`);
      check(af.json.items.every((i) => i.account === accVal) && af.json.total <= all.json.total, "account filter composes with pagination");
    } else { console.log("  (no account value — skipping account filter)"); }
    const brVal = (all.json.items.find((i) => i.branch) || {}).branch;
    if (brVal) {
      const bf = await get(`/treasury/transactions?page=1&pageSize=100&branch=${encodeURIComponent(brVal)}`);
      check(bf.json.items.every((i) => i.branch === brVal) && bf.json.total <= all.json.total, "branch filter composes with pagination");
    } else { console.log("  (no branch value — skipping branch filter)"); }

    console.log("\nsummary endpoint unchanged:");
    const s = await get("/treasury/summary");
    check(s.status === 200 && s.json.data && typeof s.json.data.cash === "number" && typeof s.json.data.bank === "number" && typeof s.json.data.total === "number", "/treasury/summary still returns {data:{cash,bank,total,...}}");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only GET, no writes)`);
  } finally {
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
