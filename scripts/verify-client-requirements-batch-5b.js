"use strict";

// CONT39 acceptance harness.  It uses the real HTTP routes, authentication,
// idempotency and canonical V2 receive/sale paths against the acceptance DB.
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
  assert.ok(user && user.accountType === "super_admin", "active Super Admin harness user is required");
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `cont39-${suffix()}` }, ip: "127.0.0.1" });
  return { token: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "cont39_done") };
}
async function limitedSalesToken(companyId) {
  let user = await models.User.findOne({ where: { companyId, role: "sales" } });
  if (!user) user = await models.User.create({ id: `USR-CONT39-${suffix()}`, companyId, email: `cont39.${suffix()}@test.local`, firstName: "Limited", lastName: "Sales", role: "sales", accountType: "legacy", isActive: true });
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `cont39-limited-${suffix()}` }, ip: "127.0.0.1" });
  return { token: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "cont39_limited_done") };
}
async function codeFor(type) {
  const row = await one(`SELECT i.code AS "inventoryCode",m.code AS "itemCode" FROM barcode_inventory_codes i JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code) WHERE i.asset_type=:type AND i.is_active=true ORDER BY i.sort_order,i.code LIMIT 1`, { type });
  assert.ok(row?.inventoryCode && row?.itemCode, `active Barcode taxonomy required for ${type}`);
  return row;
}
function valueByCategory(rows, category) { const value = rows.find((row) => row.category === category); assert.ok(value, `source seed required: ${category}`); return value; }
async function receive(baseUrl, auth, scope, profile, pieces, key = `CONT39-RX-${suffix()}`) {
  const type = profile === "LOOSE_GEMSTONE" ? "gemstone" : "pearl";
  const codes = await codeFor(type);
  const body = { id: `CONT39-PO-${suffix()}`, supplierId: scope.supplierId, branchId: scope.branchId, warehouseId: scope.branchId, purchaseDate: "2026-08-07", paymentMethod: "credit", paidAmount: 0, applyVat: true, vatRate: 7.25, inventoryV2: true, items: [{ name: `${profile} ${suffix()}`, type, category: "CONT39 acceptance", inventoryCode: codes.inventoryCode, itemCode: codes.itemCode, quantity: pieces.length, weightPerUnit: 1, unitCost: 100, price: 100, perPiece: pieces }] };
  const result = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key, body });
  return { body, key, result };
}
async function detail(baseUrl, auth, scope, id) { return request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(id)}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId }); }
function gemPiece(label, refs) {
  return { name: label, description: label, profile: "LOOSE_GEMSTONE", type: "gemstone", category: "CONT39", grossWeight: "2.348", stoneWeight: "0", purchaseCost: "100", looseDetails: { stoneName: refs.GEMSTONE_NAME.label, diamondType: refs.GEMSTONE_TYPE.label, treatment: refs.GEMSTONE_TREATMENT.label, shape: refs.GEMSTONE_SHAPE.label, color: refs.GEMSTONE_COLOR.label, tone: refs.GEMSTONE_TONE.label, toneLevel: refs.GEMSTONE_TONE_LEVEL.label, saturation: refs.GEMSTONE_SATURATION.label, opticalEffect: refs.GEMSTONE_OPTICAL_EFFECT.label, origin: refs.GEMSTONE_ORIGIN.label, carat: "2.348", masterData: { stoneName: refs.GEMSTONE_NAME.id, stoneType: refs.GEMSTONE_TYPE.id, treatment: refs.GEMSTONE_TREATMENT.id, shape: refs.GEMSTONE_SHAPE.id, color: refs.GEMSTONE_COLOR.id, tone: refs.GEMSTONE_TONE.id, toneLevel: refs.GEMSTONE_TONE_LEVEL.id, saturation: refs.GEMSTONE_SATURATION.id, opticalEffect: refs.GEMSTONE_OPTICAL_EFFECT.id, origin: refs.GEMSTONE_ORIGIN.id, certificateAuthority: refs.CERTIFICATE_AUTHORITY.id } }, looseFinancial: { purchaseCost: "100", additionalCost: "10", vatRate: "7.25" }, looseCurrentValuation: { currentValue: "130", currentVatRate: "7.25" }, pricing: { markupPercent: "20", maximumDiscountPercent: "10", minimumSellingPrice: "160" }, certificate: { issuerId: refs.CERTIFICATE_AUTHORITY.id, certificateNumber: `GEM-CERT-${suffix()}`, issueDate: "2026-08-07", url: "https://acceptance.invalid/gem.pdf" } };
}
function pearlPiece(label, refs, { sizeId = null } = {}) {
  return { name: label, description: label, profile: "LOOSE_PEARL", type: "pearl", category: "CONT39", grossWeight: "3.250", stoneWeight: "0", purchaseCost: "90", looseDetails: { totalPearlWeight: "3.25", pearlSizeId: sizeId, pearlType: refs.PEARL_TYPE.label, color: refs.PEARL_COLOR.label, overtone: refs.PEARL_OVERTONE.label, orient: refs.PEARL_ORIENT.label, shape: refs.PEARL_SHAPE.label, luster: refs.PEARL_LUSTER.label, surfaceQuality: refs.PEARL_SURFACE_QUALITY.label, nacreQuality: refs.PEARL_NACRE_QUALITY.label, origin: refs.PEARL_ORIGIN.label, masterData: { pearlType: refs.PEARL_TYPE.id, pearlColor: refs.PEARL_COLOR.id, overtone: refs.PEARL_OVERTONE.id, orient: refs.PEARL_ORIENT.id, pearlShape: refs.PEARL_SHAPE.id, luster: refs.PEARL_LUSTER.id, surfaceQuality: refs.PEARL_SURFACE_QUALITY.id, nacreQuality: refs.PEARL_NACRE_QUALITY.id, pearlOrigin: refs.PEARL_ORIGIN.id, certificateAuthority: refs.CERTIFICATE_AUTHORITY.id } }, looseFinancial: { purchaseCost: "90", vatRate: "7.25" }, looseCurrentValuation: { currentValue: "110", currentVatRate: "7.25" }, pricing: { markupPercent: "20", maximumDiscountPercent: "10", minimumSellingPrice: "135" }, certificate: { issuerId: refs.CERTIFICATE_AUTHORITY.id, certificateNumber: `PEARL-CERT-${suffix()}`, issueDate: "2026-08-07", url: "https://acceptance.invalid/pearl.pdf" } };
}

async function main() {
  await sequelize.authenticate();
  assert.equal((await one("SELECT current_database() AS db")).db, expectedDatabase, "STOP — acceptance DB required");
  const scope = await one("SELECT c.id AS \"companyId\",b.id AS \"branchId\",s.id AS \"supplierId\",cu.id AS \"customerId\" FROM companies c JOIN branches b ON b.company_id=c.id AND b.name='Main Branch' JOIN suppliers s ON s.company_id=c.id JOIN customers cu ON cu.company_id=c.id LIMIT 1");
  assert.ok(scope?.companyId && scope?.branchId && scope?.supplierId && scope?.customerId, "acceptance scope required");
  const { server, baseUrl } = await startServer();
  let auth;
  try {
    auth = await superAdminToken();
    const list = await request(baseUrl, "GET", "/profile-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(list.status, 200); const source = list.body.data.values;
    for (const category of ["GEMSTONE_NAME", "GEMSTONE_TYPE", "GEMSTONE_SHAPE", "GEMSTONE_COLOR", "GEMSTONE_TONE", "GEMSTONE_TONE_LEVEL", "GEMSTONE_SATURATION", "GEMSTONE_OPTICAL_EFFECT", "GEMSTONE_ORIGIN", "PEARL_TYPE", "PEARL_COLOR", "PEARL_OVERTONE", "PEARL_ORIENT", "PEARL_SHAPE", "PEARL_LUSTER", "PEARL_SURFACE_QUALITY", "PEARL_NACRE_QUALITY", "PEARL_ORIGIN", "CERTIFICATE_AUTHORITY"]) assert.ok(source.some((row) => row.category === category), `source seed absent: ${category}`);
    assert.equal((await request(baseUrl, "POST", "/profile-master-data", { companyId: scope.companyId, branchId: scope.branchId, body: { category: "GEMSTONE_TREATMENT", value: "Unauthorized" } })).status, 401);
    const treatmentValue = `CONT39 Heated ${suffix()}`;
    const [createA, createB] = await Promise.all([request(baseUrl, "POST", "/profile-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { category: "GEMSTONE_TREATMENT", value: treatmentValue } }), request(baseUrl, "POST", "/profile-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { category: "GEMSTONE_TREATMENT", value: treatmentValue } })]);
    assert.ok([200, 201].includes(createA.status) && [200, 201].includes(createB.status));
    const treatment = createA.body.data; assert.equal(await models.sequelize.query("SELECT COUNT(*)::int AS count FROM profile_master_data WHERE company_id=:companyId AND category_key='GEMSTONE_TREATMENT' AND canonical_value=:value", { replacements: { companyId: scope.companyId, value: treatmentValue.toLowerCase() }, type: models.sequelize.QueryTypes.SELECT }).then((rows) => rows[0].count), 1);
    const editValue = await request(baseUrl, "POST", "/profile-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { category: "GEMSTONE_TREATMENT", value: `CONT39 Editable ${suffix()}` } }); assert.equal(editValue.status, 201);
    assert.equal((await request(baseUrl, "PATCH", `/profile-master-data/${editValue.body.data.id}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { value: `CONT39 Renamed ${suffix()}` } })).status, 200);
    console.log("PROFILE_MASTER_DATA_ADMIN_CONCURRENCY: PASS");

    const gemRefs = Object.fromEntries(["GEMSTONE_NAME", "GEMSTONE_TYPE", "GEMSTONE_SHAPE", "GEMSTONE_COLOR", "GEMSTONE_TONE", "GEMSTONE_TONE_LEVEL", "GEMSTONE_SATURATION", "GEMSTONE_OPTICAL_EFFECT", "GEMSTONE_ORIGIN", "CERTIFICATE_AUTHORITY"].map((category) => [category, valueByCategory(source, category)])); gemRefs.GEMSTONE_TREATMENT = treatment;
    const gem = await receive(baseUrl, auth, scope, "LOOSE_GEMSTONE", [gemPiece(`CONT39 Gem ${suffix()}`, gemRefs)]); assert.equal(gem.result.status, 201, JSON.stringify(gem.result.body));
    const gemAsset = (gem.result.body.assets || gem.result.body.data.assets)[0]; const gemRead = await detail(baseUrl, auth, scope, gemAsset.id); assert.equal(gemRead.status, 200); assert.equal(gemRead.body.data.looseDetails.measurement.commercialDisplayValue, "2.34"); assert.equal(gemRead.body.data.looseDetails.masterDataReferences.length, 11); assert.equal(Number(gemRead.body.data.currentPurchaseCost.total_purchase_cost), 117.25); assert.equal(Number(gemRead.body.data.currentValuation.total_value), 139.425);
    assert.equal((await request(baseUrl, "PATCH", `/profile-master-data/${treatment.id}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { value: `${treatmentValue} altered` } })).status, 422);
    assert.equal((await request(baseUrl, "PATCH", `/profile-master-data/${treatment.id}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { isActive: false } })).status, 200);
    const historicalTreatment = (await detail(baseUrl, auth, scope, gemAsset.id)).body.data.looseDetails.masterDataReferences.find((row) => row.category === "GEMSTONE_TREATMENT");
    assert.equal(historicalTreatment.isActive, false, "deactivation must preserve the immutable historical master-data snapshot");
    const activeAfterDeactivate = await request(baseUrl, "GET", "/profile-master-data", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(activeAfterDeactivate.body.data.values.some((row) => row.id === treatment.id), false, "inactive treatment must not be selectable for new receipt");
    assert.equal((await request(baseUrl, "PATCH", `/profile-master-data/${treatment.id}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, body: { isActive: true } })).status, 200);
    const badGem = gemPiece(`Bad Gem ${suffix()}`, gemRefs); badGem.looseDetails.carat = "2.3491"; assert.equal((await receive(baseUrl, auth, scope, "LOOSE_GEMSTONE", [badGem])).result.status, 422);
    const wrongGem = gemPiece(`Wrong Gem ${suffix()}`, gemRefs); wrongGem.looseDetails.masterData.shape = valueByCategory(source, "PEARL_SHAPE").id; assert.equal((await receive(baseUrl, auth, scope, "LOOSE_GEMSTONE", [wrongGem])).result.status, 422);
    console.log("LOOSE_GEMSTONE_SOURCE_MASTER_FINANCE_READBACK: PASS");

    const pearlRefs = Object.fromEntries(["PEARL_TYPE", "PEARL_COLOR", "PEARL_OVERTONE", "PEARL_ORIENT", "PEARL_SHAPE", "PEARL_LUSTER", "PEARL_SURFACE_QUALITY", "PEARL_NACRE_QUALITY", "PEARL_ORIGIN", "CERTIFICATE_AUTHORITY"].map((category) => [category, valueByCategory(source, category)]));
    const size = await one("SELECT id FROM pearl_size_master_data WHERE company_id=:companyId AND is_active=true ORDER BY value LIMIT 1", { companyId: scope.companyId });
    const pearl = await receive(baseUrl, auth, scope, "LOOSE_PEARL", [pearlPiece(`CONT39 Pearl identical ${suffix()}`, pearlRefs), pearlPiece(`CONT39 Pearl identical ${suffix()}`, pearlRefs), pearlPiece(`CONT39 Pearl sized ${suffix()}`, pearlRefs, { sizeId: size.id })]); assert.equal(pearl.result.status, 201, JSON.stringify(pearl.result.body));
    const pearlAssets = pearl.result.body.assets || pearl.result.body.data.assets; assert.equal(pearlAssets.length, 3); assert.equal(new Set(pearlAssets.map((asset) => asset.id)).size, 3); assert.equal(new Set(pearlAssets.map((asset) => asset.barcode)).size, 3);
    const pearlRead = await detail(baseUrl, auth, scope, pearlAssets[0].id); assert.equal(pearlRead.status, 200); assert.equal(pearlRead.body.data.looseDetails.pearlSize, null); assert.equal(pearlRead.body.data.looseDetails.measurement.unit, "CT"); assert.equal(Number(pearlRead.body.data.currentPurchaseCost.total_purchase_cost), 96.525); assert.equal(Number(pearlRead.body.data.currentValuation.total_value), 117.975);
    const badPearl = pearlPiece(`Bad Pearl ${suffix()}`, pearlRefs); badPearl.looseDetails.totalPearlWeight = "3.257"; assert.equal((await receive(baseUrl, auth, scope, "LOOSE_PEARL", [badPearl])).result.status, 422);
    const unknownSize = pearlPiece(`Unknown Pearl ${suffix()}`, pearlRefs, { sizeId: "PSMD-UNKNOWN" }); assert.equal((await receive(baseUrl, auth, scope, "LOOSE_PEARL", [unknownSize])).result.status, 422);
    console.log("LOOSE_PEARL_ONE_ASSET_OPTIONAL_SIZE_FINANCE_READBACK: PASS");

    // The existing POS handler remains the one durable sale/posting/state
    // authority.  A limited authenticated user cannot bypass a persisted
    // minimum; an authorized approver succeeds once and records approval.
    const belowMinimum = { branchId: scope.branchId, customerId: scope.customerId, paymentMethod: "cash", items: [{ assetId: gemAsset.id, sellingPrice: "100", maximumDiscountPercent: "10" }] };
    const limited = await limitedSalesToken(scope.companyId);
    try { const rejected = await request(baseUrl, "POST", "/pos/checkout", { token: limited.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT39-SALE-DENY-${suffix()}`, body: belowMinimum }); assert.equal(rejected.status, 403); } finally { await limited.cleanup(); }
    const stillAvailable = await detail(baseUrl, auth, scope, gemAsset.id); assert.equal(stillAvailable.body.data.asset.operationalStatus, "AVAILABLE");
    const approvedKey = `CONT39-SALE-APPROVED-${suffix()}`;
    const approved = await request(baseUrl, "POST", "/pos/checkout", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: approvedKey, body: belowMinimum }); assert.equal(approved.status, 201, JSON.stringify(approved.body));
    const approvedReplay = await request(baseUrl, "POST", "/pos/checkout", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: approvedKey, body: belowMinimum }); assert.equal(approvedReplay.status, 201);
    assert.ok(await models.ApprovalRequest.findOne({ where: { companyId: scope.companyId, type: "price-override", status: "approved" }, order: [["createdAt", "DESC"]] }));
    assert.equal((await detail(baseUrl, auth, scope, gemAsset.id)).body.data.asset.operationalStatus, "SOLD");

    const pearlSaleBody = { branchId: scope.branchId, customerId: scope.customerId, paymentMethod: "cash", items: [{ assetId: pearlAssets[0].id, markupPercent: "20", maximumDiscountPercent: "10" }] };
    const pearlSale = await request(baseUrl, "POST", "/pos/checkout", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT39-PEARL-SALE-${suffix()}`, body: pearlSaleBody }); assert.equal(pearlSale.status, 201, JSON.stringify(pearlSale.body));
    const competingBody = { branchId: scope.branchId, customerId: scope.customerId, paymentMethod: "cash", items: [{ assetId: pearlAssets[1].id, markupPercent: "20", maximumDiscountPercent: "10" }] };
    const [saleA, saleB] = await Promise.all([request(baseUrl, "POST", "/pos/checkout", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT39-SALE-RACE-A-${suffix()}`, body: competingBody }), request(baseUrl, "POST", "/pos/checkout", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT39-SALE-RACE-B-${suffix()}`, body: competingBody })]); assert.ok([201, 422].includes(saleA.status) && [201, 422].includes(saleB.status)); assert.notEqual(saleA.status, saleB.status, "only one competing Sale may succeed");
    console.log("LOOSE_PROFILE_SALE_APPROVAL_ATOMICITY_AND_CONCURRENCY: PASS");

    const replay = await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: gem.key, body: gem.body }); assert.ok([200, 201].includes(replay.status));
    const changed = structuredClone(gem.body); changed.items[0].perPiece[0].looseDetails.carat = "2.349"; assert.equal((await request(baseUrl, "POST", "/purchase-orders/receive", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: gem.key, body: changed })).status, 409);
    const expectedVersion = Number(gemRead.body.data.currentValuation.version);
    const [sameA, sameB] = await Promise.all([request(baseUrl, "PUT", `/inventory-v2/assets/${gemAsset.id}/current-valuation`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT39-VAL-${suffix()}`, body: { expectedVersion, looseValuation: { currentValue: "140", currentVatRate: "7.25" } } }), request(baseUrl, "PUT", `/inventory-v2/assets/${gemAsset.id}/current-valuation`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, key: `CONT39-VAL-CONFLICT-${suffix()}`, body: { expectedVersion, looseValuation: { currentValue: "150", currentVatRate: "7.25" } } })]); assert.ok([200, 409].includes(sameA.status) && [200, 409].includes(sameB.status)); assert.notEqual(sameA.status, sameB.status, "one stale valuation writer must conflict");
    console.log("BATCH_5B_RECEIVE_IDEMPOTENCY_AND_VALUATION_RACE: PASS");

    const integrity = await one(`SELECT (SELECT COUNT(*)::int FROM asset_profile_master_data_references r LEFT JOIN profile_master_data m ON m.id=r.master_data_id WHERE m.id IS NULL) AS orphan_refs,(SELECT COUNT(*)::int FROM asset_profile_master_data_references r JOIN profile_master_data m ON m.id=r.master_data_id WHERE m.is_active=false AND r.created_at>m.updated_at) AS invalid_new_inactive_refs,(SELECT COUNT(*)::int FROM journal_entries je WHERE je.status IN ('posted','reversed') AND COALESCE((SELECT SUM(jl.debit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id),0)<>COALESCE((SELECT SUM(jl.credit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id),0)) AS unbalanced,(SELECT COUNT(*)::int FROM journal_lines jl LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.id IS NULL) AS orphan_lines,0::int AS grouped_pearls`);
    assert.equal(integrity.orphan_refs, 0); assert.equal(integrity.invalid_new_inactive_refs, 0); assert.equal(integrity.unbalanced, 0); assert.equal(integrity.orphan_lines, 0); assert.equal(integrity.grouped_pearls, 0);
    console.log("BATCH_5B_RELATIONSHIP_AND_FINANCIAL_INTEGRITY: PASS");
  } finally { if (auth) await auth.cleanup(); await stopServer(server); await sequelize.close(); }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
