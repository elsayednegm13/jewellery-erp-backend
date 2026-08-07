"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });
const expectedDatabase = String(process.env.INVENTORY_REHEARSAL_DB || "").trim();
assert.equal(expectedDatabase, "darfus_erp_inventory_rehearsal_20260804_160500z", "Batch 2A must use only the retained acceptance database");
delete process.env.DATABASE_URL;
process.env.DB_NAME = expectedDatabase;

const sequelize = require("../src/config/database");
const app = require("../src/app");
const { User, Setting } = require("../src/models");
const technicalSessions = require("../src/services/technical-session.service");
const goldValuationService = require("../src/services/gold-valuation.service");

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 18);
const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements }))[0][0];
const decimal = (value) => Number(Number(value).toFixed(8));

function startServer() { return new Promise((resolve, reject) => { const server = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` })); }); }
function stopServer(server) { return new Promise((resolve) => server.close(resolve)); }
async function request(baseUrl, method, pathname, { token, companyId, branchId, idempotencyKey, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (companyId) headers["X-Company-ID"] = companyId;
  if (branchId) headers["X-Branch-ID"] = branchId;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function technicalToken() {
  const user = await User.findOne({ where: { email: "admin@admin.com", isActive: true } });
  assert.ok(user && user.accountType === "super_admin", "active Super Admin harness user is required");
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `batch-2a-${id()}` }, ip: "127.0.0.1" });
  return { token: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "batch_2a_acceptance_complete") };
}
function receiptBody({ purchaseOrderId, scope, profile, description, valuation, certificate }) {
  return {
    id: purchaseOrderId, supplierId: scope.supplierId, branchId: scope.branchId, warehouseId: scope.branchId,
    purchaseDate: "2026-08-05", paymentMethod: "credit", paidAmount: 0, inventoryV2: true,
    items: [{ name: description, type: "gold-weight", category: "Batch 2A acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode, karat: profile === "GOLD_BAR_24K" ? 24 : 21, quantity: 1, weightPerUnit: profile === "GOLD_BAR_24K" ? 5 : 10, unitCost: 0, price: 0, perPiece: [{
      name: description, description, profile, type: "gold-weight", category: "Batch 2A acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode,
      karat: profile === "GOLD_BAR_24K" ? 24 : 21, grossWeight: profile === "GOLD_BAR_24K" ? 5 : 10, stoneWeight: profile === "GOLD_BAR_24K" ? 0 : 2,
      goldColor: "Yellow", condition: profile === "GOLD_BAR_24K" ? null : "NEW", goldValuation: valuation,
      ...(certificate ? { certificate } : {}),
    }] }],
  };
}

async function main() {
  await sequelize.authenticate();
  assert.equal((await one("SELECT current_database() AS database")).database, expectedDatabase, "stop before mutation unless the exact acceptance DB is connected");
  const scope = await one(`SELECT c.id AS "companyId", b.id AS "branchId", s.id AS "supplierId", i.code AS "inventoryCode", m.code AS "itemCode"
    FROM companies c JOIN branches b ON b.company_id=c.id AND b.name='Main Branch' JOIN suppliers s ON s.company_id=c.id
    JOIN barcode_inventory_codes i ON i.asset_type='gold-weight' AND i.is_active=true
    JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
    ORDER BY s.id,m.code LIMIT 1`);
  assert.ok(scope?.companyId && scope?.branchId && scope?.supplierId && scope?.inventoryCode && scope?.itemCode, "acceptance barcode/supplier fixture is incomplete");
  const before = await one(`SELECT (SELECT COUNT(*)::int FROM assets) AS assets,(SELECT COUNT(*)::int FROM products) AS products,(SELECT COUNT(*)::int FROM journal_entries) AS journals`);
  const defaultSetting = await Setting.findOne({ where: { companyId: scope.companyId, key: "purchaseVatRate" } });
  const defaultRate = defaultSetting ? Number(defaultSetting.value) : 6.25;
  if (!defaultSetting) await Setting.create({ companyId: scope.companyId, key: "purchaseVatRate", value: defaultRate });
  assert.throws(() => goldValuationService.calculateReceiptGoldValuation({ profile: "GOLD_BAR_24K", weights: { netGoldWeight: "5.00000000" }, input: { purchaseGoldRate: 100, currentGoldRate: 120, certificateCost: 20, currentCertificateCost: 25 }, configuredVatRate: null }), /GOLD_VALUATION_VAT_RATE_NOT_CONFIGURED/, "24K VAT must fail closed without manual or configured rate");

  const { server, baseUrl } = await startServer();
  let auth;
  try {
    auth = await technicalToken();
    const suffix = id();
    const weightPo = `CR2A-W-${suffix}`;
    const weightKey = `CR2A-W-${suffix}`;
    const weightBody = receiptBody({ purchaseOrderId: weightPo, scope, profile: "GOLD_BY_WEIGHT_JEWELLERY", description: `Batch 2A Weight ${suffix}`, valuation: { purchaseGoldRate: 100, makingPerGram: 10, currentGoldRate: 120, currentMakingPerGram: 12 } });
    const weightReceive = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: weightKey, body: weightBody });
    assert.equal(weightReceive.status, 201, `Gold By Weight receipt must succeed: ${JSON.stringify(weightReceive.body)}`);
    const weightAsset = (weightReceive.body.assets || weightReceive.body.data?.assets || [])[0];
    const weightJournal = weightReceive.body.journalEntry || weightReceive.body.data?.journalEntry;
    assert.ok(weightAsset?.id && weightAsset.barcode && weightAsset.inventoryProfile === "GOLD_BY_WEIGHT_JEWELLERY", "Gold By Weight must create one canonical Asset with a Barcode");
    assert.equal(Number(weightJournal.totalDebit), Number(weightJournal.totalCredit), "Gold By Weight receive journal must balance");
    const weightDetail = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(weightAsset.id)}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(weightDetail.status, 200, "Gold By Weight detail must read back");
    assert.equal(decimal(weightDetail.body.data.goldDetails.net_gold_weight), 8, "Net weight must be server derived");
    assert.equal(decimal(weightDetail.body.data.goldDetails.pure_gold_9999), 7, "Pure Gold 999.9 must be server derived");
    assert.equal(decimal(weightDetail.body.data.currentPurchaseCost.purchase_gold_rate), 100, "historical purchase gold rate must persist");
    assert.equal(decimal(weightDetail.body.data.currentPurchaseCost.gold_value), 800, "historical gold value must be server calculated");
    assert.equal(decimal(weightDetail.body.data.currentPurchaseCost.making_total), 80, "historical making must be server calculated");
    assert.equal(decimal(weightDetail.body.data.currentPurchaseCost.total_purchase_cost), 880, "historical purchase total must be frozen evidence");
    assert.equal(decimal(weightDetail.body.data.currentValuation.gold_value), 960, "current gold valuation must be separate from purchase");
    assert.equal(decimal(weightDetail.body.data.currentValuation.making_value), 96, "current making must be separate from purchase");

    const barPo = `CR2A-B-${suffix}`;
    const barKey = `CR2A-B-${suffix}`;
    const barBody = receiptBody({ purchaseOrderId: barPo, scope, profile: "GOLD_BAR_24K", description: `Batch 2A 24K ${suffix}`, valuation: { purchaseGoldRate: 100, currentGoldRate: 120, certificateCost: 20, currentCertificateCost: 25, vatRate: 7.25, currentVatRate: 7.25 }, certificate: { issuer: "Batch 2A", certificateNumber: `CERT-${suffix}`, issueDate: "2026-08-05" } });
    const barReceive = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: barKey, body: barBody });
    assert.equal(barReceive.status, 201, `24K receipt must succeed: ${JSON.stringify(barReceive.body)}`);
    const barAsset = (barReceive.body.assets || barReceive.body.data?.assets || [])[0];
    const barJournal = barReceive.body.journalEntry || barReceive.body.data?.journalEntry;
    assert.ok(barAsset?.id && barAsset.barcode && barAsset.inventoryProfile === "GOLD_BAR_24K", "24K must create one canonical Asset with a Barcode");
    assert.equal(Number(barJournal.totalDebit), Number(barJournal.totalCredit), "24K receive journal must balance");
    const barDetail = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(barAsset.id)}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(barDetail.status, 200, "24K detail must read back");
    assert.equal(decimal(barDetail.body.data.currentPurchaseCost.gold_value), 500, "24K purchase gold value must be calculated separately");
    assert.equal(decimal(barDetail.body.data.currentPurchaseCost.certificate_cost), 20, "24K purchase certificate cost must persist");
    assert.equal(decimal(barDetail.body.data.currentPurchaseCost.vat_base), 20, "24K purchase VAT base must be certificate-only");
    assert.equal(decimal(barDetail.body.data.currentPurchaseCost.vat_amount), 1.45, "24K purchase VAT must use the non-5% manual rate");
    assert.equal(decimal(barDetail.body.data.currentPurchaseCost.total_purchase_cost), 521.45, "24K purchase total must exclude VAT on gold value");
    assert.equal(decimal(barDetail.body.data.currentValuation.vat_base), 25, "24K current VAT base must be current certificate-only");
    assert.equal(decimal(barDetail.body.data.currentValuation.vat_amount), 1.8125, "24K current VAT must use current certificate value only");
    assert.equal(decimal(barDetail.body.data.currentValuation.total_value), 626.8125, "24K current valuation must remain separate");
    assert.equal(barDetail.body.data.certificates.length, 1, "24K certificate relation must persist");

    const replay = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: barKey, body: barBody });
    assert.equal(replay.status, 201, "same receive key/body must replay");
    assert.equal((replay.body.assets || replay.body.data?.assets || [])[0].id, barAsset.id, "receive replay must return the original Asset");
    const changedBody = structuredClone(barBody); changedBody.items[0].perPiece[0].goldValuation.currentGoldRate = 121;
    const conflict = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: barKey, body: changedBody });
    assert.equal(conflict.status, 409, "same receive key with changed valuation body must conflict");

    const valuationKey = `CR2A-VALUATION-${suffix}`;
    const valuationBody = { goldValuation: { currentGoldRate: 130, currentCertificateCost: 30, currentVatRate: 7.25 }, reason: "Batch 2A current valuation proof" };
    const valuationUpdate = await request(baseUrl, "PUT", `/inventory-v2/assets/${encodeURIComponent(barAsset.id)}/current-valuation`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: valuationKey, body: valuationBody });
    assert.equal(valuationUpdate.status, 200, `current valuation update must succeed: ${JSON.stringify(valuationUpdate.body)}`);
    assert.equal(decimal(valuationUpdate.body.data.gold_value), 650, "updated current gold value must use current rate");
    assert.equal(decimal(valuationUpdate.body.data.vat_base), 30, "updated VAT base must remain certificate-only");
    assert.equal(decimal(valuationUpdate.body.data.vat_amount), 2.175, "updated VAT must not include gold value");
    const valuationReplay = await request(baseUrl, "PUT", `/inventory-v2/assets/${encodeURIComponent(barAsset.id)}/current-valuation`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: valuationKey, body: valuationBody });
    assert.equal(valuationReplay.status, 200, "same current valuation key/body must replay");
    const valuationConflict = await request(baseUrl, "PUT", `/inventory-v2/assets/${encodeURIComponent(barAsset.id)}/current-valuation`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: valuationKey, body: { ...valuationBody, reason: "changed" } });
    assert.equal(valuationConflict.status, 409, "same current valuation key with changed body must conflict");
    const afterUpdate = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(barAsset.id)}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(decimal(afterUpdate.body.data.currentPurchaseCost.total_purchase_cost), 521.45, "current valuation must never overwrite frozen purchase evidence");
    assert.equal(decimal(afterUpdate.body.data.currentValuation.gold_value), 650, "read-back must expose updated current valuation");

    const defaultPo = `CR2A-D-${suffix}`;
    const defaultBody = receiptBody({ purchaseOrderId: defaultPo, scope, profile: "GOLD_BAR_24K", description: `Batch 2A default VAT ${suffix}`, valuation: { purchaseGoldRate: 100, currentGoldRate: 100, certificateCost: 10, currentCertificateCost: 10 }, certificate: { issuer: "Batch 2A", certificateNumber: `DEFAULT-${suffix}`, issueDate: "2026-08-05" } });
    const defaultReceive = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: `CR2A-DK-${suffix}`, body: defaultBody });
    assert.equal(defaultReceive.status, 201, "configured Settings VAT rate must be accepted when manual rate is omitted");
    const defaultAsset = (defaultReceive.body.assets || defaultReceive.body.data?.assets || [])[0];
    const defaultDetail = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(defaultAsset.id)}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(decimal(defaultDetail.body.data.currentPurchaseCost.vat_rate), decimal(defaultRate), "VAT rate source must use configured Settings rate");
    assert.equal(defaultDetail.body.data.currentPurchaseCost.vat_rate_source, "SETTINGS_DEFAULT", "read-back must disclose Settings VAT source");

    const integrity = await one(`SELECT
      (SELECT COUNT(*)::int FROM asset_purchase_cost_revisions r LEFT JOIN assets a ON a.id=r.asset_id WHERE a.id IS NULL) AS orphan_costs,
      (SELECT COUNT(*)::int FROM asset_current_valuations v LEFT JOIN assets a ON a.id=v.asset_id WHERE a.id IS NULL) AS orphan_valuations,
      (SELECT COUNT(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_journal_lines,
      (SELECT COUNT(*)::int FROM cash_transactions ct LEFT JOIN journal_entries je ON je.id=ct.journal_entry_id WHERE ct.status='posted' AND ct.type<>'closing' AND (ct.journal_entry_id IS NULL OR je.id IS NULL)) AS unlinked_treasury`);
    assert.deepEqual(integrity, { orphan_costs: 0, orphan_valuations: 0, orphan_journal_lines: 0, unlinked_treasury: 0 }, "valuation/financial integrity failed");
    const after = await one(`SELECT (SELECT COUNT(*)::int FROM assets) AS assets,(SELECT COUNT(*)::int FROM products) AS products,(SELECT COUNT(*)::int FROM journal_entries) AS journals`);
    assert.equal(after.assets, before.assets + 3, "replay and conflicts must not duplicate Assets");
    assert.equal(after.products, before.products, "gold V2 receipt must not create Product quantity authority");
    assert.equal(after.journals, before.journals + 3, "three valid receipts must create exactly three journals");
    assert.ok(fs.readFileSync(path.resolve(__dirname, "../../app/[locale]/(dashboard)/suppliers/purchases/page.tsx"), "utf8").includes("goldValuation"), "existing intake UI must send the canonical gold valuation contract");
    console.log(JSON.stringify({ result: "PASS", database: expectedDatabase, assets: { goldByWeight: weightAsset.id, goldBar24k: barAsset.id, settingsDefault: defaultAsset.id }, barcodes: [weightAsset.barcode, barAsset.barcode, defaultAsset.barcode], formulas: { netGoldWeight: 8, pureGold9999: 7 }, vat: { manualRate: 7.25, settingsRate: defaultRate, goldVatBase: 0, certificateOnly: true }, idempotency: { receiveReplay: replay.status, receiveConflict: conflict.status, valuationReplay: valuationReplay.status, valuationConflict: valuationConflict.status }, journals: { goldByWeight: weightJournal.id, goldBar24k: barJournal.id }, integrity }));
  } finally {
    if (auth) await auth.cleanup();
    await stopServer(server);
  }
}

main().catch((error) => { console.error(`CLIENT_REQUIREMENTS_BATCH_2A_FAIL: ${error.stack || error.message}`); process.exitCode = 1; }).finally(async () => sequelize.close());
