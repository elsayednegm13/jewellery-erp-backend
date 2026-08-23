"use strict";

// V2 profile contracts use sellingPrice for Loose Diamond and salePrice for
// older/shared profiles.  Keep both explicit authorities ahead of the legacy
// normalized item.price fallback; the fallback remains available only when no
// explicit V2 sale-price authority was supplied.
function firstPresent(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function resolveAssetSellingPrice({ piece = {}, item = {}, fallback = null } = {}) {
  return firstPresent(
    piece.sellingPrice,
    piece.salePrice,
    item.sellingPrice,
    item.salePrice,
    item.price,
    fallback,
  );
}

module.exports = { firstPresent, resolveAssetSellingPrice };
