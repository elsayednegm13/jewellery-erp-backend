"use strict";

const { AppError } = require("../utils/errors");
const { normalizeTreatment } = require("./transaction-tax-context.service");

const LOCATION_TEXT_FIELDS = Object.freeze(["location", "locationName", "locationText"]);

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function locationIdFor({ body = {}, item = {}, piece = null } = {}) {
  return String(
    (piece && piece.locationId) || item.locationId || body.locationId || ""
  ).trim();
}

function assertNoFreeTextLocation({ body = {}, items = [] } = {}) {
  const candidates = [body, ...(Array.isArray(items) ? items : [])];
  for (const item of candidates) {
    for (const field of LOCATION_TEXT_FIELDS) {
      if (hasValue(item?.[field])) {
        throw new AppError(
          "Inventory receive must reference an active database Location by locationId; free-text locations are not accepted.",
          422,
          "LOCATION_FREE_TEXT_FORBIDDEN",
          { [field]: "Use the canonical database locationId." }
        );
      }
    }
    for (const piece of Array.isArray(item?.perPiece) ? item.perPiece : []) {
      for (const field of LOCATION_TEXT_FIELDS) {
        if (hasValue(piece?.[field])) {
          throw new AppError(
            "Inventory receive must reference an active database Location by locationId; free-text locations are not accepted.",
            422,
            "LOCATION_FREE_TEXT_FORBIDDEN",
            { [field]: "Use the canonical database locationId." }
          );
        }
      }
    }
  }
}

function assertBranchAuthority({ body = {}, requestBranchId, headerBranchId } = {}) {
  const authoritative = String(requestBranchId || "").trim();
  if (!authoritative) {
    throw new AppError("A server-authoritative branch context is required for Supplier Receive.", 422, "BRANCH_CONTEXT_REQUIRED");
  }
  for (const requested of [body.branchId, body.warehouseId, headerBranchId]) {
    if (hasValue(requested) && String(requested).trim() !== authoritative) {
      throw new AppError("The receive branch is server-authoritative and cannot be overridden by the request.", 403, "BRANCH_SCOPE_FORBIDDEN");
    }
  }
  return authoritative;
}

function assertCanonicalReceiveInput({ body = {}, items = [], requestBranchId, headerBranchId } = {}) {
  const taxTreatmentValue = Object.prototype.hasOwnProperty.call(body, "taxTreatment")
    ? String(body.taxTreatment || "").trim()
    : "";
  if (!taxTreatmentValue) {
    throw new AppError("An explicit taxTreatment is required for Supplier Receive.", 422, "TAX_TREATMENT_REQUIRED", {
      taxTreatment: "Select an enabled company tax treatment."
    });
  }
  const taxTreatment = normalizeTreatment(taxTreatmentValue);
  assertNoFreeTextLocation({ body, items });
  const branchId = assertBranchAuthority({ body, requestBranchId, headerBranchId });
  const normalizedItems = Array.isArray(items) ? items : [];
  if (!normalizedItems.length) throw new AppError("At least one receive item is required.", 422, "RECEIVE_ITEMS_REQUIRED");
  for (const item of normalizedItems) {
    if (Array.isArray(item.perPiece)) {
      for (const piece of item.perPiece) {
        if (!locationIdFor({ body, item, piece })) {
          throw new AppError("Each physical receive piece requires a canonical locationId.", 422, "LOCATION_ID_REQUIRED");
        }
      }
    } else if (!locationIdFor({ body, item })) {
      throw new AppError("Each receive item requires a canonical locationId.", 422, "LOCATION_ID_REQUIRED");
    }
  }
  return Object.freeze({ taxTreatment, branchId });
}

async function resolveAndCanonicalizeLocations({ models, companyId, branchId, body = {}, items = [], transaction } = {}) {
  const ids = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (Array.isArray(item.perPiece)) {
      for (const piece of item.perPiece) ids.add(locationIdFor({ body, item, piece }));
    } else {
      ids.add(locationIdFor({ body, item }));
    }
  }
  const rows = await Promise.all([...ids].map((id) => models.InventoryLocation.findOne({
    where: { id, companyId, branchId, isActive: true },
    transaction,
  })));
  const locationMap = new Map(rows.filter(Boolean).map((row) => [row.id, row]));
  for (const id of ids) {
    if (!locationMap.has(id)) {
      throw new AppError(
        "The selected Location is missing, inactive, or outside the current company/branch.",
        422,
        "LOCATION_NOT_FOUND_OR_INACTIVE",
        { locationId: "Select an active Location in the current branch." }
      );
    }
  }
  const canonicalItems = (Array.isArray(items) ? items : []).map((item) => {
    const itemLocationId = locationIdFor({ body, item });
    const itemLocation = itemLocationId ? locationMap.get(itemLocationId) : null;
    return {
      ...item,
      ...(itemLocation ? { locationId: itemLocation.id, location: itemLocation.name } : {}),
      ...(Array.isArray(item.perPiece) ? {
        perPiece: item.perPiece.map((piece) => {
          const pieceLocationId = locationIdFor({ body, item, piece });
          const pieceLocation = locationMap.get(pieceLocationId);
          return {
            ...piece,
            locationId: pieceLocation.id,
            location: pieceLocation.name,
          };
        }),
      } : {}),
    };
  });
  return { locationMap, items: canonicalItems };
}

module.exports = {
  LOCATION_TEXT_FIELDS,
  locationIdFor,
  assertNoFreeTextLocation,
  assertBranchAuthority,
  assertCanonicalReceiveInput,
  resolveAndCanonicalizeLocations,
};
