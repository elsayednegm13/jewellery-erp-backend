/**
 * P5.3 verification — purchase receive posting split by karat (behind the flag).
 *
 * Part A (rolled back): postPurchaseEntry flag off (Dr 1200) and flag on (Dr per
 *   karat), plus credit/partial/cash credit-side variants and a rounding case.
 * Part B (HTTP, reversed): a real receive with accountingByKarat=true debits the
 *   per-karat inventory sub-accounts, and the product/asset link fix (710b372)
 *   + StockMovement still hold.
 *
 * Run: node scripts/verify-karat-purchase-posting.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const {
  sequelize, JournalLine, JournalEntry, Setting, Supplier, Product, Asset, AssetEvent,
  StockMovement, PurchaseOrder, PurchaseOrderItem, Account,
} = models;
const postingService = require("../src/services/posting.service");

const COMPANY = "CMP-DEMO";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }
const INV_SUBS = ["1210", "1211", "1212", "1213", "1219"];
const sum = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0) * 100) / 100;
async function linesOf(entry, t) {
  return (await JournalLine.findAll({ where: { journalEntryId: entry.id }, transaction: t })).map((l) => ({ code: l.accountCode, debit: Number(l.debit), credit: Number(l.credit) }));
}
const balanced = (ls) => Math.abs(sum(ls, (l) => l.debit) - sum(ls, (l) => l.credit)) < 0.01;
const po = (over) => ({ companyId: COMPANY, id: "PO-KPP", total: 1500, supplierName: "Probe", branchId: "BR-WH", date: "2026-06-20", ...over });
const mixedItems = [{ karat: 21, totalCost: 600 }, { karat: 18, totalCost: 400 }, { karat: 24, totalCost: 300 }, { karat: null, totalCost: 200 }];

(async () => {
  await sequelize.authenticate();
  console.log("Part A — postPurchaseEntry [rolled back]:");
  let t = await sequelize.transaction();
  try {
    // flag OFF
    const off = await linesOf(await postingService.postPurchaseEntry(po(), 0, "credit", "P", { transaction: t, accountingByKarat: false, items: mixedItems }), t);
    check(off.some((l) => l.code === "1200" && l.debit === 1500), "flag OFF debits 1200 = total");
    check(off.every((l) => !INV_SUBS.includes(l.code)), "flag OFF uses NO inventory sub-accounts");
    check(balanced(off), "flag OFF balanced");

    // flag ON — mixed karat, full credit
    const on = await linesOf(await postingService.postPurchaseEntry(po(), 0, "credit", "P", { transaction: t, accountingByKarat: true, items: mixedItems }), t);
    check(on.some((l) => l.code === "1211" && l.debit === 600), "ON debits 1211 (21K) = 600");
    check(on.some((l) => l.code === "1210" && l.debit === 400), "ON debits 1210 (18K) = 400");
    check(on.some((l) => l.code === "1213" && l.debit === 300), "ON debits 1213 (24K) = 300");
    check(on.some((l) => l.code === "1219" && l.debit === 200), "ON debits 1219 (Other/null) = 200");
    check(!on.some((l) => l.code === "1200"), "ON does NOT debit 1200 when items present");
    check(sum(on.filter((l) => INV_SUBS.includes(l.code)), (l) => l.debit) === 1500, "ON inventory sub-lines sum == PO total (1500)");
    check(on.some((l) => l.code === "2100" && l.credit === 1500), "ON full-credit → Cr 2100 = 1500 (unchanged)");
    check(balanced(on), "ON balanced");

    // ON, items MISSING → fallback to 1200
    const noItems = await linesOf(await postingService.postPurchaseEntry(po(), 0, "credit", "P", { transaction: t, accountingByKarat: true }), t);
    check(noItems.some((l) => l.code === "1200" && l.debit === 1500) && noItems.every((l) => !INV_SUBS.includes(l.code)), "ON but no items → safe fallback to 1200");

    // credit-side variants (flag ON)
    const partial = await linesOf(await postingService.postPurchaseEntry(po(), 500, "credit", "P", { transaction: t, accountingByKarat: true, items: mixedItems }), t);
    check(partial.some((l) => l.code === "1110" && l.credit === 500) && partial.some((l) => l.code === "2100" && l.credit === 1000), "partial → Cr 1110=500 + Cr 2100=1000");
    check(balanced(partial), "partial balanced");
    const cash = await linesOf(await postingService.postPurchaseEntry(po(), 1500, "cash", "P", { transaction: t, accountingByKarat: true, items: mixedItems }), t);
    check(cash.some((l) => l.code === "1110" && l.credit === 1500) && !cash.some((l) => l.code === "2100"), "cash full → Cr 1110=1500 only");
    check(balanced(cash), "cash balanced");

    // rounding (3 equal thirds of 1000)
    const rItems = [{ karat: 18, totalCost: 1000 / 3 }, { karat: 21, totalCost: 1000 / 3 }, { karat: 22, totalCost: 1000 / 3 }];
    const rl = await linesOf(await postingService.postPurchaseEntry(po({ id: "PO-KPP-R", total: 1000 }), 0, "credit", "P", { transaction: t, accountingByKarat: true, items: rItems }), t);
    const invs = rl.filter((l) => INV_SUBS.includes(l.code));
    check(sum(invs, (l) => l.debit) === 1000, "rounding: inventory sub-lines sum EXACTLY to 1000");
    check(invs.some((l) => l.debit === 333.34), "rounding: last bucket absorbed remainder (333.34)");
    check(balanced(rl), "rounding balanced");
  } finally { await t.rollback(); }

  // ---- Part B: HTTP receive with accountingByKarat=true ----
  console.log("\nPart B — HTTP receive (flag ON) → per-karat inventory + link fix intact [reversed]:");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });
  const api = async (m, p, b) => {
    const res = await fetch(`${base}${p}`, { method: m, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Company-ID": COMPANY, "X-Branch-ID": "BR-WH" }, body: b ? JSON.stringify(b) : undefined });
    let j = null; try { j = await res.json(); } catch {}
    return { status: res.status, json: j };
  };
  const ts = Date.now();
  const SUP = `SUP-PROBE-${ts}`, PRODCODE = `PROBE-PRD-${ts}`;
  const accSnap = new Map((await Account.findAll({ where: { companyId: COMPANY } })).map((a) => [a.id, a.balance]));
  await Supplier.create({ id: SUP, companyId: COMPANY, name: "Probe Sup", category: "Gold", phone: `4${ts}`.slice(-10), due: 0 });
  const [flag] = await Setting.findOrCreate({ where: { companyId: COMPANY, key: "accountingByKarat" }, defaults: { companyId: COMPANY, key: "accountingByKarat", value: true } });
  await flag.update({ value: true });
  let poId;
  try {
    const r = await api("POST", "/purchase-orders/receive", {
      supplierId: SUP, branchId: "BR-WH", paymentMethod: "credit", paidAmount: 0,
      items: [
        { name: "Ring21", type: "gold-piece", category: "R", karat: 21, weightPerUnit: 5, grossWeight: 5, netWeight: 5, unitCost: 1000, cost: 1000, price: 1320, quantity: 1, productCode: PRODCODE },
        { name: "Dia18", type: "gold-piece", category: "S", karat: 18, weightPerUnit: 2, grossWeight: 2, netWeight: 2, unitCost: 500, cost: 500, price: 660, quantity: 1 },
      ],
    });
    check(r.status === 201, "receive (flag ON) → 201");
    poId = r.json.data?.purchaseOrder?.id || r.json.purchaseOrder?.id;
    const je = await JournalEntry.findOne({ where: { companyId: COMPANY, sourceId: poId } });
    const codes = (await JournalLine.findAll({ where: { journalEntryId: je.id } })).map((l) => l.accountCode);
    check(codes.includes("1211") && codes.includes("1210"), "receive (flag ON) debits 1211 (21K product) + 1210 (18K asset)");
    check(!codes.includes("1200"), "receive (flag ON) does NOT debit 1200");
    // link-fix regression still holds
    const items = await PurchaseOrderItem.findAll({ where: { purchaseOrderId: poId } });
    const prodLine = items.find((i) => i.productId);
    const assetLine = items.find((i) => i.assetId);
    check(prodLine && !prodLine.assetId, "product line: productId set, assetId null (710b372 intact)");
    check(assetLine && !assetLine.productId, "asset line: assetId set, productId null (710b372 intact)");
    check(await StockMovement.count({ where: { companyId: COMPANY, referenceId: poId, type: "purchase_receive" } }) === 1, "StockMovement still created for the product");
  } finally {
    if (poId) {
      const jes = await JournalEntry.findAll({ where: { companyId: COMPANY, sourceId: poId } });
      for (const je of jes) await JournalLine.destroy({ where: { journalEntryId: je.id } });
      await JournalEntry.destroy({ where: { companyId: COMPANY, sourceId: poId } });
      await StockMovement.destroy({ where: { companyId: COMPANY, referenceId: poId } });
      const items = await PurchaseOrderItem.findAll({ where: { purchaseOrderId: poId } });
      for (const it of items) if (it.assetId) { await AssetEvent.destroy({ where: { assetId: it.assetId } }); await Asset.destroy({ where: { id: it.assetId }, force: true }).catch(() => {}); }
      await PurchaseOrderItem.destroy({ where: { purchaseOrderId: poId } });
      await PurchaseOrder.destroy({ where: { id: poId }, force: true });
    }
    await Product.destroy({ where: { companyId: COMPANY, productCode: PRODCODE }, force: true }).catch(() => {});
    for (const [id, bal] of accSnap) await Account.update({ balance: bal }, { where: { id } });
    await Account.destroy({ where: { companyId: COMPANY, code: INV_SUBS, id: { [require("sequelize").Op.notIn]: [...accSnap.keys()] } } });
    await Supplier.destroy({ where: { id: SUP }, force: true }).catch(() => {});
    await Setting.destroy({ where: { companyId: COMPANY, key: "accountingByKarat" } });
    server.close();
  }

  console.log(`\nRESULT: all ${passed} checks passed. (Part A rolled back; Part B reversed + flag restored)`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
