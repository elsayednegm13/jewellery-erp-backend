"use strict";

// CONT45 acceptance proof for the read-only All Items / Item Details surface.
// It creates no inventory data and uses the existing acceptance profiles only.
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

function server() { return new Promise((resolve, reject) => { const value = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve(value)); }); }
function stop(value) { return new Promise((resolve) => value.close(resolve)); }
async function request(baseUrl, pathName, { token, companyId, branchId } = {}) {
  const headers = { Authorization: `Bearer ${token}`, "X-Company-ID": companyId, "X-Branch-ID": branchId };
  const response = await fetch(`${baseUrl}/api/v1${pathName}`, { headers });
  const body = await response.json();
  return { status: response.status, body };
}
async function token() {
  const user = await models.User.findOne({ where: { email: "admin@admin.com", isActive: true } });
  assert.ok(user && user.accountType === "super_admin", "active acceptance Super Admin is required");
  const issued = await technicalSessions.issueTokens(user, { headers: { "x-device-session-id": `cont45-${crypto.randomUUID()}` }, ip: "127.0.0.1" });
  return { user, value: issued.token, cleanup: () => technicalSessions.revokeSession(issued.session.id, user.id, "cont45_complete") };
}

async function main() {
  await sequelize.authenticate();
  const [[database]] = await sequelize.query("SELECT current_database() AS database");
  assert.equal(database.database, expectedDatabase, "STOP — exact acceptance DB required before a technical session mutation");
  const allProfiles = ["GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K", "GOLD_BY_PIECE", "DIAMOND_JEWELLERY", "LOOSE_DIAMOND", "GEMSTONE_JEWELLERY", "LOOSE_GEMSTONE", "PEARL_JEWELLERY", "LOOSE_PEARL"];
  const fixtures = {};
  for (const profile of allProfiles) {
    const asset = await models.Asset.findOne({ where: { inventoryProfile: profile }, order: [["createdAt", "DESC"]] });
    assert.ok(asset?.branchId, `acceptance fixture missing for ${profile}`);
    fixtures[profile] = asset.toJSON();
  }
  const svc = await server();
  const baseUrl = `http://127.0.0.1:${svc.address().port}`;
  let admin;
  try {
    admin = await token();
    const sample = fixtures.GOLD_BY_WEIGHT_JEWELLERY;
    const profiles = await request(baseUrl, "/inventory-v2/profiles", { token: admin.value, companyId: sample.companyId, branchId: sample.branchId });
    assert.equal(profiles.status, 200);
    const profileKeys = (profiles.body.data?.profiles || []).map((value) => value.key);
    for (const profile of [...allProfiles, "CGP_CUSTOMER_GOLD_PURCHASE"]) assert.ok(profileKeys.includes(profile), `profile contract missing ${profile}`);

    for (const profile of allProfiles) {
      const fixture = fixtures[profile];
      const list = await request(baseUrl, `/inventory-v2/assets?profile=${encodeURIComponent(profile)}&limit=1&offset=0`, { token: admin.value, companyId: fixture.companyId, branchId: fixture.branchId });
      assert.equal(list.status, 200, `${profile} list route`);
      assert.ok(list.body.data.total >= 1, `${profile} canonical Asset result missing`);
      assert.equal(list.body.data.items[0].inventoryProfile, profile);
      const detail = await request(baseUrl, `/inventory-v2/assets/${encodeURIComponent(fixture.id)}`, { token: admin.value, companyId: fixture.companyId, branchId: fixture.branchId });
      assert.equal(detail.status, 200, `${profile} detail route`);
      assert.equal(detail.body.data.asset.inventoryProfile, profile);
      assert.ok(Array.isArray(detail.body.data.timeline), `${profile} unified timeline missing`);
      assert.ok(Array.isArray(detail.body.data.history), `${profile} immutable history missing`);
      assert.ok(Array.isArray(detail.body.data.movements), `${profile} movement evidence missing`);
    }

    const byBarcode = await request(baseUrl, `/inventory-v2/assets?search=${encodeURIComponent(sample.barcode)}&limit=1`, { token: admin.value, companyId: sample.companyId, branchId: sample.branchId });
    assert.equal(byBarcode.status, 200); assert.ok(byBarcode.body.data.items.some((item) => item.id === sample.id), "barcode search must find the exact Asset");
    const byId = await request(baseUrl, `/inventory-v2/assets?search=${encodeURIComponent(sample.id)}&limit=1`, { token: admin.value, companyId: sample.companyId, branchId: sample.branchId });
    assert.equal(byId.status, 200); assert.ok(byId.body.data.items.some((item) => item.id === sample.id), "Asset-number search must find the exact Asset");
    const searchFixtures = await sequelize.query(`SELECT a.id,a.company_id AS "companyId",a.branch_id AS "branchId",a.description,a.condition,a.tag_state AS "tagState",supplier.name AS "supplierName",rfid.rfid_number AS rfid,certificate.certificate_number AS "certificateNumber"
      FROM assets a LEFT JOIN suppliers supplier ON supplier.id=a.supplier_id LEFT JOIN asset_rfid_assignments rfid ON rfid.asset_id=a.id AND rfid.is_current=true LEFT JOIN asset_certificates certificate ON certificate.asset_id=a.id
      WHERE a.inventory_profile IS NOT NULL AND (a.description IS NOT NULL OR supplier.name IS NOT NULL OR rfid.rfid_number IS NOT NULL OR certificate.certificate_number IS NOT NULL) ORDER BY a.created_at DESC LIMIT 40`);
    const searchable = searchFixtures[0];
    for (const field of ["description", "supplierName", "rfid", "certificateNumber"]) {
      const fixture = searchable.find((value) => value[field] && String(value[field]).trim().length >= 3);
      if (!fixture) continue;
      const term = String(fixture[field]).trim().slice(0, Math.min(12, String(fixture[field]).trim().length));
      const result = await request(baseUrl, `/inventory-v2/assets?search=${encodeURIComponent(term)}&limit=50`, { token: admin.value, companyId: fixture.companyId, branchId: fixture.branchId });
      assert.equal(result.status, 200, `${field} search route`);
      assert.ok(result.body.data.items.some((item) => item.id === fixture.id), `${field} search must find the exact Asset`);
    }
    const conditioned = searchable.find((value) => value.condition);
    if (conditioned) {
      const filtered = await request(baseUrl, `/inventory-v2/assets?condition=${encodeURIComponent(conditioned.condition)}&limit=50`, { token: admin.value, companyId: conditioned.companyId, branchId: conditioned.branchId });
      assert.equal(filtered.status, 200); assert.ok(filtered.body.data.items.every((item) => item.condition === conditioned.condition), "condition filter must be server-side");
    }
    const pageOne = await request(baseUrl, "/inventory-v2/assets?limit=1&offset=0", { token: admin.value, companyId: sample.companyId, branchId: sample.branchId });
    const pageTwo = await request(baseUrl, "/inventory-v2/assets?limit=1&offset=1", { token: admin.value, companyId: sample.companyId, branchId: sample.branchId });
    assert.equal(pageOne.status, 200); assert.equal(pageTwo.status, 200); assert.ok(pageOne.body.data.total >= 2); assert.notEqual(pageOne.body.data.items[0].id, pageTwo.body.data.items[0].id, "server-side offset pagination must change the Asset row");
    assert.ok(pageOne.body.data.items.every((item) => item.inventoryProfile && item.operationalStatus), "All Items response must contain canonical Asset profile and status, never Product rows");

    const [[reviewed]] = await sequelize.query("SELECT a.id,a.company_id AS \"companyId\",a.branch_id AS \"branchId\" FROM asset_return_reviews r JOIN assets a ON a.id=r.asset_id ORDER BY r.reviewed_at DESC LIMIT 1");
    assert.ok(reviewed, "R38 acceptance review fixture must exist");
    const restockDetail = await request(baseUrl, `/inventory-v2/assets/${encodeURIComponent(reviewed.id)}`, { token: admin.value, companyId: reviewed.companyId, branchId: reviewed.branchId });
    assert.equal(restockDetail.status, 200); assert.ok(restockDetail.body.data.returnReviews.length >= 1, "R38 review must appear in Item Details");
    assert.ok(restockDetail.body.data.timeline.some((entry) => entry.eventType === "RETURNED_RESTOCK_APPROVED"), "R38 transition must appear in canonical timeline");

    console.log("BATCH_7_API_ACCEPTANCE: PASS");
    console.log("ALL_9_NON_CGP_PROFILES: PASS");
    console.log("ALL_ITEMS_API_SEARCH_FILTER_PAGINATION: PASS");
    console.log("ITEM_DETAILS_PROFILE_READBACK: PASS");
    console.log("R38_HISTORY_READBACK: PASS");
  } finally {
    if (admin) await admin.cleanup();
    await stop(svc);
    await sequelize.close();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
