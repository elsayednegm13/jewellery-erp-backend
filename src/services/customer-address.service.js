const { AppError } = require("../utils/errors");

const ADDRESS_KEYS = new Set(["line1", "line2", "city", "country", "postalCode", "isPrimary"]);
const ADDRESS_TEXT_KEYS = ["line1", "line2", "city", "country", "postalCode"];
const PROFILE_MUTATION_FIELDS = new Set([
  "name", "phone", "phoneCountry", "email", "tier", "notes", "nationality", "addresses",
]);

function addressError(message, fieldErrors = null, code = "INVALID_CUSTOMER_ADDRESS") {
  return new AppError(message, 422, code, fieldErrors);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeText(value, field) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw addressError(`${field} must be a string.`, { [field]: [`${field} must be a string.`] });
  }
  const trimmed = value.trim();
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

  const normalized = { isPrimary: address.isPrimary === undefined ? false : address.isPrimary };
  for (const key of ADDRESS_TEXT_KEYS) {
    const value = normalizeText(address[key], key);
    if (value !== null) normalized[key] = value;
  }

  if (typeof normalized.isPrimary !== "boolean") {
    throw addressError("isPrimary must be boolean.", { addresses: ["isPrimary must be boolean."] });
  }

  if (!ADDRESS_TEXT_KEYS.some((key) => normalized[key])) {
    throw addressError(
      "An address must contain at least one non-empty address text field.",
      { addresses: ["EMPTY_CUSTOMER_ADDRESS"] },
      "EMPTY_CUSTOMER_ADDRESS",
    );
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
    && ADDRESS_TEXT_KEYS.some((key) => typeof address[key] === "string" && address[key].trim());
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
  const update = {};
  for (const field of PROFILE_MUTATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field];
  }
  if (Object.prototype.hasOwnProperty.call(update, "nationality")) {
    update.nationality = normalizeText(update.nationality, "nationality");
  }
  if (Object.prototype.hasOwnProperty.call(update, "addresses")) {
    update.addresses = normalizeCustomerAddresses(update.addresses);
  }
  return update;
}

module.exports = {
  ADDRESS_KEYS,
  ADDRESS_TEXT_KEYS,
  PROFILE_MUTATION_FIELDS,
  normalizeCustomerAddresses,
  resolvePrimaryAddress,
  sanitizeCustomerMutation,
  isUsableLegacyAddress,
};
