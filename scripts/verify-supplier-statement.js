/**
 * Supplier sub-ledger statement — Phase 10E verify (READ-ONLY endpoint).
 *
 * GET /suppliers/:id/statement is read-only. Fixtures live under a throwaway
 * company (created via models, no posting service — no real balances move, no
 * audit/journal rows), and the endpoint is queried with that X-Company-ID. All
 * fixtures are removed in `finally`, leaving no residue. Includes a soft-deleted
 * PO to prove the payment->PO->supplier link resolves with paranoid:false.
 *
 * Run from repo root:
 *   node backend/scripts/verify-supplier-statement.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Supplier, PurchaseOrder, CashTransaction } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-SUP-${stamp}`;
const SUP = `SUP-V-${stamp}`;
const SUP2 = `SUP-V2-${stamp}`;

const PO1 = `PO-V1-${stamp}`;
const PO2 = `PO-V2-${stamp}`;
const PO_DRAFT = `PO-VD-${stamp}`;
const PO_PARTIAL = `PO-VP-${stamp}`;
const PO_CONSIGN = `PO-VC-${stamp}`;
const PO_SOFT = `PO-VS-${stamp}`;
const PO_C2 = `PO-VC2-${stamp}`;
const TX1 = `TX-V1-${stamp}`;
const TX2 = `TX-V2-${stamp}`;
const TX_SOFT = `TX-VS-${stamp}`;
const TX_OTHER = `TX-VO-${stamp}`;
const TX_CATX = `TX-VX-${stamp}`;
const ALL_TX = [TX1, TX2, TX_SOFT, TX_OTHER, TX_CATX];

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

async function makePO(id, supplierId, status, total, receivedDate, isConsignment = false) {
  return PurchaseOrder.create({
    id, companyId: CO, supplierId, supplierName: supplierId, status, total,
    date: receivedDate, receivedDate: status === "received" ? receivedDate : null,
    branch: "Main", isConsignment,
  });
}
async function makeTx(id, reference, amount, date, category = "supplier_purchase") {
  return CashTransaction.create({
    id, companyId: CO, type: "cash_out", account: "cash", amount, category,
    reference, description: `pay ${reference}`, date, createdBy: "Fixture", status: "posted",
  });
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify Sup Co", workspace: `verify-sup-${stamp}` });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورّد تحقق", category: "general", phone: "+100", due: 1500 });
    await Supplier.create({ id: SUP2, companyId: CO, name: "مورّد آخر", category: "general", phone: "+200", due: 0 });

    // SUP purchase orders
    await makePO(PO1, SUP, "received", 1000, "2026-01-10");   // credit 1000
    await makePO(PO2, SUP, "received", 600, "2026-02-10");    // credit 600
    await makePO(PO_DRAFT, SUP, "draft", 999, "2026-01-15");  // excluded
    await makePO(PO_PARTIAL, SUP, "partial", 500, "2026-01-16"); // excluded
    await makePO(PO_CONSIGN, SUP, "received", 700, "2026-01-17", true); // excluded (consignment)
    await makePO(PO_SOFT, SUP, "received", 200, "2026-03-01"); // will be soft-deleted
    // SUP2 order (for cross-supplier payment)
    await makePO(PO_C2, SUP2, "received", 400, "2026-01-12");

    // Payments
    await makeTx(TX1, PO1, 300, "2026-01-20");          // debit 300 (SUP)
    await makeTx(TX2, PO2, 100, "2026-02-20");          // debit 100 (SUP)
    await makeTx(TX_SOFT, PO_SOFT, 80, "2026-03-05");   // debit 80 (SUP, via soft-deleted PO)
    await makeTx(TX_OTHER, PO_C2, 50, "2026-01-25");    // SUP2's PO → excluded
    await makeTx(TX_CATX, PO1, 999, "2026-01-26", "other"); // wrong category → excluded

    // Soft-delete PO_SOFT (paranoid) — its payment must still map via paranoid:false.
    await PurchaseOrder.destroy({ where: { id: PO_SOFT } });

    console.log("1) basic + validation:");
    check((await get(`/suppliers/${SUP}/statement`)).status === 200, "existing supplier → 200");
    check((await get(`/suppliers/SUP-NOPE-${stamp}/statement`)).status === 404, "missing supplier → 404");
    check((await get(`/suppliers/${SUP}/statement`, "CMP-DEMO")).status === 404, "cross-company supplier → 404");
    check((await get(`/suppliers/${SUP}/statement?from=2026-13-40`)).status === 422, "invalid from → 422");
    check((await get(`/suppliers/${SUP}/statement?from=2026-03-01&to=2026-01-01`)).status === 422, "from > to → 422");
    check((await get(`/suppliers/${SUP}/statement?pageSize=9999`)).json.data.pageSize === 200, "pageSize capped at 200");

    console.log("\n2) full statement (no date filter):");
    const all = (await get(`/suppliers/${SUP}/statement`)).json.data;
    check(all.openingBalance === 0, "no `from` → openingBalance 0");
    check(all.total === 5, "5 rows (2 received POs + 3 payments); draft/partial/consignment/soft-PO-credit/other-supplier/wrong-category excluded");
    check(itemOf(all, PO1) && itemOf(all, PO1).credit === 1000 && itemOf(all, PO1).debit === 0, "received PO → credit 1000");
    check(itemOf(all, TX1) && itemOf(all, TX1).debit === 300 && itemOf(all, TX1).credit === 0, "supplier_purchase cash-out → debit 300");
    check(!itemOf(all, PO_DRAFT) && !itemOf(all, PO_PARTIAL) && !itemOf(all, PO_CONSIGN), "draft/partial/consignment POs excluded");
    check(!itemOf(all, TX_OTHER), "payment for another supplier's PO excluded");
    check(!itemOf(all, TX_CATX), "cash-out with a different category excluded");
    check(!itemOf(all, PO_SOFT), "soft-deleted PO is NOT a credit row");
    check(itemOf(all, TX_SOFT) && itemOf(all, TX_SOFT).debit === 80, "payment of a soft-deleted PO STILL maps (paranoid:false link) → debit 80");
    check(all.closingBalance === 1120, "closing = 1000 -300 +600 -100 -80 = 1120");
    check(all.supplierDueReference === 1500, "Supplier.due shown as reference (1500)");
    check(all.difference === 380, "difference = 1500 - 1120 = 380 (reference only, no write)");
    check(all.meta && all.meta.ledgerBased === false && all.meta.readOnly === true && all.meta.dueReferenceReliable === false, "meta: source_documents / not ledger-based / read-only / due not reliable");

    console.log("\n3) opening + paging continuity (from=2026-02-01, pageSize=2):");
    const p1 = (await get(`/suppliers/${SUP}/statement?from=2026-02-01&pageSize=2&page=1`)).json.data;
    check(p1.openingBalance === 700, "openingBalance = pre-`from` aggregate (1000 - 300 = 700)");
    check(p1.total === 3 && p1.totalPages === 2, "period total 3, totalPages 2");
    check(p1.closingBalance === 1120, "closingBalance = 1120 (not page-based)");
    check(p1.items.length === 2 && p1.items[0].sourceId === PO2 && p1.items[0].runningBalance === 1300, "row1 PO2 → running 1300");
    check(p1.items[1].sourceId === TX2 && p1.items[1].runningBalance === 1200, "row2 payment → running 1200");
    const p2 = (await get(`/suppliers/${SUP}/statement?from=2026-02-01&pageSize=2&page=2`)).json.data;
    check(p2.openingBalance === 700 && p2.closingBalance === 1120, "opening/closing identical on page 2 (not page-based)");
    check(p2.items.length === 1 && p2.items[0].sourceId === TX_SOFT && p2.items[0].runningBalance === 1120, "page 2 running continues (1200 - 80 = 1120)");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only endpoint; fixtures cleaned up)`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("cash transactions", () => CashTransaction.destroy({ where: { id: ALL_TX } }));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("company", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company/suppliers/POs/cash-transactions removed; endpoint made no writes");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
