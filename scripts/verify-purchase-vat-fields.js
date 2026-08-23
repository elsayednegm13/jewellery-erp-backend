/**
 * Purchase VAT / RCM header fields — Phase 12F verify.
 *
 * Confirms the additive migration + PurchaseOrder model fields exist and behave
 * as a forward-only foundation: new columns are present, default safely (no VAT,
 * recoverable, not RCM), persist when set, and that NOTHING financial changed —
 * PurchaseOrderItem has no VAT fields, and creating a PurchaseOrder triggers no
 * posting (no 1400/2210 account rows). Posting/receive/report behaviour is
 * proven unchanged by the separate regression scripts.
 *
 * WRITE/READ — fixtures under a throwaway company; cleanup deletes the company
 * LAST so FK cascade removes every row. No residue.
 *
 *   cd backend && node scripts/verify-purchase-vat-fields.js
 */
require("dotenv").config();
const models = require("../src/models");

const { sequelize, Company, Supplier, PurchaseOrder, PurchaseOrderItem, Account } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-POVAT-${stamp}`;
const SUP = `SUP-POVAT-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

const NEW_COLS = ["tax_base", "vat_rate", "input_vat_amount", "tax_included", "is_recoverable", "is_rcm", "rcm_vat_amount", "rcm_rate"];
const NEW_ATTRS = ["taxBase", "vatRate", "inputVatAmount", "taxIncluded", "isRecoverable", "isRcm", "rcmVatAmount", "rcmRate"];

(async () => {
  await sequelize.authenticate();

  try {
    console.log("1) migration columns exist on purchase_orders:");
    const desc = await sequelize.getQueryInterface().describeTable("purchase_orders");
    for (const c of NEW_COLS) check(Boolean(desc[c]), `column ${c} exists in DB`);

    console.log("\n2) PurchaseOrder model exposes the new attributes:");
    for (const a of NEW_ATTRS) check(a in PurchaseOrder.rawAttributes, `model attribute ${a} defined`);

    console.log("\n3) PurchaseOrderItem is unchanged (no VAT fields):");
    for (const a of NEW_ATTRS) check(!(a in PurchaseOrderItem.rawAttributes), `PurchaseOrderItem has NO ${a}`);

    await Company.create({ id: CO, businessName: "Verify POVAT Co", workspace: `verify-povat-${stamp}` });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد", phone: "+1", category: "general" });

    console.log("\n4) create without VAT fields → safe defaults:");
    const po1 = await PurchaseOrder.create({
      id: `PO-POVAT-${stamp}-1`, companyId: CO, supplierId: SUP, supplierName: "مورد",
      status: "draft", date: "2026-04-10", total: 1000, branch: "Main",
    });
    const r1 = await PurchaseOrder.findByPk(po1.id);
    check(Number(r1.taxBase) === 0, "default taxBase = 0");
    check(Number(r1.vatRate) === 0, "default vatRate = 0");
    check(Number(r1.inputVatAmount) === 0, "default inputVatAmount = 0");
    check(r1.taxIncluded === false, "default taxIncluded = false");
    check(r1.isRecoverable === true, "default isRecoverable = true");
    check(r1.isRcm === false, "default isRcm = false");
    check(Number(r1.rcmVatAmount) === 0, "default rcmVatAmount = 0");
    check(Number(r1.rcmRate) === 0, "default rcmRate = 0");
    check(Number(r1.total) === 1000, "existing total field unaffected (1000)");

    console.log("\n5) create with VAT values → persisted & read back:");
    const po2 = await PurchaseOrder.create({
      id: `PO-POVAT-${stamp}-2`, companyId: CO, supplierId: SUP, supplierName: "مورد",
      status: "draft", date: "2026-04-11", total: 1050, branch: "Main",
      taxBase: 1000, vatRate: 5, inputVatAmount: 50, taxIncluded: true, isRecoverable: true,
      isRcm: false, rcmVatAmount: 0, rcmRate: 0,
    });
    const r2 = await PurchaseOrder.findByPk(po2.id);
    check(Number(r2.taxBase) === 1000 && Number(r2.vatRate) === 5 && Number(r2.inputVatAmount) === 50, "input VAT values persisted (base 1000, rate 5, vat 50)");
    check(r2.taxIncluded === true, "taxIncluded = true persisted");

    console.log("\n6) RCM values persist + update works:");
    const po3 = await PurchaseOrder.create({
      id: `PO-POVAT-${stamp}-3`, companyId: CO, supplierId: SUP, supplierName: "مورد",
      status: "draft", date: "2026-04-12", total: 2000, branch: "Main",
      taxBase: 2000, vatRate: 5, isRcm: true, rcmVatAmount: 100, rcmRate: 5,
    });
    const r3 = await PurchaseOrder.findByPk(po3.id);
    check(r3.isRcm === true && Number(r3.rcmVatAmount) === 100 && Number(r3.rcmRate) === 5, "RCM values persisted (isRcm, rcmVatAmount 100, rcmRate 5)");
    await r3.update({ inputVatAmount: 75, isRecoverable: false });
    const r3b = await PurchaseOrder.findByPk(po3.id);
    check(Number(r3b.inputVatAmount) === 75 && r3b.isRecoverable === false, "model-level update of VAT fields works");

    console.log("\n7) foundation is inert — no posting / no GL rows from PO creation:");
    check((await Account.findOne({ where: { companyId: CO, code: "1400" } })) === null, "no 1400 Account row created by purchase-order creation");
    check((await Account.findOne({ where: { companyId: CO, code: "2210" } })) === null, "no 2210 Account row created by purchase-order creation");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
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
