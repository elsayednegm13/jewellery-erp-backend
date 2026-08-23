"use strict";

const assert = require("node:assert/strict");
const policy = require("../src/services/inventory-master-policy.service");
const runtime = require("../src/services/inventory-v2-runtime.service");

const profiles = [
  "GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K", "GOLD_BY_PIECE", "DIAMOND_JEWELLERY", "LOOSE_DIAMOND",
  "GEMSTONE_JEWELLERY", "LOOSE_GEMSTONE", "PEARL_JEWELLERY", "LOOSE_PEARL", "CGP_CUSTOMER_GOLD_PURCHASE",
];

function minimum(profile) {
  const gold = ["GOLD_BY_WEIGHT_JEWELLERY", "GOLD_BAR_24K", "GOLD_BY_PIECE", "CGP_CUSTOMER_GOLD_PURCHASE"].includes(profile);
  return {
    profile, name: `Batch 1B ${profile}`, description: `Batch 1B ${profile}`, grossWeight: 1,
    stoneWeight: 0, purchaseCost: 10, ...(gold ? { karat: profile === "GOLD_BAR_24K" ? 24 : 21 } : {}),
    ...(profile === "GOLD_BY_PIECE" ? { condition: "NEW" } : {}),
    ...(profile === "LOOSE_DIAMOND" ? { looseDetails: { stoneName: "Diamond", diamondType: "Natural", carat: "1.000", color: "D", clarity: "VS1", shape: "ROUND" } } : {}),
    ...(profile === "LOOSE_GEMSTONE" ? { looseDetails: { stoneName: "Sapphire", carat: "1.000" } } : {}),
    // This unit-level normalizer does not resolve database Master Data; the
    // canonical receipt route performs Pearl Size selection validation.
    ...(profile === "LOOSE_PEARL" ? { looseDetails: { totalPearlWeight: "1.00", pearlSizeId: "MASTER_DATA_RESOLVED_BY_RECEIVE" } } : {}),
  };
}

for (const profile of profiles) {
  const contract = policy.requireProfile(profile);
  assert.equal(policy.normalizeProfile(profile), profile);
  const normalized = runtime.normalizeReceiptPiece(minimum(profile));
  assert.equal(normalized.profile, profile);
  assert.equal(normalized.description, `Batch 1B ${profile}`);
  assert.equal(normalized.locationId, null);
  assert.equal(normalized.rfid, null);
  const missing = minimum(profile);
  delete missing.description;
  delete missing.name;
  assert.throws(() => runtime.normalizeReceiptPiece(missing), /DESCRIPTION_REQUIRED/);
  assert.ok(contract.locationOptional && contract.rfidAllowed, `${profile} keeps location and RFID optional`);
  assert.throws(() => runtime.normalizeReceiptPiece({ ...minimum(profile), operationalStatus: "SOLD" }), /OPERATIONAL_STATUS_PAYLOAD_FORBIDDEN/);
}

assert.equal(policy.normalizeProfile("GOLD_BY_WEIGHT"), "GOLD_BY_WEIGHT_JEWELLERY");
assert.equal(policy.normalizeProfile("GOLD_BY_WEIGHT_24"), "GOLD_BAR_24K");
assert.equal(policy.normalizeProfile("CGP"), "CGP_CUSTOMER_GOLD_PURCHASE");
assert.throws(() => policy.normalizeProfile("UNKNOWN_PROFILE"), /INVENTORY_PROFILE_INVALID/);
const certificate = runtime.normalizeReceiptPiece({ ...minimum("GOLD_BAR_24K"), certificate: { issuer: "Issuer", certificateNumber: "CERT-1", issueDate: "2026-08-05", imageUrl: "attachment://cert-1" } });
assert.deepEqual(certificate.certificate, { issuer: "Issuer", certificateNumber: "CERT-1", issueDate: "2026-08-05", url: "attachment://cert-1" });
assert.throws(() => runtime.normalizeReceiptPiece({ ...minimum("GOLD_BAR_24K"), certificate: { issuer: "Issuer" } }), /CERTIFICATE_REQUIRED_FIELDS/);

console.log(JSON.stringify({ result: "PASS", profiles, registryCount: Object.keys(policy.PROFILE_REGISTRY).length, aliases: ["GOLD_BY_WEIGHT", "GOLD_BY_WEIGHT_24", "CGP"], certificate: "PASS", statusInjection: "REJECTED" }));
