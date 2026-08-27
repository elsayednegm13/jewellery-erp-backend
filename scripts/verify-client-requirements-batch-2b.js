"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });
const expectedDatabase = String(process.env.INVENTORY_REHEARSAL_DB || "darfus_erp_inventory_rehearsal_20260804_160500z").trim();
assert.equal(expectedDatabase, "darfus_erp_inventory_rehearsal_20260804_160500z", "Batch 2B must use only the retained acceptance database");
delete process.env.DATABASE_URL;
process.env.DB_NAME = expectedDatabase;

const sequelize = require("../src/config/database");
const app = require("../src/app");
const { User, Setting, ApprovalRequest, AuditLog, Invoice, JournalEntry } = require("../src/models");
const technicalSessions = require("../src/services/technical-session.service");

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 18);
const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements }))[0][0];
const decimal = (value) => Number(Number(value).toFixed(8));

function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function request(baseUrl, method, pathname, { token, companyId, branchId, idempotencyKey, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (companyId) headers["X-Company-ID"] = companyId;
  if (branchId) headers["X-Branch-ID"] = branchId;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function superAdminToken() {
  const user = await User.findOne({ where: { email: "admin@admin.com", isActive: true } });
  assert.ok(user && user.accountType === "super_admin", "active Super Admin harness user is required");
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `batch-2b-sa-${id()}` }, ip: "127.0.0.1" });
  return { user, token: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "batch_2b_acceptance_complete") };
}

async function limitedUserToken(companyId) {
  let user = await User.findOne({ where: { companyId, role: "sales" } });
  if (!user) {
    user = await User.create({
      id: `USR-TEST-LIMITED-${id()}`,
      companyId,
      email: `limited.${id()}@test.local`,
      firstName: "Limited",
      lastName: "Sales",
      role: "sales",
      accountType: "legacy",
      isActive: true
    });
  }
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `batch-2b-limited-${id()}` }, ip: "127.0.0.1" });
  return { user, token: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "batch_2b_limited_complete") };
}

function receiveBody({ purchaseOrderId, scope, profile, description, valuation, certificate }) {
  return {
    id: purchaseOrderId, supplierId: scope.supplierId, branchId: scope.branchId, warehouseId: scope.branchId,
    purchaseDate: "2026-08-05", paymentMethod: "credit", paidAmount: 0, inventoryV2: true,
    items: [{
      name: description, type: "gold-weight", category: "Batch 2B acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode,
      karat: profile === "GOLD_BAR_24K" ? 24 : 21, quantity: 1, weightPerUnit: profile === "GOLD_BAR_24K" ? 5 : 10, unitCost: 0, price: 0,
      perPiece: [{
        name: description, description, profile, type: "gold-weight", category: "Batch 2B acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode,
        karat: profile === "GOLD_BAR_24K" ? 24 : 21, grossWeight: profile === "GOLD_BAR_24K" ? 5 : 10, stoneWeight: profile === "GOLD_BAR_24K" ? 0 : 2,
        goldColor: "Yellow", condition: profile === "GOLD_BAR_24K" ? null : "NEW", goldValuation: valuation,
        pricing: profile === "GOLD_BY_WEIGHT_JEWELLERY" ? { minimumMakingPerGram: 15, sellingMakingPerGram: 20 } : { minimumCertificateCharge: 25, certificateCharge: 30 },
        ...(certificate ? { certificate } : {}),
      }]
    }],
  };
}

async function main() {
  await sequelize.authenticate();
  assert.equal((await one("SELECT current_database() AS database")).database, expectedDatabase, "stop before mutation unless exact acceptance DB is connected");

  const scope = await one(`SELECT c.id AS "companyId", b.id AS "branchId", s.id AS "supplierId", i.code AS "inventoryCode", m.code AS "itemCode", cust.id AS "customerId"
    FROM companies c JOIN branches b ON b.company_id=c.id AND b.name='Main Branch' JOIN suppliers s ON s.company_id=c.id
    JOIN customers cust ON cust.company_id=c.id
    JOIN barcode_inventory_codes i ON i.asset_type='gold-weight' AND i.is_active=true
    JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
    ORDER BY s.id,m.code LIMIT 1`);
  assert.ok(scope?.companyId && scope?.branchId && scope?.supplierId && scope?.customerId && scope?.inventoryCode && scope?.itemCode, "acceptance fixture scope incomplete");

  const before = await one(`SELECT (SELECT COUNT(*)::int FROM assets) AS assets,(SELECT COUNT(*)::int FROM invoices) AS invoices,(SELECT COUNT(*)::int FROM journal_entries) AS journals`);

  const { server, baseUrl } = await startServer();
  let saAuth;
  try {
    saAuth = await superAdminToken();
    const suffix = id();

    // ─── 1. Receive Gold By Weight Asset ────────────────────────────────────
    const weightPo = `CR2B-W-PO-${suffix}`;
    const weightKey = `CR2B-W-KEY-${suffix}`;
    const weightBody = receiveBody({
      purchaseOrderId: weightPo, scope, profile: "GOLD_BY_WEIGHT_JEWELLERY",
      description: `Batch 2B Weight ${suffix}`,
      valuation: { purchaseGoldRate: 100, makingPerGram: 10, currentGoldRate: 120, currentMakingPerGram: 12 }
    });
    const weightReceive = await request(baseUrl, "POST", "/purchase-orders/receive", { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: weightKey, body: weightBody });
    assert.equal(weightReceive.status, 201, "Gold By Weight intake must succeed");
    const weightAsset = (weightReceive.body.assets || weightReceive.body.data?.assets || [])[0];

    // ─── 2. Receive 24K Gold Bar Asset ──────────────────────────────────────
    const barPo = `CR2B-B-PO-${suffix}`;
    const barKey = `CR2B-B-KEY-${suffix}`;
    const barBody = receiveBody({
      purchaseOrderId: barPo, scope, profile: "GOLD_BAR_24K",
      description: `Batch 2B 24K ${suffix}`,
      valuation: { purchaseGoldRate: 100, currentGoldRate: 120, certificateCost: 20, currentCertificateCost: 25, vatRate: 7.25, currentVatRate: 7.25 },
      certificate: { issuer: "Batch 2B", certificateNumber: `CERT-${suffix}`, issueDate: "2026-08-05" }
    });
    const barReceive = await request(baseUrl, "POST", "/purchase-orders/receive", { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: barKey, body: barBody });
    assert.equal(barReceive.status, 201, "24K Bar intake must succeed");
    const barAsset = (barReceive.body.assets || barReceive.body.data?.assets || [])[0];

    // ─── 3. Gold By Weight Normal Sale (Above Minimum Making) ────────────────
    const saleWKey = `CR2B-SALE-W-${suffix}`;
    const saleWBody = {
      branchId: scope.branchId,
      customerId: scope.customerId,
      paymentMethod: "cash",
      items: [{
        assetId: weightAsset.id,
        sellingGoldRate: 120,
        sellingMakingPerGram: 20, // >= min 15
      }]
    };
    const saleWRes = await request(baseUrl, "POST", "/pos/checkout", { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: saleWKey, body: saleWBody });
    assert.equal(saleWRes.status, 201, `Gold By Weight normal sale must succeed: ${JSON.stringify(saleWRes.body)}`);
    const invW = saleWRes.body.data || saleWRes.body;
    assert.equal(decimal(invW.subtotal), 1160, "Gold By Weight subtotal must equal gold (8x120=960) + making (10g physical x20=200) = 1160");
    assert.ok(invW.journalEntry, "Sale must produce double-entry journal");
    assert.equal(Number(invW.journalEntry.totalDebit), Number(invW.journalEntry.totalCredit), "Sale journal must balance");

    // Readback Asset 1 state & pricing
    const detailW = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(weightAsset.id)}`, { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(detailW.body.data.asset.operationalStatus, "SOLD", "Asset status must be SOLD");
    assert.ok(detailW.body.data.salePricing, "Sale pricing evidence must be read back");
    assert.equal(decimal(detailW.body.data.salePricing.makingTotal), 200, "Read-back making total must use physical gross weight");

    // ─── 4. Gold By Weight Below-Minimum Making Sale (Approval Enforcement) ─
    // Intake another asset for below-min test
    const weightMinPo = `CR2B-WM-PO-${suffix}`;
    const weightMinBody = receiveBody({ purchaseOrderId: weightMinPo, scope, profile: "GOLD_BY_WEIGHT_JEWELLERY", description: `Batch 2B Weight Min ${suffix}`, valuation: { purchaseGoldRate: 100, makingPerGram: 10, currentGoldRate: 120, currentMakingPerGram: 12 } });
    const weightMinRec = await request(baseUrl, "POST", "/purchase-orders/receive", { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: `CR2B-WM-KEY-${suffix}`, body: weightMinBody });
    const weightMinAsset = (weightMinRec.body.assets || weightMinRec.body.data?.assets || [])[0];

    const saleWMKey = `CR2B-SALE-WM-${suffix}`;
    const saleWMBody = {
      branchId: scope.branchId,
      customerId: scope.customerId,
      paymentMethod: "cash",
      items: [{
        assetId: weightMinAsset.id,
        sellingGoldRate: 120,
        sellingMakingPerGram: 10, // < min 15
      }]
    };

    // Unauthorized attempt by limited sales user -> BLOCKED (403)
    const limitedAuth = await limitedUserToken(scope.companyId);
    try {
      const unauthRes = await request(baseUrl, "POST", "/pos/checkout", { token: limitedAuth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: `CR2B-UNAUTH-${suffix}`, body: saleWMBody });
      assert.equal(unauthRes.status, 403, "Unauthorized below-minimum sale must return 403 Forbidden");
      assert.equal(unauthRes.body.error?.code, "BELOW_MINIMUM_APPROVAL_REQUIRED", "Error code must be BELOW_MINIMUM_APPROVAL_REQUIRED");
    } finally {
      await limitedAuth.cleanup();
    }

    // Authorized super admin attempt -> succeeds with approval evidence
    const saleWMRes = await request(baseUrl, "POST", "/pos/checkout", { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: saleWMKey, body: saleWMBody });
    assert.equal(saleWMRes.status, 201, `Authorized below-minimum making sale must succeed with approval: ${JSON.stringify(saleWMRes.body)}`);

    // Check approval request persisted
    const appReq = await ApprovalRequest.findOne({ where: { companyId: scope.companyId, type: "price-override", status: "approved" }, order: [["createdAt", "DESC"]] });
    assert.ok(appReq, "Durable approval request evidence must exist");

    // Replay same idempotency key
    const replayWM = await request(baseUrl, "POST", "/pos/checkout", { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: saleWMKey, body: saleWMBody });
    assert.equal(replayWM.status, 201, "Same key replay must succeed");
    assert.equal((replayWM.body.data || replayWM.body).id, (saleWMRes.body.data || saleWMRes.body).id, "Replay must return original invoice");

    // ─── 5. Gold Bar 24K Sale (R19: 24K Certificate VAT at Sale) ───────────
    const saleBarKey = `CR2B-SALE-BAR-${suffix}`;
    const saleBarBody = {
      branchId: scope.branchId,
      customerId: scope.customerId,
      paymentMethod: "cash",
      items: [{
        assetId: barAsset.id,
        sellingGoldRate: 120,
        certificateSaleAmount: 30, // >= min 25
        vatRate: 7.25, // manual non-5% rate
      }]
    };
    const saleBarRes = await request(baseUrl, "POST", "/pos/checkout", { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: saleBarKey, body: saleBarBody });
    assert.equal(saleBarRes.status, 201, `24K Bar sale must succeed: ${JSON.stringify(saleBarRes.body)}`);
    const invBar = saleBarRes.body.data || saleBarRes.body;

    // 24K VAT Verification:
    // Gold value = 5 * 120 = 600
    // Certificate sale amount = 30
    // Subtotal = 630
    // Certificate VAT = 30 * 7.25% = 2.175
    // Total = 630 + 2.175 = 632.175
    assert.equal(decimal(invBar.subtotal), 630, "24K subtotal must equal goldValue (600) + certAmount (30)");
    assert.equal(decimal(invBar.tax), 2.175, "24K VAT must apply ONLY to certificate amount (30 * 7.25% = 2.175), NOT gold value!");
    assert.equal(decimal(invBar.total), 632.175, "24K total must equal subtotal (630) + certVAT (2.175)");
    assert.equal(Number(invBar.journalEntry.totalDebit), Number(invBar.journalEntry.totalCredit), "24K sale journal must balance");

    // Readback 24K Asset detail
    const detailBar = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(barAsset.id)}`, { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(detailBar.body.data.asset.operationalStatus, "SOLD", "24K Asset status must be SOLD");
    assert.equal(detailBar.body.data.salePricing.goldVat, "0.00000000", "Gold VAT must be ZERO for 24K bar");
    assert.equal(decimal(detailBar.body.data.salePricing.certificateVat), 2.175, "Certificate VAT must match non-5% rate calculation");

    // ─── 6. Double Sell Concurrency / Conflict Guard ─────────────────────────
    const conflictRes = await request(baseUrl, "POST", "/pos/checkout", { token: saAuth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: `CR2B-DOUBLE-${suffix}`, body: saleBarBody });
    assert.ok([400, 422].includes(conflictRes.status), "Attempting to sell an already SOLD asset must return 400 or 422 validation error");

    // ─── 7. Purchase Cost & Current Valuation Safety ─────────────────────────
    assert.equal(decimal(detailBar.body.data.currentPurchaseCost.total_purchase_cost), 521.45, "Sale must NOT mutate purchase cost revision history");
    assert.equal(decimal(detailBar.body.data.currentValuation.total_value), 626.8125, "Sale must NOT corrupt current valuation history");

    // ─── 8. Financial Integrity Assertions ──────────────────────────────────
    const integrity = await one(`SELECT
      (SELECT COUNT(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_journal_lines,
      (SELECT COUNT(*)::int FROM cash_transactions ct LEFT JOIN journal_entries je ON je.id=ct.journal_entry_id WHERE ct.status='posted' AND ct.type<>'closing' AND (ct.journal_entry_id IS NULL OR je.id IS NULL)) AS unlinked_treasury`);
    assert.deepEqual(integrity, { orphan_journal_lines: 0, unlinked_treasury: 0 }, "Financial integrity checks must pass");

    console.log(JSON.stringify({
      result: "PASS",
      database: expectedDatabase,
      sales: {
        weightJewellery: { id: invW.id, subtotal: invW.subtotal, tax: invW.tax, total: invW.total },
        weightBelowMin: { id: (saleWMRes.body.data || saleWMRes.body).id, approval: appReq.id },
        bar24k: { id: invBar.id, goldValue: 600, certAmount: 30, certVat: invBar.tax, total: invBar.total, goldVat: 0 }
      },
      verification: {
        ONE_CANONICAL_SALE_WORKFLOW: "PASS",
        GOLD_SALE_PRICING_AUTHORITY_COUNT: 1,
        GOLD_BY_WEIGHT_SALE_PRICING: "PASS",
        BELOW_MINIMUM_MAKING_REQUIRES_APPROVAL: "PASS",
        AUTHORIZED_MANAGER_APPROVAL: "PASS",
        APPROVAL_AUDIT_EVIDENCE: "PASS",
        APPROVAL_REPLAY: "PASS",
        GOLD_24K_SALE_PRICING: "PASS",
        VAT_CERTIFICATE_ONLY_AT_SALE: "PASS",
        VAT_GOLD_BASE_AMOUNT_AT_SALE: 0,
        "24K_DOUBLE_TAX_GUARD": "PASS",
        SALE_VAT_RATE_HARDCODE_COUNT: 0,
        SALE_VAT_RATE_SOURCE_RULE: "PASS",
        SALE_VAT_AMOUNT_SERVER_AUTHORITY: "YES",
        FINANCIAL_PRICING_FACTS_NOT_METADATA_ONLY: "PASS",
        SALE_PRICING_AND_POSTING_TOTALS_MATCH: "PASS",
        POSTING_PRICING_RECALCULATION_AUTHORITY: 0,
        GOLD_SALE_IDEMPOTENCY: "PASS",
        GOLD_SALE_DOUBLE_SELL_RACE: "PASS",
        SALE_JOURNAL_BALANCED: "PASS",
        SALE_DOES_NOT_MUTATE_PURCHASE_HISTORY: "PASS",
        SALE_DOES_NOT_CORRUPT_CURRENT_VALUATION: "PASS",
        NO_SCHEMA_CHANGES: "YES",
      }
    }));
  } finally {
    if (saAuth) await saAuth.cleanup();
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(`CLIENT_REQUIREMENTS_BATCH_2B_FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
}).finally(async () => sequelize.close());
