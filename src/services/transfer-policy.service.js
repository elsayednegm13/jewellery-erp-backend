"use strict";

const { AppError, ValidationError } = require("../utils/errors");

const TRANSFER_PERMISSIONS = Object.freeze({
  read: "inventory.transfer.read",
  create: "inventory.transfer.create",
  approve: "inventory.transfer.approve",
  dispatch: "inventory.transfer.dispatch",
  receive: "inventory.transfer.receive",
  cancel: "inventory.transfer.cancel",
});

const TRANSFER_STATUSES = Object.freeze(["pending", "approved", "in-transit", "received", "cancelled"]);
const ACTIVE_ITEM_STATUSES = Object.freeze(["PENDING", "APPROVED", "IN_TRANSIT"]);
const CREATE_FIELDS = Object.freeze(["assetIds", "fromBranchId", "toBranchId", "fromLocationId", "toLocationId", "notes"]);
const PATCH_FIELDS = Object.freeze(["status", "cancelReason"]);

const TRANSITIONS = Object.freeze({
  pending: Object.freeze({ approved: "approve", cancelled: "cancel" }),
  approved: Object.freeze({ "in-transit": "dispatch", cancelled: "cancel" }),
  "in-transit": Object.freeze({ received: "receive" }),
  received: Object.freeze({}),
  cancelled: Object.freeze({}),
});

function normalizeRequiredId(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new ValidationError(field + " is required.");
  return normalized;
}

function normalizeCreateBody(body = {}) {
  const unknown = Object.keys(body).filter((key) => !CREATE_FIELDS.includes(key));
  if (unknown.length) throw new ValidationError("Unknown transfer fields: " + unknown.join(", "));
  if (!Array.isArray(body.assetIds) || body.assetIds.length === 0) {
    throw new ValidationError("At least one Asset is required for a transfer.");
  }
  const assetIds = body.assetIds.map((value) => normalizeRequiredId(value, "assetIds[]"));
  if (new Set(assetIds).size !== assetIds.length) throw new ValidationError("Duplicate Asset IDs are not allowed.");
  const fromBranchId = normalizeRequiredId(body.fromBranchId, "fromBranchId");
  const toBranchId = normalizeRequiredId(body.toBranchId, "toBranchId");
  const fromLocationId = normalizeRequiredId(body.fromLocationId, "fromLocationId");
  const toLocationId = normalizeRequiredId(body.toLocationId, "toLocationId");
  if (fromBranchId === toBranchId) throw new ValidationError("Source and destination branches must differ.");
  return {
    assetIds,
    fromBranchId,
    toBranchId,
    fromLocationId,
    toLocationId,
    notes: body.notes == null ? "" : String(body.notes),
  };
}

function normalizePatchBody(body = {}) {
  const unknown = Object.keys(body).filter((key) => !PATCH_FIELDS.includes(key));
  if (unknown.length) throw new ValidationError("Unknown transfer fields: " + unknown.join(", "));
  const status = normalizeRequiredId(body.status, "status");
  if (!TRANSFER_STATUSES.includes(status)) throw new ValidationError("Invalid transfer lifecycle status.");
  if (status !== "cancelled" && body.cancelReason !== undefined) {
    throw new ValidationError("cancelReason is only valid when cancelling a transfer.");
  }
  return { status, cancelReason: body.cancelReason == null ? null : String(body.cancelReason) };
}

function actionForTransition(currentStatus, nextStatus) {
  const action = TRANSITIONS[currentStatus]?.[nextStatus];
  if (!action) throw new ValidationError("Illegal transfer transition: " + currentStatus + " -> " + nextStatus + ".");
  return action;
}

function assertTransferBranchContext(req, expectedBranchId, operation) {
  const current = String(req?.branchId || "").trim();
  const expected = String(expectedBranchId || "").trim();
  if (!current) throw new AppError("A Branch context is required for transfer operations.", 422, "BRANCH_CONTEXT_REQUIRED");
  if (!expected || current !== expected) {
    throw new AppError("Transfer " + operation + " must use the authorized Branch context.", 403, "TRANSFER_BRANCH_SCOPE_FORBIDDEN");
  }
  return current;
}

function assertVisibleTransferBranch(req, transfer) {
  const current = assertTransferBranchContext(req, req.branchId, "read");
  if (String(transfer.fromBranchId) !== current && String(transfer.toBranchId) !== current) {
    throw new AppError("Transfer is outside the authorized Branch scope.", 403, "TRANSFER_BRANCH_SCOPE_FORBIDDEN");
  }
}

module.exports = {
  TRANSFER_PERMISSIONS,
  TRANSFER_STATUSES,
  ACTIVE_ITEM_STATUSES,
  CREATE_FIELDS,
  PATCH_FIELDS,
  normalizeCreateBody,
  normalizePatchBody,
  actionForTransition,
  assertTransferBranchContext,
  assertVisibleTransferBranch,
};
