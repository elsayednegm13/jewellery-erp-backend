/**
 * P2.3 verification — gold prices scoped by company (tenant-safe).
 *
 * Writes are exercised via the model (GoldPrice rows are deletable; the POST
 * route also appends an IMMUTABLE audit row, so we avoid it to keep the chain
 * clean — the route sets companyId:req.companyId + source:"manual"). Reads use
 * the real GET routes (no audit) with X-Company-ID to simulate two companies.
 * All created price rows + fixtures are removed.
 *
 * Run: node scripts/verify-gold-prices-tenant.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const { sequelize, GoldPrice, Asset } = models;
const settingsService = require("../src/services/settings.service");

const A = "CMP-DEMO", B = "CMP-TEST-B", CUR = "AED";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

let base, token;
async function api(path, companyId) {
  // No X-Branch-ID: it is validated against the company, and the gold/valuation
  // GETs don't need a branch header (branch filter is a query param).
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": companyId } });
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, json: j };
}
const priceOf = (rep, karat) => (rep.prices || []).find((p) => Number(p.karat) === karat) || {};

const ts = Date.now();
const ASSET21 = `AST-PROBE-${ts}-21`;
const createdPriceIds = [];

(async () => {
  await sequelize.authenticate();

  // ---- Part A: migration + model write ----
  console.log("Part A — column/migration + model write:");
  const desc = await sequelize.getQueryInterface().describeTable("gold_prices");
  check(!!desc.company_id && !!desc.source, "gold_prices has company_id + source columns");
  check(desc.source.defaultValue === "manual", "source default is 'manual'");
  const legacyNull = await GoldPrice.count({ where: { companyId: null } });
  check(legacyNull > 0, `legacy rows kept with company_id NULL (count ${legacyNull}) — no backfill`);

  const t = await sequelize.transaction();
  try {
    const row = await GoldPrice.create({ karat: 21, pricePerGram: 1, currency: CUR, companyId: A }, { transaction: t });
    check(row.companyId === A, "created gold price stores companyId");
    check(row.source === "manual", "created gold price defaults source = 'manual'");
  } finally { await t.rollback(); }

  // ---- Part B: tenant isolation via real GET routes ----
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  // Company-scoped prices for 21K: A=3000, B=3500 (24K left to legacy fallback).
  const pA = await GoldPrice.create({ karat: 21, pricePerGram: 3000, currency: CUR, companyId: A, source: "manual", updatedBy: "probe" });
  const pB = await GoldPrice.create({ karat: 21, pricePerGram: 3500, currency: CUR, companyId: B, source: "manual", updatedBy: "probe" });
  createdPriceIds.push(pA.id, pB.id);
  await Asset.create({ id: ASSET21, companyId: A, name: ASSET21, type: "gold-piece", status: "available", category: "P", grossWeight: 4, netWeight: 4, goldWeight: 4, price: 1000, cost: 700, karat: 21, branch: "WH", branchId: "BR-WH", location: "P", barcode: `GT-${ts}` });

  try {
    console.log("\nPart B — tenant isolation (real GET routes):");
    const repA = (await api(`/gold/karat-prices?currency=${CUR}`, A)).json;
    const repB = (await api(`/gold/karat-prices?currency=${CUR}`, B)).json;
    check(priceOf(repA, 21).pricePerGram === 3000, "company A 21K price = 3000 (its own)");
    check(priceOf(repB, 21).pricePerGram === 3500, "company B 21K price = 3500 (its own)");
    check(priceOf(repA, 21).pricePerGram !== 3500, "company A does NOT see company B's price");
    check(priceOf(repB, 21).pricePerGram !== 3000, "company B does NOT see company A's price");
    check(priceOf(repA, 21).source === "manual" && priceOf(repB, 21).source === "manual", "both show source=manual for their own price");

    // 24K: neither A nor B has a company override → both fall back to the SAME
    // legacy (company_id NULL) value (company wins only when it has its own).
    check(priceOf(repA, 24).pricePerGram === priceOf(repB, 24).pricePerGram, "24K (no company override) → both fall back to the legacy/global value");
    // A has a 21K override → it overrides the legacy 21K value.
    const legacy21 = await GoldPrice.findOne({ where: { companyId: null, currency: CUR, karat: 21 }, order: [["updated_at", "DESC"]] });
    if (legacy21) check(Number(priceOf(repA, 21).pricePerGram) !== Number(legacy21.pricePerGram) || Number(legacy21.pricePerGram) === 3000, "company 21K override wins over the legacy 21K value");

    console.log("\nP5.4 valuation uses the company price:");
    // The valuation report prices in the company's settings currency — set A's
    // 21K price in THAT currency so the assertion is deterministic.
    const curA = (await settingsService.getCompanySettings(A)).currency || CUR;
    const pAval = await GoldPrice.create({ karat: 21, pricePerGram: 3000, currency: curA, companyId: A, source: "manual", updatedBy: "probe" });
    createdPriceIds.push(pAval.id);
    const val = (await api("/reports/inventory-valuation", A)).json;
    const g21 = (val.groups || []).find((g) => g.karat === "21");
    check(g21 && Number(g21.pricePerGram) === 3000, `valuation report (company A, ${curA}) uses A's 21K price (3000)`);
  } finally {
    await GoldPrice.destroy({ where: { id: createdPriceIds } });
    await Asset.destroy({ where: { id: ASSET21 }, force: true }).catch(() => {});
    // safety: remove any stray test rows for company B
    await GoldPrice.destroy({ where: { companyId: B } });
    console.log("(removed test price rows + fixtures; legacy NULL rows untouched)");
    server.close();
  }

  console.log(`\nRESULT: all ${passed} checks passed.`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
