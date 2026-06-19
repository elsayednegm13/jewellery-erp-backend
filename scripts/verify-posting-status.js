/**
 * P4.1 verification — invoice posting_status foundation.
 *
 *  Part A (DB, rolled back): column/default/values + existing rows + payment
 *         status independence.
 *  Part B (controller guard, no DB writes): generic CRUD cannot create a
 *         draft invoice or change an invoice's postingStatus (both 403; the
 *         guard fires BEFORE any DB write, so nothing is persisted).
 *
 * Run: node scripts/verify-posting-status.js
 */
require("dotenv").config();
const { sequelize, Invoice } = require("../src/models");
const ErpController = require("../src/controllers/erp.controller");

let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

function mockRes() {
  const r = { statusCode: null, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

(async () => {
  await sequelize.authenticate();
  console.log("DB connected (" + process.env.DB_NAME + "@" + process.env.DB_PORT + ")\n");

  // ---------- Part A: column / model / data ----------
  console.log("Part A — column, default, values, existing rows [rolled back]:");
  const desc = await sequelize.getQueryInterface().describeTable("invoices");
  check(!!desc.posting_status, "posting_status column exists");
  check(desc.posting_status.defaultValue === "posted", "column default = posted");
  check(JSON.stringify(desc.posting_status.special) === JSON.stringify(["draft", "posted", "cancelled"]),
    "enum values = draft/posted/cancelled");
  check(desc.posting_status.allowNull === false, "column is NOT NULL");

  const notPosted = await Invoice.count({ where: { postingStatus: { [require("sequelize").Op.ne]: "posted" } } });
  check(notPosted === 0, "ALL existing invoices are treated as posted");

  const t = await sequelize.transaction();
  try {
    const base = { companyId: "CMP-DEMO", customerId: "CUS-0041", customerName: "Probe", date: "2026-06-19", total: 100, tax: 0, paymentMethod: "Cash", branch: "Main" };
    // No postingStatus provided → default posted.
    const def = await Invoice.create({ id: "INV-PROBE-DEF-" + Date.now(), ...base }, { transaction: t });
    check(def.postingStatus === "posted", "invoice created WITHOUT postingStatus defaults to posted");
    // status stays an independent payment status.
    check(def.status === "due", "payment `status` still works independently (default due)");
    // Model accepts all three lifecycle values.
    for (const ps of ["draft", "posted", "cancelled"]) {
      const row = await Invoice.create({ id: `INV-PROBE-${ps}-${Date.now()}`, ...base, status: "paid", postingStatus: ps }, { transaction: t });
      check(row.postingStatus === ps && row.status === "paid", `model accepts postingStatus="${ps}" with payment status independent`);
    }
  } finally { await t.rollback(); }

  // ---------- Part B: generic CRUD guard (no DB writes happen on 403) ----------
  console.log("\nPart B — generic CRUD cannot touch postingStatus:");
  const ctrl = new ErpController(Invoice, ["customerName"]);

  // create a draft via generic POST → 403, and model.create never reached.
  const res1 = mockRes();
  await ctrl.create({ body: { postingStatus: "draft", customerId: "X" }, companyId: "CMP-DEMO", user: null, headers: {} }, res1, () => {});
  check(res1.statusCode === 403, "generic POST /invoices with postingStatus=draft is rejected (403)");
  check(/lifecycle endpoints/.test(res1.body?.message || ""), "rejection message points to lifecycle endpoints");

  // create a posted invoice via generic POST is allowed past the guard
  // (we don't persist it — stop by checking the guard didn't 403).
  const res2 = mockRes();
  let createReached = false;
  const ctrl2 = new ErpController(
    // customerId points at a non-existent customer so the post-create
    // net-purchases recalc affects zero rows (keeps this test side-effect-free).
    { name: "Invoice", rawAttributes: Invoice.rawAttributes, create: async () => { createReached = true; return { id: "X", toJSON: () => ({ id: "X" }), customerId: "CUS-PROBE-NONEXISTENT" }; } },
    ["customerName"]
  );
  // Avoid the post-create customer recalculation hitting the DB by passing a posted status only.
  try {
    await ctrl2.create({ body: { postingStatus: "posted" }, companyId: "CMP-DEMO", user: null, headers: {} }, res2, () => {});
  } catch { /* downstream (recalc/emit) may noop-fail; we only assert the guard let it through */ }
  check(createReached === true, "generic POST with postingStatus=posted passes the guard (allowed)");

  // change postingStatus on an existing invoice via generic PATCH → 403.
  const existing = await Invoice.findOne({ where: { companyId: "CMP-DEMO" } });
  const res3 = mockRes();
  await ctrl.update({ params: { id: existing.id }, body: { postingStatus: "cancelled" }, companyId: "CMP-DEMO", user: null, headers: {} }, res3, () => {});
  check(res3.statusCode === 403, "generic PATCH /invoices/:id changing postingStatus is rejected (403)");
  // confirm it was NOT changed in the DB.
  const after = await Invoice.findOne({ where: { id: existing.id } });
  check(after.postingStatus === existing.postingStatus, "the invoice's postingStatus was NOT changed by the blocked PATCH");

  console.log(`\nRESULT: all ${passed} checks passed. (no data committed)`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
