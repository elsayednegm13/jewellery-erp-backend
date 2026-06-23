/**
 * Financial report aggregate endpoints (Phase 5E-a) — READ-ONLY verify.
 *
 * Confirms /reports/tax-summary, /reports/financial-summary and
 * /reports/profit-summary are company-scoped, posted-only, and that their
 * totals match an INDEPENDENT direct-DB aggregate. Date/branch filters are
 * exercised. No writes, no invoice create/destroy.
 *
 * Run from repo root: node backend/scripts/verify-report-aggregates.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const { sequelize, Invoice, InvoiceItem } = require("../src/models");

const COMPANY = "CMP-DEMO";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

let base, token;
async function get(path, company = COMPANY) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": company } });
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
    // ── Independent expected aggregates (posted only) ──
    const allInv = await Invoice.findAll({ where: { companyId: COMPANY } });
    const posted = allInv.filter((i) => i.postingStatus === "posted");
    const nonPosted = allInv.length - posted.length;
    const expSales = posted.reduce((s, i) => s + n(i.total), 0);
    const expVat = posted.reduce((s, i) => s + n(i.tax), 0);
    const expSub = posted.reduce((s, i) => s + n(i.subtotal), 0);
    const expRecv = posted.reduce((s, i) => s + n(i.remainingAmount), 0);

    console.log("tax-summary:");
    const tax = await get("/reports/tax-summary");
    check(tax.status === 200 && tax.json.success, "GET /reports/tax-summary → 200 success");
    check(tax.json.postedOnly === true, "declares postedOnly");
    check(tax.json.totals.records === posted.length, `records == posted count (${posted.length})`);
    check(near(tax.json.totals.salesTotal, expSales), "salesTotal matches independent posted Σtotal");
    check(near(tax.json.totals.vatTotal, expVat), "vatTotal matches independent posted Σtax");
    check(near(tax.json.totals.netSubtotal, expSub), "netSubtotal matches independent posted Σsubtotal");

    console.log("\nposted-only (drafts/cancelled excluded):");
    if (nonPosted > 0) {
      const allSales = allInv.reduce((s, i) => s + n(i.total), 0);
      check(!near(tax.json.totals.salesTotal, allSales) || near(expSales, allSales), "endpoint sum != all-invoices sum when non-posted exist");
      console.log(`  (note: ${nonPosted} non-posted invoices present and excluded)`);
    } else {
      check(near(tax.json.totals.salesTotal, expSales), "no non-posted invoices in data; posted == all (filter still applied in query)");
      console.log("  (note: dataset has only posted invoices)");
    }

    console.log("\nfinancial-summary:");
    const fin = await get("/reports/financial-summary");
    check(fin.status === 200 && fin.json.success, "GET /reports/financial-summary → 200 success");
    check(fin.json.ledgerBased === false && fin.json.basis === "invoice", "declares invoice-based (ledger deferred)");
    check(near(fin.json.totals.revenue, expSales), "revenue matches posted Σtotal");
    check(near(fin.json.totals.vat, expVat), "vat matches posted Σtax");
    check(near(fin.json.totals.receivables, expRecv), "receivables matches posted ΣremainingAmount");
    check(fin.json.totals.inventoryCostValue === null, "inventoryCostValue deferred (null)");

    console.log("\nprofit-summary:");
    const prof = await get("/reports/profit-summary");
    check(prof.status === 200 && prof.json.success, "GET /reports/profit-summary → 200 success");
    check(JSON.stringify(prof.json.includedTypes) === JSON.stringify(["sale"]), "includedTypes = [sale]");
    check(prof.json.returnsExchanges === "excluded_pending_item_signing_review", "returns/exchanges excluded + flagged");
    check(typeof prof.json.totals.missingCostCount === "number" && typeof prof.json.totals.zeroCostCount === "number", "reports missingCostCount + zeroCostCount");
    check(near(prof.json.totals.grossProfit, prof.json.totals.revenue - prof.json.totals.cogs), "grossProfit == revenue - cogs");
    // Independent profit over posted SALE items
    const saleIds = posted.filter((i) => i.type === "sale").map((i) => i.id);
    const items = saleIds.length ? await InvoiceItem.findAll({ where: { invoiceId: saleIds } }) : [];
    const expRev = items.reduce((s, it) => s + n(it.price) * n(it.quantity), 0);
    check(near(prof.json.totals.revenue, expRev), "profit revenue matches independent posted-sale item Σ(price*qty)");

    console.log("\nfilters (branch + date):");
    const branchId = (posted.find((i) => i.branchId) || {}).branchId;
    if (branchId) {
      const bf = await get(`/reports/tax-summary?branchId=${encodeURIComponent(branchId)}`);
      check(bf.status === 200 && bf.json.filters.branchId === branchId && bf.json.totals.records <= tax.json.totals.records, "branchId filter applies + narrows (or equals)");
    } else {
      console.log("  (no branchId in data — skipping branch filter check)");
    }
    const goodDate = await get("/reports/tax-summary?from=2000-01-01&to=2999-12-31");
    check(goodDate.json.filters.dateFilterApplied === true && near(goodDate.json.totals.salesTotal, expSales), "valid from/to applied; full-range total unchanged");
    const badDate = await get("/reports/tax-summary?from=15-01-2024");
    check(badDate.status === 200 && badDate.json.filters.dateFilterRejected === true, "malformed from/to is rejected safely (not applied)");

    console.log("\ncompany scope:");
    const other = await get("/reports/tax-summary", "CMP-DOES-NOT-EXIST");
    check(other.status === 200 && other.json.totals.records === 0, "different company → 0 records (companyId scoped)");

    console.log(`\nRESULT: all ${passed} checks passed. (read-only GET, no writes)`);
  } finally {
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
