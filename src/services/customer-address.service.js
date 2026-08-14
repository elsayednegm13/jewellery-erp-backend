const { AppError } = require("../utils/errors");

const ADDRESS_KEYS = new Set(["line1", "line2", "city", "country", "postalCode", "isPrimary"]);
const OPTIONAL_TEXT_KEYS = new Set(["line2", "postalCode"]);

function addressError(message, fieldErrors = null, code = "INVALID_CUSTOMER_ADDRESS") {
  return new AppError(message, 422, code, fieldErrors);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeText(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw addressError(`${field} is required.`, { [field]: [`${field} is required.`] });
    return null;
  }
  if (typeof value !== "string") {
    throw addressError(`${field} must be a string.`, { [field]: [`${field} must be a string.`] });
  }
  const trimmed = value.trim();
  if (!trimmed && required) {
    throw addressError(`${field} is required.`, { [field]: [`${field} is required.`] });
  }
  return trimmed || null;
}

function normalizeAddress(address, index) {
  if (!isPlainObject(address)) {
    throw addressError(`Address at index ${index} must be an object.`, { addresses: [`Address at index ${index} must be an object.`] });
  }

  const unknownKeys = Object.keys(address).filter((key) => !ADDRESS_KEYS.has(key));
  if (unknownKeys.length) {
    throw addressError(`Unsupported customer address fields: ${unknownKeys.join(", ")}.`, { addresses: [`Unsupported fields: ${unknownKeys.join(", ")}`] });
  }

  const normalized = {
    line1: normalizeText(address.line1, "line1", { required: true }),
    line2: normalizeText(address.line2, "line2"),
    city: normalizeText(address.city, "city", { required: true }),
    country: normalizeText(address.country, "country", { required: true }),
    postalCode: normalizeText(address.postalCode, "postalCode"),
    isPrimary: address.isPrimary === undefined ? false : address.isPrimary,
  };

  if (typeof normalized.isPrimary !== "boolean") {
    throw addressError("isPrimary must be boolean.", { addresses: ["isPrimary must be boolean."] });
  }

  for (const key of OPTIONAL_TEXT_KEYS) {
    if (normalized[key] === null) delete normalized[key];
  }
  return normalized;
}

function normalizeCustomerAddresses(addresses) {
  if (addresses === undefined) return undefined;
  if (!Array.isArray(addresses)) {
    throw addressError("addresses must be an array.", { addresses: ["addresses must be an array."] });
  }

  const normalized = addresses.map((address, index) => normalizeAddress(address, index));
  const primaryIndexes = normalized.reduce((result, address, index) => {
    if (address.isPrimary) result.push(index);
    return result;
  }, []);
  if (primaryIndexes.length > 1) {
    throw addressError("Only one customer address may be Primary.", { addresses: ["MULTIPLE_PRIMARY_ADDRESSES"] }, "MULTIPLE_PRIMARY_ADDRESSES");
  }
  if (normalized.length && primaryIndexes.length === 0) normalized[0].isPrimary = true;
  return normalized;
}

function isUsableLegacyAddress(address) {
  return isPlainObject(address)
    && typeof address.line1 === "string" && address.line1.trim()
    && typeof address.city === "string" && address.city.trim()
    && typeof address.country === "string" && address.country.trim();
}

function resolvePrimaryAddress(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { primaryAddress: null, source: "NONE" };
  }

  const usable = addresses.filter(isUsableLegacyAddress);
  const explicit = usable.filter((address) => address.isPrimary === true);
  if (explicit.length > 1) return { primaryAddress: null, source: "NONE" };
  if (explicit.length === 1) return { primaryAddress: { ...explicit[0] }, source: "EXPLICIT_PRIMARY" };
  if (usable.length === 1) return { primaryAddress: { ...usable[0] }, source: "SINGLE_ADDRESS" };
  if (usable.length > 1) return { primaryAddress: { ...usable[0] }, source: "LEGACY_FALLBACK" };
  return { primaryAddress: null, source: "NONE" };
}

function sanitizeCustomerMutation(body = {}) {
  const update = { ...body };
  const serverOwned = [
    "companyId", "company_id", "balance", "purchases", "loyaltyPoints", "loyalty_points",
    "availableCredit", "available_credit", "status",
    "creditLedger", "credit_ledger", "audit", "auditFields", "createdAt", "created_at",
    "updatedAt", "updated_at", "expectedUpdatedAt"
  ];
  for (const field of serverOwned) delete update[field];
  if (Object.prototype.hasOwnProperty.call(update, "addresses")) {
    update.addresses = normalizeCustomerAddresses(update.addresses);
  }
  return update;
}

module.exports = {
  ADDRESS_KEYS,
  normalizeCustomerAddresses,
  resolvePrimaryAddress,
  sanitizeCustomerMutation,
  isUsableLegacyAddress,
};
