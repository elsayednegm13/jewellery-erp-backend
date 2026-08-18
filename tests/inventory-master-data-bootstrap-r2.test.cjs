const test = require("node:test");
const assert = require("node:assert/strict");

const manifest = require("../src/services/inventory-master-data-manifest");
const bootstrap = require("../src/services/inventory-master-data-bootstrap.service");
const profileMasterData = require("../src/services/profile-master-data.service");
const barcodeIdentity = require("../src/services/barcode-identity.service");

test("R2 manifest contains the exact approved 157-row reference delta", () => {
  assert.equal(manifest.R1_PROFILE_MASTER_DATA_ROWS.length, 157);
  assert.deepEqual(bootstrap.countByCategory(manifest.R1_PROFILE_MASTER_DATA_ROWS), {
    CERTIFICATE_AUTHORITY: 16,
    DIAMOND_TONE: 14,
    DIAMOND_TONE_LEVEL: 9,
    DIAMOND_SATURATION: 10,
    DIAMOND_POSITION: 7,
    DIAMOND_SETTING: 47,
    GEMSTONE_POSITION: 7,
    GEMSTONE_SETTING: 47,
  });
  assert.equal(new Set(manifest.R1_PROFILE_MASTER_DATA_ROWS.map((row) => `${row.category}|${row.canonicalValue}`)).size, 157);
  assert.equal(manifest.DATASET_MANIFEST.gemstoneTreatmentInitialValues.length, 0);
  assert.equal(bootstrap.validateManifest().rowCount, 157);
});

test("R2 barcode taxonomy contains only the five approved inventory codes and twenty items", () => {
  assert.deepEqual(manifest.DATASET_MANIFEST.barcodeInventoryCodes.map((row) => row.code), ["GW", "GP", "DD", "GS", "PL"]);
  assert.equal(manifest.DATASET_MANIFEST.barcodeItemCodes.length, 20);
  assert.ok(manifest.DATASET_MANIFEST.barcodeItemCodes.some((row) => row.code === "ROS"));
  assert.ok(manifest.DATASET_MANIFEST.barcodeItemCodes.some((row) => row.code === "CSD"));
  assert.equal(manifest.DATASET_MANIFEST.barcodeItemCodes.some((row) => row.code === "WCH"), false);
});

test("certificate authority uses Gübelin as canonical and preserves Gubelin as an alias", () => {
  const certificate = manifest.R1_PROFILE_MASTER_DATA_ROWS.filter((row) => row.category === "CERTIFICATE_AUTHORITY");
  assert.ok(certificate.some((row) => row.displayLabel === "Gübelin"));
  assert.deepEqual(manifest.CERTIFICATE_ALIASES, { Gubelin: "Gübelin" });
});

test("profile category registry scopes R2 stone metadata without broadening loose profile authority", () => {
  assert.ok(profileMasterData.categoriesForProfile("DIAMOND_JEWELLERY").includes("DIAMOND_POSITION"));
  assert.equal(profileMasterData.categoriesForProfile("LOOSE_DIAMOND").includes("DIAMOND_POSITION"), false);
  assert.ok(profileMasterData.categoriesForProfile("GEMSTONE_JEWELLERY").includes("GEMSTONE_SETTING"));
  assert.equal(profileMasterData.categoriesForProfile("LOOSE_GEMSTONE").includes("GEMSTONE_SETTING"), false);
  assert.equal(profileMasterData.categoryForField("LOOSE_DIAMOND", "tone"), "DIAMOND_TONE");
  assert.equal(profileMasterData.categoryForField("LOOSE_GEMSTONE", "tone"), "GEMSTONE_TONE");
});

test("loose profiles derive barcode karat 00 and reject contradictory input", () => {
  for (const profile of ["LOOSE_DIAMOND", "LOOSE_GEMSTONE", "LOOSE_PEARL"]) {
    assert.equal(barcodeIdentity.resolveKaratCodeForProfile({ profile }), "00");
    assert.equal(barcodeIdentity.resolveKaratCodeForProfile({ profile, karat: "00" }), "00");
    assert.throws(() => barcodeIdentity.resolveKaratCodeForProfile({ profile, karat: "18" }), /LOOSE_PROFILE_KARAT_MUST_BE_00/);
  }
  assert.equal(barcodeIdentity.resolveKaratCodeForProfile({ profile: "DIAMOND_JEWELLERY", karat: "18" }), "18");
});
