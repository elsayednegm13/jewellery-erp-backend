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

  // Every lifecycle field is rejected by generic POST and PATCH (incl. snake_case
  // and incl. postingStatus:"posted" — the default fills posted, callers must not).
  const fieldSamples = {
    postingStatus: "draft",
    posting_status: "posted",
    postedAt: "2026-06-19 10:00",
    posted_at: "2026-06-19 10:00",
    cancelledAt: "2026-06-19 10:00",
    cancelled_at: "2026-06-19 10:00",
    cancelReason: "test",
    cancel_reason: "test",
  };

  // POST: each lifecycle field → 403 (guard fires before any DB write).
  for (const [field, val] of Object.entries(fieldSamples)) {
    const res = mockRes();
    await ctrl.create({ body: { [field]: val, customerId: "X" }, companyId: "CMP-DEMO", user: null, headers: {} }, res, () => {});
    check(res.statusCode === 403, `generic POST /invoices with ${field} → 403`);
  }
  // message check (once).
  const resMsg = mockRes();
  await ctrl.create({ body: { postedAt: "x" }, companyId: "CMP-DEMO", user: null, headers: {} }, resMsg, () => {});
  check(/Invoice lifecycle fields can only be changed through invoice lifecycle endpoints/.test(resMsg.body?.message || ""),
    "rejection message is the lifecycle-fields message");

  // PATCH: each lifecycle field → 403, and confirm nothing changed in DB.
  const existing = await Invoice.findOne({ where: { companyId: "CMP-DEMO" } });
  const before = { postingStatus: existing.postingStatus, postedAt: existing.postedAt, cancelledAt: existing.cancelledAt, cancelReason: existing.cancelReason };
  for (const [field, val] of Object.entries(fieldSamples)) {
    const res = mockRes();
    await ctrl.update({ params: { id: existing.id }, body: { [field]: val }, companyId: "CMP-DEMO", user: null, headers: {} }, res, () => {});
    check(res.statusCode === 403, `generic PATCH /invoices/:id with ${field} → 403`);
  }
  const after = await Invoice.findOne({ where: { id: existing.id } });
  check(
    after.postingStatus === before.postingStatus &&
    String(after.postedAt) === String(before.postedAt) &&
    String(after.cancelledAt) === String(before.cancelledAt) &&
    String(after.cancelReason) === String(before.cancelReason),
    "lifecycle fields were NOT changed in DB by the blocked PATCHes"
  );

  // A non-lifecycle generic PATCH still works (notes) — does not get blocked.
  const resOk = mockRes();
  let blocked = false;
  await ctrl.update({ params: { id: existing.id }, body: { notes: existing.notes }, companyId: "CMP-DEMO", user: null, headers: {} }, resOk, () => {});
  if (resOk.statusCode === 403) blocked = true;
  check(!blocked, "generic PATCH WITHOUT lifecycle fields is still allowed (not over-blocked)");

  // Custom routes are unaffected: a direct Invoice.create CAN set lifecycle
  // fields (this is the path /pos/checkout, returns, exchanges, etc. use).
  const t2 = await sequelize.transaction();
  try {
    const row = await Invoice.create(
      { id: "INV-PROBE-CUSTOM-" + Date.now(), companyId: "CMP-DEMO", customerId: "CUS-0041", customerName: "Probe", date: "2026-06-19", total: 1, paymentMethod: "Cash", branch: "Main", postingStatus: "posted", postedAt: "2026-06-19 10:00" },
      { transaction: t2 }
    );
    check(row.postingStatus === "posted", "custom routes (direct Invoice.create) can set lifecycle fields — unaffected by the guard");
  } finally { await t2.rollback(); }

  console.log(`\nRESULT: all ${passed} checks passed. (no data committed)`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
