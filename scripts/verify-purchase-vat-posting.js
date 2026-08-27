/**
 * Purchase VAT / RCM posting — Phase 12G verify.
 *
 * Drives postPurchaseEntry directly (like the 12B sales verify) across the four
 * cases, asserting the resulting JournalLines + validation:
 *   A No VAT      → Dr Inventory=total ; Cr Cash/AP=total (byte-identical to before)
 *   B Recoverable → Dr Inventory=taxBase ; Dr 1400=inputVat ; Cr Cash/AP=gross
 *   C Non-recover → Dr Inventory=gross ; no 1400 line
 *   D RCM         → Dr Inventory=taxBase ; Dr 1400=rcm ; Cr 2210=rcm ; Cr Cash/AP=taxBase
 * + that 1400/2210 are only created when used, AP/cash split is correct, RCM VAT
 *   never enters payable/cash, and bad snapshots are rejected before any write.
 *
 * WRITE/READ — fixtures under a throwaway company; cleanup deletes the company
 * LAST so FK cascade removes every row. No residue.
 *
 *   cd backend && node scripts/verify-purchase-vat-posting.js
 */
require("dotenv").config();
const models = require("../src/models");
const postingService = require("../src/services/posting.service");

const { sequelize, Company, Supplier, PurchaseOrder, JournalEntry, JournalLine, Account } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-PVATP-${stamp}`;
const SUP = `SUP-PVATP-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let poSeq = 0;
async function mkPO(fields) {
  return PurchaseOrder.create({
    id: `PO-PVATP-${stamp}-${++poSeq}`, companyId: CO, supplierId: SUP, supplierName: "مورد",
    status: "received", date: "2026-04-10", branch: "Main", ...fields,
  });
}
async function linesOf(jeId) {
  const rows = await JournalLine.findAll({ where: { journalEntryId: jeId } });
  // returns { [accountCode]: { debit, credit } } aggregated
  const map = {};
  for (const r of rows) {
    const code = r.accountCode;
    map[code] = map[code] || { debit: 0, credit: 0 };
    map[code].debit += Number(r.debit || 0);
    map[code].credit += Number(r.credit || 0);
  }
  return map;
}
const acctExists = async (code) => (await Account.findOne({ where: { companyId: CO, code } })) !== null;

(async () => {
  await sequelize.authenticate();
  try {
    await Company.create({ id: CO, businessName: "Verify PVATP Co", workspace: `verify-pvatp-${stamp}` });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد", phone: "+1", category: "general" });

    console.log("1) Case A — no VAT (defaults) → unchanged Dr Inventory=total / Cr AP=total:");
    const poA = await mkPO({ total: 1000 });
    const jeA = await postingService.postPurchaseEntry(poA.toJSON(), 0, "credit", "Verify");
    const lA = await linesOf(jeA.id);
    check(approx(lA["1200"].debit, 1000), "Dr Inventory(1200) = 1000");
    check(lA["2100"] && approx(lA["2100"].credit, 1000), "Cr AP(2100) = 1000 (unpaid)");
    check(!lA["1400"] && !lA["2210"], "no 1400 / 2210 lines");
    check(!(await acctExists("1400")) && !(await acctExists("2210")), "Case A creates no 1400/2210 accounts");

    console.log("\n2) Case B — recoverable input VAT (split, partial pay):");
    const poB = await mkPO({ total: 1050, taxBase: 1000, vatRate: 5, inputVatAmount: 50, isRecoverable: true, isRcm: false });
    const jeB = await postingService.postPurchaseEntry(poB.toJSON(), 600, "Cash", "Verify");
    const lB = await linesOf(jeB.id);
    check(approx(lB["1200"].debit, 1000), "Dr Inventory(1200) = taxBase 1000 (NOT 1050)");
    check(approx(lB["1400"].debit, 50), "Dr Input VAT(1400) = 50");
    check(approx(lB["1110"].credit, 600), "Cr Cash(1110) = paid 600");
    check(approx(lB["2100"].credit, 450), "Cr AP(2100) = 1050 - 600 = 450");
    check(!lB["2210"], "no 2210 (not RCM)");
    check(await acctExists("1400"), "1400 account created because used");

    console.log("\n3) Case C — non-recoverable VAT → gross into inventory, no 1400:");
    const poC = await mkPO({ total: 1050, taxBase: 1000, vatRate: 5, inputVatAmount: 50, isRecoverable: false, isRcm: false });
    const jeC = await postingService.postPurchaseEntry(poC.toJSON(), 0, "credit", "Verify");
    const lC = await linesOf(jeC.id);
    check(approx(lC["1200"].debit, 1050), "Dr Inventory(1200) = gross 1050 (VAT capitalised)");
    check(approx(lC["2100"].credit, 1050), "Cr AP(2100) = 1050");
    check(!lC["1400"], "no 1400 line for non-recoverable VAT");

    console.log("\n4) Case D — RCM (net-zero, supplier paid only taxBase):");
    const poD = await mkPO({ total: 1000, taxBase: 1000, vatRate: 5, isRcm: true, rcmVatAmount: 50, rcmRate: 5 });
    const jeD = await postingService.postPurchaseEntry(poD.toJSON(), 400, "Cash", "Verify");
    const lD = await linesOf(jeD.id);
    check(approx(lD["1200"].debit, 1000), "Dr Inventory(1200) = taxBase 1000");
    check(approx(lD["1400"].debit, 50), "Dr Input VAT(1400) = 50");
    check(approx(lD["2210"].credit, 50), "Cr RCM Output VAT(2210) = 50");
    check(approx(lD["1110"].credit, 400), "Cr Cash(1110) = paid 400");
    check(approx(lD["2100"].credit, 600), "Cr AP(2100) = taxBase 1000 - 400 = 600 (RCM VAT NOT in payable)");
    const drD = Number(lD["1200"].debit) + Number(lD["1400"].debit);
    const crD = Number(lD["2210"].credit) + Number(lD["1110"].credit) + Number(lD["2100"].credit);
    check(approx(drD, crD), "Case D balances (Dr taxBase+rcm == Cr rcm+cash+AP)");
    check(await acctExists("2210"), "2210 account created because used");

    console.log("\n5) settings-driven account codes are honoured:");
    const poB2 = await mkPO({ total: 1050, taxBase: 1000, vatRate: 5, inputVatAmount: 50, isRecoverable: true });
    const jeB2 = await postingService.postPurchaseEntry(poB2.toJSON(), 0, "credit", "Verify", { inputVatAccountCode: "1110" });
    const lB2 = await linesOf(jeB2.id);
    check(approx(lB2["1110"].debit, 50), "input VAT posted to opts.inputVatAccountCode override (1110) = 50");

    console.log("\n6) validation rejects bad snapshots BEFORE any write:");
    const jeCountBefore = await JournalEntry.count({ where: { companyId: CO } });
    const rej = async (fields, paid, label) => {
      const po = await mkPO(fields);
      let threw = false;
      try { await postingService.postPurchaseEntry(po.toJSON(), paid || 0, "credit", "Verify"); } catch { threw = true; }
      check(threw, label);
    };
    await rej({ total: 1050, taxBase: 1000, inputVatAmount: 40, isRecoverable: true }, 0, "recoverable: taxBase+inputVat != total → reject");
    await rej({ total: 50, taxBase: 0, inputVatAmount: 50, isRecoverable: true }, 0, "recoverable: taxBase <= 0 → reject");
    await rej({ total: 1000, taxBase: -10, isRecoverable: true }, 0, "negative taxBase → reject");
    await rej({ total: 1000, taxBase: 1000, vatRate: 150 }, 0, "vatRate > 100 → reject");
    await rej({ total: 1000, taxBase: 1000, isRcm: true, rcmVatAmount: 50, inputVatAmount: 10 }, 0, "RCM with ordinary inputVat > 0 → reject");
    await rej({ total: 1000, taxBase: 1000, isRcm: true, rcmVatAmount: 0 }, 0, "RCM with rcmVatAmount <= 0 → reject");
    await rej({ total: 1050, taxBase: 1000, isRcm: true, rcmVatAmount: 50 }, 0, "RCM where total != taxBase → reject");
    await rej({ total: 1000, taxBase: 1000, isRcm: true, rcmVatAmount: 50 }, 1200, "RCM paidAmount > taxBase → reject");
    check((await JournalEntry.count({ where: { companyId: CO } })) === jeCountBefore, "no JournalEntry created by any rejected attempt (validation before write)");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("journal entries (+lines cascade)", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascade remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all rows removed; no residue");
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
