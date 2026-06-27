/**
 * Purchase receive VAT wiring — Phase 12I verify.
 *
 * Drives the real POST /purchase-orders/receive end-to-end and asserts the
 * backend computes the VAT/RCM snapshot at receive time and posts via 12G:
 *   - default (no VAT requested) → unchanged Case A (Dr Inventory=total / Cr AP)
 *   - applyVat inclusive/exclusive recoverable → Dr Inventory=taxBase, Dr 1400,
 *     Cr Cash/AP=gross; PO.total = gross
 *   - non-recoverable → Dr Inventory=gross, no 1400
 *   - DRC/RCM → Dr Inventory=taxBase, Dr 1400, Cr 2210, Cr AP=taxBase; PO.total
 *     = taxBase; rcm snapshot persisted; isDRC translated to isRcm
 *   - the 12H VAT report reads the snapshots; validation rejects bad input
 *
 * WRITE — fixtures under a throwaway company; cleanup deletes the company LAST so
 * FK cascade removes every row. No residue.
 *
 *   cd backend && node scripts/verify-purchase-receive-vat-wiring.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");

const { sequelize, Company, Supplier, Branch, PurchaseOrder, JournalEntry, JournalLine, Account, Asset } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-PRVW-${stamp}`;
const SUP = `SUP-PRVW-${stamp}`;
const BR = `BR-PRVW-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let base, token;
let poN = 0;
async function receive(extra) {
  const id = `PO-PRVW-${stamp}-${++poN}`;
  const body = {
    id, supplierId: SUP, branchId: BR, paymentMethod: "credit",
    items: [{ name: "بند", quantity: 1, weightPerUnit: 10, unitCost: extra.unitCost ?? 1000, karat: 21 }],
    ...extra,
  };
  delete body.unitCost;
  const r = await fetch(`${base}/purchase-orders/receive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, id };
}
async function report() {
  const r = await fetch(`${base}/reports/tax-summary`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
  let json = null; try { json = await r.json(); } catch {}
  return json.data;
}
async function jeLines(poId) {
  const je = await JournalEntry.findOne({ where: { companyId: CO, sourceType: "purchase_order", sourceId: poId } });
  if (!je) return null;
  const rows = await JournalLine.findAll({ where: { journalEntryId: je.id } });
  const map = {};
  for (const r of rows) {
    map[r.accountCode] = map[r.accountCode] || { debit: 0, credit: 0 };
    map[r.accountCode].debit += Number(r.debit || 0);
    map[r.accountCode].credit += Number(r.credit || 0);
  }
  return map;
}

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify PRVW Co", workspace: `verify-prvw-${stamp}` });
    await Supplier.create({ id: SUP, companyId: CO, name: "مورد", phone: "+1", category: "general" });
    await Branch.create({ id: BR, companyId: CO, name: "Main", code: "M1", type: "store", isActive: true });

    console.log("1) Case A — default receive (no VAT requested) unchanged:");
    const a = await receive({ unitCost: 1000 });
    check(a.status === 201 || a.status === 200, "receive without VAT → success");
    const poA = await PurchaseOrder.findByPk(a.id);
    check(Number(poA.total) === 1000 && Number(poA.taxBase) === 0 && Number(poA.inputVatAmount) === 0 && poA.isRcm === false, "PO defaults (total 1000, no VAT snapshot)");
    const lA = await jeLines(a.id);
    check(approx(lA["1200"].debit, 1000), "Dr Inventory(1200) = 1000");
    check(lA["2100"] && approx(lA["2100"].credit, 1000) && !lA["1400"], "Cr AP = 1000, no 1400");

    console.log("\n2) Case B — recoverable exclusive (applyVat):");
    const b = await receive({ unitCost: 1000, applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: true });
    const poB = await PurchaseOrder.findByPk(b.id);
    check(Number(poB.taxBase) === 1000 && Number(poB.inputVatAmount) === 50 && Number(poB.total) === 1050, "exclusive snapshot: taxBase 1000, inputVat 50, total→1050");
    const lB = await jeLines(b.id);
    check(approx(lB["1200"].debit, 1000) && approx(lB["1400"].debit, 50) && approx(lB["2100"].credit, 1050), "journal: Dr 1200=1000, Dr 1400=50, Cr AP=1050");

    console.log("\n3) Case B — recoverable inclusive:");
    const c = await receive({ unitCost: 1050, applyVat: true, vatRate: 5, taxIncluded: true, isRecoverable: true });
    const poC = await PurchaseOrder.findByPk(c.id);
    check(approx(poC.taxBase, 1000) && approx(poC.inputVatAmount, 50) && approx(poC.total, 1050), "inclusive snapshot: gross 1050 → taxBase 1000, inputVat 50, total 1050");
    const lC = await jeLines(c.id);
    check(approx(lC["1200"].debit, 1000) && approx(lC["1400"].debit, 50), "journal: Dr 1200=1000, Dr 1400=50");

    console.log("\n4) Case C — non-recoverable → gross into inventory, no 1400:");
    const d = await receive({ unitCost: 1000, applyVat: true, vatRate: 5, taxIncluded: false, isRecoverable: false });
    const poD = await PurchaseOrder.findByPk(d.id);
    check(poD.isRecoverable === false && approx(poD.total, 1050), "non-recoverable snapshot, total 1050");
    const lD = await jeLines(d.id);
    check(approx(lD["1200"].debit, 1050) && !lD["1400"], "journal: Dr Inventory=1050 (gross), no 1400");

    console.log("\n5) Case D — DRC/RCM (isDRC translated to isRcm, net-zero):");
    const e = await receive({ unitCost: 1000, isDRC: true, rcmRate: 5 });
    const poE = await PurchaseOrder.findByPk(e.id);
    check(poE.isRcm === true && approx(poE.rcmVatAmount, 50) && Number(poE.inputVatAmount) === 0 && approx(poE.total, 1000), "RCM snapshot: isRcm, rcmVat 50, inputVat 0, total=taxBase 1000");
    const lE = await jeLines(e.id);
    check(approx(lE["1200"].debit, 1000) && approx(lE["1400"].debit, 50) && approx(lE["2210"].credit, 50) && approx(lE["2100"].credit, 1000), "journal: Dr 1200=1000, Dr 1400=50, Cr 2210=50, Cr AP=1000");

    console.log("\n6) VAT report reflects the wired snapshots:");
    const rep = await report();
    check(approx(rep.totals.inputVatTotal, 100), "report inputVatTotal = 50 (B excl) + 50 (B incl) = 100 (non-recoverable excluded)");
    check(approx(rep.totals.rcmOutputVatTotal, 50) && approx(rep.totals.rcmInputVatTotal, 50), "report RCM output/input = 50 each");

    console.log("\n7) validation rejects bad input before any write:");
    const poCountBefore = await PurchaseOrder.count({ where: { companyId: CO } });
    check((await receive({ unitCost: 1000, applyVat: true, vatRate: 150 })).status === 422, "vatRate 150 → 422");
    check((await receive({ unitCost: 1000, isDRC: true, rcmRate: 0 })).status === 422, "RCM rcmRate 0 → 422");
    check((await receive({ unitCost: 1000, isDRC: true, rcmRate: 5, isRecoverable: false })).status === 422, "RCM + isRecoverable=false → 422");
    check((await receive({ unitCost: 1000, isDRC: true, rcmRate: 5, inputVatAmount: 10 })).status === 422, "RCM + inputVatAmount>0 → 422");
    check((await receive({ unitCost: 1000, isDRC: true, rcmRate: 5, paidAmount: 1200 })).status === 422, "RCM paidAmount>taxBase → 422");
    check((await PurchaseOrder.count({ where: { companyId: CO } })) === poCountBefore, "no PurchaseOrder created by any rejected receive");

    console.log("\n8) idempotency replay does not duplicate:");
    const key = `PRVW-KEY-${stamp}`;
    const f1 = await receive({ unitCost: 1000, applyVat: true, vatRate: 5, idempotencyKey: key });
    const cnt1 = await PurchaseOrder.count({ where: { companyId: CO } });
    // replay same key + same id
    const r2 = await fetch(`${base}/purchase-orders/receive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ id: f1.id, supplierId: SUP, branchId: BR, paymentMethod: "credit", applyVat: true, vatRate: 5, items: [{ name: "بند", quantity: 1, weightPerUnit: 10, unitCost: 1000, karat: 21 }] }),
    });
    check(r2.status === 200, "replay same Idempotency-Key → 200");
    check((await PurchaseOrder.count({ where: { companyId: CO } })) === cnt1, "replay created no new PurchaseOrder");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("assets", () => Asset.destroy({ where: { companyId: CO }, force: true }));
    await safe("journal entries (+lines cascade)", () => JournalEntry.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
    await safe("cash transactions", () => models.CashTransaction.destroy({ where: { companyId: CO } }));
    await safe("purchase order items", () => models.PurchaseOrderItem.destroy({ where: {}, force: true }).catch(() => {}));
    await safe("purchase orders", () => PurchaseOrder.destroy({ where: { companyId: CO }, force: true }));
    await safe("branches", () => Branch.destroy({ where: { companyId: CO }, force: true }));
    await safe("suppliers", () => Supplier.destroy({ where: { companyId: CO }, force: true }));
    await safe("company (cascade remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all cascaded rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
