/**
 * Installment payment records a Payment row — Phase 10O verify.
 *
 * POST /installments/:id/pay now also creates a Payment row (atomic with the
 * installment update) so Customer Statement V2 captures installment collections
 * as credits. WRITE endpoint → all fixtures live under a throwaway company;
 * cleanup deletes the company LAST so FK cascade removes every created row
 * (payments, journal, audit, …) — no residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-installment-payment-statement.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Customer, Invoice, Installment, Payment, JournalEntry, Account } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-INST-${stamp}`;
const CUST = `CUS-INST-${stamp}`;
const INV = `INV-INST-${stamp}`;
const INST = `IST-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let token;
async function pay(instId, body, key, company = CO) {
  const headers = { Authorization: `Bearer ${token}`, "X-Company-ID": company, "Content-Type": "application/json" };
  if (key) headers["Idempotency-Key"] = key;
  const r = await fetch(`${base}/installments/${instId}/pay`, { method: "POST", headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function stmt() {
  const r = await fetch(`${base}/customers/${CUST}/statement-v2`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
  let json = null; try { json = await r.json(); } catch {}
  return json.data;
}
const payCount = async () => Payment.count({ where: { companyId: CO, invoiceId: INV } });
const instRow = async () => Installment.findByPk(INST);
const custBalance = async () => Number((await Customer.findByPk(CUST)).balance);

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify Inst Co", workspace: `verify-inst-${stamp}` });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل أقساط", phone: "+100", balance: 0 });
    await Invoice.create({
      id: INV, companyId: CO, customerId: CUST, customerName: "عميل أقساط", type: "installment",
      total: 1000, tax: 0, subtotal: 1000, date: "2026-01-10", status: "due", postingStatus: "posted",
      paymentMethod: "installment", branch: "Main",
    });
    await Installment.create({
      id: INST, companyId: CO, invoiceId: INV, customerId: CUST, customerName: "عميل أقساط",
      sequence: 1, dueDate: "2026-02-10", amount: 600, paidAmount: 0, status: "pending", branch: "Main",
    });

    const bal0 = await custBalance();

    console.log("1) partial installment payment creates a Payment row:");
    const r1 = await pay(INST, { amount: 200, paymentMethod: "Cash", reference: "RC-1", notes: "n1" }, `K1-${stamp}`);
    check(r1.status === 200 && r1.json.success, "pay 200 → 200 success");
    check(Number((await instRow()).paidAmount) === 200, "Installment.paidAmount = 200");
    check((await instRow()).status === "partial", "Installment.status = partial");
    check((await payCount()) === 1, "exactly one Payment row created");
    const p = await Payment.findOne({ where: { companyId: CO, invoiceId: INV } });
    check(p.invoiceId === INV && Number(p.amount) === 200, "Payment.invoiceId = invoice, amount = 200");
    check(p.paymentMethod === "Cash" && p.reference === "RC-1" && p.notes === "n1", "Payment method/reference/notes saved");
    check(Boolean(r1.json.payment) && r1.json.payment.id === p.id, "response exposes the created payment");
    check(Boolean(r1.json.journalEntry), "existing installment journal entry still posted");
    check((await custBalance()) === bal0, "Customer.balance UNCHANGED by installment pay");

    console.log("\n2) statement picks up the installment collection as credit:");
    const s1 = await stmt();
    const invRow = (s1.items || []).find((x) => x.sourceId === INV);
    const payRow = (s1.items || []).find((x) => x.sourceId === p.id);
    check(Boolean(invRow) && invRow.debit === 1000, "invoice shows as debit 1000");
    check(Boolean(payRow) && payRow.type === "payment" && payRow.credit === 200, "installment payment shows as credit 200");
    check(s1.closingBalance === 800, "closing = 1000 - 200 = 800");
    check(!(s1.items || []).some((x) => x.type === "installment"), "no Installment rows injected directly into the statement");

    console.log("\n3) idempotent replay does not duplicate the Payment:");
    const replay = await pay(INST, { amount: 200, paymentMethod: "Cash" }, `K1-${stamp}`);
    check(replay.status === 200, "replay with same Idempotency-Key → 200");
    check((await payCount()) === 1, "still exactly one Payment row (no duplicate)");
    check(Number((await instRow()).paidAmount) === 200, "Installment.paidAmount still 200 on replay");

    console.log("\n3b) amount validation (remaining = 400) — rejections create nothing:");
    // paidAmount currently 200, remaining 400, one payment so far.
    check((await pay(INST, { amount: 0 }, `KZ-${stamp}`)).status === 422, "amount 0 → 422 (no full-payment shortcut)");
    check((await pay(INST, { amount: -5 }, `KN-${stamp}`)).status === 422, "negative amount → 422");
    check((await pay(INST, {}, `KM-${stamp}`)).status === 422, "missing amount → 422 (no default to full)");
    check((await pay(INST, { amount: "abc" }, `KS-${stamp}`)).status === 422, "non-numeric amount → 422");
    check((await pay(INST, { amount: "Infinity" }, `KI-${stamp}`)).status === 422, "non-finite amount → 422");
    check((await pay(INST, { amount: 700 }, `KO-${stamp}`)).status === 422, "overpayment (700 > remaining 400) → 422");
    check((await payCount()) === 1, "no Payment created by any rejected attempt");
    check(Number((await instRow()).paidAmount) === 200, "Installment.paidAmount unchanged by rejected attempts");

    console.log("\n4) full payment (explicit amount = remaining) + already-paid guard:");
    const r2 = await pay(INST, { amount: 400, paymentMethod: "Cash" }, `K2-${stamp}`);
    check(r2.status === 200 && (await instRow()).status === "paid", "remaining 400 → paid");
    check((await payCount()) === 2, "second Payment row created (total 2)");
    const s2 = await stmt();
    check(s2.closingBalance === 400, "closing = 1000 - 600 = 400");
    const already = await pay(INST, { amount: 1, paymentMethod: "Cash" }, `K3-${stamp}`);
    check(already.status === 409, "paying an already-paid installment → 409 (existing guard)");

    console.log("\n5) not-found / cross-company guards:");
    check((await pay(`IST-NOPE-${stamp}`, { amount: 10 }, `K4-${stamp}`)).status === 404, "non-existing installment → 404");
    check((await pay(INST, { amount: 10 }, `K5-${stamp}`, "CMP-DEMO")).status === 404, "cross-company installment → 404");

    console.log("\n6) final invariant:");
    check((await custBalance()) === bal0, "Customer.balance still unchanged after all payments");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("payments", () => Payment.destroy({ where: { companyId: CO } }));
    await safe("installments", () => Installment.destroy({ where: { companyId: CO } }));
    await safe("journal entries (+lines cascade)", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("invoices", () => Invoice.destroy({ where: { companyId: CO }, force: true }));
    await safe("customers", () => Customer.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascades audit/remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
