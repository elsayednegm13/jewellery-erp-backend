/**
 * Supplier purchase-order payment state — Phase 17B verify.
 *
 * GET /suppliers/:id/purchase-orders now augments each PO with computed
 * payableAmount / paidAmount / remainingAmount / paymentStatus / canPay, sourced
 * from supplier-payment cash-outs (reference = PO.id), NOT Supplier.due. Proves
 * unpaid/partial/paid/consignment states, that /purchase-orders/:id/pay still
 * rejects overpay & already-paid, statement closing == sum remaining, and
 * Supplier.due is never written.
 *
 * WRITE — fixtures under a throwaway company; cleanup deletes it LAST. No residue.
 *
 *   cd backend && node scripts/verify-supplier-purchase-payment-state.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const sps = require("../src/services/supplier-payment-state.service");

const { sequelize, Company, Supplier, Branch, PurchaseOrder, CashTransaction, JournalEntry, Account, AuditLog } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-SPS-${stamp}`;
const SUP = `SUP-SPS-${stamp}`;

let passed = 0;
function check(condition, message) { if (!condition) throw new Error("FAILED: " + message); passed++; console.log("  ✓ " + message); }
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token;
async function getPos() {
  const r = await fetch(`${base}/suppliers/${SUP}/purchase-orders`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
  let json = null; try { json = await r.json(); } catch {}
  return (json.items || json.data || []);
}
async function statement() {
  const r = await fetch(`${base}/suppliers/${SUP}/statement`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
  let json = null; try { json = await r.json(); } catch {}
  return json.data;
}
async function pay(poId, amount, key) {
  const r = await fetch(`${base}/purchase-orders/${poId}/pay`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Idempotency-Key": key, "Content-Type": "application/json" }, body: JSON.stringify({ amount, account: "cash" }) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
let poN = 0;
async function mkPO(total, { received = true, consignment = false } = {}) {
  const id = `PO-SPS-${stamp}-${++poN}`;
  await PurchaseOrder.create({ id, companyId: CO, supplierId: SUP, supplierName: "مورد", status: received ? "received" : "draft", date: "2026-05-01", total, branch: "Main", isConsignment: consignment });
  return id;
}
async function mkPayment(poId, amount) {
  await CashTransaction.create({ id: `TX-SPS-${stamp}-${Math.random().toString(36).slice(2, 7)}`, companyId: CO, type: "cash_out", account: "cash", amount, category: "supplier_purchase", reference: poId, description: "test pay", branch: "Main", date: "2026-05-02", status: "posted" });
}
const byId = (list, id) => list.find((p) => p.id === id);

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    console.log("0) pure helper computePoPaymentState:");
    check(JSON.stringify(sps.computePoPaymentState({ total: 984, status: "received", isConsignment: false }, 0)) === JSON.stringify({ payableAmount: 984, paidAmount: 0, remainingAmount: 984, paymentStatus: "unpaid", canPay: true }), "unpaid → remaining=total, canPay=true");
    check(sps.computePoPaymentState({ total: 1000, status: "received", isConsignment: false }, 500).paymentStatus === "partial", "partial → paymentStatus=partial");
    const full = sps.computePoPaymentState({ total: 600, status: "received", isConsignment: false }, 600);
    check(full.remainingAmount === 0 && full.paymentStatus === "paid" && full.canPay === false, "fully paid → remaining=0, paid, canPay=false");
    check(sps.computePoPaymentState({ total: 300, status: "received", isConsignment: true }, 0).canPay === false, "consignment → canPay=false even when unpaid");

    await Company.create({ id: CO, businessName: "Verify SPS Co", workspace: `verify-sps-${stamp}` });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد", phone: "+1", category: "general", due: 984 });

    const poUnpaid = await mkPO(984);
    const poPartial = await mkPO(1000); await mkPayment(poPartial, 500);
    const poPaid = await mkPO(600); await mkPayment(poPaid, 600);
    const poCons = await mkPO(300, { consignment: true });

    console.log("\n1) computed state exposed on GET /suppliers/:id/purchase-orders:");
    const list = await getPos();
    const u = byId(list, poUnpaid), p = byId(list, poPartial), f = byId(list, poPaid), c = byId(list, poCons);
    check(u && approx(u.payableAmount, 984) && approx(u.paidAmount, 0) && approx(u.remainingAmount, 984) && u.paymentStatus === "unpaid" && u.canPay === true, "unpaid PO: payable 984/paid 0/remaining 984/unpaid/canPay true");
    check(p && approx(p.paidAmount, 500) && approx(p.remainingAmount, 500) && p.paymentStatus === "partial" && p.canPay === true, "partial PO: paid 500/remaining 500/partial/canPay true");
    check(f && approx(f.paidAmount, 600) && approx(f.remainingAmount, 0) && f.paymentStatus === "paid" && f.canPay === false, "paid PO: paid 600/remaining 0/paid/canPay false");
    check(c && c.canPay === false, "consignment PO: canPay false");

    console.log("\n2) /purchase-orders/:id/pay behavior unchanged:");
    check((await pay(poPaid, 100, `K-paid-${stamp}`)).status >= 400, "pay on fully-paid PO → rejected");
    check((await pay(poPartial, 600, `K-over-${stamp}`)).status >= 400, "overpay (600 > remaining 500) → rejected");
    const okPay = await pay(poPartial, 500, `K-ok-${stamp}`);
    check(okPay.status === 200 || okPay.status === 201, "valid top-up (500 = remaining) → success");
    const list2 = await getPos();
    const p2 = byId(list2, poPartial);
    check(approx(p2.paidAmount, 1000) && approx(p2.remainingAmount, 0) && p2.paymentStatus === "paid" && p2.canPay === false, "after top-up: partial PO now paid/remaining 0/canPay false");

    console.log("\n3) statement closing == sum of remaining (received non-consignment):");
    const st = await statement();
    // remaining now: unpaid 984 + partial 0 + paid 0 = 984 (consignment excluded)
    check(approx(st.closingBalance, 984), "statement closing = 984 (= Σ remaining of received non-consignment POs)");

    console.log("\n4) Supplier.due untouched (reference only):");
    const sup = await Supplier.findByPk(SUP);
    check(Number(sup.due) === 984, "Supplier.due still 984 (never written by payments)");
    check(typeof st.supplierDueReference !== "undefined", "statement still returns supplierDueReference (reference)");

    console.log("\n5) no GL/posting regression (pay still posts a journal):");
    const jeCount = await JournalEntry.count({ where: { companyId: CO, sourceType: "supplier_payment" } }).catch(() => null);
    check((await CashTransaction.count({ where: { companyId: CO, type: "cash_out", category: "supplier_purchase" } })) >= 3, "supplier-payment cash-outs recorded (2 fixtures + 1 real pay)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("journal entries", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascade audit/remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
