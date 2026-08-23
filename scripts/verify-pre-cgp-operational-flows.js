"use strict";

// CONT46 acceptance-only regression for operational inventory workflows that
// predate the profile-batch harnesses.  It is deliberately bound to the
// rehearsal DB before any fixture or HTTP mutation.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });

const ACCEPTANCE_DB = "darfus_erp_inventory_rehearsal_20260804_160500z";
delete process.env.DATABASE_URL;
process.env.DB_NAME = ACCEPTANCE_DB;

const sequelize = require("../src/config/database");
const models = require("../src/models");
const app = require("../src/app");
const technicalSessions = require("../src/services/technical-session.service");
const reservationService = require("../src/services/reservation.service");

const suffix = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);
const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements }))[0][0];
async function assertAcceptance() {
  assert.equal((await one("SELECT current_database() AS database")).database, ACCEPTANCE_DB,
    "STOP — CONT46 mutations require the exact acceptance database");
}
function startServer() { return new Promise((resolve, reject) => { const server = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` })); }); }
function stopServer(server) { return new Promise((resolve) => server.close(resolve)); }
async function request(baseUrl, method, pathname, { token, companyId, branchId, key, body } = {}) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Company-ID": companyId, "X-Branch-ID": branchId };
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let parsed = text;
  if (response.headers.get("content-type")?.includes("application/json") && text) { try { parsed = JSON.parse(text); } catch (_) {} }
  return { status: response.status, body: parsed };
}
async function superAdmin() {
  const user = await models.User.findOne({ where: { email: "admin@admin.com", isActive: true } });
  assert.ok(user?.accountType === "super_admin", "active Super Admin is required for CONT46 acceptance");
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `cont46-${suffix()}` }, ip: "127.0.0.1" });
  return { user, token: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "cont46_complete") };
}
async function permissionActor(companyId, permissionName) {
  await assertAcceptance();
  const permission = await models.Permission.findOne({ where: { name: permissionName } });
  assert.ok(permission, `permission ${permissionName} is required for CONT46`);
  const id = suffix();
  const role = await models.Role.create({ id: `ROLE-CONT46-${id}`, companyId, name: `CONT46 ${permissionName}`, slug: `cont46-${id}`, description: "ACCEPTANCE ONLY", isSystem: false, isAdmin: false });
  await models.RolePermission.create({ roleId: role.id, permissionId: permission.id });
  const user = await models.User.create({ id: `USR-CONT46-${id}`, companyId, email: `cont46.${id}@acceptance.invalid`, firstName: "CONT46", lastName: "Approver", password: crypto.randomBytes(32).toString("hex"), role: "sales", accountType: "legacy", isActive: true });
  await models.UserRole.create({ userId: user.id, roleId: role.id });
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `cont46-permission-${id}` }, ip: "127.0.0.1" });
  return { user, token: issued.token, cleanup: async () => { await technicalSessions.revokeSession(issued.session.id, user.id, "cont46_complete"); await models.UserRole.destroy({ where: { userId: user.id, roleId: role.id } }); await models.RolePermission.destroy({ where: { roleId: role.id } }); await user.update({ isActive: false }); } };
}
function receiveBody(scope, label) {
  const id = suffix();
  return { id: `CONT46-PO-${label}-${id}`, supplierId: scope.supplierId, branchId: scope.mainBranchId, warehouseId: scope.mainBranchId,
    purchaseDate: "2026-08-07", paymentMethod: "credit", paidAmount: 0, inventoryV2: true,
    items: [{ name: `CONT46 ${label} ${id}`, type: "gold-weight", category: "CONT46 acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode,
      karat: 21, quantity: 1, weightPerUnit: 10, unitCost: 100, price: 200,
      perPiece: [{ name: `CONT46 ${label} ${id}`, description: `CONT46 ${label} ${id}`, profile: "GOLD_BY_WEIGHT_JEWELLERY", type: "gold-weight", category: "CONT46 acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode,
        karat: 21, grossWeight: 10, stoneWeight: 0, goldColor: "Yellow", condition: "NEW",
        goldValuation: { purchaseGoldRate: 10, makingPerGram: 10, currentGoldRate: 12, currentMakingPerGram: 12 }, pricing: { minimumMakingPerGram: 15, sellingMakingPerGram: 20 } }] }] };
}
async function receive(baseUrl, admin, scope, label) {
  await assertAcceptance();
  const key = `CONT46-RX-${label}-${suffix()}`;
  const body = receiveBody(scope, label);
  const result = await request(baseUrl, "POST", "/purchase-orders/receive", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key, body });
  assert.equal(result.status, 201, `receive ${label}: ${JSON.stringify(result.body)}`);
  const asset = (result.body.assets || result.body.data?.assets || [])[0];
  assert.ok(asset?.id && asset?.barcode, "receive must produce one identified Asset");
  return asset;
}
async function assetDetail(baseUrl, admin, scope, assetId, branchId = scope.mainBranchId) {
  const result = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(assetId)}`, { token: admin.token, companyId: scope.companyId, branchId });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.data;
}
async function main() {
  await sequelize.authenticate(); await assertAcceptance();
  const scope = await one(`SELECT c.id AS "companyId", b.id AS "mainBranchId", d.id AS "destinationBranchId", s.id AS "supplierId", cust.id AS "customerId", i.code AS "inventoryCode", m.code AS "itemCode"
    FROM companies c JOIN branches b ON b.company_id=c.id AND b.name='Main Branch' AND b.is_active=true
    JOIN branches d ON d.company_id=c.id AND d.id<>b.id AND d.is_active=true
    JOIN suppliers s ON s.company_id=c.id JOIN customers cust ON cust.company_id=c.id
    JOIN barcode_inventory_codes i ON i.asset_type='gold-weight' AND i.is_active=true
    JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
    ORDER BY s.id,m.code LIMIT 1`);
  assert.ok(Object.values(scope || {}).every(Boolean), "CONT46 scope requires two active branches and receive taxonomy");
  const { server, baseUrl } = await startServer(); let admin; let adjuster;
  try {
    admin = await superAdmin();
    adjuster = await permissionActor(scope.companyId, "inventory.adjust");

    // Authentication and company context fail closed before any business mutation.
    const unauthenticated = await fetch(`${baseUrl}/api/v1/inventory-v2/assets?limit=1`);
    assert.equal(unauthenticated.status, 401, "Inventory V2 reads require authentication");
    const missingCompany = await fetch(`${baseUrl}/api/v1/inventory-v2/assets?limit=1`, { headers: { Authorization: `Bearer ${admin.token}`, "X-Branch-ID": scope.mainBranchId } });
    assert.equal(missingCompany.status, 422, "Super Admin Inventory V2 access requires an explicit company context");

    // Reservation is service-owned but uses the same canonical V2 state authority.
    const reservationAsset = await receive(baseUrl, admin, scope, "RESERVATION");
    await assertAcceptance();
    const reservationKey = `CONT46-RES-${suffix()}`;
    const reservationBody = { id: `CONT46-RES-${suffix()}`, customerId: scope.customerId, branchId: scope.mainBranchId, items: [{ assetId: reservationAsset.id, agreedPrice: "200" }], expiresAt: "2027-12-31", initialPayment: { amount: "20", paymentMethod: "cash" } };
    const createdReservation = await reservationService.createReservation({ companyId: scope.companyId, branchId: scope.mainBranchId, user: admin.user, idempotencyKey: reservationKey, body: reservationBody });
    assert.equal(createdReservation.statusCode, 201);
    const replayReservation = await reservationService.createReservation({ companyId: scope.companyId, branchId: scope.mainBranchId, user: admin.user, idempotencyKey: reservationKey, body: reservationBody });
    assert.equal(replayReservation.statusCode, 201);
    const reservationId = createdReservation.responseBody.data.reservation.id;
    assert.equal((await assetDetail(baseUrl, admin, scope, reservationAsset.id)).asset.operationalStatus, "RESERVED");
    await assertAcceptance();
    const cancelled = await reservationService.cancelReservation({ companyId: scope.companyId, branchId: scope.mainBranchId, user: admin.user, reservationId, body: { reason: "CONT46 release acceptance" } });
    assert.ok([200, 201].includes(cancelled.statusCode));
    assert.equal((await assetDetail(baseUrl, admin, scope, reservationAsset.id)).asset.operationalStatus, "AVAILABLE");

    // Transfer: exact identity crosses branches through Pending Transfer and returns Available.
    const transferAsset = await receive(baseUrl, admin, scope, "TRANSFER");
    const transferIdentity = { id: transferAsset.id, barcode: transferAsset.barcode };
    await assertAcceptance();
    const transfer = await request(baseUrl, "POST", "/transfers", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: { assetIds: [transferAsset.id], fromBranchId: scope.mainBranchId, toBranchId: scope.destinationBranchId, notes: "CONT46 transfer" } });
    assert.equal(transfer.status, 201, JSON.stringify(transfer.body));
    const transferId = transfer.body.data.id;
    assert.equal((await assetDetail(baseUrl, admin, scope, transferAsset.id)).asset.operationalStatus, "PENDING_TRANSFER");
    await assertAcceptance(); assert.equal((await request(baseUrl, "PATCH", `/transfers/${transferId}`, { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: { status: "in-transit" } })).status, 200);
    await assertAcceptance(); assert.equal((await request(baseUrl, "PATCH", `/transfers/${transferId}`, { token: admin.token, companyId: scope.companyId, branchId: scope.destinationBranchId, body: { status: "received" } })).status, 200);
    const transferred = await assetDetail(baseUrl, admin, scope, transferAsset.id, scope.destinationBranchId);
    assert.equal(transferred.asset.operationalStatus, "AVAILABLE"); assert.equal(transferred.asset.id, transferIdentity.id); assert.equal(transferred.asset.barcode, transferIdentity.barcode);
    const wrongBranch = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(transferAsset.id)}`, { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId });
    assert.ok([403, 404].includes(wrongBranch.status), "Asset detail must not leak across a different Branch context");
    const transferRaceAsset = await receive(baseUrl, admin, scope, "TRANSFER-RACE");
    await assertAcceptance();
    const [transferRaceA, transferRaceB] = await Promise.all([
      request(baseUrl, "POST", "/transfers", { token: adjuster.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: { assetIds: [transferRaceAsset.id], fromBranchId: scope.mainBranchId, toBranchId: scope.destinationBranchId, notes: "CONT46 transfer race" } }),
      request(baseUrl, "POST", "/transfers", { token: adjuster.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: { assetIds: [transferRaceAsset.id], fromBranchId: scope.mainBranchId, toBranchId: scope.destinationBranchId, notes: "CONT46 transfer race" } }),
    ]);
    const transferRace = [transferRaceA, transferRaceB];
    assert.equal(transferRace.filter((result) => result.status === 201).length, 1, `one transfer request must win: ${transferRaceA.status}/${transferRaceB.status}`);
    assert.equal(transferRace.filter((result) => result.status >= 400).length, 1, `one transfer request must lose: ${transferRaceA.status}/${transferRaceB.status}`);
    const transferRaceId = transferRace.find((result) => result.status === 201).body.data.id;
    await assertAcceptance(); assert.equal((await request(baseUrl, "PATCH", `/transfers/${transferRaceId}`, { token: adjuster.token, companyId: scope.companyId, branchId: scope.destinationBranchId, body: { status: "received" } })).status, 200);
    assert.equal((await assetDetail(baseUrl, admin, scope, transferRaceAsset.id, scope.destinationBranchId)).asset.operationalStatus, "AVAILABLE");

    // Workshop sends and returns the same Asset, with replay-safe return.
    const workshopAsset = await receive(baseUrl, admin, scope, "WORKSHOP"); const workshopKey = `CONT46-WORK-${suffix()}`;
    await assertAcceptance(); const workshop = await request(baseUrl, "POST", "/inventory-v2/workshop-orders", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: workshopKey, body: { assetIds: [workshopAsset.id], providerName: "CONT46", notes: "workshop" } });
    assert.equal(workshop.status, 201, JSON.stringify(workshop.body)); const workshopId = workshop.body.data.workshopOrderId;
    assert.equal((await assetDetail(baseUrl, admin, scope, workshopAsset.id)).asset.operationalStatus, "WORKSHOP");
    await assertAcceptance(); const workshopReturn = await request(baseUrl, "POST", `/inventory-v2/workshop-orders/${workshopId}/return`, { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: `CONT46-WORK-RETURN-${suffix()}`, body: { notes: "returned" } });
    assert.equal(workshopReturn.status, 200); assert.equal((await assetDetail(baseUrl, admin, scope, workshopAsset.id)).asset.operationalStatus, "AVAILABLE");

    // Missing preserves the Asset identity and blocks it through the canonical state transition.
    const missingAsset = await receive(baseUrl, admin, scope, "MISSING"); const missingKey = `CONT46-MISSING-${suffix()}`;
    await assertAcceptance(); const missing = await request(baseUrl, "POST", `/inventory-v2/assets/${missingAsset.id}/missing`, { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: missingKey, body: { reason: "CONT46 physical count exception" } });
    assert.equal(missing.status, 201, JSON.stringify(missing.body));
    const missingReplay = await request(baseUrl, "POST", `/inventory-v2/assets/${missingAsset.id}/missing`, { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: missingKey, body: { reason: "CONT46 physical count exception" } });
    assert.equal(missingReplay.status, 200); assert.equal((await assetDetail(baseUrl, admin, scope, missingAsset.id)).asset.operationalStatus, "MISSING");

    // Manufacturing creates one identified output with immutable lineage, then melt consumes a distinct whole input.
    const manufacturingInput = await receive(baseUrl, admin, scope, "MANUFACTURING"); const manufacturingKey = `CONT46-MFG-${suffix()}`;
    const manufacturingBody = { inputAssetIds: [manufacturingInput.id], reason: "CONT46 manufacture", outputs: [{ name: "CONT46 manufactured output", description: "CONT46 manufactured output", profile: "GOLD_BY_WEIGHT_JEWELLERY", type: "gold-weight", category: "CONT46", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode, karat: 21, grossWeight: 9, stoneWeight: 0, goldColor: "Yellow", purchaseCost: 100, physicalEvidence: "CONT46 manufacture physical output" }] };
    await assertAcceptance(); const manufactured = await request(baseUrl, "POST", "/inventory-v2/manufacturing-orders", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: manufacturingKey, body: manufacturingBody });
    assert.equal(manufactured.status, 201, JSON.stringify(manufactured.body)); const manufacturedOutputId = manufactured.body.data.outputAssetIds[0];
    const manufacturedReplay = await request(baseUrl, "POST", "/inventory-v2/manufacturing-orders", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: manufacturingKey, body: manufacturingBody });
    assert.equal(manufacturedReplay.status, 200); assert.equal((await assetDetail(baseUrl, admin, scope, manufacturingInput.id)).asset.operationalStatus, "MELTED"); assert.equal((await assetDetail(baseUrl, admin, scope, manufacturedOutputId)).asset.operationalStatus, "AVAILABLE");
    const meltInput = await receive(baseUrl, admin, scope, "MELT"); const meltKey = `CONT46-MELT-${suffix()}`;
    await assertAcceptance(); const melted = await request(baseUrl, "POST", "/inventory-v2/melt-orders", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: meltKey, body: { inputAssetIds: [meltInput.id], reason: "CONT46 melt", outputs: [] } });
    assert.equal(melted.status, 201, JSON.stringify(melted.body)); assert.equal((await assetDetail(baseUrl, admin, scope, meltInput.id)).asset.operationalStatus, "MELTED");

    // Audit is Asset-based; it observes an exact Asset and closes immutable evidence without an adjustment.
    const auditAsset = await receive(baseUrl, admin, scope, "AUDIT"); const auditNumber = `CONT46-AUD-${suffix()}`;
    await assertAcceptance(); const audit = await request(baseUrl, "POST", "/inventory-v2/audits", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: { auditNumber, auditMethod: "BARCODE_SCAN", notes: "CONT46" } });
    assert.equal(audit.status, 201, JSON.stringify(audit.body)); const auditId = audit.body.data.id;
    await assertAcceptance(); assert.equal((await request(baseUrl, "POST", `/inventory-v2/audits/${auditId}/start`, { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: {} })).status, 200);
    await assertAcceptance(); assert.equal((await request(baseUrl, "POST", `/inventory-v2/audits/${auditId}/observe`, { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: { assetIds: [auditAsset.id], method: "BARCODE_SCAN" } })).status, 200);
    await assertAcceptance(); assert.equal((await request(baseUrl, "POST", `/inventory-v2/audits/${auditId}/complete`, { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: {} })).status, 200);
    await assertAcceptance(); assert.equal((await request(baseUrl, "POST", `/inventory-v2/audits/${auditId}/close`, { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: {} })).status, 200);

    // Adjustment requires a second authorized user and uses only exact Assets.
    const adjustmentAsset = await receive(baseUrl, admin, scope, "ADJUSTMENT"); const adjustmentKey = `CONT46-ADJ-${suffix()}`;
    const adjustmentBody = { reason: "CONT46 controlled adjustment", items: [{ assetId: adjustmentAsset.id, expectedOperationalStatus: "AVAILABLE", newOperationalStatus: "MISSING", evidence: "CONT46 physical evidence" }] };
    await assertAcceptance(); const adjustment = await request(baseUrl, "POST", "/inventory-v2/adjustments", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: adjustmentKey, body: adjustmentBody });
    assert.equal(adjustment.status, 201, JSON.stringify(adjustment.body)); const adjustmentId = adjustment.body.data.adjustmentId;
    const adjustmentReplay = await request(baseUrl, "POST", "/inventory-v2/adjustments", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: adjustmentKey, body: adjustmentBody });
    assert.equal(adjustmentReplay.status, 200);
    const adjustmentConflict = await request(baseUrl, "POST", "/inventory-v2/adjustments", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: adjustmentKey, body: { ...adjustmentBody, reason: "CONT46 conflicting adjustment" } });
    assert.equal(adjustmentConflict.status, 409, "same adjustment key with a changed body must conflict");
    await assertAcceptance(); assert.equal((await request(baseUrl, "POST", `/inventory-v2/adjustments/${adjustmentId}/approve`, { token: adjuster.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: {} })).status, 200);
    await assertAcceptance(); assert.equal((await request(baseUrl, "POST", `/inventory-v2/adjustments/${adjustmentId}/apply`, { token: adjuster.token, companyId: scope.companyId, branchId: scope.mainBranchId, body: {} })).status, 200);
    assert.equal((await assetDetail(baseUrl, admin, scope, adjustmentAsset.id)).asset.operationalStatus, "MISSING");

    // Exchange is a single canonical command: it returns the sold source and sells the exact replacement.
    const exchangeSource = await receive(baseUrl, admin, scope, "EXCHANGE-SOURCE"); const exchangeReplacement = await receive(baseUrl, admin, scope, "EXCHANGE-REPLACEMENT");
    await assertAcceptance(); const exchangeSale = await request(baseUrl, "POST", "/pos/checkout", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: `CONT46-EX-SALE-${suffix()}`, body: { branchId: scope.mainBranchId, customerId: scope.customerId, paymentMethod: "cash", items: [{ assetId: exchangeSource.id, sellingGoldRate: 120, sellingMakingPerGram: 20 }] } });
    assert.equal(exchangeSale.status, 201, JSON.stringify(exchangeSale.body)); const exchangeInvoiceId = (exchangeSale.body.data || exchangeSale.body).id;
    const exchangeKey = `CONT46-EXCHANGE-${suffix()}`; const exchangeBody = { originalInvoiceId: exchangeInvoiceId, returnedAssetId: exchangeSource.id, newAssetIds: [exchangeReplacement.id], paymentMethod: "Exchange", notes: "CONT46 exact Asset exchange" };
    await assertAcceptance(); const exchange = await request(baseUrl, "POST", "/sales/exchanges", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: exchangeKey, body: exchangeBody });
    assert.ok([200, 201].includes(exchange.status), JSON.stringify(exchange.body));
    const exchangeReplay = await request(baseUrl, "POST", "/sales/exchanges", { token: admin.token, companyId: scope.companyId, branchId: scope.mainBranchId, key: exchangeKey, body: exchangeBody });
    assert.ok([200, 201].includes(exchangeReplay.status));
    assert.equal((await assetDetail(baseUrl, admin, scope, exchangeSource.id)).asset.operationalStatus, "RETURNED"); assert.equal((await assetDetail(baseUrl, admin, scope, exchangeReplacement.id)).asset.operationalStatus, "SOLD");

    const integrity = await one(`SELECT
      (SELECT COUNT(*)::int FROM (SELECT barcode FROM assets GROUP BY barcode HAVING COUNT(*)>1) d) AS duplicate_barcodes,
      (SELECT COUNT(*)::int FROM asset_rfid_assignments r LEFT JOIN assets a ON a.id=r.asset_id WHERE a.id IS NULL) AS orphan_rfid,
      (SELECT COUNT(*)::int FROM asset_lineage_links l LEFT JOIN assets p ON p.id=l.parent_asset_id LEFT JOIN assets c ON c.id=l.child_asset_id WHERE p.id IS NULL OR c.id IS NULL) AS orphan_lineage,
      (SELECT COUNT(*)::int FROM inventory_asset_movements m LEFT JOIN assets a ON a.id=m.asset_id WHERE a.id IS NULL) AS orphan_movements,
      (SELECT COUNT(*)::int FROM journal_entries je JOIN (SELECT journal_entry_id,SUM(debit::numeric) d,SUM(credit::numeric) c FROM journal_lines GROUP BY journal_entry_id) s ON s.journal_entry_id=je.id WHERE je.status IN ('posted','reversed') AND s.d<>s.c) AS unbalanced,
      (SELECT COUNT(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_journal_lines`);
    assert.deepEqual(integrity, { duplicate_barcodes: 0, orphan_rfid: 0, orphan_lineage: 0, orphan_movements: 0, unbalanced: 0, orphan_journal_lines: 0 });
    console.log(JSON.stringify({ result: "PASS", SECURITY_SCOPE_REGRESSION: "PASS", RESERVATION_REGRESSION: "PASS", TRANSFER_REGRESSION: "PASS", TRANSFER_CONCURRENCY: "PASS", WORKSHOP_REGRESSION: "PASS", MISSING_REGRESSION: "PASS", MANUFACTURING_REGRESSION: "PASS", MELT_REGRESSION: "PASS", AUDIT_REGRESSION: "PASS", ADJUSTMENT_REGRESSION: "PASS", EXCHANGE_REGRESSION: "PASS", operationalIntegrity: integrity }, null, 2));
  } finally { if (admin) await admin.cleanup(); if (adjuster) await adjuster.cleanup(); await stopServer(server); await sequelize.close(); }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
