/**
 * P5.1 verification — accounting-by-karat mapping FOUNDATION.
 *
 * Part A (pure): CHART has the per-karat sub-accounts under the right parents,
 *   karatAccounts() maps correctly, and accountingByKarat defaults to false.
 * Part B (DB, rolled back): postInvoiceEntry / postReturnEntry / postPurchaseEntry
 *   STILL use the single accounts (1200/5000/4100) and NEVER the new sub-accounts
 *   — proving the foundation changed no posting behaviour.
 *
 * Run: node scripts/verify-karat-accounts.js
 */
require("dotenv").config();
const { sequelize, JournalLine } = require("../src/models");
const postingService = require("../src/services/posting.service");
const settingsService = require("../src/services/settings.service");
const { CHART, karatAccounts } = postingService;

let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

const SUB_ACCOUNTS = ["1210", "1211", "1212", "1213", "1219", "5010", "5011", "5012", "5013", "5019", "4110", "4111", "4112", "4113", "4119"];

(async () => {
  // ---- Part A: CHART + helper + flag default (pure) ----
  console.log("Part A — CHART, helper, flag default:");
  for (const c of ["1210", "1211", "1212", "1213", "1219"]) check(CHART[c] && CHART[c].parent === "1200", `CHART has inventory ${c} under 1200`);
  for (const c of ["5010", "5011", "5012", "5013", "5019"]) check(CHART[c] && CHART[c].parent === "5000", `CHART has COGS ${c} under 5000`);
  for (const c of ["4110", "4111", "4112", "4113", "4119"]) check(CHART[c] && CHART[c].parent === "4100", `CHART has revenue ${c} under 4100`);
  // type/nature inherit from parent family
  check(CHART["1210"].type === "asset" && CHART["1210"].nature === "debit", "inventory subs are asset/debit");
  check(CHART["5010"].type === "expense" && CHART["5010"].nature === "debit", "COGS subs are expense/debit");
  check(CHART["4110"].type === "revenue" && CHART["4110"].nature === "credit", "revenue subs are revenue/credit");

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(eq(karatAccounts(18), { inventory: "1210", cogs: "5010", revenue: "4110" }), "karatAccounts(18) → 1210/5010/4110");
  check(eq(karatAccounts(21), { inventory: "1211", cogs: "5011", revenue: "4111" }), "karatAccounts(21) → 1211/5011/4111");
  check(eq(karatAccounts(22), { inventory: "1212", cogs: "5012", revenue: "4112" }), "karatAccounts(22) → 1212/5012/4112");
  check(eq(karatAccounts(24), { inventory: "1213", cogs: "5013", revenue: "4113" }), "karatAccounts(24) → 1213/5013/4113");
  check(eq(karatAccounts(null), { inventory: "1219", cogs: "5019", revenue: "4119" }), "karatAccounts(null) → Other (1219/5019/4119)");
  check(eq(karatAccounts(999), { inventory: "1219", cogs: "5019", revenue: "4119" }), "karatAccounts(999) → Other");
  check(eq(karatAccounts("21"), { inventory: "1211", cogs: "5011", revenue: "4111" }), "karatAccounts('21') string also maps");

  check(settingsService.DEFAULTS.accountingByKarat === false, "accountingByKarat DEFAULT is false");
  const s = await settingsService.getCompanySettings("CMP-DEMO");
  check(s.accountingByKarat === false, "getCompanySettings returns accountingByKarat=false (not enabled)");

  // ---- Part B: posting still uses the single accounts [rolled back] ----
  await sequelize.authenticate();
  console.log("\nPart B — posting unchanged (no sub-accounts used) [rolled back]:");
  const codesOf = async (entry, t) => (await JournalLine.findAll({ where: { journalEntryId: entry.id }, transaction: t })).map((l) => l.accountCode);
  const usesNoSub = (codes) => codes.every((c) => !SUB_ACCOUNTS.includes(c));

  let t = await sequelize.transaction();
  try {
    const inv = { companyId: "CMP-DEMO", id: "INV-KARATTEST", total: 1150, tax: 150, subtotal: 1000, paymentMethod: "cash", status: "paid", date: "2026-06-20", branchId: "BR-WH" };
    const items = [{ cost: 400, quantity: 1, karat: 21 }, { cost: 300, quantity: 1, karat: 18 }];
    const saleEntry = await postingService.postInvoiceEntry(inv, items, "Probe", { transaction: t });
    const saleCodes = await codesOf(saleEntry, t);
    check(saleCodes.includes("4100") && saleCodes.includes("5000") && saleCodes.includes("1200"), "sale entry uses 4100/5000/1200 (single accounts)");
    check(usesNoSub(saleCodes), "sale entry uses NO per-karat sub-accounts (flag-off behaviour)");

    const retEntry = await postingService.postReturnEntry(inv, items, "Probe", { transaction: t });
    const retCodes = await codesOf(retEntry, t);
    check(retCodes.includes("4100") && retCodes.includes("5000") && retCodes.includes("1200") && usesNoSub(retCodes), "return entry unchanged (1200/5000/4100, no subs)");

    const po = { companyId: "CMP-DEMO", id: "PO-KARATTEST", total: 700, supplierName: "Probe", branchId: "BR-WH", date: "2026-06-20" };
    const poEntry = await postingService.postPurchaseEntry(po, 0, "credit", "Probe", { transaction: t });
    const poCodes = await codesOf(poEntry, t);
    check(poCodes.includes("1200") && usesNoSub(poCodes), "purchase entry unchanged (debits 1200, no subs)");
  } finally { await t.rollback(); }

  console.log(`\nRESULT: all ${passed} checks passed. (nothing committed)`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
