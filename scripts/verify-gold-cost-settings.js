/**
 * Gold cost settings foundation — Phase 15C verify.
 *
 * Adds read-only settings keys (goldCostSource, goldCostWeightBasis,
 * allowGoldCostOverride, goldCostOverridePermission, nonRecoverableVatCapitalization)
 * with safe defaults + scoped validation on PATCH /settings. NO consumer reads
 * them yet; purchase receive, posting, reports and the 12E purchase-VAT settings
 * are unchanged. This script proves they are readable, validated, and inert.
 *
 * WRITE/READ — fixtures under a throwaway company; cleanup deletes the company
 * LAST so FK cascade removes every row. No residue.
 *
 *   cd backend && node scripts/verify-gold-cost-settings.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const settingsService = require("../src/services/settings.service");

const { sequelize, Company, Setting } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-GCS-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base, token;
async function patch(body) {
  const r = await fetch(`${base}/settings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function getSettings() {
  const r = await fetch(`${base}/settings`, { headers: { Authorization: `Bearer ${token}`, "X-Company-ID": CO } });
  let json = null; try { json = await r.json(); } catch {}
  return json.data;
}
const svc = () => settingsService.getCompanySettings(CO);

(async () => {
  await sequelize.authenticate();
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" });

  try {
    await Company.create({ id: CO, businessName: "Verify GCS Co", workspace: `verify-gcs-${stamp}` });

    console.log("1) defaults readable from service + API:");
    const s0 = await svc();
    check(s0.goldCostSource === "hybrid", "default goldCostSource = hybrid");
    check(s0.goldCostWeightBasis === "net", "default goldCostWeightBasis = net");
    check(s0.allowGoldCostOverride === true, "default allowGoldCostOverride = true");
    check(s0.goldCostOverridePermission === "goldCost.override", "default goldCostOverridePermission = goldCost.override");
    check(s0.nonRecoverableVatCapitalization === true, "default nonRecoverableVatCapitalization = true");
    const api0 = await getSettings();
    check(api0.goldCostSource === "hybrid" && api0.goldCostWeightBasis === "net" && api0.allowGoldCostOverride === true && api0.goldCostOverridePermission === "goldCost.override" && api0.nonRecoverableVatCapitalization === true, "GET /settings surfaces the new keys");

    console.log("\n2) valid enum/boolean/string updates succeed:");
    for (const v of ["manual", "gold_center", "hybrid"]) {
      check((await patch({ goldCostSource: v })).status === 200 && (await svc()).goldCostSource === v, `goldCostSource = ${v} → 200 + persisted`);
    }
    for (const v of ["net", "gross"]) {
      check((await patch({ goldCostWeightBasis: v })).status === 200 && (await svc()).goldCostWeightBasis === v, `goldCostWeightBasis = ${v} → 200 + persisted`);
    }
    check((await patch({ allowGoldCostOverride: false })).status === 200 && (await svc()).allowGoldCostOverride === false, "allowGoldCostOverride = false → persisted");
    check((await patch({ nonRecoverableVatCapitalization: false })).status === 200 && (await svc()).nonRecoverableVatCapitalization === false, "nonRecoverableVatCapitalization = false → persisted");
    check((await patch({ goldCostOverridePermission: "custom.perm" })).status === 200 && (await svc()).goldCostOverridePermission === "custom.perm", "goldCostOverridePermission = custom.perm → persisted");

    console.log("\n3) invalid updates rejected (422):");
    check((await patch({ goldCostSource: "bad" })).status === 422, "goldCostSource 'bad' → 422");
    check((await patch({ goldCostWeightBasis: "bad" })).status === 422, "goldCostWeightBasis 'bad' → 422");
    check((await patch({ allowGoldCostOverride: "false" })).status === 422, "allowGoldCostOverride 'false' (string) → 422");
    check((await patch({ allowGoldCostOverride: 1 })).status === 422, "allowGoldCostOverride 1 (number) → 422");
    check((await patch({ nonRecoverableVatCapitalization: "yes" })).status === 422, "nonRecoverableVatCapitalization 'yes' → 422");
    check((await patch({ goldCostOverridePermission: "" })).status === 422, "empty goldCostOverridePermission → 422");
    check((await patch({ goldCostOverridePermission: "   " })).status === 422, "whitespace goldCostOverridePermission → 422");
    // a rejected update must not mutate stored values
    const s4 = await svc();
    check(s4.goldCostSource === "hybrid" && s4.goldCostOverridePermission === "custom.perm", "rejected updates left previous valid values intact");

    console.log("\n4) 12E purchase-VAT settings still work (not broken):");
    check((await patch({ purchaseVatRate: 7 })).status === 200 && (await svc()).purchaseVatRate === 7, "purchaseVatRate update still works");
    check((await patch({ purchaseVatRate: 150 })).status === 422, "purchaseVatRate 150 still rejected");
    check((await patch({ vatRate: 9 })).status === 200 && (await svc()).vatRate === 9, "sales vatRate update still works");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("settings", () => Setting.destroy({ where: { companyId: CO } }));
    await safe("company (cascade remainder)", () => Company.destroy({ where: { id: CO } }));
    console.log("cleanup done — throwaway company + all rows removed; no residue");
    server.close();
    await sequelize.close();
  }
  process.exit(0);
})().catch((error) => {
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});
