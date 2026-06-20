/**
 * P5.2 verification — sales/return posting split by karat (behind the flag).
 *
 * Part A (rolled back): postInvoiceEntry/postReturnEntry with the flag forced
 *   off (single accounts, unchanged) and on (per-karat split, exact sums,
 *   balanced), incl. a rounding case.
 * Part B (HTTP, committed then fully reversed): with accountingByKarat=true in
 *   settings, a real POS checkout and a posted draft produce per-karat sub-account
 *   journal lines.
 *
 * Run: node scripts/verify-karat-posting.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const {
  sequelize, JournalLine, JournalEntry, Setting, Customer, Asset, Invoice, InvoiceItem,
  Payment, CashTransaction, AssetEvent, Account, LoyaltyTransaction,
} = models;
const postingService = require("../src/services/posting.service");

const COMPANY = "CMP-DEMO";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }
const SUBS = ["1210", "1211", "1212", "1213", "1219", "5010", "5011", "5012", "5013", "5019", "4110", "4111", "4112", "4113", "4119"];
const sum = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0) * 100) / 100;

async function linesOf(entry, t) {
  return (await JournalLine.findAll({ where: { journalEntryId: entry.id }, transaction: t })).map((l) => ({ code: l.accountCode, debit: Number(l.debit), credit: Number(l.credit) }));
}
const balanced = (ls) => Math.abs(sum(ls, (l) => l.debit) - sum(ls, (l) => l.credit)) < 0.01;

(async () => {
  await sequelize.authenticate();

  // ---- Part A: unit-level via opts override ----
  console.log("Part A — postInvoiceEntry/postReturnEntry [rolled back]:");
  let t = await sequelize.transaction();
  try {
    const inv = { companyId: COMPANY, id: "INV-KPT", total: 1955, tax: 255, subtotal: 1700, paymentMethod: "cash", status: "paid", date: "2026-06-20", branchId: "BR-WH" };
    const items = [
      { cost: 400, quantity: 1, karat: 21, price: 600 },
      { cost: 300, quantity: 1, karat: 18, price: 500 },
      { cost: 200, quantity: 1, karat: 24, price: 400 },
      { cost: 100, quantity: 1, karat: null, price: 200 },
    ];

    // flag OFF
    const off = await linesOf(await postingService.postInvoiceEntry(inv, items, "P", { transaction: t, accountingByKarat: false }), t);
    check(off.some((l) => l.code === "4100") && off.some((l) => l.code === "5000") && off.some((l) => l.code === "1200"), "flag OFF sale uses 4100/5000/1200");
    check(off.every((l) => !SUBS.includes(l.code)), "flag OFF sale uses NO sub-accounts");
    check(balanced(off), "flag OFF sale balanced");

    // flag ON — sale
    const on = await linesOf(await postingService.postInvoiceEntry(inv, items, "P", { transaction: t, accountingByKarat: true }), t);
    for (const c of ["4111", "4110", "4113", "4119"]) check(on.some((l) => l.code === c && l.credit > 0), `ON sale revenue in ${c}`);
    for (const c of ["5011", "5010", "5013", "5019"]) check(on.some((l) => l.code === c && l.debit > 0), `ON sale COGS in ${c}`);
    for (const c of ["1211", "1210", "1213", "1219"]) check(on.some((l) => l.code === c && l.credit > 0), `ON sale inventory in ${c}`);
    check(on.some((l) => l.code === "2200" && l.credit === 255), "ON sale VAT unchanged (2200=255)");
    check(on.some((l) => l.code === "1110" && l.debit === 1955), "ON sale cash/debit unchanged (1110=1955)");
    check(on.every((l) => l.code !== "4100" && l.code !== "5000" && l.code !== "1200"), "ON sale does NOT use the single accounts");
    check(sum(on.filter((l) => l.code.startsWith("411")), (l) => l.credit) === 1700, "ON revenue sub-lines sum == subtotal (1700)");
    check(sum(on.filter((l) => l.code.startsWith("501")), (l) => l.debit) === 1000, "ON COGS sub-lines sum == total cost (1000)");
    check(balanced(on), "ON sale balanced");

    // flag ON — return
    const ret = await linesOf(await postingService.postReturnEntry(inv, items, "P", { transaction: t, accountingByKarat: true }), t);
    check(ret.some((l) => l.code === "4111" && l.debit > 0), "ON return reverses revenue per karat (Dr 4111)");
    check(ret.some((l) => l.code === "5011" && l.credit > 0), "ON return reverses COGS per karat (Cr 5011)");
    check(ret.some((l) => l.code === "1211" && l.debit > 0), "ON return inventory per karat (Dr 1211)");
    check(ret.some((l) => l.code === "2200" && l.debit === 255), "ON return VAT reversal unchanged");
    check(balanced(ret), "ON return balanced");

    // rounding: 3 equal-basis groups, subtotal 1000 → 333.33/333.33/333.34
    const rItems = [{ cost: 0, quantity: 1, karat: 18, price: 1 }, { cost: 0, quantity: 1, karat: 21, price: 1 }, { cost: 0, quantity: 1, karat: 22, price: 1 }];
    const rInv = { companyId: COMPANY, id: "INV-KPT-R", total: 1000, tax: 0, subtotal: 1000, paymentMethod: "cash", status: "paid", date: "2026-06-20", branchId: "BR-WH" };
    const rl = await linesOf(await postingService.postInvoiceEntry(rInv, rItems, "P", { transaction: t, accountingByKarat: true }), t);
    const revs = rl.filter((l) => l.code.startsWith("411"));
    check(sum(revs, (l) => l.credit) === 1000, "rounding: revenue sub-lines sum EXACTLY to 1000");
    check(revs.some((l) => l.credit === 333.34), "rounding: last karat bucket absorbed the remainder (333.34)");
    check(balanced(rl), "rounding entry balanced");
  } finally { await t.rollback(); }

  // ---- Part B: HTTP integration with the real setting ----
  console.log("\nPart B — HTTP checkout + post-draft with accountingByKarat=true [reversed]:");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  const api = async (m, p, b, k) => {
    const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Company-ID": COMPANY, "X-Branch-ID": "BR-WH" };
    if (k) h["Idempotency-Key"] = k;
    const res = await fetch(`${base}${p}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
    let j = null; try { j = await res.json(); } catch {}
    return { status: res.status, json: j };
  };
  const ts = Date.now();
  const CUST = `CUS-PROBE-${ts}`, A1 = `AST-PROBE-${ts}-1`, A2 = `AST-PROBE-${ts}-2`;
  const cleanupInv = [];
  const accSnap = new Map((await Account.findAll({ where: { companyId: COMPANY } })).map((a) => [a.id, a.balance]));
  await Customer.create({ id: CUST, companyId: COMPANY, name: "KP", phone: `7${ts}`.slice(-10), balance: 0, purchases: 0 });
  await Asset.create({ id: A1, companyId: COMPANY, name: A1, type: "gold-piece", status: "available", category: "P", grossWeight: 3, netWeight: 3, price: 1000, cost: 700, karat: 21, branch: "المستودع الرئيسي", branchId: "BR-WH", location: "P", barcode: `KB1-${ts}` });
  await Asset.create({ id: A2, companyId: COMPANY, name: A2, type: "gold-piece", status: "available", category: "P", grossWeight: 3, netWeight: 3, price: 1000, cost: 700, karat: 18, branch: "المستودع الرئيسي", branchId: "BR-WH", location: "P", barcode: `KB2-${ts}` });
  const [flagRow] = await Setting.findOrCreate({ where: { companyId: COMPANY, key: "accountingByKarat" }, defaults: { companyId: COMPANY, key: "accountingByKarat", value: true } });
  await flagRow.update({ value: true });
  try {
    const co = await api("POST", "/pos/checkout", { customerId: CUST, branchId: "BR-WH", paymentMethod: "cash", items: [{ assetId: A1, name: A1, price: 1000, cost: 700, totalWeight: 3, quantity: 1, karat: 21 }] }, "KCO");
    cleanupInv.push(co.json.id);
    const coJe = await JournalEntry.findOne({ where: { companyId: COMPANY, sourceId: co.json.id } });
    const coLines = (await JournalLine.findAll({ where: { journalEntryId: coJe.id } })).map((l) => l.accountCode);
    check(coLines.includes("4111") && coLines.includes("5011") && coLines.includes("1211"), "POS checkout (flag ON) posts 21K sub-accounts (4111/5011/1211)");
    check(!coLines.includes("4100") && !coLines.includes("5000") && !coLines.includes("1200"), "POS checkout (flag ON) does NOT use single accounts");

    const d = await api("POST", "/sales/invoices/drafts", { customerId: CUST, branchId: "BR-WH", paymentMethod: "cash", items: [{ assetId: A2, name: A2, price: 1000, cost: 700, karat: 18 }] });
    cleanupInv.push(d.json.id);
    await api("POST", `/sales/invoices/${d.json.id}/post`, {}, "KPD");
    const pdJe = await JournalEntry.findOne({ where: { companyId: COMPANY, sourceId: d.json.id } });
    const pdLines = (await JournalLine.findAll({ where: { journalEntryId: pdJe.id } })).map((l) => l.accountCode);
    check(pdLines.includes("4110") && pdLines.includes("5010") && pdLines.includes("1210"), "post-draft (flag ON) posts 18K sub-accounts (4110/5010/1210)");
  } finally {
    for (const id of cleanupInv) {
      if (!id) continue;
      const jes = await JournalEntry.findAll({ where: { companyId: COMPANY, sourceId: id } });
      for (const je of jes) await JournalLine.destroy({ where: { journalEntryId: je.id } });
      await JournalEntry.destroy({ where: { companyId: COMPANY, sourceId: id } });
      await CashTransaction.destroy({ where: { companyId: COMPANY, reference: id } });
      await Payment.destroy({ where: { invoiceId: id } });
      await InvoiceItem.destroy({ where: { invoiceId: id } });
      await Invoice.destroy({ where: { id }, force: true });
    }
    for (const id of [A1, A2]) await AssetEvent.destroy({ where: { assetId: id } });
    await LoyaltyTransaction.destroy({ where: { customerId: CUST } }).catch(() => {});
    for (const [id, bal] of accSnap) await Account.update({ balance: bal }, { where: { id } });
    // Delete sub-account rows that this run auto-created (not in the pre-run
    // snapshot) so the chart returns to its flag-off state.
    await Account.destroy({ where: { companyId: COMPANY, code: SUBS, id: { [require("sequelize").Op.notIn]: [...accSnap.keys()] } } });
    for (const id of [A1, A2]) await Asset.destroy({ where: { id }, force: true }).catch(() => {});
    await Customer.destroy({ where: { id: CUST }, force: true }).catch(() => {});
    await Setting.destroy({ where: { companyId: COMPANY, key: "accountingByKarat" } }); // restore default (false)
    server.close();
  }

  console.log(`\nRESULT: all ${passed} checks passed. (Part A rolled back; Part B reversed + flag restored to default)`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
