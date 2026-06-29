/**
 * Sales draft financial totals server-side — Phase 18B-1 verify.
 *
 * Proves subtotal/tax/total are computed on the SERVER (salesService.computeTotals)
 * and forged client totals are ignored for GL across the draft sale paths:
 *   - /sales/invoices/draft (immediate-post): forged totals → Invoice + GL use
 *     server totals; COGS still server (16B)
 *   - /sales/invoices/drafts (true draft): stored totals are server-computed
 *   - /sales/invoices/:id/post: recomputes totals (overrides forged stored ones)
 *     before posting (existing behaviour, asserted here)
 * + VAT output = server tax, journals balance, no schema/migration change.
 *
 * WRITE — fixtures under a throwaway company; cleanup deletes it LAST. No residue.
 *
 *   cd backend && node scripts/verify-sales-draft-financial-truth.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Customer, Branch, Asset, Invoice, InvoiceItem, Payment, JournalEntry, JournalLine, Account, Setting, StockMovement, AssetEvent, CashTransaction } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-SDFT-${stamp}`;
const CUST = `CUS-SDFT-${stamp}`;
const BR = `BR-SDFT-${stamp}`;
const VAT = 5; // %

let passed = 0;
function check(condition, message) { if (!condition) throw new Error("FAILED: " + message); passed++; console.log("  ✓ " + message); }
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token, n = 0;
const H = () => ({ Authorization: `Bearer ${token}`, "X-Company-ID": CO, "X-Branch-ID": BR, "Content-Type": "application/json" });
async function post(path, body) {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: H(), body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function mkAsset(cost, price) {
  const id = `AST-SDFT-${stamp}-${++n}`;
  await Asset.create({ id, companyId: CO, name: `قطعة ${n}`, type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost, price, branch: "Main", branchId: BR, category: "rings", location: "Showroom", barcode: `BC-${stamp}-${n}`, status: "available" });
  return id;
}
async function jeOf(invId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceType: "invoice", sourceId: invId } });
  if (!je) return null;
  const rows = await JournalLine.findAll({ where: { journalEntryId: je.id } });
  const m = {}; let dr = 0, cr = 0;
  for (const l of rows) { m[l.accountCode] = m[l.accountCode] || { debit: 0, credit: 0 }; m[l.accountCode].debit += Number(l.debit || 0); m[l.accountCode].credit += Number(l.credit || 0); dr += Number(l.debit || 0); cr += Number(l.credit || 0); }
  return { m, balanced: approx(dr, cr) };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify SDFT Co", workspace: `verify-sdft-${stamp}` });
    await Setting.create({ companyId: CO, key: "vatRate", value: VAT });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });

    console.log("1) /sales/invoices/draft (immediate-post) ignores forged totals:");
    const a1 = await mkAsset(700, 1000);
    const id1 = `INV-SDFT-${stamp}-A`;
    const r1 = await post("/sales/invoices/draft", {
      id: id1, customerId: CUST, customerName: "عميل", branch: "Main", type: "sale", status: "paid", paymentMethod: "Cash",
      subtotal: 1, tax: 0, total: 1, // forged
      items: [{ assetId: a1, name: "قطعة", quantity: 1, price: 1000, cost: 0 }],
    });
    check(r1.status === 200 || r1.status === 201, "draft immediate-post → success");
    const inv1 = await Invoice.findByPk(id1);
    check(approx(inv1.subtotal, 1000) && approx(inv1.tax, 50) && approx(inv1.total, 1050), "Invoice totals server-computed: subtotal 1000 / tax 50 / total 1050 (forged 1/0/1 ignored)");
    const j1 = await jeOf(id1);
    check(j1 && approx(j1.m["1110"].debit, 1050), "GL cash(1110) debit = 1050 (server total, not 1)");
    check(approx(j1.m["4100"].credit, 1000) && approx(j1.m["2200"].credit, 50), "GL revenue(4100)=1000, VAT(2200)=50 (server)");
    check(approx(j1.m["5000"].debit, 700), "COGS(5000)=700 (server asset.cost, 16B intact)");
    check(j1.balanced, "journal balanced");

    console.log("\n2) /sales/invoices/drafts (true draft) stores server totals:");
    const a2 = await mkAsset(600, 800);
    const r2 = await post("/sales/invoices/drafts", {
      customerId: CUST, branchId: BR, paymentMethod: "Cash",
      subtotal: 1, tax: 0, total: 1, // forged
      items: [{ assetId: a2, price: 800, cost: 0 }],
    });
    check(r2.status === 200 || r2.status === 201, "drafts (save) → success");
    const draftId = r2.json.id || r2.json.data?.id;
    const inv2 = await Invoice.findByPk(draftId);
    check(approx(inv2.subtotal, 800) && approx(inv2.tax, 40) && approx(inv2.total, 840), "stored draft totals server-computed: 800 / 40 / 840 (forged ignored)");

    console.log("\n3) /sales/invoices/:id/post recomputes totals even from a forged stored draft:");
    const a3 = await mkAsset(900, 1200);
    const draftId3 = `DRAFT-SDFT-${stamp}`;
    // Simulate a pre-existing draft saved with FORGED totals + forged item cost.
    await Invoice.create({ id: draftId3, companyId: CO, customerId: CUST, customerName: "عميل", type: "sale", subtotal: 1, tax: 0, total: 1, vatRate: VAT, date: "2026-06-01", status: "due", postingStatus: "draft", paymentMethod: "Cash", branch: "Main", branchId: BR });
    await InvoiceItem.create({ invoiceId: draftId3, assetId: a3, name: "قطعة", quantity: 1, price: 1200, cost: 5 });
    const r3 = await post(`/sales/invoices/${draftId3}/post`, {});
    check(r3.status === 200 || r3.status === 201, "post forged draft → success");
    const inv3 = await Invoice.findByPk(draftId3);
    check(approx(inv3.subtotal, 1200) && approx(inv3.tax, 60) && approx(inv3.total, 1260), "post corrected totals: 1200 / 60 / 1260 (forged 1/0/1 overridden)");
    const j3 = await jeOf(draftId3);
    check(j3 && approx(j3.m["1110"].debit, 1260) && approx(j3.m["4100"].credit, 1200) && approx(j3.m["2200"].credit, 60), "GL uses server totals (cash 1260 / revenue 1200 / VAT 60)");
    check(approx(j3.m["5000"].debit, 900), "COGS(5000)=900 (server asset.cost, forged 5 ignored)");
    check(j3.balanced, "journal balanced");

    console.log("\n4) VAT output report reflects server tax (no forged leakage):");
    const rep = await fetch(`${base}/reports/tax-summary`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
    const repJson = (await rep.json()).data;
    // posted: draft immediate (tax 50) + post (tax 60) = 110; the true-draft (#2) is NOT posted.
    check(approx(repJson.totals.vatTotal, 110), "tax-summary vatTotal = 50 + 60 = 110 (server tax; unposted draft excluded)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("payments", () => Payment.destroy({ where: { companyId: CO } }));
    await safe("asset events", () => AssetEvent.destroy({ where: {}, force: true }).catch(() => {}));
    await safe("invoice items", async () => {
      // Scoped: delete only THIS test company's invoice items (invoice_items has
      // no companyId; resolve via the company's invoices). A global where:{} wipe
      // would destroy shared dev data — see Phase 18F/18G.
      const invs = await Invoice.findAll({ where: { companyId: CO }, attributes: ["id"], paranoid: false });
      const ids = invs.map((i) => i.id).filter(Boolean);
      if (ids.length) await InvoiceItem.destroy({ where: { invoiceId: ids }, force: true });
    });
    await safe("invoices", () => Invoice.destroy({ where: { companyId: CO }, force: true }));
    await safe("assets", () => Asset.destroy({ where: { companyId: CO }, force: true }));
    await safe("stock movements", () => StockMovement.destroy({ where: { companyId: CO } }));
    await safe("journal entries", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("settings", () => Setting.destroy({ where: { companyId: CO } }));
    await safe("customers", () => Customer.destroy({ where: { companyId: CO }, force: true }));
    await safe("branches", () => Branch.destroy({ where: { companyId: CO }, force: true }));
    await safe("company", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
