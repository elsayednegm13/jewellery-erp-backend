"use strict";

// CONT37 focused acceptance: Pearl Size Master Data and the one canonical
// loose-measurement policy.  This script is deliberately acceptance-DB-only.
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
const pearlSizes = require("../src/services/pearl-size-master-data.service");

const suffix = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);
const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements }))[0][0];
function startServer() { return new Promise((resolve, reject) => { const server = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` })); }); }
function stopServer(server) { return new Promise((resolve) => server.close(resolve)); }
async function request(baseUrl, method, pathname, { token, companyId, branchId, key, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (companyId) headers["X-Company-ID"] = companyId;
  if (branchId) headers["X-Branch-ID"] = branchId;
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function superAdminToken() {
  const user = await models.User.findOne({ where: { email: "admin@admin.com", isActive: true } });
  assert.ok(user && user.accountType === "super_admin", "active Super Admin required");
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `cont37-${suffix()}` }, ip: "127.0.0.1" });
  return { user, token: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "cont37_done") };
}
async function codeFor(type) {
  const row = await one(`SELECT i.code AS "inventoryCode",m.code AS "itemCode" FROM barcode_inventory_codes i JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code) WHERE i.asset_type=:type AND i.is_active=true ORDER BY i.sort_order,i.code LIMIT 1`, { type });
  assert.ok(row?.inventoryCode && row?.itemCode, `active barcode taxonomy required for ${type}`);
  return row;
}
function loosePiece(profile, description, looseDetails) {
  const type = profile === "LOOSE_DIAMOND" ? "diamond" : profile === "LOOSE_GEMSTONE" ? "gemstone" : "pearl";
  return { name: description, description, profile, type, category: "CONT37 acceptance", grossWeight: "1.000", stoneWeight: "0", purchaseCost: "100", looseDetails };
}
async function receive(baseUrl, auth, scope, { profile, pieces, key = `CONT37-RX-${suffix()}` }) {
  const type = profile === "LOOSE_DIAMOND" ? "diamond" : profile === "LOOSE_GEMSTONE" ? "gemstone" : "pearl";
  const codes = await codeFor(type);
  const body = { supplierId: scope.supplierId, branchId: scope.branchId, warehouseId: scope.branchId, purchaseDate: "2026-08-07", paymentMethod: "credit", paidAmount: 0, inventoryV2: true, items: [{ name: `${profile} ${suffix()}`, type, category: "CONT37 acceptance", inventoryCode: codes.inventoryCode, itemCode: codes.itemCode, quantity: pieces.length, weightPerUnit: 1, unitCost: 100, price: 100, perPiece: pieces }] };
  const result = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key, body });
  return { result, body, key };
}
async function detail(baseUrl, auth, scope, id) { return request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(id)}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId }); }

async function main() {
  await sequelize.authenticate();
  const db = await one("SELECT current_database() AS db");
  assert.equal(db.db, expectedDatabase, "STOP — acceptance DB required");
  const scope = await one("SELECT c.id AS \"companyId\",b.id AS \"branchId\",s.id AS \"supplierId\" FROM companies c JOIN branches b ON b.company_id=c.id AND b.name='Main Branch' JOIN suppliers s ON s.company_id=c.id LIMIT 1");
  assert.ok(scope?.companyId && scope?.branchId && scope?.supplierId, "acceptance scope required");

  let seedTransaction = await sequelize.transaction();
  try { await pearlSizes.seedInitial({ models, companyId: scope.companyId, actorId: "acceptance:cont37", transaction: seedTransaction }); await seedTransaction.commit(); } catch (error) { await seedTransaction.rollback(); throw error; }
  const { server, baseUrl } = await startServer();
  let auth;
  try {
    auth = await superAdminToken();
    const list = await request(baseUrl, "GET", "/pearl-size-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(list.status, 200); assert.ok(list.body.data.values.length >= 39); assert.equal(await models.PearlSizeMasterData.count({ where: { companyId: scope.companyId, isOwnerApprovedInitial: true, isActive: true } }), 39); assert.equal(list.body.data.values.find((value) => value.displayValue === "12.0")?.unit, "MM");
    const size12 = list.body.data.values.find((value) => value.displayValue === "12.0"); assert.ok(size12, "12.0 mm master value required");

    const customValue = (21 + ((Date.now() % 900) + 100) / 1000).toFixed(3);
    const customA = await request(baseUrl, "POST", "/pearl-size-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { value: customValue } });
    assert.equal(customA.status, 201, JSON.stringify(customA.body));
    const customB = await request(baseUrl, "POST", "/pearl-size-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { value: customValue } });
    assert.equal(customB.status, 200); assert.equal(customB.body.replayed, true);
    const concurrentValue = "20.75";
    const [concurrentA, concurrentB] = await Promise.all([request(baseUrl, "POST", "/pearl-size-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { value: concurrentValue } }), request(baseUrl, "POST", "/pearl-size-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { value: concurrentValue } })]);
    assert.ok([200, 201].includes(concurrentA.status) && [200, 201].includes(concurrentB.status), `${concurrentA.status}/${concurrentB.status}`);
    const deactivate = await request(baseUrl, "PATCH", `/pearl-size-master-data/${customA.body.data.id}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { isActive: false } }); assert.equal(deactivate.status, 200);
    console.log("PEARL_SIZE_MASTER_DATA_API_IDEMPOTENCY_CONCURRENCY: PASS");

    const diamondA = await receive(baseUrl, auth, scope, { profile: "LOOSE_DIAMOND", pieces: [loosePiece("LOOSE_DIAMOND", "Diamond 1.768", { stoneName: "Diamond", diamondType: "Natural", carat: "1.768", color: "D", clarity: "VS1", shape: "ROUND" })] });
    assert.equal(diamondA.result.status, 201, JSON.stringify(diamondA.result.body));
    const diamondAsset = (diamondA.result.body.assets || diamondA.result.body.data?.assets)[0]; assert.ok(diamondAsset?.barcode);
    const diamondDetail = await detail(baseUrl, auth, scope, diamondAsset.id); assert.equal(diamondDetail.status, 200); assert.equal(Number(diamondDetail.body.data.looseDetails.carat), 1.768); assert.equal(diamondDetail.body.data.looseDetails.measurement.commercialDisplayValue, "1.76");
    const diamondNine = await receive(baseUrl, auth, scope, { profile: "LOOSE_DIAMOND", pieces: [loosePiece("LOOSE_DIAMOND", "Diamond 1.769", { stoneName: "Diamond", diamondType: "Natural", carat: "1.769", color: "D", clarity: "VS1", shape: "ROUND" })] });
    const diamondNineAsset = (diamondNine.result.body.assets || diamondNine.result.body.data?.assets)[0]; const diamondNineDetail = await detail(baseUrl, auth, scope, diamondNineAsset.id); assert.equal(diamondNineDetail.body.data.looseDetails.measurement.commercialDisplayValue, "1.77");
    const diamondBad = await receive(baseUrl, auth, scope, { profile: "LOOSE_DIAMOND", pieces: [loosePiece("LOOSE_DIAMOND", "Diamond bad", { stoneName: "Diamond", diamondType: "Natural", carat: "1.7691", color: "D", clarity: "VS1", shape: "ROUND" })] }); assert.equal(diamondBad.result.status, 422);
    console.log("LOOSE_DIAMOND_MEASURED_AND_9_RULE: PASS");

    const gemA = await receive(baseUrl, auth, scope, { profile: "LOOSE_GEMSTONE", pieces: [loosePiece("LOOSE_GEMSTONE", "Gem 2.348", { stoneName: "Sapphire", carat: "2.348" })] }); assert.equal(gemA.result.status, 201, JSON.stringify(gemA.result.body));
    const gemAsset = (gemA.result.body.assets || gemA.result.body.data?.assets)[0]; const gemDetail = await detail(baseUrl, auth, scope, gemAsset.id); assert.equal(Number(gemDetail.body.data.looseDetails.carat), 2.348); assert.equal(gemDetail.body.data.looseDetails.measurement.commercialDisplayValue, "2.34");
    const gemNine = await receive(baseUrl, auth, scope, { profile: "LOOSE_GEMSTONE", pieces: [loosePiece("LOOSE_GEMSTONE", "Gem 2.349", { stoneName: "Ruby", carat: "2.349" })] }); const gemNineAsset = (gemNine.result.body.assets || gemNine.result.body.data?.assets)[0]; const gemNineDetail = await detail(baseUrl, auth, scope, gemNineAsset.id); assert.equal(gemNineDetail.body.data.looseDetails.measurement.commercialDisplayValue, "2.35");
    const gemBad = await receive(baseUrl, auth, scope, { profile: "LOOSE_GEMSTONE", pieces: [loosePiece("LOOSE_GEMSTONE", "Gem bad", { stoneName: "Ruby", carat: "2.3491" })] }); assert.equal(gemBad.result.status, 422);
    console.log("LOOSE_GEMSTONE_MEASURED_AND_9_RULE: PASS");

    const pearlA = await receive(baseUrl, auth, scope, { profile: "LOOSE_PEARL", pieces: [loosePiece("LOOSE_PEARL", "Pearl 3.25", { totalPearlWeight: "3.25", pearlSizeId: size12.id, pearlType: "South Sea" })] }); assert.equal(pearlA.result.status, 201, JSON.stringify(pearlA.result.body));
    const pearlAsset = (pearlA.result.body.assets || pearlA.result.body.data?.assets)[0]; const pearlDetail = await detail(baseUrl, auth, scope, pearlAsset.id); assert.equal(Number(pearlDetail.body.data.looseDetails.totalPearlWeight), 3.25); assert.equal(pearlDetail.body.data.looseDetails.pearlSize, "12.0"); assert.equal(pearlDetail.body.data.looseDetails.measurement.unit, "CT");
    const pearlBadWeight = await receive(baseUrl, auth, scope, { profile: "LOOSE_PEARL", pieces: [loosePiece("LOOSE_PEARL", "Pearl bad weight", { totalPearlWeight: "3.257", pearlSizeId: size12.id })] }); assert.equal(pearlBadWeight.result.status, 422);
    const pearlBadSize = await receive(baseUrl, auth, scope, { profile: "LOOSE_PEARL", pieces: [loosePiece("LOOSE_PEARL", "Pearl bad size", { totalPearlWeight: "3.25", pearlSize: "12.25" })] }); assert.equal(pearlBadSize.result.status, 422);
    const pearlInactiveSize = await receive(baseUrl, auth, scope, { profile: "LOOSE_PEARL", pieces: [loosePiece("LOOSE_PEARL", "Pearl inactive size", { totalPearlWeight: "3.25", pearlSizeId: customA.body.data.id })] }); assert.equal(pearlInactiveSize.result.status, 422);
    const reactivate = await request(baseUrl, "PATCH", `/pearl-size-master-data/${customA.body.data.id}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { isActive: true } }); assert.equal(reactivate.status, 200);
    const pearlCustomSize = await receive(baseUrl, auth, scope, { profile: "LOOSE_PEARL", pieces: [loosePiece("LOOSE_PEARL", "Pearl custom size", { totalPearlWeight: "3.25", pearlSizeId: customA.body.data.id })] }); assert.equal(pearlCustomSize.result.status, 201);
    const pearlCustomAsset = (pearlCustomSize.result.body.assets || pearlCustomSize.result.body.data?.assets)[0]; const pearlCustomDetail = await detail(baseUrl, auth, scope, pearlCustomAsset.id); assert.equal(pearlCustomDetail.body.data.looseDetails.pearlSize, customA.body.data.displayValue);
    console.log("LOOSE_PEARL_MASTER_SIZE_AND_NO_SILENT_ROUNDING: PASS");

    const multi = await receive(baseUrl, auth, scope, { profile: "LOOSE_GEMSTONE", pieces: ["1.100", "1.200", "1.300"].map((carat, index) => loosePiece("LOOSE_GEMSTONE", `Gem multi ${index}`, { stoneName: "Sapphire", carat })) }); assert.equal(multi.result.status, 201); const multiAssets = multi.result.body.assets || multi.result.body.data?.assets; assert.equal(multiAssets.length, 3); assert.equal(new Set(multiAssets.map((asset) => asset.barcode)).size, 3);
    console.log("LOOSE_PROFILE_MULTI_PIECE_SERIALIZATION: PASS");

    const concurrentCodes = await codeFor("diamond");
    const concurrentBody = { supplierId: scope.supplierId, branchId: scope.branchId, warehouseId: scope.branchId, purchaseDate: "2026-08-07", paymentMethod: "credit", paidAmount: 0, inventoryV2: true, items: [{ name: `Concurrent loose diamond ${suffix()}`, type: "diamond", category: "CONT37 concurrency", inventoryCode: concurrentCodes.inventoryCode, itemCode: concurrentCodes.itemCode, quantity: 1, weightPerUnit: 1, unitCost: 100, price: 100, perPiece: [loosePiece("LOOSE_DIAMOND", "Concurrent diamond", { stoneName: "Diamond", diamondType: "Natural", carat: "1.111", color: "D", clarity: "VS1", shape: "ROUND" })] }] };
    const beforeConcurrentAssets = await models.Asset.count({ where: { companyId: scope.companyId } });
    const concurrentKey = `CONT37-CONCURRENT-${suffix()}`;
    const [receiveA, receiveB] = await Promise.all([request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: concurrentKey, body: concurrentBody }), request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: concurrentKey, body: concurrentBody })]);
    assert.ok([200, 201].includes(receiveA.status) && [200, 201].includes(receiveB.status), `${receiveA.status}/${receiveB.status}`); assert.equal(await models.Asset.count({ where: { companyId: scope.companyId } }), beforeConcurrentAssets + 1);
    console.log("LOOSE_PROFILE_RECEIVE_CONCURRENCY: PASS");

    const replay = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: diamondA.key, body: diamondA.body }); assert.ok([200, 201].includes(replay.status));
    const changed = structuredClone(diamondA.body); changed.items[0].perPiece[0].looseDetails.carat = "1.769";
    const conflict = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: diamondA.key, body: changed }); assert.equal(conflict.status, 409);
    console.log("LOOSE_PROFILE_RECEIVE_IDEMPOTENCY: PASS");

    const integrity = await one(`SELECT (SELECT COUNT(*)::int FROM (SELECT value,unit FROM pearl_size_master_data WHERE company_id=:companyId AND is_active GROUP BY value,unit HAVING COUNT(*)>1) duplicates) AS duplicate_active_sizes,(SELECT COUNT(*)::int FROM asset_components c LEFT JOIN assets a ON a.id=c.asset_id WHERE c.role='PRIMARY_SUBJECT' AND a.inventory_profile IN ('LOOSE_DIAMOND','LOOSE_GEMSTONE','LOOSE_PEARL') AND a.id IS NULL) AS orphan_loose_details,(SELECT COUNT(*)::int FROM journal_entries je WHERE je.status IN ('posted','reversed') AND COALESCE((SELECT SUM(jl.debit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id),0)<>COALESCE((SELECT SUM(jl.credit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id),0)) AS unbalanced,(SELECT COUNT(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_lines`, { companyId: scope.companyId });
    assert.equal(integrity.duplicate_active_sizes, 0); assert.equal(integrity.orphan_loose_details, 0); assert.equal(integrity.unbalanced, 0); assert.equal(integrity.orphan_lines, 0);
    console.log("LOOSE_PROFILE_RELATIONSHIP_AND_FINANCIAL_INTEGRITY: PASS");
  } finally { if (auth) await auth.cleanup(); await stopServer(server); await sequelize.close(); }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
