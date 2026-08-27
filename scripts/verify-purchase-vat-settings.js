/**
 * Purchase VAT / RCM settings foundation — Phase 12E verify.
 *
 * Adds read-only settings keys (vatEnabled, purchaseVatRate,
 * purchaseTaxIncludedDefault, purchaseVatRecoverableDefault, inputVatAccountCode,
 * rcmOutputAccountCode) with safe defaults + scoped validation on PATCH /settings.
 * NO posting consumes them yet; sales vatRate, purchase receive, and posting are
 * unchanged. This script proves the foundation is readable, validated, and inert.
 *
 * WRITE/READ — fixtures under a throwaway company; cleanup deletes the company
 * LAST so FK cascade removes every row. No residue.
 *
 *   cd backend && node scripts/verify-purchase-vat-settings.js
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const { JWT_SECRET } = require("../src/config/security");
const models = require("../src/models");
const settingsService = require("../src/services/settings.service");
const postingService = require("../src/services/posting.service");

const { sequelize, Company, Setting, Account } = models;

const stamp = Date.now();
const CO = `CMP-VERIFY-PVAT-${stamp}`;

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  console.log("  ✓ " + message);
}

let base;
let token;
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
  token = jwt.sign({ userId: "USR-ADMIN" }, JWT_SECRET, { expiresIn: "1h" }); // admin → settings.view/update

  try {
    await Company.create({ id: CO, businessName: "Verify PVAT Co", workspace: `verify-pvat-${stamp}` });

    console.log("1) defaults are readable from settings service + API:");
    const s0 = await svc();
    check(s0.vatEnabled === true, "default vatEnabled = true");
    check(s0.purchaseTaxIncludedDefault === false, "default purchaseTaxIncludedDefault = false");
    check(s0.purchaseVatRecoverableDefault === true, "default purchaseVatRecoverableDefault = true");
    check(s0.inputVatAccountCode === "1400", "default inputVatAccountCode = 1400");
    check(s0.rcmOutputAccountCode === "2210", "default rcmOutputAccountCode = 2210");
    const api0 = await getSettings();
    check(api0.inputVatAccountCode === "1400" && api0.rcmOutputAccountCode === "2210" && api0.vatEnabled === true, "GET /settings surfaces the new keys");

    console.log("\n2) purchaseVatRate falls back to vatRate when unset:");
    check(s0.purchaseVatRate === s0.vatRate, "no purchaseVatRate row → purchaseVatRate === vatRate (fallback)");
    await Setting.create({ companyId: CO, key: "vatRate", value: 15 });
    const s1 = await svc();
    check(s1.vatRate === 15 && s1.purchaseVatRate === 15, "after vatRate=15, purchaseVatRate still falls back to 15");

    console.log("\n3) valid updates succeed:");
    check((await patch({ purchaseVatRate: 7 })).status === 200, "update purchaseVatRate = 7 → 200");
    check((await svc()).purchaseVatRate === 7, "purchaseVatRate now 7 (independent of vatRate)");
    check((await patch({ purchaseTaxIncludedDefault: true, purchaseVatRecoverableDefault: false, vatEnabled: false })).status === 200, "update booleans → 200");
    const s2 = await svc();
    check(s2.purchaseTaxIncludedDefault === true && s2.purchaseVatRecoverableDefault === false && s2.vatEnabled === false, "boolean values persisted");
    check((await patch({ inputVatAccountCode: "1450", rcmOutputAccountCode: "2215" })).status === 200, "update account codes → 200");
    const s3 = await svc();
    check(s3.inputVatAccountCode === "1450" && s3.rcmOutputAccountCode === "2215", "account codes persisted");

    console.log("\n4) invalid updates are rejected (422):");
    check((await patch({ purchaseVatRate: -1 })).status === 422, "purchaseVatRate -1 → 422");
    check((await patch({ purchaseVatRate: 101 })).status === 422, "purchaseVatRate 101 → 422");
    check((await patch({ purchaseVatRate: "abc" })).status === 422, "purchaseVatRate 'abc' → 422");
    check((await patch({ purchaseVatRate: "" })).status === 422, "purchaseVatRate '' → 422");
    check((await patch({ vatEnabled: "yes" })).status === 422, "vatEnabled 'yes' (non-boolean) → 422");
    check((await patch({ purchaseTaxIncludedDefault: 1 })).status === 422, "purchaseTaxIncludedDefault 1 (non-boolean) → 422");
    check((await patch({ inputVatAccountCode: "" })).status === 422, "empty inputVatAccountCode → 422");
    check((await patch({ rcmOutputAccountCode: "   " })).status === 422, "whitespace rcmOutputAccountCode → 422");
    // a rejected update must not have mutated the stored values
    const s4 = await svc();
    check(s4.purchaseVatRate === 7 && s4.inputVatAccountCode === "1450", "rejected updates left previous valid values intact");

    console.log("\n5) sales vatRate path is NOT broken:");
    check((await patch({ vatRate: 9 })).status === 200, "update sales vatRate = 9 → 200 (unchanged behaviour)");
    check((await svc()).vatRate === 9, "sales vatRate persisted = 9");

    console.log("\n6) foundation is inert — no posting consumes it, no GL rows created:");
    check(typeof postingService.CHART["1400"] === "object" && postingService.CHART["1400"].nature === "debit", "CHART defines 1400 (Input VAT, debit asset) constant");
    check(typeof postingService.CHART["2210"] === "object" && postingService.CHART["2210"].nature === "credit", "CHART defines 2210 (RCM Output VAT, credit liability) constant");
    check((await Account.findOne({ where: { companyId: CO, code: "1400" } })) === null, "no 1400 Account row created (ensureAccount not triggered — posting unchanged)");
    check((await Account.findOne({ where: { companyId: CO, code: "2210" } })) === null, "no 2210 Account row created");

    console.log(`\nRESULT: all ${passed} checks passed.`);
  } finally {
    const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`CLEANUP WARNING (${label}):`, e.message); } };
    await safe("settings", () => Setting.destroy({ where: { companyId: CO } }));
    await safe("accounts", () => Account.destroy({ where: { companyId: CO } }));
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
