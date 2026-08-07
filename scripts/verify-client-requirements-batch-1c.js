"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });
const expectedDatabase = String(process.env.INVENTORY_REHEARSAL_DB || "").trim();
assert.equal(expectedDatabase, "darfus_erp_inventory_rehearsal_20260804_160500z", "Batch 1C must use only the retained acceptance database");
delete process.env.DATABASE_URL;
process.env.DB_NAME = expectedDatabase;

const sequelize = require("../src/config/database");
const app = require("../src/app");
const { User } = require("../src/models");
const technicalSessions = require("../src/services/technical-session.service");

const uuid = () => crypto.randomUUID();
const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements }))[0][0];

async function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}
const stopServer = (server) => new Promise((resolve) => server.close(resolve));

async function request(baseUrl, method, pathname, { token, companyId, branchId, idempotencyKey, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (companyId) headers["X-Company-ID"] = companyId;
  if (branchId) headers["X-Branch-ID"] = branchId;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  return { status: response.status, body: await response.json() };
}

async function technicalToken() {
  const user = await User.findOne({ where: { email: "admin@admin.com", isActive: true } });
  assert.ok(user && user.accountType === "super_admin", "active Super Admin harness user is required");
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `batch-1c-${uuid()}` }, ip: "127.0.0.1" });
  return { token: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "batch_1c_acceptance_complete") };
}

async function main() {
  await sequelize.authenticate();
  assert.equal((await one("SELECT current_database() AS database")).database, expectedDatabase, "stop before mutation unless the exact acceptance DB is connected");
  const scope = await one(`SELECT c.id AS "companyId",b.id AS "branchId",s.id AS "supplierId",i.code AS "inventoryCode",m.code AS "itemCode"
    FROM companies c JOIN branches b ON b.company_id=c.id AND b.name='Main Branch' JOIN suppliers s ON s.company_id=c.id
    JOIN barcode_inventory_codes i ON i.asset_type='gold-weight' AND i.is_active=true
    JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
    ORDER BY s.id,m.code LIMIT 1`);
  assert.ok(scope?.companyId && scope?.branchId && scope?.supplierId && scope?.inventoryCode && scope?.itemCode, "acceptance fixture prerequisites are incomplete");
  const { server, baseUrl } = await startServer();
  let auth;
  try {
    auth = await technicalToken();
    const frontendSource = fs.readFileSync(path.resolve(__dirname, "../../app/[locale]/(dashboard)/suppliers/purchases/page.tsx"), "utf8");
    const frontendProfiles = ["GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K", "GOLD_BY_PIECE", "DIAMOND_JEWELLERY", "LOOSE_DIAMOND", "GEMSTONE_JEWELLERY", "LOOSE_GEMSTONE", "PEARL_JEWELLERY", "LOOSE_PEARL", "CGP_CUSTOMER_GOLD_PURCHASE"];
    for (const profile of frontendProfiles) assert.ok(frontendSource.includes(`${profile}:`), `frontend presentation map is missing ${profile}`);
    for (const field of ["/inventory-v2/profiles", "profileContracts.map", "canonicalAssetType", "profileRequires", "weightApplicable", "goldColorApplicable", "perPiece", "inventoryV2: true", "certificateIssuer", "certificateNumber", "locationId", "operational status is read-only", "isCgpProfile", "Company is server-scoped"]) assert.ok(frontendSource.includes(field), `frontend profile-driven intake is missing ${field}`);
    assert.doesNotMatch(frontendSource, /SERIALIZED_PROFILE_OPTIONS/, "frontend must not own a second profile business registry");
    assert.doesNotMatch(frontendSource, /operationalStatus\s*:/, "frontend intake must not submit an operational status");
    assert.doesNotMatch(frontendSource, /setCompany\s*\(/, "intake must not expose a Company switcher");
    const profiles = await request(baseUrl, "GET", "/inventory-v2/profiles", { token: auth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(profiles.status, 200, "profile contract endpoint must be readable");
    assert.equal(profiles.body?.data?.profiles?.length, 10, "all ten canonical profiles must be exposed by the server registry");
    const profileContracts = profiles.body.data.profiles;
    const expectedAssetTypes = { GOLD_BY_WEIGHT_JEWELLERY: "gold-weight", GOLD_BAR_24K: "gold-weight", GOLD_BY_PIECE: "gold-piece", DIAMOND_JEWELLERY: "diamond", LOOSE_DIAMOND: "diamond", GEMSTONE_JEWELLERY: "gemstone", LOOSE_GEMSTONE: "gemstone", PEARL_JEWELLERY: "pearl", LOOSE_PEARL: "pearl", CGP_CUSTOMER_GOLD_PURCHASE: "gold-weight" };
    for (const [profile, assetType] of Object.entries(expectedAssetTypes)) assert.equal(profileContracts.find((contract) => contract.key === profile)?.assetType, assetType, `${profile} asset type must be supplied by the server contract`);

    const suffix = uuid().replaceAll("-", "").slice(0, 18);
    const purchaseOrderId = `CR1C-${suffix}`;
    const receiptKey = `CR1C-RECEIVE-${suffix}`;
    const certificateNumber = `CR1C-CERT-${suffix}`;
    const receive = await request(baseUrl, "POST", "/purchase-orders/receive", {
      token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: receiptKey,
      body: { id: purchaseOrderId, supplierId: scope.supplierId, branchId: scope.branchId, warehouseId: scope.branchId, purchaseDate: "2026-08-05", paymentMethod: "credit", paidAmount: 0, inventoryV2: true, items: [{ name: `Batch 1C common intake ${suffix}`, type: "gold-weight", category: "Batch 1C acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode, karat: 24, quantity: 1, weightPerUnit: 1.2, unitCost: 250, price: 250, perPiece: [{ name: `Batch 1C Gold Bar ${suffix}`, description: `Batch 1C Gold Bar ${suffix}`, profile: "GOLD_BAR_24K", type: "gold-weight", category: "Batch 1C acceptance", inventoryCode: scope.inventoryCode, itemCode: scope.itemCode, karat: 24, grossWeight: 1.2, stoneWeight: 0, purchaseCost: 250, goldValue: 250, condition: null, goldColor: "Yellow", brand: "Batch Brand", model: "Bar", modelNumber: `M-${suffix}`, supplierReference: `SUP-${suffix}`, locationId: null, certificate: { issuer: "Batch 1C issuer", certificateNumber, issueDate: "2026-08-05", url: "https://example.invalid/certificate-proof" } }] }] },
    });
    assert.equal(receive.status, 201, "common V2 receipt must succeed");
    const asset = (receive.body?.assets || receive.body?.data?.assets || [])[0];
    assert.ok(asset?.id && asset.inventoryProfile === "GOLD_BAR_24K" && asset.operationalStatus === "AVAILABLE", "receipt must create a canonical Asset with backend-controlled status");

    const form = new FormData();
    form.append("file", new Blob(["Batch 1C attachment proof"], { type: "application/pdf" }), "batch-1c-proof.pdf");
    const attachmentKey = `${receiptKey}:attachment:0`;
    const upload = await request(baseUrl, "POST", `/assets/${encodeURIComponent(asset.id)}/attachments`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: attachmentKey, form });
    assert.equal(upload.status, 201, "attachment must persist through the canonical AssetAttachment endpoint");
    const replayForm = new FormData();
    replayForm.append("file", new Blob(["Batch 1C attachment proof"], { type: "application/pdf" }), "batch-1c-proof.pdf");
    const uploadReplay = await request(baseUrl, "POST", `/assets/${encodeURIComponent(asset.id)}/attachments`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: attachmentKey, form: replayForm });
    assert.equal(uploadReplay.status, 201, "same attachment key and binary must replay");

    const detail = await request(baseUrl, "GET", `/inventory-v2/assets/${encodeURIComponent(asset.id)}`, { token: auth.token, companyId: scope.companyId, branchId: scope.branchId });
    assert.equal(detail.status, 200, "canonical V2 detail must read back the common data");
    const detailAsset = detail.body?.data?.asset;
    assert.equal(detailAsset?.operationalStatus, "AVAILABLE", "operational status must be read-only backend state");
    assert.equal(detailAsset?.description, `Batch 1C Gold Bar ${suffix}`, "description must round-trip");
    assert.equal(detailAsset?.brand, "Batch Brand", "brand must round-trip");
    assert.equal(detailAsset?.model, "Bar", "model must round-trip");
    assert.equal(detailAsset?.modelNumber, `M-${suffix}`, "model number must round-trip");
    assert.equal(detailAsset?.metadata?.profileContract?.supplierReference, `SUP-${suffix}`, "supplier reference snapshot must round-trip");
    assert.equal(detailAsset?.locationId || null, null, "omitted Location must remain optional");
    assert.equal(detail.body?.data?.certificates?.length, 1, "certificate relation must be returned by V2 detail");
    assert.equal(detail.body.data.certificates[0].certificateNumber, certificateNumber, "certificate number must round-trip");
    assert.equal(detail.body?.data?.attachments?.length, 1, "attachment replay must not create a duplicate relation");

    // These requests are the same canonical receive route used by the intake
    // screen.  They exercise the remaining representative common contracts;
    // CGP intentionally remains rendering/registry-only until its owner-set
    // material-pool semantics are implemented in Batch 6.
    const representativeProfiles = [
      { profile: "GOLD_BY_WEIGHT_JEWELLERY", type: "gold-weight", karat: 21, condition: null },
      { profile: "GOLD_BY_PIECE", type: "gold-piece", karat: 21, condition: "NEW" },
      { profile: "DIAMOND_JEWELLERY", type: "diamond", karat: null, condition: null },
      { profile: "LOOSE_DIAMOND", type: "diamond", karat: null, condition: null, looseDetails: { stoneName: "Diamond", diamondType: "Natural", carat: "1.000", color: "D", clarity: "VS1", shape: "ROUND" } },
    ];
    const representativeResults = [];
    const unavailableBarcodeFixtures = [];
    for (const config of representativeProfiles) {
      const profileScope = await one(`SELECT i.code AS "inventoryCode",m.code AS "itemCode" FROM barcode_inventory_codes i
        JOIN barcode_item_codes m ON m.is_active=true AND (jsonb_array_length(m.allowed_inventory_codes)=0 OR m.allowed_inventory_codes ? i.code)
        WHERE i.asset_type=:assetType AND i.is_active=true ORDER BY m.code LIMIT 1`, { assetType: config.type });
      if (!profileScope?.inventoryCode || !profileScope?.itemCode) {
        unavailableBarcodeFixtures.push({ profile: config.profile, assetType: config.type });
        continue;
      }
      const profileSuffix = uuid().replaceAll("-", "").slice(0, 16);
      const profileReceive = await request(baseUrl, "POST", "/purchase-orders/receive", {
        token: auth.token, companyId: scope.companyId, branchId: scope.branchId, idempotencyKey: `CR1C-${config.profile}-${profileSuffix}`,
        body: { id: `CR1C-${config.profile}-${profileSuffix}`, supplierId: scope.supplierId, branchId: scope.branchId, warehouseId: scope.branchId, purchaseDate: "2026-08-05", paymentMethod: "credit", paidAmount: 0, inventoryV2: true, items: [{ name: `Batch 1C ${config.profile}`, type: config.type, category: "Batch 1C representative", inventoryCode: profileScope.inventoryCode, itemCode: profileScope.itemCode, quantity: 1, weightPerUnit: 1, unitCost: 100, price: 100, perPiece: [{ name: `Batch 1C ${config.profile} ${profileSuffix}`, description: `Batch 1C ${config.profile} ${profileSuffix}`, profile: config.profile, type: config.type, category: "Batch 1C representative", inventoryCode: profileScope.inventoryCode, itemCode: profileScope.itemCode, karat: config.karat, grossWeight: 1, stoneWeight: 0, purchaseCost: 100, goldValue: 100, condition: config.condition, brand: "Batch Brand", model: "Common Intake", modelNumber: `R-${profileSuffix}`, supplierReference: `SUP-${profileSuffix}`, locationId: null, ...(config.looseDetails ? { looseDetails: config.looseDetails } : {}) }] }] },
      });
      assert.equal(profileReceive.status, 201, `${config.profile} common intake must succeed: ${JSON.stringify(profileReceive.body)}`);
      const profileAssets = profileReceive.body?.assets || profileReceive.body?.data?.assets || [];
      assert.equal(profileAssets.length, 1, `${config.profile} one physical piece must create one Asset`);
      const profileAsset = profileAssets[0];
      assert.equal(profileAsset?.inventoryProfile, config.profile, `${config.profile} must round-trip its canonical profile`);
      assert.equal(profileAsset?.operationalStatus, "AVAILABLE", `${config.profile} status must be backend-controlled`);
      assert.equal(profileAsset?.condition || null, config.condition, `${config.profile} must preserve the profile-aware Condition contract`);
      assert.ok(profileAsset?.barcode, `${config.profile} must receive a canonical Barcode`);
      const barcode = await one("SELECT COUNT(*)::int AS count FROM assets WHERE barcode=:barcode", { barcode: profileAsset.barcode });
      assert.equal(Number(barcode.count), 1, `${config.profile} Barcode must remain globally unique`);
      representativeResults.push(config.profile);
    }

    const integrity = await one(`SELECT
      (SELECT COUNT(*)::int FROM asset_certificates c LEFT JOIN assets a ON a.id=c.asset_id WHERE c.asset_id=:assetId AND a.id IS NULL) AS "orphanCertificates",
      (SELECT COUNT(*)::int FROM asset_attachments x LEFT JOIN assets a ON a.id=x.asset_id WHERE x.asset_id=:assetId AND a.id IS NULL) AS "orphanAttachments",
      (SELECT COUNT(*)::int FROM asset_attachments WHERE asset_id=:assetId) AS attachments,
      (SELECT COUNT(*)::int FROM asset_certificates WHERE asset_id=:assetId) AS certificates`, { assetId: asset.id });
    assert.deepEqual(integrity, { orphanCertificates: 0, orphanAttachments: 0, attachments: 1, certificates: 1 }, "certificate or attachment relation integrity failed");
    console.log(JSON.stringify({ result: unavailableBarcodeFixtures.length ? "PARTIAL" : "PASS", database: expectedDatabase, frontendProfiles: frontendProfiles.length, profiles: 10, representativeProfiles: ["GOLD_BAR_24K", ...representativeResults, "CGP_CUSTOMER_GOLD_PURCHASE:RENDERING_ONLY"], unavailableBarcodeFixtures, assetId: asset.id, profile: asset.inventoryProfile, certificate: certificateNumber, attachmentReplay: uploadReplay.status, integrity }));
  } finally {
    if (auth) await auth.cleanup();
    await stopServer(server);
  }
}

main().catch((error) => { console.error(`CLIENT_REQUIREMENTS_BATCH_1C_FAIL: ${error.stack || error.message}`); process.exitCode = 1; }).finally(async () => sequelize.close());
