const assert = require("node:assert/strict");
const test = require("node:test");

const masterPolicy = require("../src/services/inventory-master-data-policy.service");
const profileMasterData = require("../src/services/profile-master-data.service");
const provisioner = require("../scripts/provision-master-data-01d.js");

test("01D final profile authority maps all nine internal strategies", () => {
  assert.equal(masterPolicy.FINAL_PROFILE_CODES.length, 9);
  for (const profile of masterPolicy.FINAL_PROFILE_CODES) {
    assert.equal(masterPolicy.isFinalProfile(profile), true);
    assert.ok(masterPolicy.PROFILE_CATEGORIES[profile].length > 0, profile);
  }
  assert.equal(masterPolicy.isFinalProfile("CGP_CUSTOMER_GOLD_PURCHASE"), false);
  assert.equal(masterPolicy.isFinalProfile("WATCH"), false);
});

test("01D client evidence dataset is normalized, unique, and non-empty", () => {
  const rows = masterPolicy.initialRows();
  assert.ok(rows.length >= 40);
  const keys = rows.map((row) => `${row.category}:${String(row.value).toLocaleLowerCase("en-US")}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const row of rows) assert.ok(Object.values(profileMasterData.CATEGORIES).includes(row.category));
  assert.deepEqual(masterPolicy.CLIENT_KARAT_CODES, ["24", "22", "21", "18", "14", "12", "10", "9"]);
});

test("01D provisioning target is fail-closed", () => {
  assert.throws(() => provisioner.assertSafeTargetName("darfus_erp"), /official persistent database/);
  assert.throws(() => provisioner.assertSafeTargetName("darfus_erp_inventory_rehearsal_20260804_160500z"), /must start/);
  assert.equal(provisioner.assertSafeTargetName("darfus_erp_master_data_01d_20260817"), "darfus_erp_master_data_01d_20260817");
});

test("01D does not treat barcode sequences, locations, or settings as seed rows", () => {
  const rows = masterPolicy.initialRows();
  assert.equal(rows.some((row) => row.category === "BARCODE_SEQUENCE"), false);
  assert.equal(rows.some((row) => row.category === "INVENTORY_LOCATION"), false);
  assert.equal(rows.some((row) => row.category === "VAT_RATE"), false);
});
