/**
 * Suppliers pagination Phase 3 — READ-ONLY contract test (GET only).
 *
 * Confirms /suppliers honours page/pageSize and returns the metadata the
 * suppliers hook/repository relies on, that pages don't overlap, and that
 * search/filters narrow the result. No writes (no backend change was made).
 *
 * Run from repo root: node backend/scripts/verify-suppliers-pagination.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const { sequelize } = require("../src/models");

const COMPANY = "CMP-DEMO";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

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
    const p1 = await get("/suppliers?page=1&pageSize=5&sortBy=createdAt&sortDirection=desc");
    check(p1.status === 200, "GET /suppliers?page=1&pageSize=5 → 200");
    check(typeof p1.json.total === "number" && typeof p1.json.totalPages === "number" && p1.json.page === 1 && p1.json.pageSize === 5, "returns metadata {page,pageSize,total,totalPages}");
    check(Array.isArray(p1.json.items) && p1.json.items.length <= 5, "page honours pageSize (≤ 5 items)");

    if (p1.json.total > 5) {
      const p2 = await get("/suppliers?page=2&pageSize=5&sortBy=createdAt&sortDirection=desc");
      check(p2.json.page === 2, "page 2 returns page=2");
      const ids1 = new Set(p1.json.items.map((i) => i.id));
      const overlap = p2.json.items.filter((i) => ids1.has(i.id)).length;
      check(overlap === 0, "page 1 and page 2 do not overlap");
      check(p1.json.totalPages === Math.ceil(p1.json.total / 5), "totalPages = ceil(total / pageSize)");
    } else {
      console.log("  (≤5 suppliers — skipping multi-page overlap check)");
    }

    console.log("\nsearch + filters narrow the result:");
    const all = await get("/suppliers?page=1&pageSize=250");
    const totalAll = all.json.total;
    const statusFilter = await get(`/suppliers?page=1&pageSize=250&filters=${encodeURIComponent(JSON.stringify({ status: "active" }))}`);
    check(statusFilter.status === 200 && statusFilter.json.total <= totalAll, "status filter narrows (or equals) the total");
    const search = await get("/suppliers?page=1&pageSize=250&search=zzzzzznomatch");
    check(search.json.total === 0 || search.json.total < totalAll, "a non-matching search returns fewer/zero results");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only GET, no writes)`);
  } finally {
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
