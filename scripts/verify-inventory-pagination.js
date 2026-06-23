/**
 * Inventory pagination Phase 4B — READ-ONLY contract test (GET only).
 *
 * Verifies the endpoints the inventory page now relies on:
 *   - /products  honours page/pageSize/search and stockType/branchName filters
 *   - /assets    default behaviour unchanged (may include child assets)
 *   - /assets?standaloneOnly=true  returns ONLY parentAssetId-null rows, with a
 *     correct total/totalPages (no client-side removal needed)
 *   - type/status/branch filters compose with standaloneOnly
 *
 * The only backend change in Phase 4B is the Asset-scoped standaloneOnly param;
 * this script proves the default path is untouched. No writes.
 *
 * Run from repo root: node backend/scripts/verify-inventory-pagination.js
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
const ids = (j) => new Set((j.items || []).map((i) => i.id));
const filt = (obj) => encodeURIComponent(JSON.stringify(obj));

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  try {
    console.log("PRODUCTS pagination:");
    const p1 = await get("/products?page=1&pageSize=10");
    check(p1.status === 200, "GET /products?page=1&pageSize=10 → 200");
    check(typeof p1.json.total === "number" && p1.json.page === 1 && p1.json.pageSize === 10, "metadata {page,pageSize,total,totalPages}");
    check(Array.isArray(p1.json.items) && p1.json.items.length <= 10, "page honours pageSize (≤10)");
    if (p1.json.total > 10) {
      const p2 = await get("/products?page=2&pageSize=10");
      const overlap = [...ids(p2.json)].filter((id) => ids(p1.json).has(id)).length;
      check(overlap === 0, "products page 1 vs 2 do not overlap");
      check(p1.json.totalPages === Math.ceil(p1.json.total / 10), "products totalPages = ceil(total/pageSize)");
    } else { console.log("  (≤10 products — skipping multi-page check)"); }
    const allP = await get("/products?page=1&pageSize=250");
    const branchVal = (allP.json.items.find((i) => i.branchName) || {}).branchName;
    if (branchVal) {
      const bf = await get(`/products?page=1&pageSize=250&filters=${filt({ branchName: branchVal })}`);
      check(bf.status === 200 && bf.json.total <= allP.json.total && bf.json.items.every((i) => i.branchName === branchVal), "branchName filter narrows server-side");
    }
    const stockVal = (allP.json.items.find((i) => i.stockType) || {}).stockType;
    if (stockVal) {
      const sf = await get(`/products?page=1&pageSize=250&filters=${filt({ stockType: stockVal })}`);
      check(sf.json.items.every((i) => i.stockType === stockVal) && sf.json.total <= allP.json.total, "stockType filter narrows server-side");
    }
    const pSearch = await get("/products?page=1&pageSize=250&search=zzzzzznomatch");
    check(pSearch.json.total === 0 || pSearch.json.total < allP.json.total, "products non-matching search returns fewer/zero");

    console.log("\nASSETS standaloneOnly:");
    const aDefault = await get("/assets?page=1&pageSize=250");
    const aStandalone = await get("/assets?page=1&pageSize=250&standaloneOnly=true");
    check(aDefault.status === 200 && aStandalone.status === 200, "both asset queries → 200");
    check(aStandalone.json.items.every((a) => !a.parentAssetId), "standaloneOnly: every row has no parentAssetId");
    check(aStandalone.json.total <= aDefault.json.total, "standalone total ≤ default total");
    check(aDefault.json.items.some((a) => a.parentAssetId) ? aStandalone.json.total < aDefault.json.total : true, "default path unchanged (still includes children when present)");

    console.log("\nASSETS standaloneOnly pagination + filters:");
    const a1 = await get("/assets?page=1&pageSize=10&standaloneOnly=true");
    check(a1.json.items.length <= 10 && a1.json.total === aStandalone.json.total, "pageSize honoured; total counts standalone only");
    check(a1.json.totalPages === Math.ceil(a1.json.total / 10), "assets totalPages = ceil(standaloneTotal/pageSize)");
    if (a1.json.total > 10) {
      const a2 = await get("/assets?page=2&pageSize=10&standaloneOnly=true");
      const overlap = [...ids(a2.json)].filter((id) => ids(a1.json).has(id)).length;
      check(overlap === 0, "assets page 1 vs 2 do not overlap");
    }
    const typeVal = (aStandalone.json.items.find((a) => a.type) || {}).type;
    if (typeVal) {
      const tf = await get(`/assets?page=1&pageSize=250&standaloneOnly=true&filters=${filt({ type: typeVal })}`);
      check(tf.json.items.every((a) => a.type === typeVal && !a.parentAssetId) && tf.json.total <= aStandalone.json.total, "type filter composes with standaloneOnly");
    }
    const statusActive = await get(`/assets?page=1&pageSize=250&standaloneOnly=true&filters=${filt({ status: "available" })}`);
    check(statusActive.json.items.every((a) => a.status === "available" && !a.parentAssetId), "status filter composes with standaloneOnly");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only GET, no writes)`);
  } finally {
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
