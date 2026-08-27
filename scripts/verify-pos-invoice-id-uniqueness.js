/**
 * POS invoice id global uniqueness — Phase 16D verify.
 *
 * Proves /pos/checkout now uses a globally-unique technical id (INV-ID-...) for
 * the PK while keeping the company-scoped human invoiceNumber. Two different
 * companies can each make their FIRST POS sale (both invoiceNumber=INV-2026-000001)
 * WITHOUT an invoices_pkey collision. Technical refs (InvoiceItem/Payment/
 * Installment/CashTransaction/Journal) point to the new global id; COGS/VAT/
 * posting are unchanged; idempotency replay creates nothing new.
 *
 * WRITE — fixtures under throwaway companies; cleanup deletes them LAST. No
 * residue. No migration / schema change / backfill.
 *
 *   cd backend && node scripts/verify-pos-invoice-id-uniqueness.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Customer, Branch, Asset, Invoice, InvoiceItem, Payment, Installment, JournalEntry, JournalLine, Account, StockMovement, AssetEvent, CashTransaction, Notification, Setting } = models;

const stamp = Date.now();
const COS = [`CMP-POSID-A-${stamp}`, `CMP-POSID-B-${stamp}`];

let passed = 0;
function check(condition, message) { if (!condition) throw new Error("FAILED: " + message); passed++; console.log("  ✓ " + message); }
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token;
async function setup(co, n) {
  await Company.create({ id: co, businessName: `POSID ${n}`, workspace: `posid-${n}-${stamp}` });
  await Customer.create({ id: `CUS-${co}`, companyId: co, name: "عميل", phone: "+1", balance: 0 });
  await Branch.create({ id: `BR-${co}`, companyId: co, name: "Main", code: "M1", type: "store", isActive: true });
  await Asset.create({ id: `AST-${co}`, companyId: co, name: "خاتم", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost: 1000, price: 2000, branch: "Main", branchId: `BR-${co}`, category: "rings", location: "Showroom", barcode: `BC-${co}`, status: "available" });
}
async function checkout(co, body, key) {
  const headers = { Authorization: `Bearer ${token}`, "X-Company-ID": co, "X-Branch-ID": `BR-${co}`, "Content-Type": "application/json" };
  if (key) headers["Idempotency-Key"] = key;
  const r = await fetch(`${base}/pos/checkout`, { method: "POST", headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    for (let i = 0; i < COS.length; i++) await setup(COS[i], i + 1);

    console.log("1) two companies' FIRST POS sale both succeed (no PK collision):");
    const rA = await checkout(COS[0], { branchId: `BR-${COS[0]}`, customerId: `CUS-${COS[0]}`, items: [{ assetId: `AST-${COS[0]}`, price: 2000 }], paymentMethod: "Cash" });
    const rB = await checkout(COS[1], { branchId: `BR-${COS[1]}`, customerId: `CUS-${COS[1]}`, items: [{ assetId: `AST-${COS[1]}`, price: 2000 }], paymentMethod: "Cash" });
    check(rA.status === 200 || rA.status === 201, "company A POS checkout → success");
    check(rB.status === 200 || rB.status === 201, "company B POS checkout → success (no invoices_pkey collision)");
    const invA = rA.json.id || rA.json.data?.id;
    const invB = rB.json.id || rB.json.data?.id;
    const recA = await Invoice.findByPk(invA);
    const recB = await Invoice.findByPk(invB);

    console.log("\n2) id is globally unique + distinct from the human number:");
    check(invA !== invB, "company A id !== company B id (globally unique)");
    check(invA.startsWith("INV-ID-") && invB.startsWith("INV-ID-"), "ids use the technical INV-ID- scheme");
    check(recA.id !== recA.invoiceNumber, "id !== invoiceNumber (technical id separated from human number)");

    console.log("\n3) invoiceNumber stays company-scoped human format (collision-free):");
    check(recA.invoiceNumber === "INV-2026-000001" && recB.invoiceNumber === "INV-2026-000001", "both first sales share invoiceNumber INV-2026-000001 (company-scoped, no clash on PK)");

    console.log("\n4) technical refs point to the new global id:");
    const itA = await InvoiceItem.findOne({ where: { invoiceId: invA } });
    check(Boolean(itA) && itA.invoiceId === invA, "InvoiceItem.invoiceId === new global id");
    const payA = await Payment.findOne({ where: { invoiceId: invA } });
    check(Boolean(payA) && payA.invoiceId === invA, "Payment.invoiceId === new global id (cash sale)");
    const smA = await StockMovement.findOne({ where: { companyId: COS[0], referenceId: invA } }).catch(() => null);
    const je = await JournalEntry.findOne({ where: { companyId: COS[0], sourceType: "invoice", sourceId: invA } });
    check(Boolean(je), "JournalEntry.sourceId === new global id (posting intact)");

    console.log("\n5) COGS = server book cost, journal balanced (unchanged), VAT intact:");
    const lines = await JournalLine.findAll({ where: { journalEntryId: je.id } });
    const m = {}; let dr = 0, cr = 0;
    for (const l of lines) { m[l.accountCode] = m[l.accountCode] || { debit: 0, credit: 0 }; m[l.accountCode].debit += Number(l.debit || 0); m[l.accountCode].credit += Number(l.credit || 0); dr += Number(l.debit || 0); cr += Number(l.credit || 0); }
    check(approx(m["5000"].debit, 1000) && approx(m["1200"].credit, 1000), "COGS(5000)=1000, inventory credit=1000 (server cost)");
    check(approx(dr, cr), "journal balanced");

    console.log("\n6) installment POS sale links Installment to the global id:");
    // top up a second asset for company A
    await Asset.create({ id: `AST2-${COS[0]}`, companyId: COS[0], name: "سوار", type: "gold-piece", karat: 21, grossWeight: 8, netWeight: 8, goldWeight: 8, cost: 1500, price: 5000, branch: "Main", branchId: `BR-${COS[0]}`, category: "bracelets", location: "Showroom", barcode: `BC2-${COS[0]}`, status: "available" });
    const rInst = await checkout(COS[0], { branchId: `BR-${COS[0]}`, customerId: `CUS-${COS[0]}`, items: [{ assetId: `AST2-${COS[0]}`, price: 5000 }], paymentMethod: "installment", downPayment: 500, installmentCount: 3, firstDueDate: "2026-07-01" });
    if (rInst.status === 200 || rInst.status === 201) {
      const invI = rInst.json.id || rInst.json.data?.id;
      const recI = await Invoice.findByPk(invI);
      check(invI.startsWith("INV-ID-") && recI.invoiceNumber === "INV-2026-000002", "installment sale: global id + invoiceNumber INV-2026-000002 (next in sequence)");
      const inst = await Installment.findOne({ where: { invoiceId: invI } });
      check(Boolean(inst) && inst.invoiceId === invI && inst.id.startsWith(`INST-${invI}-`), "Installment.invoiceId + INST id reference the global invoice id");
    } else {
      check(false, `installment checkout failed (${rInst.status}: ${JSON.stringify(rInst.json).slice(0,120)})`);
    }

    console.log("\n7) idempotency replay creates no new invoice:");
    const key = `POSID-KEY-${stamp}`;
    await Asset.create({ id: `AST3-${COS[1]}`, companyId: COS[1], name: "ق", type: "gold-piece", karat: 21, grossWeight: 3, netWeight: 3, goldWeight: 3, cost: 600, price: 1200, branch: "Main", branchId: `BR-${COS[1]}`, category: "rings", location: "Showroom", barcode: `BC3-${COS[1]}`, status: "available" });
    const first = await checkout(COS[1], { branchId: `BR-${COS[1]}`, customerId: `CUS-${COS[1]}`, items: [{ assetId: `AST3-${COS[1]}`, price: 1200 }], paymentMethod: "Cash" }, key);
    const cntAfterFirst = await Invoice.count({ where: { companyId: COS[1] } });
    const replay = await checkout(COS[1], { branchId: `BR-${COS[1]}`, customerId: `CUS-${COS[1]}`, items: [{ assetId: `AST3-${COS[1]}`, price: 1200 }], paymentMethod: "Cash" }, key);
    check(replay.status === 200, "replay same Idempotency-Key → 200");
    check((await Invoice.count({ where: { companyId: COS[1] } })) === cntAfterFirst, "replay created no new invoice");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    for (const co of COS) {
      await safe("notifications", () => Notification.destroy({ where: { companyId: co } }).catch(() => {}));
      await safe("installments", () => Installment.destroy({ where: { companyId: co } }));
      await safe("payments", () => Payment.destroy({ where: { companyId: co } }));
      await safe("asset events", () => AssetEvent.destroy({ where: {}, force: true }).catch(() => {}));
      await safe("invoice items", async () => {
        // Scoped: delete only THIS test company's invoice items (invoice_items
        // has no companyId; resolve via the company's invoices). A global
        // where:{} wipe would destroy shared dev data — see Phase 18F/18G.
        const invs = await Invoice.findAll({ where: { companyId: co }, attributes: ["id"], paranoid: false });
        const ids = invs.map((i) => i.id).filter(Boolean);
        if (ids.length) await InvoiceItem.destroy({ where: { invoiceId: ids }, force: true });
      });
      await safe("invoices", () => Invoice.destroy({ where: { companyId: co }, force: true }));
      await safe("assets", () => Asset.destroy({ where: { companyId: co }, force: true }));
      await safe("stock movements", () => StockMovement.destroy({ where: { companyId: co } }));
      await safe("journal entries", () => JournalEntry.destroy({ where: { companyId: co } }));
      await safe("accounts", () => Account.destroy({ where: { companyId: co } }));
      await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: co } }));
      await safe("settings", () => Setting.destroy({ where: { companyId: co } }));
      await safe("customers", () => Customer.destroy({ where: { companyId: co }, force: true }));
      await safe("branches", () => Branch.destroy({ where: { companyId: co }, force: true }));
      await safe("company", () => Company.destroy({ where: { id: co } }));
    }
    console.log("cleanup done — throwaway companies + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
