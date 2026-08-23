/**
 * TD-003 verification — invoice type enum aligned with checkout flows.
 *
 * Confirms the enum accepts every type the routes write (sale/return/exchange/
 * deposit/repair/installment) and that creating an installment invoice works
 * (the bug was: enum lacked "installment" so /pos/checkout would roll back).
 * All DB writes happen inside a transaction that is ROLLED BACK.
 *
 * Run: node scripts/verify-invoice-type.js
 */
require("dotenv").config();
const { sequelize, Invoice } = require("../src/models");

const USED_TYPES = ["sale", "return", "exchange", "deposit", "repair", "installment"];
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

(async () => {
  await sequelize.authenticate();
  console.log("DB connected (" + process.env.DB_NAME + "@" + process.env.DB_PORT + ")\n");

  // DB enum contains every type the routes use.
  const [labels] = await sequelize.query(
    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='enum_invoices_type' ORDER BY e.enumsortorder"
  );
  const set = new Set(labels.map((l) => l.enumlabel));
  console.log("enum_invoices_type:", [...set].join(", "));
  for (const ty of USED_TYPES) check(set.has(ty), `enum accepts "${ty}"`);

  // Create an invoice of each used type (rolled back) — installment is the fix.
  console.log("\ncreate invoice per type [rolled back]:");
  const t = await sequelize.transaction();
  try {
    const base = { companyId: "CMP-DEMO", customerId: "CUS-0041", customerName: "Probe", date: "2026-06-19", total: 100, tax: 0, paymentMethod: "Cash", branch: "Main" };
    for (const ty of USED_TYPES) {
      const row = await Invoice.create({ id: `INV-PROBE-${ty}-${Date.now()}`, ...base, type: ty }, { transaction: t });
      check(row.type === ty, `invoice created with type="${ty}"`);
    }
  } finally { await t.rollback(); }

  console.log(`\nRESULT: all ${passed} checks passed. (nothing committed)`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
