"use strict";

const { AppError } = require("../utils/errors");

/**
 * Validate the immutable pricing authority carried by a CGP snapshot.
 * Manual snapshots retain the approved Gold Center price contract; live
 * snapshots carry provider quote + policy lineage instead.  Consumers call
 * this before projecting facts so no downstream domain needs to re-price.
 */
function assertSnapshotPricingProvenance(snapshot) {
  const mode = String(snapshot?.pricingMode || "MANUAL_APPROVED").toUpperCase();
  if (mode === "MANUAL_APPROVED") {
    if (!snapshot.approvedPriceId || snapshot.approvedPriceStatus !== "APPROVED") {
      throw new AppError("CGP projection requires approved pricing provenance", 409, "CGP_APPROVED_PRICE_PROVENANCE_REQUIRED");
    }
    return mode;
  }
  if (mode === "LIVE_PROVIDER") {
    const required = ["provider", "marketQuoteId", "policyId", "finalEffectiveRate", "calculatedAt"];
    if (required.some((field) => snapshot[field] === null || snapshot[field] === undefined || String(snapshot[field]).trim() === "")) {
      throw new AppError("CGP live projection requires immutable market and policy provenance", 409, "CGP_LIVE_PRICE_PROVENANCE_REQUIRED");
    }
    return mode;
  }
  throw new AppError("CGP pricing mode is invalid", 409, "CGP_PRICING_MODE_INVALID");
}

module.exports = { assertSnapshotPricingProvenance };
