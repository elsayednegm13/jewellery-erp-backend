"use strict";

// CONT44 acceptance-only proof.  It deliberately uses the public HTTP routes
// for receipt, sale, return, review and restock; it never writes persistent DB.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });
const expectedDatabase = "darfus_erp_inventory_rehearsal_20260804_160500z";
delete process.env.DATABASE_URL;
process.env.DB_NAME = expectedDatabase;

const sequelize = require("../src/config/database");
const models = require("../src/models");
const app = require("../src/app");
const technicalSessions = require("../src/services/technical-session.service");

const tokenId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 18);
const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements }))[0][0];

function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}
function stopServer(server) { return new Promise((resolve) => server.close(resolve)); }
async function request(baseUrl, method, pathname, { token, companyId, branchId, key, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (companyId) headers["X-Company-ID"] = companyId;
  if (branchId) headers["X-Branch-ID"] = branchId;
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let parsed = text;
  if (response.headers.get("content-type")?.includes("application/json") && text) {
    try { parsed = JSON.parse(text); } catch (_) { /* preserve invalid diagnostic text */ }
  }
  return { status: response.status, body: parsed };
}
async function superAdminToken() {
  const user = await models.User.findOne({ where: { email: "admin@admin.com", isActive: true } });
  assert.ok(user && user.accountType === "super_admin", "active Super Admin acceptance harness user is required");
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `cont44-sa-${tokenId()}` }, ip: "127.0.0.1" });
  return { user, token: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "cont44_complete") };
}
async function roleUserToken({ companyId, permitted }) {
  const permission = await models.Permission.findOne({ where: { name: "inventory.returns.approve_restock" } });
  assert.ok(permission, "R38 permission must exist after migration 61");
  const suffix = tokenId();
  const role = await models.Role.create({ id: `ROLE-CONT44-${suffix}`, companyId, name: permitted ? "CONT44 Restock Approver" : "CONT44 Restock Denied", slug: `cont44-restock-${suffix}`, description: "ACCEPTANCE ONLY: R38 permission proof", isSystem: false, isAdmin: false });
  if (permitted) await models.RolePermission.create({ roleId: role.id, permissionId: permission.id });
  const user = await models.User.create({ id: `USR-CONT44-${suffix}`, companyId, email: `cont44.${suffix}@acceptance.invalid`, firstName: permitted ? "Permission" : "Denied", lastName: "R38", password: crypto.randomBytes(32).toString("hex"), role: "sales", accountType: "legacy", isActive: true });
  await models.UserRole.create({ userId: user.id, roleId: role.id });
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `cont44-${permitted ? "allow" : "deny"}-${suffix}` }, ip: "127.0.0.1" });
  return {
    user, role, token: issued.token,
    cleanup: async () => {
      await technicalSessions.revokeSession(issued.session.id, user.id, "cont44_complete");
      // Acceptance-only authority is explicitly removed after the proof; the
      // review row retains the immutable technical reviewer id without a role
      // grant remaining in the acceptance environment.
      await models.UserRole.destroy({ where: { userId: user.id, roleId: role.id } });
      await models.RolePermission.destroy({ where: { roleId: role.id } });
      await user.update({ isActive: false });
    }
  };
}
function receiveBody({ scope, purchaseOrderId, description }) {
  return {
    id: purchaseOrderId, supplierId: scope.supplierId, branchId: scope.branchId, warehouseId: scope.branchId,
    purchaseDate: "2026-08-07", paymentMethod: "credit", paidAmount: 0, inventoryV2: true,
    items: [{
      name: description, type: "gold-weight", category: "CONT44 acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode,
      karat: 21, quantity: 1, weightPerUnit: 10, unitCost: 0, price: 0,
      perPiece: [{
        name: description, description, profile: "GOLD_BY_WEIGHT_JEWELLERY", type: "gold-weight", category: "CONT44 acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode,
        karat: 21, grossWeight: 10, stoneWeight: 2, goldColor: "Yellow", condition: "NEW",
        goldValuation: { purchaseGoldRate: 100, makingPerGram: 10, currentGoldRate: 120, currentMakingPerGram: 12 },
        pricing: { minimumMakingPerGram: 15, sellingMakingPerGram: 20 }
      }]
    }]
  };
}
async function receiveSaleReturn(baseUrl, admin, scope, label) {
  const suffix = tokenId();
  const receive = await request(baseUrl, "POST", "/purchase-orders/receive", { token: admin.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-RX-${label}-${suffix}`, body: receiveBody({ scope, purchaseOrderId: `CONT44-PO-${label}-${suffix}`, description: `CONT44 ${label} ${suffix}` }) });
  assert.equal(receive.status, 201, `receive ${label}: ${JSON.stringify(receive.body)}`);
  const asset = (receive.body.assets || receive.body.data?.assets || [])[0];
  assert.ok(asset?.id && asset?.barcode, "receipt must create one identified Asset");
  const rfidNumber = `CONT44-RFID-${label}-${suffix}`;
  const rfid = await request(baseUrl, "POST", `/inventory-v2/assets/${encodeURIComponent(asset.id)}/rfid`, { token: admin.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-RFID-${label}-${suffix}`, body: { rfidNumber, reason: "CONT44 identity-preservation acceptance" } });
  assert.equal(rfid.status, 201, `RFID assignment ${label}: ${JSON.stringify(rfid.body)}`);
  const saleBody = { branchId: scope.branchId, customerId: scope.customerId, paymentMethod: "cash", items: [{ assetId: asset.id, sellingGoldRate: 120, sellingMakingPerGram: 20 }] };
  const sale = await request(baseUrl, "POST", "/pos/checkout", { token: admin.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-SALE-${label}-${suffix}`, body: saleBody });
  assert.equal(sale.status, 201, `sale ${label}: ${JSON.stringify(sale.body)}`);
  const saleInvoice = sale.body.data || sale.body;
  const returned = await request(baseUrl, "POST", "/sales/returns", { token: admin.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-RETURN-${label}-${suffix}`, body: { originalInvoiceId: saleInvoice.id, returnedAssetIds: [asset.id], reason: `CONT44 R38 ${label}` } });
  assert.ok([200, 201].includes(returned.status), `return ${label}: ${JSON.stringify(returned.body)}`);
  const detail = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(asset.id)}`, { token: admin.token, companyId: scope.companyId, branchId: scope.branchId });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.asset.operationalStatus, "RETURNED", "canonical return must leave asset RETURNED");
  return { asset, rfidNumber, saleInvoice, returnResponse: returned, saleBody };
}
async function details(baseUrl, admin, scope, assetId) {
  const res = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(assetId)}`, { token: admin.token, companyId: scope.companyId, branchId: scope.branchId });
  assert.equal(res.status, 200); return res.body.data;
}
async function restockFinancialSnapshot(assetId) {
  return one(`SELECT
    (SELECT COUNT(*)::int FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id WHERE ii.asset_id=:assetId AND i.type='return' AND i.status='returned' AND i.posting_status='posted') AS completed_returns,
    (SELECT COUNT(*)::int FROM journal_entries je JOIN invoice_items ii ON ii.invoice_id=je.source_id WHERE ii.asset_id=:assetId AND je.source_type IN ('RETURN','RETURN_INVOICE','return')) AS return_journals,
    (SELECT COUNT(*)::int FROM cash_transactions ct JOIN invoices i ON ct.reference=i.id JOIN invoice_items ii ON ii.invoice_id=i.id WHERE ii.asset_id=:assetId AND ct.status='posted' AND i.type='return') AS return_treasury,
    (SELECT COUNT(*)::int FROM journal_entries) AS journals,
    (SELECT COUNT(*)::int FROM journal_lines) AS journal_lines,
    (SELECT COUNT(*)::int FROM cash_transactions) AS treasury` , { assetId });
}

async function main() {
  await sequelize.authenticate();
  assert.equal((await one("SELECT current_database() AS database")).database, expectedDatabase, "STOP — exact acceptance DB required before every mutation");
  const scope = await one(`SELECT c.id AS "companyId", b.id AS "branchId", s.id AS "supplierId", cust.id AS "customerId", i.code AS "inventoryCode", m.code AS "itemCode"
    FROM companies c JOIN branches b ON b.company_id=c.id AND b.name='Main Branch' JOIN suppliers s ON s.company_id=c.id JOIN customers cust ON cust.company_id=c.id
    JOIN barcode_inventory_codes i ON i.asset_type='gold-weight' AND i.is_active=true JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
    ORDER BY s.id,m.code LIMIT 1`);
  assert.ok(Object.values(scope || {}).every(Boolean), "acceptance fixture scope is incomplete");
  const { server, baseUrl } = await startServer();
  let admin; let denied; let permitted;
  try {
    admin = await superAdminToken();
    denied = await roleUserToken({ companyId: scope.companyId, permitted: false });
    permitted = await roleUserToken({ companyId: scope.companyId, permitted: true });

    // Main end-to-end proof: receipt -> sale -> financial return -> returned -> review -> available.
    const main = await receiveSaleReturn(baseUrl, admin, scope, "MAIN");
    const beforeReview = await details(baseUrl, admin, scope, main.asset.id);
    const identity = { id: beforeReview.asset.id, number: beforeReview.asset.assetNumber || beforeReview.asset.asset_number || null, barcode: beforeReview.asset.barcode, rfid: main.rfidNumber };
    const beforeRestockFinancial = await restockFinancialSnapshot(main.asset.id);
    assert.equal(beforeRestockFinancial.completed_returns, 1, "a fully posted return is mandatory before review");
    const missingCondition = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-MISSING-CONDITION-${tokenId()}`, body: { branchId: scope.branchId } });
    assert.equal(missingCondition.status, 422, "review condition is mandatory");
    const deniedApprove = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review/approve-restock`, { token: denied.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-DENY-APPROVE-${tokenId()}`, body: { branchId: scope.branchId } });
    assert.equal(deniedApprove.status, 403, "permission must be server-enforced for restock approval");
    const deniedReview = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review`, { token: denied.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-DENY-${tokenId()}`, body: { branchId: scope.branchId, conditionOutcome: "GOOD", note: "must be rejected" } });
    assert.equal(deniedReview.status, 403, "permission must be server-enforced for review");
    assert.equal((await details(baseUrl, admin, scope, main.asset.id)).asset.operationalStatus, "RETURNED");

    const blockedSale = await request(baseUrl, "POST", "/pos/checkout", { token: admin.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-SALE-BLOCK-${tokenId()}`, body: main.saleBody });
    assert.ok(blockedSale.status >= 400, "RETURNED asset must not be sellable before approval");

    const reviewKey = `CONT44-REVIEW-${tokenId()}`;
    const reviewBody = { branchId: scope.branchId, conditionOutcome: "GOOD", note: "CONT44 acceptance Good condition" };
    const review = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: reviewKey, body: reviewBody });
    assert.equal(review.status, 201, JSON.stringify(review.body));
    const reviewReplay = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: reviewKey, body: reviewBody });
    assert.equal(reviewReplay.status, 201); assert.equal(reviewReplay.body.data.reviewId, review.body.data.reviewId);
    const reviewChanged = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: reviewKey, body: { ...reviewBody, note: "changed" } });
    assert.equal(reviewChanged.status, 409);

    const approveKey = `CONT44-APPROVE-${tokenId()}`;
    const approveBody = { branchId: scope.branchId };
    const approved = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review/approve-restock`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: approveKey, body: approveBody });
    assert.equal(approved.status, 200, JSON.stringify(approved.body)); assert.equal(approved.body.data.financialSideEffectCount, 0);
    const approveReplay = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review/approve-restock`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: approveKey, body: approveBody });
    assert.equal(approveReplay.status, 200); assert.equal(approveReplay.body.data.reviewId, approved.body.data.reviewId);
    const approveChanged = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review/approve-restock`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: approveKey, body: { branchId: scope.branchId, note: "changed" } });
    assert.equal(approveChanged.status, 409);
    const afterRestock = await details(baseUrl, admin, scope, main.asset.id);
    assert.equal(afterRestock.asset.operationalStatus, "AVAILABLE");
    assert.equal(afterRestock.asset.id, identity.id); assert.equal(afterRestock.asset.barcode, identity.barcode);
    const [[rfidAfterRestock]] = await sequelize.query("SELECT rfid_number AS \"rfidNumber\" FROM asset_rfid_assignments WHERE asset_id=:assetId AND is_current=true", { replacements: { assetId: main.asset.id } });
    assert.equal(rfidAfterRestock.rfidNumber, identity.rfid, "the same current RFID relationship must remain after restock");
    const afterRestockFinancial = await restockFinancialSnapshot(main.asset.id);
    assert.deepEqual(afterRestockFinancial, beforeRestockFinancial, "restock must have zero financial side effects");
    const secondRestock = await request(baseUrl, "POST", `/inventory-v2/assets/${main.asset.id}/return-review/approve-restock`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-SECOND-${tokenId()}`, body: approveBody });
    assert.ok(secondRestock.status >= 400, "second restock must be rejected after AVAILABLE");

    // Non-GOOD is retained but never restocked.
    const nonGood = await receiveSaleReturn(baseUrl, admin, scope, "NONGOOD");
    const nonGoodReview = await request(baseUrl, "POST", `/inventory-v2/assets/${nonGood.asset.id}/return-review`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-NONGOOD-REVIEW-${tokenId()}`, body: { branchId: scope.branchId, conditionOutcome: "NEEDS_REPAIR", note: "source outcome retained" } });
    assert.equal(nonGoodReview.status, 201);
    const nonGoodApprove = await request(baseUrl, "POST", `/inventory-v2/assets/${nonGood.asset.id}/return-review/approve-restock`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-NONGOOD-APPROVE-${tokenId()}`, body: { branchId: scope.branchId } });
    assert.equal(nonGoodApprove.status, 422);
    assert.equal((await details(baseUrl, admin, scope, nonGood.asset.id)).asset.operationalStatus, "RETURNED");

    // Concurrent approval: exactly one durable transition and one review.
    const race = await receiveSaleReturn(baseUrl, admin, scope, "RACE");
    const raceReview = await request(baseUrl, "POST", `/inventory-v2/assets/${race.asset.id}/return-review`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-RACE-REVIEW-${tokenId()}`, body: { branchId: scope.branchId, conditionOutcome: "GOOD", note: "race" } });
    assert.equal(raceReview.status, 201);
    const [raceA, raceB] = await Promise.all([
      request(baseUrl, "POST", `/inventory-v2/assets/${race.asset.id}/return-review/approve-restock`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-RACE-A-${tokenId()}`, body: { branchId: scope.branchId } }),
      request(baseUrl, "POST", `/inventory-v2/assets/${race.asset.id}/return-review/approve-restock`, { token: permitted.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT44-RACE-B-${tokenId()}`, body: { branchId: scope.branchId } }),
    ]);
    const raceStatuses = [raceA.status, raceB.status];
    assert.equal(raceStatuses.filter((status) => status === 200).length, 1, `race outcomes: ${raceA.status}/${raceB.status}`);
    assert.ok(raceStatuses.some((status) => [409, 422].includes(status)), `one canonical stale-state loser required: ${raceA.status}/${raceB.status}`);
    assert.equal((await details(baseUrl, admin, scope, race.asset.id)).asset.operationalStatus, "AVAILABLE");
    const raceEvidence = await one(`SELECT (SELECT COUNT(*)::int FROM asset_return_reviews WHERE asset_id=:assetId) AS reviews,(SELECT COUNT(*)::int FROM asset_events WHERE asset_id=:assetId AND event_type='RETURNED_RESTOCK_APPROVED') AS restock_events,(SELECT COUNT(*)::int FROM inventory_asset_movements WHERE asset_id=:assetId AND movement_type='RETURNED_RESTOCK') AS restock_movements`, { assetId: race.asset.id });
    assert.deepEqual(raceEvidence, { reviews: 1, restock_events: 1, restock_movements: 1 });

    const evidence = await one(`SELECT
      (SELECT COUNT(*)::int FROM asset_return_reviews WHERE asset_id=:assetId AND condition_outcome='GOOD' AND reviewed_by=:reviewer AND approved_by=:reviewer AND approved_at IS NOT NULL) AS approved_review,
      (SELECT COUNT(*)::int FROM asset_events WHERE asset_id=:assetId AND event_type='SALE') AS sale_events,
      (SELECT COUNT(*)::int FROM asset_events WHERE asset_id=:assetId AND event_type='RETURN') AS return_events,
      (SELECT COUNT(*)::int FROM asset_events WHERE asset_id=:assetId AND event_type='RETURN_REVIEW_RECORDED') AS review_events,
      (SELECT COUNT(*)::int FROM asset_events WHERE asset_id=:assetId AND event_type='RETURNED_RESTOCK_APPROVED') AS restock_events,
      (SELECT COUNT(*)::int FROM inventory_asset_movements WHERE asset_id=:assetId AND movement_type='RETURNED_RESTOCK') AS restock_movements,
      (SELECT COUNT(*)::int FROM journal_entries je JOIN (SELECT journal_entry_id,SUM(debit::numeric) d,SUM(credit::numeric) c FROM journal_lines GROUP BY journal_entry_id) x ON x.journal_entry_id=je.id WHERE je.status IN ('posted','reversed') AND x.d<>x.c) AS unbalanced,
      (SELECT COUNT(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_lines,
      (SELECT COUNT(*)::int FROM cash_transactions ct LEFT JOIN journal_entries je ON je.id=ct.journal_entry_id WHERE ct.status='posted' AND ct.type<>'closing' AND (ct.journal_entry_id IS NULL OR je.id IS NULL)) AS unlinked_treasury`, { assetId: main.asset.id, reviewer: permitted.user.id });
    assert.deepEqual(evidence, { approved_review: 1, sale_events: 1, return_events: 1, review_events: 1, restock_events: 1, restock_movements: 1, unbalanced: 0, orphan_lines: 0, unlinked_treasury: 0 });
    console.log(JSON.stringify({
      R38_RETURNED_TO_AVAILABLE_RUNTIME: "PASS", R38_AUTHORIZATION: "PASS", R38_GOOD_CONDITION_GATE: "PASS", R38_IDEMPOTENCY: "PASS", R38_CONCURRENCY: "PASS", R38_FINANCIAL_SAFETY: "PASS", R38_AUDIT_HISTORY: "PASS", mainAssetId: main.asset.id, primaryBarcode: identity.barcode, raceStatuses: [raceA.status, raceB.status], restockFinancialSideEffects: 0
    }, null, 2));
  } finally {
    if (admin) await admin.cleanup();
    if (denied) await denied.cleanup();
    if (permitted) await permitted.cleanup();
    await stopServer(server); await sequelize.close();
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
