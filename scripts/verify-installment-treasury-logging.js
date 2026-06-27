/**
 * Installment payment logs a treasury CashTransaction — Phase 11D verify.
 *
 * POST /installments/:id/pay now, atomically with the installment update + the
 * Payment row + the GL journal (postInstallmentPayment), also creates a
 * CashTransaction (type cash_in) linked to the SAME journalEntryId — an
 * operational treasury log only, with NO postCashEntry and therefore NO second
 * journal / no double-posting. The journal posting was moved INSIDE the
 * transaction, so a posting failure rolls back the whole collection.
 *
 * Proves: the treasury list/summary now surface installment collections; GL is
 * not double-counted; Customer Statement still credits once (from Payment, not
 * the CashTransaction); idempotent replay duplicates nothing; rejected amounts
 * create nothing; bank methods map to account=bank; Customer.balance untouched;
 * and posting failure rolls everything back (no orphans).
 *
 * WRITE endpoint → all fixtures live under a throwaway company; cleanup deletes
 * the company LAST so FK cascade removes every created row — no residue.
 *
 * Run from repo root:
 *   node backend/scripts/verify-installment-treasury-logging.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const postingService = require("../src/services/posting.service");

const { sequelize, Company, Customer, Invoice, Installment, Payment, JournalEntry, Account, CashTransaction } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-ITX-${stamp}`;
const CUST = `CUS-ITX-${stamp}`;
const INV = `INV-ITX-${stamp}`;
const INST = `IST-ITX-${stamp}`;       // cash installment (600)
const INV2 = `INV-ITX2-${stamp}`;
const INST2 = `IST-ITX2-${stamp}`;     // bank installment (300)
const INV3 = `INV-ITX3-${stamp}`;
const INST3 = `IST-ITX3-${stamp}`;     // rollback-sim installment (100)

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
async function get(pathname) {
  const r = await fetch(`${base}${pathname}`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

const cashTxAll = () => CashTransaction.findAll({ where: { companyId: CO } });
const instJournalCount = (instId) => JournalEntry.count({ where: { companyId: CO, sourceType: "installment", sourceId: instId } });
const cashTxJournalCount = () => JournalEntry.count({ where: { companyId: CO, sourceType: "cash_transaction" } });
const payCount = (invId) => Payment.count({ where: { companyId: CO, invoiceId: invId } });
const custBalance = async () => Number((await Customer.findByPk(CUST)).balance);
const cashBal = async () => {
  const a = await Account.findOne({ where: { companyId: CO, code: "1110" } });
  return a ? Number(a.balance) : 0;
};

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" }); // admin role → treasury perms

  try {
    await Company.create({ id: CO, businessName: "Verify ITx Co", workspace: `verify-itx-${stamp}` });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل أقساط خزنة", phone: "+100", balance: 0 });
    for (const [inv, total] of [[INV, 1000], [INV2, 300], [INV3, 100]]) {
      await Invoice.create({
        id: inv, companyId: CO, customerId: CUST, customerName: "عميل أقساط خزنة", type: "installment",
        total, tax: 0, subtotal: total, date: "2026-01-10", status: "due", postingStatus: "posted",
        paymentMethod: "installment", branch: "Main",
      });
    }
    await Installment.create({ id: INST, companyId: CO, invoiceId: INV, customerId: CUST, customerName: "عميل أقساط خزنة", sequence: 1, dueDate: "2026-02-10", amount: 600, paidAmount: 0, status: "pending", branch: "Main" });
    await Installment.create({ id: INST2, companyId: CO, invoiceId: INV2, customerId: CUST, customerName: "عميل أقساط خزنة", sequence: 1, dueDate: "2026-02-10", amount: 300, paidAmount: 0, status: "pending", branch: "Main" });
    await Installment.create({ id: INST3, companyId: CO, invoiceId: INV3, customerId: CUST, customerName: "عميل أقساط خزنة", sequence: 1, dueDate: "2026-02-10", amount: 100, paidAmount: 0, status: "pending", branch: "Main" });

    const bal0 = await custBalance();

    console.log("1) cash installment payment logs a treasury CashTransaction (partial):");
    const cashBefore = await cashBal();
    const r1 = await pay(INST, { amount: 200, paymentMethod: "Cash", reference: "RC-1" }, `K1-${stamp}`);
    check(r1.status === 200 && r1.json.success, "pay 200 cash → 200 success");
    check((await payCount(INV)) === 1, "exactly one Payment row created");
    check((await instJournalCount(INST)) === 1, "exactly one installment JournalEntry created");
    const txs1 = (await cashTxAll()).filter((t) => t.reference === INV);
    check(txs1.length === 1, "exactly one CashTransaction created for this collection");
    const tx1 = txs1[0];
    check(tx1.type === "cash_in", "CashTransaction.type = cash_in");
    check(tx1.account === "cash", "CashTransaction.account = cash (Cash method)");
    check(Number(tx1.amount) === 200, "CashTransaction.amount = 200");
    check(tx1.reference === INV, "CashTransaction.reference = inst.invoiceId");
    check(tx1.category === "تحصيل قسط", "CashTransaction.category = تحصيل قسط");
    check(Boolean(r1.json.journalEntry) && tx1.journalEntryId === r1.json.journalEntry.id, "CashTransaction.journalEntryId = the installment journal id");
    check((await cashTxJournalCount()) === 0, "no postCashEntry journal created (sourceType cash_transaction = 0)");
    check((await cashBal()) === cashBefore + 200, "GL Cash (1110) increased by exactly 200 — once");
    check((await custBalance()) === bal0, "Customer.balance UNCHANGED by installment pay");

    console.log("\n2) Customer Statement credits once (from Payment, not the CashTransaction):");
    const s1 = (await get(`/customers/${CUST}/statement-v2`)).json.data;
    const payRows = (s1.items || []).filter((x) => x.type === "payment" && x.sourceId && x.sourceId.startsWith("PAY-INST"));
    check(payRows.length === 1 && payRows[0].credit === 200, "exactly one payment credit (200) in statement — no double credit");
    check(!(s1.items || []).some((x) => x.type === "installment"), "no Installment/CashTransaction rows injected into the statement");

    console.log("\n3) treasury list + summary surface the collection:");
    const list = (await get(`/treasury/transactions?type=cash_in`)).json;
    check((list.items || []).some((x) => x.reference === INV && x.type === "cash_in"), "treasury transactions list shows the installment cash_in");
    const summary = (await get(`/treasury/summary`)).json.data;
    check(typeof summary.todayIn === "number" && summary.todayIn >= 200, "treasury summary todayIn includes the installment collection (>= 200)");
    check(typeof summary.cash === "number", "treasury summary still returns server-side cash balance (logic unchanged)");

    console.log("\n4) idempotent replay duplicates nothing:");
    const replay = await pay(INST, { amount: 200, paymentMethod: "Cash" }, `K1-${stamp}`);
    check(replay.status === 200, "replay same Idempotency-Key → 200");
    check((await payCount(INV)) === 1, "no duplicate Payment on replay");
    check((await instJournalCount(INST)) === 1, "no duplicate JournalEntry on replay");
    check((await cashTxAll()).filter((t) => t.reference === INV).length === 1, "no duplicate CashTransaction on replay");
    check(Number((await Installment.findByPk(INST)).paidAmount) === 200, "paidAmount unchanged on replay");

    console.log("\n5) rejected amounts create no CashTransaction (10P guards intact):");
    const txCountBeforeBad = (await cashTxAll()).length;
    check((await pay(INST, { amount: 0 }, `KZ-${stamp}`)).status === 422, "amount 0 → 422");
    check((await pay(INST, { amount: -5 }, `KN-${stamp}`)).status === 422, "negative → 422");
    check((await pay(INST, {}, `KM-${stamp}`)).status === 422, "missing amount → 422");
    check((await pay(INST, { amount: 9999 }, `KO-${stamp}`)).status === 422, "overpayment → 422");
    check((await cashTxAll()).length === txCountBeforeBad, "no CashTransaction created by any rejected attempt");

    console.log("\n6) full payment + bank method maps to account=bank:");
    const r2 = await pay(INST, { amount: 400, paymentMethod: "Cash" }, `K2-${stamp}`);
    check(r2.status === 200 && (await Installment.findByPk(INST)).status === "paid", "remaining 400 → paid (full payment works)");
    check((await cashTxAll()).filter((t) => t.reference === INV).length === 2, "second installment cash_in logged (total 2 for this invoice)");
    const rb = await pay(INST2, { amount: 300, paymentMethod: "Bank Transfer" }, `KB-${stamp}`);
    check(rb.status === 200, "bank-transfer installment payment → 200");
    const txBank = (await cashTxAll()).find((t) => t.reference === INV2);
    check(Boolean(txBank) && txBank.account === "bank", "bank/transfer method → CashTransaction.account = bank (matches GL cashCode 1120)");

    console.log("\n7) posting failure rolls back the whole collection (no orphans):");
    const orig = postingService.postInstallmentPayment;
    postingService.postInstallmentPayment = async () => { throw new Error("SIMULATED posting failure"); };
    let threw = false;
    try {
      const bad = await pay(INST3, { amount: 100, paymentMethod: "Cash" }, `KF-${stamp}`);
      threw = bad.status >= 400;
    } finally {
      postingService.postInstallmentPayment = orig;
    }
    check(threw, "posting failure → error status (not 200)");
    check((await payCount(INV3)) === 0, "rollback: no Payment row left behind");
    check(Number((await Installment.findByPk(INST3)).paidAmount) === 0, "rollback: installment paidAmount still 0");
    check((await Installment.findByPk(INST3)).status === "pending", "rollback: installment still pending");
    check((await cashTxAll()).filter((t) => t.reference === INV3).length === 0, "rollback: no CashTransaction left behind");
    check((await instJournalCount(INST3)) === 0, "rollback: no JournalEntry left behind");

    console.log("\n8) final invariant:");
    check((await custBalance()) === bal0, "Customer.balance still unchanged after all payments");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("cash transactions", () => CashTransaction.destroy({ where: { companyId: CO } }));
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
