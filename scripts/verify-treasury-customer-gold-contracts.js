/**
 * Treasury amount guard + customer-gold rate contract — Phase 18B-2 verify.
 *
 * Confirms (and locks) two server-side guards that ALREADY exist:
 *   - POST /treasury/transactions rejects missing/0/negative/NaN/Infinity amount
 *     with 422 before any CashTransaction/JournalEntry is created.
 *   - POST /customers/:id/gold/deposit computes value = weight × ratePerGram on
 *     the server, validates weight>0 && ratePerGram>0, and NEVER reads body.cost
 *     (a forged cost is ignored). The scrap asset cost + GL inventory use the
 *     server value. ratePerGram is a manual negotiated buy rate (Case C).
 *
 * No route change in 18B-2 — this is a regression lock. WRITE fixtures under a
 * throwaway company; cleanup deletes it LAST. No residue.
 *
 *   cd backend && node scripts/verify-treasury-customer-gold-contracts.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Customer, Branch, Asset, CashTransaction, JournalEntry, JournalLine, Account, AssetEvent, Invoice, Setting } = models;
const CustomerGoldPool = models.CustomerGoldPool;

const stamp = Date.now();
const CO = `CMP-VERIFY-TCG-${stamp}`;
const CUST = `CUS-TCG-${stamp}`;
const BR = `BR-TCG-${stamp}`;

let passed = 0;
function check(condition, message) { if (!condition) throw new Error("FAILED: " + message); passed++; console.log("  ✓ " + message); }
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token;
async function treasury(body) {
  const r = await fetch(`${base}/treasury/transactions`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function deposit(body) {
  const r = await fetch(`${base}/customers/${CUST}/gold/deposit`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "X-Branch-ID": BR, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const ctCount = () => CashTransaction.count({ where: { companyId: CO } });
const scrapCount = () => Asset.count({ where: { companyId: CO, type: "gold-weight" } });

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify TCG Co", workspace: `verify-tcg-${stamp}` });
    await Customer.create({ id: CUST, companyId: CO, name: "عميل", phone: "+1", balance: 0 });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });

    console.log("1) /treasury/transactions rejects invalid amount (no CashTransaction):");
    const c0 = await ctCount();
    check((await treasury({ account: "cash", type: "cash_in" })).status === 422, "missing amount → 422");
    check((await treasury({ amount: 0, account: "cash" })).status === 422, "amount 0 → 422");
    check((await treasury({ amount: -5, account: "cash" })).status === 422, "amount -5 → 422");
    check((await treasury({ amount: "abc", account: "cash" })).status === 422, "amount 'abc' → 422");
    check((await treasury({ amount: "Infinity", account: "cash" })).status === 422, "amount 'Infinity' → 422");
    check((await ctCount()) === c0, "no CashTransaction created by any rejected amount");

    console.log("\n2) /treasury/transactions valid amount still works:");
    const ok = await treasury({ amount: 500, account: "cash", type: "cash_in", category: "test" });
    check(ok.status === 201 || ok.status === 200, "valid amount 500 → success");
    check((await ctCount()) === c0 + 1, "one CashTransaction created");
    const tx = await CashTransaction.findOne({ where: { companyId: CO }, order: [["created_at", "DESC"]] });
    check(Boolean(tx.journalEntryId), "valid transaction posted a journal (journalEntryId set)");

    console.log("\n3) /customers/:id/gold/deposit validates weight/rate (no asset):");
    const s0 = await scrapCount();
    check((await deposit({ weight: 0, ratePerGram: 255, karat: 21, description: "x" })).status >= 400, "weight 0 → rejected");
    check((await deposit({ weight: 5, ratePerGram: 0, karat: 21, description: "x" })).status >= 400, "ratePerGram 0 → rejected");
    check((await scrapCount()) === s0, "no scrap asset created by rejected deposits");

    console.log("\n4) deposit computes value server-side and ignores forged body.cost:");
    const d = await deposit({ weight: 5, ratePerGram: 255, karat: 21, description: "كسر", cost: 99999, price: 99999, total: 99999 });
    check(d.status === 201 || d.status === 200, "valid deposit (5g × 255) → success");
    const scrap = await Asset.findOne({ where: { companyId: CO, type: "gold-weight" }, order: [["created_at", "DESC"]] });
    check(approx(scrap.cost, 1275), "scrap asset cost = 5 × 255 = 1275 (server), NOT forged 99999");
    const je = await JournalEntry.findOne({ where: { companyId: CO, sourceType: "customer_gold_pool" }, order: [["created_at", "DESC"]] });
    const lines = je ? await JournalLine.findAll({ where: { journalEntryId: je.id } }) : [];
    const inv1200 = lines.find((l) => l.accountCode === "1200");
    check(inv1200 && approx(inv1200.debit, 1275), "GL inventory(1200) debit = 1275 (server value, forged cost ignored)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("asset events", () => AssetEvent.destroy({ where: {}, force: true }).catch(() => {}));
    await safe("invoices", () => Invoice.destroy({ where: { companyId: CO }, force: true }));
    await safe("gold pool", () => CustomerGoldPool && CustomerGoldPool.destroy({ where: { companyId: CO } }).catch(() => {}));
    await safe("assets", () => Asset.destroy({ where: { companyId: CO }, force: true }));
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
