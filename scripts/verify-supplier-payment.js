/**
 * Supplier purchase payment — Phase 10J verify.
 *
 * POST /purchase-orders/:id/pay WRITES (CashTransaction + posted JournalEntry +
 * balances + audit). All fixtures live under a throwaway company; cleanup
 * deletes the company LAST, and because audit_logs.company_id / journal /
 * accounts / cash_transactions FKs are ON DELETE CASCADE (and Company is not
 * paranoid), that hard-delete cascades away every row created here — including
 * the otherwise-immutable audit rows — leaving NO residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-supplier-payment.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Supplier, PurchaseOrder, CashTransaction, JournalEntry, JournalLine, AuditLog, Account } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-PAY-${stamp}`;
const SUP = `SUP-PAY-${stamp}`;
const PO_RECV = `PO-PAY-RECV-${stamp}`;
const PO_DRAFT = `PO-PAY-DRAFT-${stamp}`;
const PO_CONSIGN = `PO-PAY-CONS-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let token;
async function pay(poId, body, key, company = CO) {
  const headers = { Authorization: `Bearer ${token}`, "X-Company-ID": company, "Content-Type": "application/json" };
  if (key !== null) headers["Idempotency-Key"] = key;
  const response = await fetch(`${base}/purchase-orders/${poId}/pay`, { method: "POST", headers, body: JSON.stringify(body) });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}
async function get(pathname) {
  const r = await fetch(`${base}${pathname}`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

async function makePO(id, status, total, isConsignment = false) {
  return PurchaseOrder.create({
    id, companyId: CO, supplierId: SUP, supplierName: "مورّد دفع", status, total,
    date: "2026-01-10", receivedDate: status === "received" ? "2026-01-10" : null,
    branch: "Main", isConsignment,
  });
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify Pay Co", workspace: `verify-pay-${stamp}` });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورّد دفع", category: "general", phone: "+100", due: 5000 });
    await makePO(PO_RECV, "received", 1000);
    await makePO(PO_DRAFT, "draft", 500);
    await makePO(PO_CONSIGN, "received", 700, true);

    console.log("1) valid partial payment + accounting impact:");
    const K1 = `KEY-1-${stamp}`;
    const r1 = await pay(PO_RECV, { amount: 400, account: "cash" }, K1);
    check(r1.status === 201 && r1.json.success, "partial payment (400) → 201");
    const txId = r1.json.data.payment.id;
    const jeId = r1.json.data.payment.journalEntryId;
    check(r1.json.data.paidSoFarAfter === 400 && r1.json.data.remainingAfter === 600, "paidSoFarAfter 400, remainingAfter 600");

    const tx = await CashTransaction.findByPk(txId);
    check(tx && tx.type === "cash_out", "CashTransaction created as cash_out");
    check(tx.category === "supplier_purchase", "category = supplier_purchase");
    check(tx.reference === PO_RECV, "reference = PO id");
    check(tx.counterAccountCode === "2100", "counterAccountCode = 2100");
    check(Boolean(jeId) && tx.journalEntryId === jeId, "journalEntryId linked on the cash transaction");

    const je = await JournalEntry.findByPk(jeId);
    check(je && je.status === "posted", "JournalEntry is posted");
    const lines = await JournalLine.findAll({ where: { journalEntryId: jeId } });
    const apLine = lines.find((l) => l.accountCode === "2100");
    const cashLine = lines.find((l) => l.accountCode === "1110");
    check(apLine && Number(apLine.debit) === 400 && Number(apLine.credit) === 0, "Dr Accounts Payable 2100 = 400");
    check(cashLine && Number(cashLine.credit) === 400 && Number(cashLine.debit) === 0, "Cr Cash 1110 = 400");

    const supAfter1 = await Supplier.findByPk(SUP);
    check(Number(supAfter1.due) === 5000, "Supplier.due UNCHANGED (still 5000)");

    console.log("\n2) supplier statement picks up the payment:");
    const st1 = (await get(`/suppliers/${SUP}/statement`)).json.data;
    const payRow = (st1.items || []).find((r) => r.sourceId === txId);
    check(Boolean(payRow) && payRow.debit === 400 && payRow.type === "supplier_payment", "statement shows payment as a debit row (400)");
    check(st1.closingBalance === 600, "statement closing = 1000 received - 400 paid = 600");

    console.log("\n3) overpayment / idempotency / double-payment:");
    const over = await pay(PO_RECV, { amount: 700, account: "cash" }, `KEY-OVER-${stamp}`);
    check(over.status === 422, "overpayment (700 > remaining 600) → 422");

    const replay = await pay(PO_RECV, { amount: 400, account: "cash" }, K1);
    check(replay.status === 200 && replay.json.meta?.idempotentReplay === true, "same Idempotency-Key + same op → 200 replay");
    const k1count = await CashTransaction.count({ where: { companyId: CO, idempotencyKey: K1 } });
    check(k1count === 1, "no second CashTransaction created on replay (double-payment blocked)");

    const conflict = await pay(PO_RECV, { amount: 500, account: "cash" }, K1);
    check(conflict.status === 409, "same Idempotency-Key + different amount → 409 conflict");

    console.log("\n4) exact remaining + fully-paid guard:");
    const exact = await pay(PO_RECV, { amount: 600, account: "cash" }, `KEY-2-${stamp}`);
    check(exact.status === 201 && exact.json.data.remainingAfter === 0, "exact remaining (600) → 201, remaining 0");
    const fully = await pay(PO_RECV, { amount: 1, account: "cash" }, `KEY-3-${stamp}`);
    check(fully.status === 422, "payment on a fully-paid PO → 422");

    console.log("\n5) eligibility + validation rejections (no writes):");
    check((await pay(PO_DRAFT, { amount: 100 }, `KEY-D-${stamp}`)).status === 422, "pay draft PO → 422");
    check((await pay(PO_CONSIGN, { amount: 100 }, `KEY-C-${stamp}`)).status === 422, "pay consignment PO → 422");
    check((await pay(PO_RECV, { amount: 100 }, `KEY-X-${stamp}`, "CMP-DEMO")).status === 404, "cross-company PO → 404");
    check((await pay(`PO-NOPE-${stamp}`, { amount: 100 }, `KEY-N-${stamp}`)).status === 404, "non-existing PO → 404");
    check((await pay(PO_RECV, { amount: 0 }, `KEY-Z-${stamp}`)).status === 422, "amount 0 → 422");
    check((await pay(PO_RECV, { amount: -5 }, `KEY-NEG-${stamp}`)).status === 422, "negative amount → 422");
    check((await pay(PO_RECV, { amount: 100 }, null)).status === 422, "missing Idempotency-Key → 422");

    console.log("\n6) final state — statement, due, audit:");
    const st2 = (await get(`/suppliers/${SUP}/statement`)).json.data;
    check(st2.closingBalance === 0, "after full payment, statement closing = 0");
    const payRows = (st2.items || []).filter((r) => r.type === "supplier_payment");
    check(payRows.length === 2, "two payment debit rows recorded (400 + 600)");
    const supFinal = await Supplier.findByPk(SUP);
    check(Number(supFinal.due) === 5000, "Supplier.due STILL unchanged after all payments");
    const auditCount = await AuditLog.count({ where: { companyId: CO, action: "supplier.payment" } });
    check(auditCount === 2, "exactly two supplier.payment audit events (one per successful payment)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    // Cleanup: delete children, then the company LAST so FK cascade removes any
    // remainder (incl. the immutable audit rows). No residue.
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("journal entries (+lines cascade)", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascades audit_logs)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
