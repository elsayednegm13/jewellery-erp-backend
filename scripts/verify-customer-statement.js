/**
 * Customer sub-ledger statement — Phase 10B verify (READ-ONLY endpoint).
 *
 * GET /customers/:id/statement-v2 is read-only. Fixtures live under a throwaway
 * company (created via models, no posting service — no real balances move, no
 * audit/journal rows), and the endpoint is queried with that X-Company-ID. All
 * fixtures are removed in `finally`, leaving no residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-customer-statement.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Customer, Invoice, Payment } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-CST-${stamp}`;
const CUST = `CUS-V-${stamp}`;
const CUST2 = `CUS-V2-${stamp}`;

const INV1 = `INV-V1-${stamp}`;
const INV2 = `INV-V2-${stamp}`;
const INV_DRAFT = `INV-VD-${stamp}`;
const INV_RET = `INV-VR-${stamp}`;
const INV_C2 = `INV-VC2-${stamp}`;
const PAY1 = `PAY-V1-${stamp}`;
const PAY2 = `PAY-V2-${stamp}`;
const PAY_OTHER = `PAY-VO-${stamp}`;
const ALL_INV = [INV1, INV2, INV_DRAFT, INV_RET, INV_C2];
const ALL_PAY = [PAY1, PAY2, PAY_OTHER];

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let token;
async function get(pathname, company = CO) {
  const response = await fetch(`${base}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Company-ID": company },
  });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}
const itemOf = (data, sourceId) => (data.items || []).find((r) => r.sourceId === sourceId);

async function makeInvoice(id, customerId, customerName, type, total, date, postingStatus) {
  return Invoice.create({
    id, companyId: CO, customerId, customerName, type, total, tax: 0, subtotal: total,
    date, status: type === "return" ? "returned" : "paid", postingStatus,
    paymentMethod: "Cash", branch: "Main",
  });
}
async function makePayment(id, invoiceId, amount, reference, date) {
  return Payment.create({ id, companyId: CO, invoiceId, amount, reference, date, paymentMethod: "Cash" });
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify Cust Co", workspace: `verify-cust-${stamp}` });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل تحقق", phone: "+100", balance: 950 });
    await Customer.create({ id: CUST2, companyId: CO, name: "عميل آخر", phone: "+200", balance: 0 });

    // CUST documents
    await makeInvoice(INV1, CUST, "عميل تحقق", "sale", 1000, "2026-01-10", "posted");   // debit 1000
    await makeInvoice(INV2, CUST, "عميل تحقق", "sale", 500, "2026-02-10", "posted");    // debit 500
    await makeInvoice(INV_DRAFT, CUST, "عميل تحقق", "sale", 999, "2026-02-12", "draft"); // excluded
    await makeInvoice(INV_RET, CUST, "عميل تحقق", "return", 200, "2026-02-15", "posted"); // credit 200
    await makePayment(PAY1, INV1, 300, "RCPT-1", "2026-01-20"); // credit 300
    await makePayment(PAY2, INV2, 100, "RCPT-2", "2026-02-20"); // credit 100
    // Another customer's invoice + payment — must NOT leak into CUST's statement
    await makeInvoice(INV_C2, CUST2, "عميل آخر", "sale", 700, "2026-01-12", "posted");
    await makePayment(PAY_OTHER, INV_C2, 50, "RCPT-O", "2026-01-25");

    console.log("1) basic + validation:");
    check((await get(`/customers/${CUST}/statement-v2`)).status === 200, "existing customer → 200");
    check((await get(`/customers/CUS-NOPE-${stamp}/statement-v2`)).status === 404, "missing customer → 404");
    check((await get(`/customers/${CUST}/statement-v2`, "CMP-DEMO")).status === 404, "cross-company customer → 404");
    check((await get(`/customers/${CUST}/statement-v2?from=2026-13-40`)).status === 422, "invalid from → 422");
    check((await get(`/customers/${CUST}/statement-v2?from=2026-03-01&to=2026-01-01`)).status === 422, "from > to → 422");
    check((await get(`/customers/${CUST}/statement-v2?pageSize=9999`)).json.data.pageSize === 200, "pageSize capped at 200");

    console.log("\n2) full statement (no date filter):");
    const all = (await get(`/customers/${CUST}/statement-v2`)).json.data;
    check(all.openingBalance === 0, "no `from` → openingBalance 0");
    check(all.total === 5, "5 rows (2 invoices + 1 return + 2 payments; draft & other-customer excluded)");
    check(itemOf(all, INV1) && itemOf(all, INV1).debit === 1000 && itemOf(all, INV1).credit === 0, "posted invoice → debit 1000");
    check(itemOf(all, PAY1) && itemOf(all, PAY1).credit === 300 && itemOf(all, PAY1).debit === 0, "payment → credit 300");
    check(itemOf(all, INV_RET) && itemOf(all, INV_RET).credit === 200, "return invoice → credit 200");
    check(!itemOf(all, INV_DRAFT), "draft invoice NOT included");
    check(!itemOf(all, PAY_OTHER) && !itemOf(all, INV_C2), "other customer's invoice/payment NOT included");
    check(all.closingBalance === 900, "closing = 1000 -300 +500 -200 -100 = 900");
    check(all.customerBalanceReference === 950, "customer.balance shown as reference (950)");
    check(all.difference === 50, "difference = 950 - 900 = 50 (reference only, no write)");
    check(all.meta && all.meta.ledgerBased === false && all.meta.readOnly === true && all.meta.source === "source_documents", "meta marks source_documents / not ledger-based / read-only");

    console.log("\n3) opening + paging continuity (from=2026-02-01, pageSize=2):");
    const p1 = (await get(`/customers/${CUST}/statement-v2?from=2026-02-01&pageSize=2&page=1`)).json.data;
    check(p1.openingBalance === 700, "openingBalance = pre-`from` aggregate (1000 - 300 = 700)");
    check(p1.total === 3 && p1.totalPages === 2, "period total 3, totalPages 2");
    check(p1.closingBalance === 900, "closingBalance = 900 (not page-based)");
    check(p1.items.length === 2 && p1.items[0].sourceId === INV2 && p1.items[0].runningBalance === 1200, "row1 INV2 → running 1200");
    check(p1.items[1].sourceId === INV_RET && p1.items[1].runningBalance === 1000, "row2 return → running 1000");
    const p2 = (await get(`/customers/${CUST}/statement-v2?from=2026-02-01&pageSize=2&page=2`)).json.data;
    check(p2.openingBalance === 700 && p2.closingBalance === 900, "opening/closing identical on page 2 (not page-based)");
    check(p2.items.length === 1 && p2.items[0].sourceId === PAY2 && p2.items[0].runningBalance === 900, "page 2 running continues (1000 - 100 = 900)");

    console.log("\n4) legacy endpoint still works:");
    const legacy = await get(`/customers/${CUST}/statement`);
    check(legacy.status === 200 && legacy.json.data && legacy.json.data.openingBalance !== undefined, "legacy GET /customers/:id/statement still returns 200 with its old shape");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only endpoint; fixtures cleaned up)`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("payments", () => Payment.destroy({ where: { id: ALL_PAY } }));
    await safe("invoices", () => Invoice.destroy({ where: { id: ALL_INV }, force: true }));
    await safe("customers", () => Customer.destroy({ where: { id: [CUST, CUST2] }, force: true }));
    await safe("company", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company/customers/invoices/payments removed; endpoint made no writes");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
