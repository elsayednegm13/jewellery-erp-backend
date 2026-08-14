/**
 * Scoped invoice-item cleanup guard — Phase 18G verify.
 *
 * Locks the test-hygiene contract introduced in 18G: a verify script's cleanup
 * of invoice_items MUST be scoped to its own throwaway company's invoices, and
 * MUST NOT touch invoice_items belonging to any other company. (invoice_items
 * has no companyId, so the correct cleanup resolves the company's invoice ids
 * first and deletes only items for those ids — never a global where:{} wipe.)
 *
 * Scenario:
 *   1. Create two throwaway companies A and B, each with one invoice + item.
 *   2. Run the scoped cleanup for company A only.
 *   3. Assert A's items are gone, B's items survive.
 *   4. Clean up both companies (scoped). No residue.
 *
 * WRITE — fixtures under throwaway companies; cleanup deletes them LAST.
 *
 *   cd backend && node scripts/verify-scoped-invoice-item-cleanup.js
 */
require("dotenv").config();
const models = require("../src/models");

const { sequelize, Company, Customer, Branch, Asset, Invoice, InvoiceItem } = models;

const stamp = Date.now();
const A = `CMP-SAFE-A-${stamp}`;
const B = `CMP-SAFE-B-${stamp}`;

let passed = 0;
function check(condition, message) { if (!condition) throw new Error("FAILED: " + message); passed++; console.log("  ✓ " + message); }

// The exact scoped-cleanup pattern the 18G-hardened verify scripts now use:
// resolve the company's invoice ids, then delete ONLY those invoice_items.
async function cleanupInvoiceItemsForCompany(companyId) {
  const invoices = await Invoice.findAll({ where: { companyId }, attributes: ["id"], paranoid: false });
  const invoiceIds = invoices.map((i) => i.id).filter(Boolean);
  if (invoiceIds.length) {
    await InvoiceItem.destroy({ where: { invoiceId: invoiceIds }, force: true });
  }
}

async function seedCompany(co) {
  const br = `BR-${co}`;
  const cust = `CUS-${co}`;
  const asset = `AST-${co}`;
  const inv = `INV-${co}`;
  await Company.create({ id: co, businessName: `Safe ${co}`, workspace: `safe-${co}` });
  await Customer.create({ id: cust, companyId: co, name: "عميل", phone: "+1", balance: 0 });
  await Branch.create({ id: br, companyId: co, name: "Main", code: "M1", type: "store", isActive: true });
  await Asset.create({ id: asset, companyId: co, name: "قطعة", type: "gold-piece", karat: 21, grossWeight: 5, netWeight: 5, goldWeight: 5, cost: 700, price: 1000, branch: "Main", branchId: br, category: "rings", location: "Showroom", barcode: `BC-${co}`, status: "sold" });
  await Invoice.create({ id: inv, companyId: co, customerId: cust, customerName: "عميل", type: "sale", subtotal: 1000, tax: 0, total: 1000, vatRate: 0, date: "2026-06-01", status: "paid", postingStatus: "posted", paymentMethod: "Cash", branch: "Main", branchId: br });
  await InvoiceItem.create({ invoiceId: inv, assetId: asset, name: "قطعة", quantity: 1, price: 1000, cost: 700, weight: 5, karat: 21 });
  return { inv };
}

const itemsOf = async (co) => {
  const invs = await Invoice.findAll({ where: { companyId: co }, attributes: ["id"], paranoid: false });
  const ids = invs.map((i) => i.id);
  return ids.length ? InvoiceItem.count({ where: { invoiceId: ids } }) : 0;
};

(async () => {
  await sequelize.authenticate();
  try {
    await seedCompany(A);
    await seedCompany(B);

    console.log("1) both companies start with one invoice item:");
    check((await itemsOf(A)) === 1, "company A has 1 invoice item");
    check((await itemsOf(B)) === 1, "company B has 1 invoice item");

    console.log("\n2) scoped cleanup for company A only:");
    await cleanupInvoiceItemsForCompany(A);
    check((await itemsOf(A)) === 0, "company A invoice items deleted");
    check((await itemsOf(B)) === 1, "company B invoice items UNTOUCHED (no global wipe)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    for (const co of [A, B]) {
      await safe("invoice items", () => cleanupInvoiceItemsForCompany(co));
      await safe("invoices", () => Invoice.destroy({ where: { companyId: co }, force: true }));
      await safe("assets", () => Asset.destroy({ where: { companyId: co }, force: true }));
      await safe("customers", () => Customer.destroy({ where: { companyId: co }, force: true }));
      await safe("branches", () => Branch.destroy({ where: { companyId: co }, force: true }));
      await safe("company", () => Company.destroy({ where: { id: co } }));
    }
    console.log("cleanup done — throwaway companies + scoped invoice items removed; no residue");
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
