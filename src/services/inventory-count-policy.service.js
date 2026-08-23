"use strict";

const { ValidationError, ConflictError } = require("../utils/errors");

const COUNT_PERMISSIONS = Object.freeze({
  read: "inventory.count.read",
  create: "inventory.count.create",
  scan: "inventory.count.scan",
  complete: "inventory.count.complete",
});

const CREATE_FIELDS = new Set(["auditNumber", "auditMethod", "locationId", "notes"]);
const SCAN_FIELDS = new Set(["assetIds", "barcodes", "rfidNumbers", "method"]);

function text(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function rejectUnknown(body, allowed) {
  const unknown = Object.keys(body || {}).filter((key) => !allowed.has(key));
  if (unknown.length) throw new ValidationError(`Unsupported Inventory Count field: ${unknown[0]}`);
}

function uniqueStrings(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError("Inventory Count identifiers must be arrays.");
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeCreateBody(body = {}) {
  rejectUnknown(body, CREATE_FIELDS);
  const auditNumber = text(body.auditNumber);
  const auditMethod = String(body.auditMethod || "").trim().toUpperCase();
  const locationId = text(body.locationId);
  if (!auditNumber) throw new ValidationError("Inventory Count auditNumber is required.");
  if (!["MANUAL_COUNT", "BARCODE_SCAN", "RFID_SCAN"].includes(auditMethod)) {
    throw new ValidationError("Inventory Count method is invalid.");
  }
  if (!locationId) throw new ValidationError("Inventory Count DB location is required.");
  return { auditNumber, auditMethod, locationId, notes: text(body.notes) };
}

function normalizeScanBody(body = {}) {
  rejectUnknown(body, SCAN_FIELDS);
  const assetIds = uniqueStrings(body.assetIds);
  const barcodes = uniqueStrings(body.barcodes);
  const rfidNumbers = uniqueStrings(body.rfidNumbers);
  const method = String(body.method || "").trim().toUpperCase() || null;
  if (!assetIds.length && !barcodes.length && !rfidNumbers.length) {
    throw new ValidationError("At least one Asset ID, Barcode, or RFID is required.");
  }
  if (method && !["MANUAL_COUNT", "BARCODE_SCAN", "RFID_SCAN"].includes(method)) {
    throw new ValidationError("Inventory Count scan method is invalid.");
  }
  return { assetIds, barcodes, rfidNumbers, method };
}

function assertScopedActiveLocation(location, { companyId, branchId }) {
  if (!location || location.isActive === false) throw new ValidationError("Inventory Count location is missing or inactive.");
  if (String(location.companyId) !== String(companyId) || String(location.branchId) !== String(branchId)) {
    throw new ConflictError("Inventory Count location is outside the authorized Company/Branch scope.");
  }
}

function assertCountableAsset(asset, locationId) {
  if (!asset) throw new ValidationError("Scanned Asset was not found.");
  if (["SOLD", "MELTED", "MISSING"].includes(String(asset.operationalStatus || "").toUpperCase())) {
    throw new ConflictError("This Asset is not count-eligible.");
  }
  if (String(asset.locationId || "") !== String(locationId)) {
    throw new ConflictError("Scanned Asset is outside the Count location scope.");
  }
}

function assertNoBody(body = {}) {
  if (Object.keys(body || {}).length) throw new ValidationError("This Inventory Count action does not accept a body.");
  return {};
}

module.exports = {
  COUNT_PERMISSIONS,
  normalizeCreateBody,
  normalizeScanBody,
  assertScopedActiveLocation,
  assertCountableAsset,
  assertNoBody,
};
