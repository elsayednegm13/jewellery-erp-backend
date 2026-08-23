/**
 * Customer.balance containment — Phase 10R verify.
 *
 * Proves the generic customers CRUD ignores `balance` from the request body
 * (create starts at 0, update never overwrites it), WITHOUT freezing the column:
 * business-layer writes (POS/payment/exchange/gold-pool, simulated here via a
 * direct model update) still work. The customer statement endpoint is untouched.
 * Fixtures live under a throwaway company; cleanup deletes the company LAST so FK
 * cascade removes everything — no residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-customer-balance-containment.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Customer } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-CBAL-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let token;
async function req(method, pathname, body) {
  const r = await fetch(`${base}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const balOf = async (id) => Number((await Customer.findByPk(id)).balance);

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  let custId = null;
  try {
    await Company.create({ id: CO, businessName: "Verify CBal Co", workspace: `verify-cbal-${stamp}` });

    console.log("1) customer CRUD ignores `balance` from the body:");
    const created = await req("POST", "/customers", { name: "عميل تجميد", phone: "+100", tier: "Standard", balance: 9999 });
    check(created.status === 201, "create customer → 201");
    custId = created.json.data?.id || created.json.id;
    check(Boolean(custId), "created customer id returned");
    check((await balOf(custId)) === 0, "create ignored body.balance (9999) → stored balance = 0");

    const updated = await req("PUT", `/customers/${custId}`, { balance: 8888, phone: "+200" });
    check(updated.status === 200, "update customer → 200");
    check((await balOf(custId)) === 0, "update ignored body.balance (8888) → balance still 0");
    check((await Customer.findByPk(custId)).phone === "+200", "update still applies non-balance fields (phone)");

    console.log("\n2) business writers are NOT frozen (column still writable):");
    // Simulates what POS/payment/exchange/gold-pool flows do (direct model write).
    await Customer.update({ balance: 500 }, { where: { id: custId } });
    check((await balOf(custId)) === 500, "business-layer balance write still works (set to 500)");

    console.log("\n3) customer statement V2 untouched and shows balance as reference:");
    const st = (await req("GET", `/customers/${custId}/statement-v2`)).json.data;
    check(Boolean(st), "statement-v2 still returns data");
    check(st.customerBalanceReference === 500, "statement echoes business balance as customerBalanceReference (500)");
    check(st.meta && st.meta.ledgerBased === false && st.meta.readOnly === true, "statement meta intact (read-only, not ledger-based)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("customers", () => Customer.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascade remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + customer removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
