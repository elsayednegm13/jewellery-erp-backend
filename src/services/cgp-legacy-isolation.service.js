"use strict";

const { AppError, ValidationError } = require("../utils/errors");

// This server configuration is deliberately not readable from a request.  The
// default preserves legacy history/operations until a later Owner-authorized
// canonical CGP Posting cutover enables the isolation boundary.
const CGP_LEGACY_ISOLATION_ENV = "CGP_LEGACY_ISOLATION_ENABLED";
const CGP_PROFILE = "CGP_CUSTOMER_GOLD_PURCHASE";

function isCanonicalCgpCutoverActive(env = process.env) {
  return String(env[CGP_LEGACY_ISOLATION_ENV] || "").trim().toLowerCase() === "true";
}

function legacyCgpAcquisitionBlocked() {
  throw new AppError(
    "Legacy customer gold acquisition is unavailable while canonical CGP cutover is active.",
    409,
    "CGP_LEGACY_ACQUISITION_ISOLATED",
  );
}

function assertLegacyCustomerGoldAcquisitionAllowed({ env = process.env } = {}) {
  if (isCanonicalCgpCutoverActive(env)) legacyCgpAcquisitionBlocked();
}

function assertCgpDispositionConversionAllowed({ disposition, env = process.env } = {}) {
  if (String(disposition || "").toUpperCase() === "CONVERTED_TO_ASSET" && isCanonicalCgpCutoverActive(env)) {
    legacyCgpAcquisitionBlocked();
  }
}

function containsCgpProfile(value) {
  if (Array.isArray(value)) return value.some(containsCgpProfile);
  if (!value || typeof value !== "object") return false;
  if (String(value.profile || value.inventoryProfile || "").toUpperCase() === CGP_PROFILE) return true;
  return Object.values(value).some((child) => containsCgpProfile(child));
}

// Supplier Receive has no customer-acquisition meaning.  This is an
// unconditional domain boundary, independent of the later legacy cutover flag.
function assertSupplierReceiveDoesNotMasqueradeAsCgp({ body, items = [] } = {}) {
  const candidates = [body, ...items];
  if (candidates.some(containsCgpProfile)) {
    throw new ValidationError("Supplier Receive cannot be used for Customer Gold Purchase acquisition.");
  }
}

module.exports = {
  CGP_LEGACY_ISOLATION_ENV,
  CGP_PROFILE,
  isCanonicalCgpCutoverActive,
  assertLegacyCustomerGoldAcquisitionAllowed,
  assertCgpDispositionConversionAllowed,
  assertSupplierReceiveDoesNotMasqueradeAsCgp,
};
