"use strict";

const WORKSHOP_PERMISSIONS = Object.freeze({
  read: "inventory.workshop.read",
  send: "inventory.workshop.send",
  complete: "inventory.workshop.complete",
  cancel: "inventory.workshop.cancel",
});

const SEND_FIELDS = new Set(["assetIds", "workshopLocationId", "providerName", "expectedReturnAt", "notes"]);
const COMPLETE_FIELDS = new Set(["returnLocationId", "notes"]);

function rejectUnknownFields(body, allowed, label) {
  const unknown = Object.keys(body || {}).filter((key) => !allowed.has(key) && key !== "idempotencyKey");
  if (unknown.length) throw new Error(`WORKSHOP_${label}_UNKNOWN_FIELDS:${unknown.join(",")}`);
}

function normalizeAssetIds(value) {
  if (!Array.isArray(value) || value.length < 1) throw new Error("WORKSHOP_ASSET_IDS_REQUIRED");
  const ids = value.map((id) => String(id || "").trim()).filter(Boolean);
  if (ids.length !== value.length) throw new Error("WORKSHOP_ASSET_ID_INVALID");
  if (new Set(ids).size !== ids.length) throw new Error("WORKSHOP_ASSET_IDS_DUPLICATE");
  return [...ids].sort();
}

function textOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return String(value).trim();
}

function normalizeSendBody(body = {}) {
  rejectUnknownFields(body, SEND_FIELDS, "SEND");
  const workshopLocationId = textOrNull(body.workshopLocationId);
  if (!workshopLocationId) throw new Error("WORKSHOP_LOCATION_ID_REQUIRED");
  return {
    assetIds: normalizeAssetIds(body.assetIds),
    workshopLocationId,
    providerName: textOrNull(body.providerName),
    expectedReturnAt: textOrNull(body.expectedReturnAt),
    notes: textOrNull(body.notes),
  };
}

function normalizeCompleteBody(body = {}) {
  rejectUnknownFields(body, COMPLETE_FIELDS, "COMPLETE");
  const returnLocationId = textOrNull(body.returnLocationId);
  if (!returnLocationId) throw new Error("WORKSHOP_RETURN_LOCATION_ID_REQUIRED");
  return { returnLocationId, notes: textOrNull(body.notes) };
}

function assertScopedActiveLocation(location, { companyId, branchId }, code = "WORKSHOP_LOCATION") {
  if (!location || location.companyId !== companyId || location.branchId !== branchId) {
    throw new Error(`${code}_SCOPE_INVALID`);
  }
  if (!location.isActive) throw new Error(`${code}_INACTIVE`);
  return location;
}

function assertOrderCanComplete(order) {
  if (!order || order.status !== "SENT") throw new Error("WORKSHOP_ORDER_NOT_SENT");
}

module.exports = {
  WORKSHOP_PERMISSIONS,
  normalizeSendBody,
  normalizeCompleteBody,
  assertScopedActiveLocation,
  assertOrderCanComplete,
};
