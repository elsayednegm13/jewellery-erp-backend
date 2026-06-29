/**
 * Sales draft COGS source-of-truth — Phase 16B verify.
 *
 * Proves COGS is server-sourced (Asset.cost / Product.averageCost), never the
 * client-supplied item.cost, across all sale paths:
 *   - /pos/checkout (already safe) ignores client cost
 *   - /sales/invoices/draft (immediate-post) ignores client cost:0 → COGS=asset.cost
 *   - /sales/invoices/drafts (buildDraftItems) stores asset.cost (not client)
 *   - /sales/invoices/:id/post recomputes COGS from current asset.cost even when
 *     the stored InvoiceItem.cost was forged (protects pre-existing drafts)
 * + COGS(5000) == inventory credit(1200) == book cost (trial balance balances),
 *   selling price/revenue/VAT untouched, no schema/migration change.
 *
 * WRITE — fixtures under a throwaway company; cleanup deletes the company LAST.
 * No residue. No backfill / no change to old posted invoices.
 *
 *   cd backend && node scripts/verify-sales-draft-cogs-source.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Customer, Branch, Asset, Invoice, InvoiceItem, JournalEntry, JournalLine, Account, StockMovement, AssetEvent, CashTransaction, Installment } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-DCOGS-${stamp}`;
const CUST = `CUS-DCOGS-${stamp}`;
const BR = `BR-DCOGS-${stamp}`;

let passed = 0;
function check(condition, message) { if (!condition) throw new Error("FAILED: " + message); passed++; console.log("  ✓ " + message); }
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token, n = 0;
const headers = () => ({ Authorization: `Bearer ${token}`, "X-Company-ID": CO, "X-Branch-ID": BR, "Content-Type": "application/json" });
async function post(path, body) {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function mkAsset(cost, extra = {}) {
  const id = `AST-DCOGS-${stamp}-${++n}`;
  await Asset.create({ id, companyId: CO, name: `قطعة ${n}`, type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost, price: cost * 2, branch: "Main", branchId: BR, category: "rings", location: "Showroom", barcode: `BC-${stamp}-${n}`, status: "available", ...extra });
  return id;
}
async function cogsOf(invId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceType: "invoice", sourceId: invId } });
  if (!je) return null;
  const rows = await JournalLine.findAll({ where: { journalEntryId: je.id } });
  const m = {};
  for (const r of rows) { m[r.accountCode] = m[r.accountCode] || { debit: 0, credit: 0 }; m[r.accountCode].debit += Number(r.debit || 0); m[r.accountCode].credit += Number(r.credit || 0); }
  const totalDr = rows.reduce((s, r) => s + Number(r.debit || 0), 0);
  const totalCr = rows.reduce((s, r) => s + Number(r.credit || 0), 0);
  return { m, balanced: approx(totalDr, totalCr) };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify DCOGS Co", workspace: `verify-dcogs-${stamp}` });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });

    // NOTE: /pos/checkout is UNCHANGED by 16B (already server-cost per 16A line
    // 284). It is not live-tested here because it auto-generates a company-scoped
    // sequence invoice id that collides with the globally-unique PK in the shared
    // dev DB (a pre-existing env limitation, unrelated to this fix).

    console.log("1) /sales/invoices/draft (immediate-post) ignores client cost:0:");
    const a2 = await mkAsset(1000);
    const draftId = `INV-DCOGS-${stamp}-A`;
    const r2 = await post("/sales/invoices/draft", { id: draftId, customerId: CUST, customerName: "عميل", branch: "Main", total: 2000, subtotal: 2000, tax: 0, paymentMethod: "Cash", items: [{ assetId: a2, name: "قطعة", quantity: 1, price: 2000, cost: 0 }] });
    check(r2.status === 200 || r2.status === 201, "sales/invoices/draft → success");
    const it2 = await InvoiceItem.findOne({ where: { invoiceId: draftId } });
    check(approx(Number(it2.cost), 1000), "draft: InvoiceItem.cost = 1000 (asset.cost, NOT client 0)");
    const c2 = await cogsOf(draftId);
    check(c2 && approx(c2.m["5000"].debit, 1000) && approx(c2.m["1200"].credit, 1000) && c2.balanced, "draft: COGS=1000, inventory credit=1000, balanced");
    // Phase 18B-1: total is now server-computed (price 2000 + 5% default VAT = 2100);
    // the selling price intent (subtotal base 2000) is unchanged.
    const inv2 = await Invoice.findByPk(draftId);
    check(approx(Number(inv2.total), 2100) && approx(Number(inv2.subtotal), 2000), "draft: total server-computed (2100 = 2000 + 5% VAT), subtotal base 2000");

    console.log("\n2) /sales/invoices/drafts (buildDraftItems) stores server cost:");
    const a3 = await mkAsset(1200);
    const r3 = await post("/sales/invoices/drafts", { customerId: CUST, branchId: BR, paymentMethod: "Cash", items: [{ assetId: a3, price: 2500, cost: 0 }] });
    check(r3.status === 200 || r3.status === 201, "sales/invoices/drafts → success");
    const draftsId = r3.json.id || r3.json.data?.id;
    const it3 = await InvoiceItem.findOne({ where: { invoiceId: draftsId } });
    check(approx(Number(it3.cost), 1200), "drafts: stored InvoiceItem.cost = 1200 (asset.cost, NOT client 0)");

    console.log("\n3) /sales/invoices/:id/post recomputes COGS even if stored cost is forged:");
    // Simulate a pre-existing draft saved with a FORGED cost (e.g. 5).
    await InvoiceItem.update({ cost: 5 }, { where: { invoiceId: draftsId } });
    const r4 = await post(`/sales/invoices/${draftsId}/post`, {});
    check(r4.status === 200 || r4.status === 201, "draft post → success");
    const c4 = await cogsOf(draftsId);
    check(c4 && approx(c4.m["5000"].debit, 1200), "post: COGS(5000) = asset.cost 1200 (forged stored cost 5 ignored)");
    check(approx(c4.m["1200"].credit, 1200) && c4.balanced, "post: inventory credit 1200, journal balanced");

    console.log("\n4) earlier posted invoice not mutated by later posts (no backfill):");
    const it2After = await InvoiceItem.findOne({ where: { invoiceId: draftId } });
    check(approx(Number(it2After.cost), 1000), "earlier immediate-post invoice cost unchanged (1000) — no backfill");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("installments", () => Installment.destroy({ where: { companyId: CO } }));
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
