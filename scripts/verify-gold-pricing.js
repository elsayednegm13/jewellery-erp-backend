/**
 * P2.2 verification — gold price settings & karat pricing foundation.
 *
 *  Part A (pure, no DB): the pricing-mode + valuation helpers.
 *  Part B (DB, rolled back): a gold-price change appends a chained audit row,
 *         and the goldPricingMode setting persists + reads back.
 *
 * Run: node scripts/verify-gold-pricing.js
 */
require("dotenv").config();
const { sequelize, AuditLog, Setting } = require("../src/models");
const goldService = require("../src/services/gold.service");
const auditService = require("../src/services/audit.service");

const COMPANY = "CMP-DEMO";
let passed = 0;
function check(cond, msg) { if (!cond) throw new Error("FAILED: " + msg); passed++; console.log("  ✓ " + msg); }

(async () => {
  // ---------- Part A: pure helpers ----------
  console.log("Part A — pricing-mode + valuation helpers (pure):");
  const args = { goldWeight: 10, perGram: 250, makingCharge: 300, stoneValue: 150, manualSalePrice: 4000 };

  check(goldService.computeItemSalePrice({ mode: "manual_sale_price", ...args }) === 4000,
    "manual_sale_price keeps the stored sale price (4000)");
  check(goldService.computeItemSalePrice({ mode: "dynamic_by_karat", ...args }) === 2500,
    "dynamic_by_karat = weight × perGram (10×250 = 2500)");
  check(goldService.computeItemSalePrice({ mode: "dynamic_by_karat_plus_making", ...args }) === 2950,
    "dynamic_by_karat_plus_making = 2500 + 300 + 150 = 2950");
  check(goldService.computeItemSalePrice({ ...args }) === 4000,
    "default mode falls back to manual sale price");

  const val = goldService.valuationFor({ goldWeight: 10, perGram: 250, cost: 2000 });
  check(val.costValue === 2000, "valuation costValue equals original cost (cost untouched)");
  check(val.marketValue === 2500, "valuation marketValue = weight × perGram (2500)");
  check(val.unrealizedGainLoss === 500, "valuation unrealized gain = market − cost (500)");

  // ---------- Part B: audit + setting persistence (rolled back) ----------
  await sequelize.authenticate();
  console.log("\nPart B — audit + setting persistence [rolled back]:");
  const t = await sequelize.transaction();
  try {
    // A gold-price change appends a chained gold_price.update audit row.
    const created = await auditService.record(COMPANY, {
      action: "gold_price.update",
      description: "Gold prices updated (AED): 21K 230→245",
      user: "Probe", sourceDocument: "gold-prices", severity: "info",
      before: JSON.stringify([{ karat: 21, pricePerGram: 230 }]),
      after: JSON.stringify([{ karat: 21, pricePerGram: 245, source: "manual" }])
    }, { transaction: t });
    check(created.action === "gold_price.update", "gold_price.update audit row recorded");
    check(!!created.hash && created.prevHash !== undefined, "audit row is hash-chained");
    const expected = auditService.computeHash(created.prevHash, created);
    check(created.hash === expected, "audit row hash verifies (chained correctly)");

    // goldPricingMode setting persists + reads back.
    const [row, made] = await Setting.findOrCreate({
      where: { companyId: COMPANY, key: "goldPricingMode" },
      defaults: { companyId: COMPANY, key: "goldPricingMode", value: "dynamic_by_karat" },
      transaction: t
    });
    if (!made) await row.update({ value: "dynamic_by_karat" }, { transaction: t });
    const readBack = await Setting.findOne({ where: { companyId: COMPANY, key: "goldPricingMode" }, transaction: t });
    check(readBack.value === "dynamic_by_karat", "goldPricingMode setting persists + reads back from DB");
  } finally { await t.rollback(); }

  console.log(`\nRESULT: all ${passed} checks passed. (nothing committed)`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
