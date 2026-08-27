"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

// The desktop shell may expose Windows account variables such as DB_USER.
// This verifier must use the normal local development credentials from the
// backend environment file, then replace only the database name below.
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });

const expectedDatabase = String(process.env.INVENTORY_REHEARSAL_DB || "").trim();
assert.match(expectedDatabase, /^darfus_erp_inventory_rehearsal_[a-z0-9_]+$/i, "INVENTORY_REHEARSAL_DB must name the disposable rehearsal database");
assert.notEqual(expectedDatabase, "darfus_erp", "persistent database is forbidden");

// The runtime uses the normal local credentials, but this verifier selects the
// disposable database before any ORM or Express module is loaded.
delete process.env.DATABASE_URL;
process.env.DB_NAME = expectedDatabase;

const sequelize = require("../src/config/database");
const app = require("../src/app");
const { User } = require("../src/models");
const technicalSessions = require("../src/services/technical-session.service");

const requestId = () => crypto.randomUUID();

async function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", (error) => {
      if (error) return reject(error);
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function jsonRequest(baseUrl, method, pathname, { token, companyId, branchId, idempotencyKey, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (companyId) headers["X-Company-ID"] = companyId;
  if (branchId) headers["X-Branch-ID"] = branchId;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  return { status: response.status, body: isJson ? await response.json() : await response.text() };
}

async function authenticatedHarnessToken(baseUrl) {
  const configuredPassword = String(process.env.INVENTORY_REHEARSAL_ADMIN_PASSWORD || "").trim();
  if (configuredPassword) {
    const login = await jsonRequest(baseUrl, "POST", "/auth/login", {
      body: { email: "admin@admin.com", password: configuredPassword },
    });
    assert.equal(login.status, 200, "configured authenticated receive harness login failed");
    assert.ok(login.body?.data?.token, "configured authenticated receive harness did not receive a token");
    return { token: login.body.data.token, authenticationMode: "AUTHENTICATED_HTTP_LOGIN", cleanup: async () => {} };
  }

  // A local acceptance environment need not expose an owner password. This
  // still exercises the normal JWT/session/authentication middleware with a
  // short-lived real Super Admin technical session and is revoked on exit.
  const user = await User.findOne({ where: { email: "admin@admin.com", isActive: true } });
  assert.ok(user && user.accountType === "super_admin", "active Super Admin harness user is required");
  const issued = await technicalSessions.issueTokens(user, {
    headers: { "x-device-session-id": `batch-1a-${requestId()}` },
    ip: "127.0.0.1",
  });
  return {
    token: issued.token,
    authenticationMode: "AUTHENTICATED_IN_PROCESS_TECHNICAL_SESSION",
    cleanup: async () => technicalSessions.revokeSession(issued.session.id, user.id, "batch_1a_acceptance_complete"),
  };
}

async function one(sql, replacements = {}) {
  const [rows] = await sequelize.query(sql, { replacements });
  return rows[0];
}

async function main() {
  await sequelize.authenticate();
  const identity = await one("SELECT current_database() AS database");
  assert.equal(identity.database, expectedDatabase, "stop before mutation unless the exact disposable DB is connected");

  const scope = await one(`SELECT c.id AS "companyId", b.id AS "branchId", s.id AS "supplierId", i.code AS "inventoryCode", m.code AS "itemCode"
    FROM companies c
    JOIN branches b ON b.company_id=c.id AND b.name='Main Branch'
    JOIN suppliers s ON s.company_id=c.id
    JOIN barcode_inventory_codes i ON i.asset_type='gold-weight' AND i.is_active=true
    JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
    ORDER BY s.id, m.code
    LIMIT 1`);
  assert.ok(scope?.companyId && scope?.branchId && scope?.supplierId && scope?.inventoryCode && scope?.itemCode, "rehearsal prerequisites are incomplete");

  const { server, baseUrl } = await startServer();
  let authenticated = null;
  try {
    authenticated = await authenticatedHarnessToken(baseUrl);
    const token = authenticated.token;

    const suffix = requestId().replaceAll("-", "").slice(0, 18);
    const purchaseOrderId = `CR1A-${suffix}`;
    const idempotencyKey = `CR1A-RECEIVE-${suffix}`;
    const body = {
      id: purchaseOrderId,
      supplierId: scope.supplierId,
      branchId: scope.branchId,
      warehouseId: scope.branchId,
      purchaseDate: "2026-08-04",
      paymentMethod: "credit",
      paidAmount: 0,
      inventoryV2: true,
      items: [{
        name: `Batch 1A physical pieces ${suffix}`,
        type: "gold-weight",
        category: "Batch 1A acceptance",
        inventoryCode: scope.inventoryCode,
        itemCode: scope.itemCode,
        karat: 21,
        quantity: 3,
        weightPerUnit: 1.22,
        unitCost: 120,
        price: 120,
        perPiece: [
          { name: `Batch 1A piece 1 ${suffix}`, profile: "GOLD_BY_WEIGHT_JEWELLERY", inventoryProfile: "GOLD_BY_WEIGHT_JEWELLERY", type: "gold-weight", category: "Batch 1A acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode, karat: 21, grossWeight: 1.11, stoneWeight: 0, purchaseCost: 110, goldValue: 110, condition: null, location: "Showroom", certificate: { issuer: "Batch 1B issuer", certificateNumber: `CR1B-${suffix}`, issueDate: "2026-08-05", imageUrl: "attachment://batch-1b-certificate" } },
          { name: `Batch 1A piece 2 ${suffix}`, profile: "GOLD_BY_WEIGHT_JEWELLERY", inventoryProfile: "GOLD_BY_WEIGHT_JEWELLERY", type: "gold-weight", category: "Batch 1A acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode, karat: 21, grossWeight: 1.22, stoneWeight: 0, purchaseCost: 120, goldValue: 120, condition: null, location: "Showroom" },
          { name: `Batch 1A piece 3 ${suffix}`, profile: "GOLD_BY_WEIGHT_JEWELLERY", inventoryProfile: "GOLD_BY_WEIGHT_JEWELLERY", type: "gold-weight", category: "Batch 1A acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode, karat: 21, grossWeight: 1.33, stoneWeight: 0, purchaseCost: 130, goldValue: 130, condition: null, location: "Showroom" },
        ],
      }],
    };

    const before = await one(`SELECT
      (SELECT COUNT(*)::int FROM assets) AS assets,
      (SELECT COUNT(*)::int FROM products) AS products,
      (SELECT COALESCE(SUM(quantity_on_hand), 0)::numeric FROM products) AS product_quantity_on_hand,
      (SELECT COALESCE(SUM(quantity_available), 0)::numeric FROM products) AS product_quantity_available,
      (SELECT COUNT(*)::int FROM journal_entries) AS journals`);
    const first = await jsonRequest(baseUrl, "POST", "/purchase-orders/receive", { token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey, body });
    assert.equal(first.status, 201, "three-piece V2 receive must succeed");
    const assets = first.body?.assets || first.body?.data?.assets;
    const journal = first.body?.journalEntry || first.body?.data?.journalEntry;
    assert.equal(assets?.length, 3, "three physical pieces must create three assets");
    assert.equal(new Set(assets.map((asset) => asset.id)).size, 3, "asset IDs must be distinct");
    assert.equal(new Set(assets.map((asset) => asset.barcode)).size, 3, "barcodes must be distinct");
    assert.ok(assets.every((asset) => asset.inventoryProfile === "GOLD_BY_WEIGHT_JEWELLERY" && asset.operationalStatus === "AVAILABLE" && asset.companyId === scope.companyId && asset.branchId === scope.branchId), "all received assets must be canonical V2 assets in the selected company and branch");
    assert.equal(assets[0].metadata?.profileContract?.certificate?.certificateNumber, `CR1B-${suffix}`, "V2 read-back must preserve the normalized certificate contract");
    assert.ok(journal && Number(journal.totalDebit) === Number(journal.totalCredit), "purchase journal must balance");

    const assetIds = assets.map((asset) => asset.id);
    const evidence = await one(`SELECT
      (SELECT COUNT(*)::int FROM asset_origins WHERE asset_id IN (:assetIds)) AS origins,
      (SELECT COUNT(*)::int FROM asset_purchase_cost_revisions WHERE asset_id IN (:assetIds)) AS costs,
      (SELECT COUNT(*)::int FROM purchase_order_item_asset_links WHERE asset_id IN (:assetIds)) AS po_links,
      (SELECT COUNT(*)::int FROM asset_events WHERE asset_id IN (:assetIds) AND event_type='PURCHASE_RECEIVED') AS history,
      (SELECT COUNT(*)::int FROM inventory_asset_movements WHERE asset_id IN (:assetIds) AND movement_type='PURCHASE_RECEIVE') AS movements,
      (SELECT COUNT(*)::int FROM asset_certificates WHERE asset_id IN (:assetIds)) AS certificates,
      (SELECT COUNT(*)::int FROM (SELECT barcode FROM assets WHERE id IN (:assetIds) GROUP BY barcode HAVING COUNT(*) > 1) d) AS duplicate_barcodes,
      (SELECT COUNT(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_journal_lines,
      (SELECT COUNT(*)::int FROM cash_transactions ct LEFT JOIN journal_entries je ON je.id=ct.journal_entry_id WHERE ct.status='posted' AND ct.type<>'closing' AND (ct.journal_entry_id IS NULL OR je.id IS NULL)) AS unlinked_treasury`, { assetIds });
    assert.deepEqual(evidence, { origins: 3, costs: 3, po_links: 3, history: 3, movements: 3, certificates: 1, duplicate_barcodes: 0, orphan_journal_lines: 0, unlinked_treasury: 0 }, "per-piece receipt evidence is incomplete");
    const poEvidence = await one(`SELECT
      p.status,
      COUNT(i.*)::int AS items,
      COALESCE(SUM(i.quantity), 0)::int AS document_quantity,
      COALESCE(SUM(i.received_quantity), 0)::int AS received_quantity,
      COUNT(i.product_id)::int AS product_links
      FROM purchase_orders p
      JOIN purchase_order_items i ON i.purchase_order_id=p.id
      WHERE p.id=:purchaseOrderId
      GROUP BY p.status`, { purchaseOrderId });
    assert.deepEqual(poEvidence, { status: "received", items: 3, document_quantity: 3, received_quantity: 3, product_links: 0 }, "PO document bookkeeping must link the three received pieces without Product identity");

    const replay = await jsonRequest(baseUrl, "POST", "/purchase-orders/receive", { token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey, body });
    assert.equal(replay.status, 201, "same-key same-body must replay the original receive");
    const replayAssets = replay.body?.assets || replay.body?.data?.assets;
    assert.deepEqual(replayAssets.map((asset) => asset.id).sort(), assetIds.slice().sort(), "replay must return original assets");

    const changedBody = structuredClone(body);
    changedBody.items[0].perPiece[0].purchaseCost = 111;
    const conflict = await jsonRequest(baseUrl, "POST", "/purchase-orders/receive", { token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey, body: changedBody });
    assert.equal(conflict.status, 409, "same-key changed-body must conflict");

    const differentKey = await jsonRequest(baseUrl, "POST", "/purchase-orders/receive", { token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: `${idempotencyKey}-other`, body });
    assert.ok(differentKey.status >= 400, "different key cannot duplicate the durable purchase source");

    const unsafeProductPayload = structuredClone(body);
    unsafeProductPayload.id = `${purchaseOrderId}-product`;
    unsafeProductPayload.items[0].productCode = "LEGACY-PRODUCT-MUST-NOT-BE-ASSET-IDENTITY";
    const unsafeProduct = await jsonRequest(baseUrl, "POST", "/purchase-orders/receive", {
      token,
      companyId: scope.companyId,
      branchId: scope.branchId,
      idempotencyKey: `${idempotencyKey}-unsafe-product`,
      body: unsafeProductPayload,
    });
    assert.ok(unsafeProduct.status >= 400, "V2 receipt must reject Product identity for physical pieces");

    const after = await one(`SELECT
      (SELECT COUNT(*)::int FROM assets) AS assets,
      (SELECT COUNT(*)::int FROM products) AS products,
      (SELECT COALESCE(SUM(quantity_on_hand), 0)::numeric FROM products) AS product_quantity_on_hand,
      (SELECT COALESCE(SUM(quantity_available), 0)::numeric FROM products) AS product_quantity_available,
      (SELECT COUNT(*)::int FROM journal_entries) AS journals,
      (SELECT COUNT(*)::int FROM journal_entries WHERE source_id=:purchaseOrderId) AS purchase_journals`, { purchaseOrderId });
    assert.equal(after.assets, before.assets + 3, "replay/conflict must not duplicate assets");
    assert.equal(after.products, before.products, "V2 receipt must not create or mutate Product quantity authority");
    assert.equal(Number(after.product_quantity_on_hand), Number(before.product_quantity_on_hand), "V2 receipt must not change Product on-hand quantity");
    assert.equal(Number(after.product_quantity_available), Number(before.product_quantity_available), "V2 receipt must not change Product available quantity");
    assert.equal(after.journals, before.journals + 1, "replay/conflict must not duplicate the purchase journal");
    assert.equal(after.purchase_journals, 1, "purchase source must own exactly one journal");

    console.log(JSON.stringify({ result: "PASS", database: identity.database, authenticationMode: authenticated.authenticationMode, purchaseOrderId, assets: assetIds, barcodes: assets.map((asset) => asset.barcode), evidence: { ...evidence, po: poEvidence }, journal: { id: journal.id, debit: journal.totalDebit, credit: journal.totalCredit }, idempotency: { replay: replay.status, changedBody: conflict.status, differentKey: differentKey.status }, safety: { v2ProductIdentityRejected: unsafeProduct.status } }));
  } finally {
    if (authenticated) await authenticated.cleanup();
    await stopServer(server);
  }
}

main()
  .catch((error) => {
    console.error(`CLIENT_REQUIREMENTS_BATCH_1A_FAIL: ${error.stack || error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => { await sequelize.close(); });
