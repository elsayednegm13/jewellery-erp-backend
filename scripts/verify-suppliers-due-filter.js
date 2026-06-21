/**
 * Suppliers due-filter hotfix — E2E verify with FULL CLEANUP (no pollution).
 *
 * Reproduces the bug fix: the "due" / "clear" dropdown values must partition
 * suppliers by the numeric `due` column, with a non-positive balance (incl.
 * negatives) counting as "no dues". Covers API mode (HTTP) and mirrors the
 * local/mock predicate.
 *
 * Creates 3 temporary suppliers, asserts, then destroys them in `finally`.
 * Run from repo root: node backend/scripts/verify-suppliers-due-filter.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const { sequelize, Supplier } = require("../src/models");

const COMPANY = "CMP-DEMO";
const MARK = `ZZDUEHOTFIX-${Date.now()}`;
const POS = `SUP-TEST-POS-${Date.now()}`;
const ZERO = `SUP-TEST-ZERO-${Date.now()}`;
const NEG = `SUP-TEST-NEG-${Date.now()}`;

let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

let base, token;
async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": COMPANY } });
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, json: j };
}
const idsOf = (j) => new Set((j.items || []).map((i) => i.id));
const dueFilter = (v) => `/suppliers?page=1&pageSize=250&filters=${encodeURIComponent(JSON.stringify({ due: v }))}`;

// Mirror of the fixed local/mock predicate in lib/repositories/local-impl.ts
function localDuePredicate(value, rawDue) {
  const due = Number(rawDue) || 0;
  return value === "due" ? due > 0 : due <= 0;
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    const baseRow = { companyId: COMPANY, category: "TestCat", phone: "000" };
    await Supplier.create({ ...baseRow, id: POS, name: `${MARK} pos`, due: 150 });
    await Supplier.create({ ...baseRow, id: ZERO, name: `${MARK} zero`, due: 0 });
    await Supplier.create({ ...baseRow, id: NEG, name: `${MARK} neg`, due: -50 });

    console.log("API mode — due partition:");
    const dues = await get(dueFilter("due"));
    const clear = await get(dueFilter("clear"));
    const all = await get("/suppliers?page=1&pageSize=250");
    check(dues.status === 200 && clear.status === 200, "due & clear queries → 200");

    const dueIds = idsOf(dues.json), clearIds = idsOf(clear.json);
    check(dueIds.has(POS), "due>0 supplier appears in 'مستحقات' (due)");
    check(!dueIds.has(ZERO) && !dueIds.has(NEG), "due=0 and due<0 do NOT appear in 'مستحقات'");
    check(clearIds.has(ZERO), "due=0 supplier appears in 'بدون مستحقات' (clear)");
    check(clearIds.has(NEG), "due<0 supplier appears in 'بدون مستحقات' (clear)");
    check(!clearIds.has(POS), "due>0 supplier does NOT appear in 'بدون مستحقات'");

    check((dues.json.items || []).every((s) => Number(s.due) > 0), "every 'due' result has due > 0");
    check((clear.json.items || []).every((s) => Number(s.due) <= 0), "every 'clear' result has due <= 0");
    check(dues.json.total + clear.json.total === all.json.total, "due.total + clear.total === all.total (clean partition)");

    const allIds = idsOf(all.json);
    check(allIds.has(POS) && allIds.has(ZERO) && allIds.has(NEG), "'الكل' (no due filter) shows all three");

    console.log("\nsearch + due filter together:");
    const searchDue = await get(`/suppliers?page=1&pageSize=250&search=${MARK}&filters=${encodeURIComponent(JSON.stringify({ due: "due" }))}`);
    const sIds = idsOf(searchDue.json);
    check(sIds.has(POS) && !sIds.has(ZERO) && !sIds.has(NEG), "search + due filter returns only the matching due>0 row");

    console.log("\nother supplier filters still work (status):");
    const statusActive = await get(`/suppliers?page=1&pageSize=250&filters=${encodeURIComponent(JSON.stringify({ status: "active" }))}`);
    check(statusActive.status === 200 && statusActive.json.total <= all.json.total, "status filter still narrows the result");

    console.log("\nlocal/mock predicate mirror:");
    check(localDuePredicate("due", 150) === true, "local: due=150 → in 'due'");
    check(localDuePredicate("clear", 0) === true, "local: due=0 → in 'clear'");
    check(localDuePredicate("clear", -50) === true, "local: due=-50 → in 'clear'");
    check(localDuePredicate("due", -50) === false && localDuePredicate("due", 0) === false, "local: due<=0 → NOT in 'due'");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    await Supplier.destroy({ where: { id: [POS, ZERO, NEG] }, force: true });
    const leftover = await Supplier.count({ where: { id: [POS, ZERO, NEG] } });
    console.log(`cleanup: temp suppliers removed, leftover count = ${leftover}`);
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch(async (e) => {
  console.error("VERIFY FAILED:", e.message);
  try { await Supplier.destroy({ where: { id: [POS, ZERO, NEG] }, force: true }); } catch {}
  process.exit(1);
});
