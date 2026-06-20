/**
 * P5.4 verification — inventory valuation report (READ-ONLY).
 *
 * Snapshots the report, adds throwaway inventory (product 21K, asset 18K,
 * diamond/null-karat, plus a SOLD 21K asset that must be ignored), then asserts
 * the per-karat DELTAS (isolating from existing inventory), market-value calc,
 * missing-data handling, branch filter, totals, and that the report writes
 * NOTHING (no JE / no balance / no stock change). Fixtures removed at the end.
 *
 * Run: node scripts/verify-inventory-valuation.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const { sequelize, Product, Asset, JournalEntry, Account, GoldPrice } = models;
const goldService = require("../src/services/gold.service");

const COMPANY = "CMP-DEMO";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

let base, token;
async function api(p) {
  const res = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": COMPANY, "X-Branch-ID": "BR-WH" } });
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, json: j };
}
const groupOf = (rep, k) => (rep.groups || []).find((g) => g.karat === k) || { itemCount: 0, quantity: 0, totalWeight: 0, costValue: 0, marketValue: 0, missingWeightCount: 0 };
const r2 = (n) => Math.round(n * 100) / 100;

const ts = Date.now();
const PID = `PRD-PROBE-${ts}`, A18 = `AST-PROBE-${ts}-18`, ADIA = `AST-PROBE-${ts}-dia`, ASOLD = `AST-PROBE-${ts}-sold`;

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    // Baseline report + read-only baselines.
    const before = (await api("/reports/inventory-valuation")).json;
    check(before && Array.isArray(before.groups) && before.totals, "report endpoint returns groups + totals");
    check(before.informational === true && before.valuationType === "current", "report is informational + current valuation");
    const currency = before.currency;
    const jeBefore = await JournalEntry.count({ where: { companyId: COMPANY } });
    const acc = await Account.findOne({ where: { companyId: COMPANY, code: "1200" } });
    const accBalBefore = acc ? String(acc.balance) : null;

    const b21 = groupOf(before, "21"), b18 = groupOf(before, "18"), bOther = groupOf(before, "other");

    // Fixtures (all at BR-WH).
    await Product.create({ id: PID, companyId: COMPANY, productCode: PID, productName: "Probe Ring", karat: 21, stockType: "gold-piece", branchId: "BR-WH", branchName: "WH", quantityOnHand: 5, quantityAvailable: 5, quantitySold: 0, quantityReserved: 0, totalWeight: 25, averageUnitWeight: 5, unitCost: 100, averageCost: 100, salePrice: 150, isActive: true });
    const mkAsset = (id, over) => Asset.create({ id, companyId: COMPANY, name: id, type: "gold-piece", status: "available", category: "P", grossWeight: 4, netWeight: 4, goldWeight: 4, price: 1000, cost: 700, karat: 18, branch: "WH", branchId: "BR-WH", location: "P", barcode: `VB-${id}`, ...over });
    await mkAsset(A18, { karat: 18, goldWeight: 4, cost: 700 });
    await mkAsset(ADIA, { type: "diamond", karat: null, goldWeight: 0, netWeight: 0, grossWeight: 0, cost: 500 }); // non-gold, no weight
    await mkAsset(ASOLD, { karat: 21, status: "sold", cost: 999 }); // MUST be excluded

    const after = (await api("/reports/inventory-valuation")).json;
    const a21 = groupOf(after, "21"), a18 = groupOf(after, "18"), aOther = groupOf(after, "other");

    // ---- grouping + cost/weight deltas ----
    console.log("grouping + values:");
    check(r2(a21.costValue - b21.costValue) === 500, "21K product cost (averageCost*qty=100*5) added to 21 group");
    check(a21.quantity - b21.quantity === 5, "21K product quantity (5) added to 21 group");
    check(r2(a21.totalWeight - b21.totalWeight) === 25, "21K product weight (25) added to 21 group");
    check(r2(a18.costValue - b18.costValue) === 700, "18K asset cost (700) added to 18 group");
    check(a18.quantity - b18.quantity === 1, "18K asset (1 piece) added to 18 group");
    check(r2(a18.totalWeight - b18.totalWeight) === 4, "18K asset gold weight (4) added to 18 group");
    check(aOther.quantity - bOther.quantity === 1, "null-karat diamond goes to Other group");
    check(r2(aOther.costValue - bOther.costValue) === 500, "diamond cost (500) added to Other group");

    // ---- sold asset excluded (the 21 delta is EXACTLY the product, not +1) ----
    check(a21.quantity - b21.quantity === 5, "SOLD 21K asset is NOT counted (21 quantity delta stays 5)");

    // ---- market value uses current gold price ----
    const price21 = await (async () => {
      const o = await GoldPrice.findOne({ where: { currency, karat: 21 }, order: [["updated_at", "DESC"]] });
      if (o) return parseFloat(o.pricePerGram);
      return (await goldService.getKaratPrices(currency, [21])).prices[0].pricePerGram;
    })();
    check(r2(a21.marketValue - b21.marketValue) === r2(25 * price21), `21K market value delta = weight(25) × pricePerGram(${price21})`);

    // ---- missing weight / price don't break ----
    check(aOther.missingWeightCount - bOther.missingWeightCount === 1, "diamond with 0 weight counted in missingWeightCount (report did not fail)");

    // ---- totals = sum of groups ----
    const sumCost = r2((after.groups || []).reduce((s, g) => s + g.costValue, 0));
    check(r2(after.totals.costValue) === sumCost, "totals.costValue == sum of group costValues");
    check(r2(after.totals.unrealizedGainLoss) === r2(after.totals.marketValue - after.totals.costValue), "totals gain/loss = market - cost");

    // ---- branch filter ----
    const byBranch = (await api("/reports/inventory-valuation?branchId=BR-WH")).json;
    const bb21 = groupOf(byBranch, "21");
    check(bb21.quantity >= 5, "branch filter (BR-WH) includes the BR-WH fixtures");

    // ---- READ-ONLY proof ----
    console.log("\nread-only:");
    check(await JournalEntry.count({ where: { companyId: COMPANY } }) === jeBefore, "report created NO JournalEntry");
    const acc2 = await Account.findOne({ where: { companyId: COMPANY, code: "1200" } });
    check((acc2 ? String(acc2.balance) : null) === accBalBefore, "account 1200 balance unchanged");
    check(Number((await Product.findByPk(PID)).quantityOnHand) === 5, "product quantity unchanged by the report");
    check((await Asset.findByPk(A18)).status === "available", "asset status unchanged by the report");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    await Product.destroy({ where: { id: PID }, force: true }).catch(() => {});
    for (const id of [A18, ADIA, ASOLD]) await Asset.destroy({ where: { id }, force: true }).catch(() => {});
    console.log("(removed fixtures)");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
