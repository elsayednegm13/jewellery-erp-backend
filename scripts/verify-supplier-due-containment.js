/**
 * Supplier.due backend containment — Phase 10M verify.
 *
 * Proves Supplier.due is FROZEN: receive no longer increments it, and the
 * generic suppliers CRUD ignores `due` from the request body. All fixtures live
 * under a throwaway company; cleanup deletes the company LAST so FK cascade
 * removes every created row (incl. the immutable audit rows) — no residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-supplier-due-containment.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Branch, Supplier, PurchaseOrder, CashTransaction, JournalEntry, Account } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-DUE-${stamp}`;
const BR = `BR-VDUE-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let token;
async function req(method, pathname, body, extraHeaders = {}) {
  const headers = { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json", ...extraHeaders };
  const r = await fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const dueOf = async (id) => Number((await Supplier.findByPk(id)).due);

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify Due Co", workspace: `verify-due-${stamp}` });
    await Branch.create({ id: BR, companyId: CO, name: "Verify WH", code: `WH-${stamp}`.slice(0, 20), type: "warehouse", isActive: true });

    console.log("1) supplier CRUD ignores `due` from the body:");
    const created = await req("POST", "/suppliers", { name: "مورّد تجميد", category: "general", phone: "+100", due: 9999 });
    check(created.status === 201, "create supplier → 201");
    const supId = created.json.data?.id || created.json.id;
    check(Boolean(supId), "created supplier id returned");
    check((await dueOf(supId)) === 0, "create ignored body.due (9999) → stored due = 0");

    const updated = await req("PUT", `/suppliers/${supId}`, { due: 8888, phone: "+200" });
    check(updated.status === 200, "update supplier → 200");
    check((await dueOf(supId)) === 0, "update ignored body.due (8888) → due still 0");
    check((await Supplier.findByPk(supId)).phone === "+200", "update still applies non-due fields (phone)");

    console.log("\n2) purchase receive does NOT increment due:");
    const recv = await req("POST", "/purchase-orders/receive", {
      supplierId: supId,
      branchId: BR,
      paymentMethod: "credit",
      paidAmount: 0, // remaining = 600 > 0 (would previously have incremented due)
      items: [{ name: "Probe item", quantity: 1, weightPerUnit: 10, unitCost: 600, karat: 21 }],
    });
    check(recv.status === 201, "receive purchase order → 201 (still works)");
    const po = recv.json.purchaseOrder || recv.json.data?.purchaseOrder;
    const poId = po && po.id;
    check(Boolean(poId), "received PO id returned");
    check((await dueOf(supId)) === 0, "Supplier.due UNCHANGED after receive (frozen, was remaining 600)");

    console.log("\n3) supplier statement is the computed source of truth:");
    const st1 = (await req("GET", `/suppliers/${supId}/statement`)).json.data;
    const poRow = (st1.items || []).find((r) => r.sourceId === poId);
    check(Boolean(poRow) && poRow.credit === 600, "statement shows received PO as credit 600");
    check(st1.closingBalance === 600, "statement closing = 600 (computed from documents, not due)");
    check(st1.supplierDueReference === 0, "statement echoes due as reference (0)");

    console.log("\n4) supplier payment does NOT change due:");
    const pay = await req("POST", `/purchase-orders/${poId}/pay`, { amount: 200, account: "cash" }, { "Idempotency-Key": `DUE-PAY-${stamp}` });
    check(pay.status === 201, "supplier payment (200) → 201");
    check((await dueOf(supId)) === 0, "Supplier.due UNCHANGED after payment (still 0)");

    const st2 = (await req("GET", `/suppliers/${supId}/statement`)).json.data;
    const payRow = (st2.items || []).find((r) => r.type === "supplier_payment");
    check(Boolean(payRow) && payRow.debit === 200, "statement shows payment as debit 200");
    check(st2.closingBalance === 400, "statement closing dropped to 400 (600 - 200)");

    console.log("\n5) final invariant:");
    check((await dueOf(supId)) === 0, "Supplier.due stayed 0 (reference only) through receive + payment");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("journal entries (+lines cascade)", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("assets", () => models.Asset.destroy({ where: { companyId: CO }, force: true }));
    await safe("products", () => models.Product.destroy({ where: { companyId: CO }, force: true }));
    await safe("stock movements", () => models.StockMovement.destroy({ where: { companyId: CO } }));
    await safe("purchase orders (+items cascade)", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("branches", () => Branch.destroy({ where: { companyId: CO } }));
    await safe("company (cascades audit/notifications/remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
